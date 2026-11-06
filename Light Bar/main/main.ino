#include <FastLED.h>
#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// LED Strip configuration
#define LED_PIN 20     // GPIO pin connected to the LED strip
#define LED_COUNT 20   // Number of LEDs in the strip - a hardware constant (the array
                        // below is sized at compile time), NOT settable over BLE. If you
                        // change the physical strip length, update this AND the "LED
                        // count" setting in the app (Settings screen) to match - the app
                        // uses its own copy of this number purely for its cycle-time-to-
                        // per-LED-delay math and has no way to read it back from here.
#define LED_CHIPSET WS2811
#define LED_COLOR_ORDER RGB // Verify with solid red, green, and blue test colors.
CRGB leds[LED_COUNT];  // Define the LED strip array

// BLE UUIDs
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

// Advertised BLE name. The companion app scans for exactly this name (see
// EmdrWirelessApp) - there's only ever one Light Bar per kit, so this rarely
// needs to change, but keeping it here (not in a separate config file) keeps
// every per-device setting in one visible place across both sketches.
const String DEVICE_NAME = "Light Bar";

// Bumped whenever a characteristic's byte layout changes. Every write's first byte
// must match this, or firmware rejects it outright - this is what lets the app
// detect "this device is running firmware from a different protocol generation"
// instead of a write silently doing nothing because the old/new layouts happened
// to both pass the length/range checks. See root README's BLE protocol contract.
const uint8_t PROTOCOL_VERSION = 1;

// LED defaults
const uint8_t DEFAULT_LIGHT_R = 0;
const uint8_t DEFAULT_LIGHT_G = 0;
const uint8_t DEFAULT_LIGHT_B = 0;
const uint8_t DEFAULT_LIGHT_DELAY = 20;

// Cap how much a single resync can pull the animation timing in, so a step is never
// abruptly cut short/stretched enough for the patient to notice
const uint8_t SYNC_MAX_CORRECTION_PERCENT = 20;

// Battery: no voltage-divider hardware confirmed wired to this pin yet - the GATT
// plumbing is real and complete, but readBatteryPercent()'s calibration constants
// are placeholders until real hardware is wired. See that function's comment.
const int BATTERY_ADC_PIN = 0;
const unsigned long BATTERY_UPDATE_INTERVAL_MS = 60000;
unsigned long lastBatteryUpdate = 0;

// LED state variables
volatile uint8_t light_state = 0;
volatile uint8_t light_r = DEFAULT_LIGHT_R;
volatile uint8_t light_g = DEFAULT_LIGHT_G;
volatile uint8_t light_b = DEFAULT_LIGHT_B;
volatile uint8_t light_delay = DEFAULT_LIGHT_DELAY;

// Animation control variables
volatile int current_led = 0;
volatile bool forward_direction = true;
volatile unsigned long last_led_update = 0;
volatile bool animation_active = false;

// For handling new values between cycles
volatile bool new_values_pending = false;
volatile uint8_t new_light_state = 0;
volatile uint8_t new_light_r = DEFAULT_LIGHT_R;
volatile uint8_t new_light_g = DEFAULT_LIGHT_G;
volatile uint8_t new_light_b = DEFAULT_LIGHT_B;
volatile uint8_t new_light_delay = DEFAULT_LIGHT_DELAY;

// BLE state
volatile bool deviceConnected = false;
BLEServer* pServer = nullptr;
BLECharacteristic* pDeviceStateChar = nullptr;
BLECharacteristic* pBatteryChar = nullptr;

// Pushes the current applied state onto DEVICE_STATE_CHARACTERISTIC and notifies
// any subscriber - call this after anything that changes the applied light_* fields.
void updateDeviceState() {
  if (!pDeviceStateChar) return;
  uint8_t payload[6] = { PROTOCOL_VERSION, light_state, light_r, light_g, light_b, light_delay };
  pDeviceStateChar->setValue(payload, 6);
  // Only notify once a client is actually connected/subscribed - calling notify()
  // this early (e.g. from setup(), before any connection exists) crashed the
  // Light Bar Test Rig with a Load access fault, so this guard is load-bearing.
  if (deviceConnected) pDeviceStateChar->notify();
}

// TODO: this assumes a 2:1 resistor divider bringing a single-cell LiPo (3.3V empty,
// 4.2V full) down into the ADC's safe range, on BATTERY_ADC_PIN. No such divider is
// confirmed wired on current hardware - calibrate or rewire before trusting this
// value. Until then it reports whatever the floating/undivided pin happens to read.
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

// Apply new LED parameters after cycle
void applyPendingValues() {
  if (new_values_pending) {
    light_state = new_light_state;
    light_r = new_light_r;
    light_g = new_light_g;
    light_b = new_light_b;
    light_delay = new_light_delay;

    if (!light_state) {
      FastLED.clear();
      FastLED.show();
      animation_active = false;
    } else if (!animation_active) {
      current_led = 0;
      forward_direction = true;
      animation_active = true;
    }

    new_values_pending = false;
    updateDeviceState();
  }
}

// BLE Server callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    updateBatteryLevel();
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;

    // Stop the animation and reset to defaults so a new connection always starts from a clean, known state
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
    FastLED.clear();
    FastLED.show();
    updateDeviceState();
  }
};

// LED state characteristic callback
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

// LED color characteristic callback
class LedColorCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 4) {
      if (data[0] != PROTOCOL_VERSION) return;
      uint8_t r = data[1];
      uint8_t g = data[2];
      uint8_t b = data[3];

      new_light_r = r;
      new_light_g = g;
      new_light_b = b;
      new_values_pending = true;
      if (!light_state || !animation_active) applyPendingValues();
    }
  }
};

// LED delay characteristic callback
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

// The two end LEDs (where the sweep reverses direction) dwell for 2x light_delay
// instead of 1x. This isn't cosmetic - the app times each pulsator's on/off phase
// to a full one-way pass, computed as light_delay * LED_COUNT (see StimulationEngine.ts).
// Without this doubling, a real one-way pass only takes light_delay * (LED_COUNT-1),
// which would drift out of sync with the pulsators over a session. Doubling both
// ends makes the two formulas agree exactly - see project notes on the sync model.
unsigned long dwellMsFor(int ledIndex) {
  bool atEnd = (ledIndex == 0) || (ledIndex == LED_COUNT - 1);
  return (unsigned long)light_delay * (atEnd ? 2 : 1);
}

// Non-blocking LED animation update
void update_led_animation() {
  unsigned long current_time = millis();

  // Only update if enough time has passed
  if (current_time - last_led_update >= dwellMsFor(current_led)) {
    last_led_update = current_time;
    animation_active = true;

    // Clear all LEDs
    FastLED.clear();

    // Set the current LED color
    CRGB color = CRGB(light_r, light_g, light_b);
    leds[current_led] = color;

    // Update the display
    FastLED.show();

    // Calculate next LED position
    if (forward_direction) {
      current_led = current_led + 1;
      if (current_led >= LED_COUNT - 1) {
        current_led = LED_COUNT - 1;
        forward_direction = false;

        // Check for pending values when changing direction at the end
        if (new_values_pending) {
          applyPendingValues();
        }
      }
    } else {
      current_led = current_led - 1;
      if (current_led <= 0) {
        current_led = 0;
        forward_direction = true;

        // Check for pending values when changing direction at the beginning
        if (new_values_pending) {
          applyPendingValues();
        }
      }
    }
  }
}

// Periodic resync trigger: nudges the animation's step timing toward "a step boundary
// is happening now" instead of snapping to it, so repeated pings gradually converge
// the light bar's cadence with the pulsators without ever visibly skipping a step.
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

// Keep the descriptor for compatibility with the deployed BLE clients.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
void setup() {
  // Initialize LED strip
  // The protocol sends RGB bytes. FastLED maps CRGB(r, g, b) to this strip's
  // physical channel order. Change LED_COLOR_ORDER to GRB if the channel test
  // shows that this strip uses GRB ordering.
  FastLED.addLeds<LED_CHIPSET, LED_PIN, LED_COLOR_ORDER>(leds, LED_COUNT);
  FastLED.clear();  // Clear all LEDs
  FastLED.show();   // Update LEDs with all off

  BLEDevice::init(DEVICE_NAME.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(LIGHTBAR_SERVICE_UUID);

  // LED state characteristic - WRITE_NR too, so the app can send it without waiting
  // for an ATT round-trip (see EmdrWirelessApp/src/ble/BleService.ts).
  BLECharacteristic* pLedStateChar = pService->createCharacteristic(
    LED_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedStateChar->setCallbacks(new LedStateCallback());

  // LED color characteristic
  BLECharacteristic* pLedColorChar = pService->createCharacteristic(
    LED_COLOR_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedColorChar->setCallbacks(new LedColorCallback());

  // LED delay characteristic
  BLECharacteristic* pLedDelayChar = pService->createCharacteristic(
    LED_DELAY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pLedDelayChar->setCallbacks(new LedDelayCallback());

  // LED sync characteristic (write-without-response for minimal latency)
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
#pragma GCC diagnostic pop

void loop() {
  while (!deviceConnected) {
    delay(500);
    pServer->startAdvertising();
  }

  // Update LED animation if active
  if (light_state) {
    update_led_animation();
  }

  unsigned long now = millis();
  if (now - lastBatteryUpdate >= BATTERY_UPDATE_INTERVAL_MS) {
    lastBatteryUpdate = now;
    updateBatteryLevel();
  }
}
