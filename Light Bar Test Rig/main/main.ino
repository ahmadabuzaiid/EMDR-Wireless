// ============================================================================
// LIGHT BAR - BLE COMMUNICATION TEST RIG (NOT the real firmware)
// ============================================================================
// Advertises itself exactly like the real Light Bar (same name, same service/
// characteristic UUIDs, same write validation rules - see "Light Bar/main/main.ino"),
// so the EmdrWirelessApp can connect to it with zero changes. There's no LED strip
// here though - every characteristic write is instead reflected on the ESP32-C3
// SuperMini's own built-in LED, purely so you can visually confirm the app <-> chip
// communication works without having the real strip wired up.
//
// The built-in LED on this board turned out to be a PLAIN single LED (confirmed by
// testing - not the WS2812 addressable RGB pixel some SuperMini variants have), so
// it can't display arbitrary colors - LED_COLOR writes are still received, stored,
// and echoed back on DEVICE_STATE_CHARACTERISTIC, but have no visible effect here.
//
// What it DOES simulate is the real Light Bar's sweep timing: it runs the exact
// same position/direction/dwell-time engine as "Light Bar/main/main.ino" (including
// the 2x end-LED dwell and the LED_SYNC phase-nudge), just without a strip to
// render to. The built-in LED is lit for one direction of the simulated sweep and
// off for the other - so you can watch it alongside the Pulsators Test Rigs and
// visually confirm they're switching at the same instant the sweep reverses (see
// StimulationEngine.ts's alternation timing: fullDelayMs * ledCount).
// ============================================================================

#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// Built-in LED: a plain PWM-driven LED on GPIO8 (confirmed by testing - this board
// does not have the addressable WS2812 pixel some ESP32-C3 SuperMini variants do).
#define LED_PIN 8
// Most SuperMini onboard LEDs are wired active-low (LOW = on). If state=1 doesn't
// turn the LED on, flip this.
const bool LED_ACTIVE_LOW = true;
const uint8_t ON_BRIGHTNESS = 255;

// Purely a timing simulation parameter - there's no physical strip, but the sweep's
// direction-reversal timing depends on it exactly the way the real Light Bar's
// LED_COUNT does. Must match the app's Settings -> LED Count setting for the
// pulsator-sync test described above to actually line up.
#define SIMULATED_LED_COUNT 20

// BLE UUIDs - identical to the real Light Bar, so the app doesn't need to know
// it's talking to a test rig instead of the real hardware.
#define LIGHTBAR_SERVICE_UUID "1fb5c201-4faf-459e-8fcc-c5c9c331914b"
#define LED_STATE_CHARACTERISTIC_UUID "2cac943b-668b-4de0-8091-332dedc91739"
#define LED_COLOR_CHARACTERISTIC_UUID "526f1035-4262-4175-8ad0-16387b946fce"
#define LED_DELAY_CHARACTERISTIC_UUID "ee231dc3-9f67-4254-a52a-e41b59f50502"
#define LED_SYNC_CHARACTERISTIC_UUID "822ff8ad-58e1-44f8-8cb5-f4048a0ee3c3"
// Read+Notify: mirrors what was actually applied, so the app can resync its UI
// after a reconnect instead of guessing/assuming its last-known values are current.
#define DEVICE_STATE_CHARACTERISTIC_UUID "78cb7a5e-4253-461c-83c5-75d3faa4fe2c"

// Standard Bluetooth SIG Battery Service - the 16-bit UUIDs below expand to the
// full 128-bit Base UUID automatically.
#define BATTERY_SERVICE_UUID "180F"
#define BATTERY_LEVEL_CHARACTERISTIC_UUID "2A19"

// Advertised BLE name - must match what the app scans for. If you're also running
// a real Light Bar nearby, having two devices advertise the same name is fine (the
// app connects to whichever has the stronger signal) but can be confusing - consider
// temporarily renaming this one, e.g. "Light Bar Test", while debugging.
const String DEVICE_NAME = "Light Bar";

// Bumped whenever a characteristic's byte layout changes. Every write's first byte
// must match this, or firmware rejects it outright - matches the real Light Bar and
// Pulsators sketches, so this test rig genuinely exercises the same protocol.
const uint8_t PROTOCOL_VERSION = 1;

const uint8_t DEFAULT_LIGHT_R = 0;
const uint8_t DEFAULT_LIGHT_G = 0;
const uint8_t DEFAULT_LIGHT_B = 0;
const uint8_t DEFAULT_LIGHT_DELAY = 20;

// Cap how much a single resync can pull the animation timing in, so a step is never
// abruptly cut short/stretched enough to be visually jarring - same rule as the real
// Light Bar.
const uint8_t SYNC_MAX_CORRECTION_PERCENT = 20;

// Battery: no voltage-divider hardware confirmed wired to this pin yet - the GATT
// plumbing is real and complete, but readBatteryPercent()'s calibration constants
// are placeholders until real hardware is wired. See that function's comment.
const int BATTERY_ADC_PIN = 0;
const unsigned long BATTERY_UPDATE_INTERVAL_MS = 60000;
unsigned long lastBatteryUpdate = 0;

// Applied state
volatile uint8_t light_state = 0;
volatile uint8_t light_r = DEFAULT_LIGHT_R;
volatile uint8_t light_g = DEFAULT_LIGHT_G;
volatile uint8_t light_b = DEFAULT_LIGHT_B;
volatile uint8_t light_delay = DEFAULT_LIGHT_DELAY;

// Simulated sweep position/direction - same roles as the real Light Bar's.
volatile int current_led = 0;
volatile bool forward_direction = true;
volatile unsigned long last_led_update = 0;
volatile bool animation_active = false;

// For handling new values between simulated sweep passes, same as the real Light Bar.
volatile bool new_values_pending = false;
volatile uint8_t new_light_state = 0;
volatile uint8_t new_light_r = DEFAULT_LIGHT_R;
volatile uint8_t new_light_g = DEFAULT_LIGHT_G;
volatile uint8_t new_light_b = DEFAULT_LIGHT_B;
volatile uint8_t new_light_delay = DEFAULT_LIGHT_DELAY;

volatile bool deviceConnected = false;
BLEServer* pServer = nullptr;
BLECharacteristic* pDeviceStateChar = nullptr;
BLECharacteristic* pBatteryChar = nullptr;

// Sets the plain LED's brightness (0-255), accounting for active-low wiring.
void setLedLevel(uint8_t brightness) {
  analogWrite(LED_PIN, LED_ACTIVE_LOW ? (255 - brightness) : brightness);
}

// Lit only while the sweep is "running" AND currently in its forward pass - off
// during the return pass. This is the whole point of this sketch: a clean on/off
// signal you can compare against the Pulsators Test Rigs' own on/off timing.
void showCurrentState() {
  setLedLevel((light_state && forward_direction) ? ON_BRIGHTNESS : 0);
}

// Pushes the current applied state onto DEVICE_STATE_CHARACTERISTIC and notifies
// any subscriber - call this after anything that changes the applied light_* fields.
void updateDeviceState() {
  if (!pDeviceStateChar) return;
  uint8_t payload[6] = { PROTOCOL_VERSION, light_state, light_r, light_g, light_b, light_delay };
  pDeviceStateChar->setValue(payload, 6);
  // Only notify once a client is actually connected/subscribed - calling notify()
  // this early (e.g. from setup(), before any connection exists) crashed this
  // exact sketch with a Load access fault, so this guard is load-bearing.
  if (deviceConnected) pDeviceStateChar->notify();
}

uint8_t readBatteryPercent() {
  const float EMPTY_V = 3.3;
  const float FULL_V = 4.2;
  int raw = analogRead(BATTERY_ADC_PIN);
  float voltage = (raw / 4095.0) * 3.3 * 2.0;
  float percent = (voltage - EMPTY_V) / (FULL_V - EMPTY_V) * 100.0;
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return (uint8_t)percent;
}

void updateBatteryLevel() {
  if (!pBatteryChar) return;
  uint8_t percent = readBatteryPercent();
  pBatteryChar->setValue(&percent, 1);
  if (deviceConnected) pBatteryChar->notify();
}

// Apply new parameters at a safe point in the simulated sweep (see LedStateCallback/
// LedDelayCallback for when this gets called immediately vs. deferred).
void applyPendingValues() {
  if (new_values_pending) {
    light_state = new_light_state;
    light_r = new_light_r;
    light_g = new_light_g;
    light_b = new_light_b;
    light_delay = new_light_delay;

    if (!light_state) {
      animation_active = false;
    } else if (!animation_active) {
      current_led = 0;
      forward_direction = true;
      animation_active = true;
    }
    showCurrentState();

    new_values_pending = false;
    updateDeviceState();
  }
}

void resetToDefaults() {
  light_state = 0;
  light_r = DEFAULT_LIGHT_R;
  light_g = DEFAULT_LIGHT_G;
  light_b = DEFAULT_LIGHT_B;
  light_delay = DEFAULT_LIGHT_DELAY;
  current_led = 0;
  forward_direction = true;
  animation_active = false;
  new_light_state = 0;
  new_light_r = DEFAULT_LIGHT_R;
  new_light_g = DEFAULT_LIGHT_G;
  new_light_b = DEFAULT_LIGHT_B;
  new_light_delay = DEFAULT_LIGHT_DELAY;
  new_values_pending = false;
  showCurrentState();
  updateDeviceState();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    updateBatteryLevel();
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    resetToDefaults();
  }
};

class LedStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 2) {
      if (data[0] != PROTOCOL_VERSION) return;
      uint8_t value = data[1];
      if (value != 0 && value != 1) return;

      new_light_state = value;
      new_values_pending = true;
      // Turning off shouldn't wait for the sweep to reach an end
      if (!light_state || !animation_active || !value) applyPendingValues();
    }
  }
};

class LedColorCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 4) {
      if (data[0] != PROTOCOL_VERSION) return;
      uint8_t r = data[1];
      uint8_t g = data[2];
      uint8_t b = data[3];

      // No physical effect on this board (see file header) - stored and applied
      // immediately purely so DEVICE_STATE_CHARACTERISTIC echoes back what was
      // actually written, same as every other characteristic here.
      light_r = r;
      light_g = g;
      light_b = b;
      updateDeviceState();
    }
  }
};

class LedDelayCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 2) {
      if (data[0] != PROTOCOL_VERSION) return;
      uint8_t value = data[1];
      if (value < 20 || value > 100 || value % 5 != 0) return;

      new_light_delay = value;
      new_values_pending = true;
      if (!light_state || !animation_active) applyPendingValues();
    }
  }
};

// The two ends of the simulated sweep (where direction reverses) dwell for 2x
// light_delay instead of 1x - identical rule to the real Light Bar, and for the
// same reason: it's what makes fullDelayMs * SIMULATED_LED_COUNT (the pulsators'
// alternation period) line up exactly with a real one-way pass. See the comment
// on dwellMsFor() in "Light Bar/main/main.ino" for the full derivation.
unsigned long dwellMsFor(int ledIndex) {
  bool atEnd = (ledIndex == 0) || (ledIndex == SIMULATED_LED_COUNT - 1);
  return (unsigned long)light_delay * (atEnd ? 2 : 1);
}

// Tracks the simulated sweep position/direction exactly like the real Light Bar's
// update_led_animation() - just without a strip to render to. showCurrentState()
// is called right when forward_direction flips, since that's the only moment the
// built-in LED's on/off state actually needs to change.
void update_direction_animation() {
  unsigned long current_time = millis();

  if (current_time - last_led_update >= dwellMsFor(current_led)) {
    last_led_update = current_time;
    animation_active = true;

    if (forward_direction) {
      current_led++;
      if (current_led >= SIMULATED_LED_COUNT - 1) {
        current_led = SIMULATED_LED_COUNT - 1;
        forward_direction = false;
        showCurrentState();
        if (new_values_pending) applyPendingValues();
      }
    } else {
      current_led--;
      if (current_led <= 0) {
        current_led = 0;
        forward_direction = true;
        showCurrentState();
        if (new_values_pending) applyPendingValues();
      }
    }
  }
}

// Periodic resync trigger - identical logic to the real Light Bar's: nudges the
// simulated sweep's phase toward "a step boundary is happening now" instead of
// snapping to it.
class LedSyncCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (!data || pCharacteristic->getLength() != 1 || data[0] != PROTOCOL_VERSION) return;
    if (!light_state || !animation_active) return;  // nothing running, nothing to sync

    unsigned long now = millis();
    unsigned long elapsed = now - last_led_update;
    unsigned long maxCorrection = (uint32_t)light_delay * SYNC_MAX_CORRECTION_PERCENT / 100;
    if (maxCorrection < 1) maxCorrection = 1;
    unsigned long correction = (elapsed < maxCorrection) ? elapsed : maxCorrection;

    last_led_update -= correction;
  }
};

void setup() {
  pinMode(LED_PIN, OUTPUT);
  last_led_update = millis();
  showCurrentState();

  BLEDevice::init(DEVICE_NAME.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(LIGHTBAR_SERVICE_UUID);

  // LED state characteristic - WRITE_NR too, so the app can send it without waiting
  // for an ATT round-trip (see EmdrWirelessApp/src/ble/BleService.ts).
  BLECharacteristic* pLedStateChar = pService->createCharacteristic(
    LED_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedStateChar->setCallbacks(new LedStateCallback());

  BLECharacteristic* pLedColorChar = pService->createCharacteristic(
    LED_COLOR_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedColorChar->setCallbacks(new LedColorCallback());

  BLECharacteristic* pLedDelayChar = pService->createCharacteristic(
    LED_DELAY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedDelayChar->setCallbacks(new LedDelayCallback());

  BLECharacteristic* pLedSyncChar = pService->createCharacteristic(
    LED_SYNC_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedSyncChar->setCallbacks(new LedSyncCallback());

  // Device state characteristic (read-back for UI resync on reconnect).
  // NOTE: the esp32 core does warn that manually adding a BLE2902 descriptor is
  // deprecated (NimBLE auto-adds the CCCD for NOTIFY characteristics) - but
  // removing it caused an immediate boot crash (Load access fault) on real
  // hardware, so it stays until that's root-caused properly. Warning > crash.
  pDeviceStateChar = pService->createCharacteristic(
    DEVICE_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pDeviceStateChar->addDescriptor(new BLE2902());
  updateDeviceState();

  pService->start();

  // Standard Battery Service
  BLEService* pBatteryService = pServer->createService(BATTERY_SERVICE_UUID);
  pBatteryChar = pBatteryService->createCharacteristic(
    BATTERY_LEVEL_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  pBatteryChar->addDescriptor(new BLE2902());
  updateBatteryLevel();
  pBatteryService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(LIGHTBAR_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // 7.5ms
  pAdvertising->setMaxPreferred(0x12);  // 22.5ms
  BLEDevice::startAdvertising();
}

void loop() {
  while (!deviceConnected) {
    delay(500);
    pServer->startAdvertising();
  }

  if (light_state) {
    update_direction_animation();
  }

  unsigned long now = millis();
  if (now - lastBatteryUpdate >= BATTERY_UPDATE_INTERVAL_MS) {
    lastBatteryUpdate = now;
    updateBatteryLevel();
  }
}
