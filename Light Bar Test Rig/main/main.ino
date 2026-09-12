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
// it can't display arbitrary colors. It's driven with plain PWM instead: color
// writes are reflected as brightness (perceived luminance of the RGB value), state
// on/off is on/off, and delay/sync writes still get their own distinct blink pattern.
// No sweep animation, no drift correction - those only make sense across a real
// multi-LED strip.
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
const uint8_t ACK_BRIGHTNESS = 60; // dim-ish, so ack blinks are visible but not blinding

// Battery: no voltage-divider hardware confirmed wired to this pin yet - the GATT
// plumbing is real and complete, but readBatteryPercent()'s calibration constants
// are placeholders until real hardware is wired. See that function's comment.
const int BATTERY_ADC_PIN = 0;
const unsigned long BATTERY_UPDATE_INTERVAL_MS = 60000;
unsigned long lastBatteryUpdate = 0;

// Current state - every write below applies immediately since there's no
// animation cycle here to protect from a mid-cycle interruption.
uint8_t light_state = 0;
uint8_t light_r = DEFAULT_LIGHT_R;
uint8_t light_g = DEFAULT_LIGHT_G;
uint8_t light_b = DEFAULT_LIGHT_B;
uint8_t light_delay = DEFAULT_LIGHT_DELAY;

volatile bool deviceConnected = false;
BLEServer* pServer = nullptr;
BLECharacteristic* pDeviceStateChar = nullptr;
BLECharacteristic* pBatteryChar = nullptr;

// Sets the plain LED's brightness (0-255), accounting for active-low wiring.
void setLedLevel(uint8_t brightness) {
  analogWrite(LED_PIN, LED_ACTIVE_LOW ? (255 - brightness) : brightness);
}

// Perceived-luminance approximation (0.299R + 0.587G + 0.114B in fixed point),
// so a color write is reflected as "how bright would this color look" rather
// than picking one channel arbitrarily.
uint8_t colorToBrightness(uint8_t r, uint8_t g, uint8_t b) {
  return (uint8_t)(((uint16_t)r * 77 + (uint16_t)g * 151 + (uint16_t)b * 28) >> 8);
}

void showCurrentState() {
  setLedLevel(light_state ? colorToBrightness(light_r, light_g, light_b) : 0);
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

// Brief blink(s) to acknowledge a write that has no natural steady-state visual
// of its own (delay/sync), then restores whatever was showing before.
void blinkAck(uint8_t times) {
  for (uint8_t i = 0; i < times; i++) {
    setLedLevel(ACK_BRIGHTNESS);
    delay(80);
    setLedLevel(0);
    delay(80);
  }
  showCurrentState();
}

void resetToDefaults() {
  light_state = 0;
  light_r = DEFAULT_LIGHT_R;
  light_g = DEFAULT_LIGHT_G;
  light_b = DEFAULT_LIGHT_B;
  light_delay = DEFAULT_LIGHT_DELAY;
  showCurrentState();
  updateDeviceState();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("Device connected");
    updateBatteryLevel();
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    resetToDefaults();
    Serial.println("Device disconnected, reset to defaults");
  }
};

class LedStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 2) {
      if (data[0] != PROTOCOL_VERSION) {
        Serial.println("LED state: protocol version mismatch, ignoring");
        return;
      }
      uint8_t value = data[1];
      Serial.print("Received LED state: ");
      Serial.println(value);
      if (value != 0 && value != 1) {
        Serial.println("Invalid LED state");
        return;
      }

      light_state = value;
      showCurrentState();
      updateDeviceState();
    }
  }
};

class LedColorCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 4) {
      if (data[0] != PROTOCOL_VERSION) {
        Serial.println("LED color: protocol version mismatch, ignoring");
        return;
      }
      uint8_t r = data[1];
      uint8_t g = data[2];
      uint8_t b = data[3];
      Serial.printf("Received LED color: R=%d, G=%d, B=%d\n", r, g, b);

      light_r = r;
      light_g = g;
      light_b = b;
      showCurrentState();
      updateDeviceState();
    }
  }
};

class LedDelayCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 2) {
      if (data[0] != PROTOCOL_VERSION) {
        Serial.println("LED delay: protocol version mismatch, ignoring");
        return;
      }
      uint8_t value = data[1];
      Serial.print("Received LED delay: ");
      Serial.println(value);
      if (value < 20 || value > 100 || value % 5 != 0) {
        Serial.println("Invalid LED delay");
        return;
      }

      light_delay = value;
      updateDeviceState();
      blinkAck(2); // two quick blinks = "delay received"
    }
  }
};

class LedSyncCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (!data || pCharacteristic->getLength() != 1 || data[0] != PROTOCOL_VERSION) {
      Serial.println("LED sync: protocol version mismatch, ignoring");
      return;
    }
    Serial.println("Received LED sync ping");
    blinkAck(1); // one quick blink = "sync ping received"
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting Light Bar BLE TEST RIG (built-in LED only)...");

  pinMode(LED_PIN, OUTPUT);
  showCurrentState();

  BLEDevice::init(DEVICE_NAME.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(LIGHTBAR_SERVICE_UUID);

  BLECharacteristic* pLedStateChar = pService->createCharacteristic(
    LED_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pLedStateChar->setCallbacks(new LedStateCallback());

  BLECharacteristic* pLedColorChar = pService->createCharacteristic(
    LED_COLOR_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pLedColorChar->setCallbacks(new LedColorCallback());

  BLECharacteristic* pLedDelayChar = pService->createCharacteristic(
    LED_DELAY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
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

  Serial.println("BLE server started and advertising...");
}

void loop() {
  while (!deviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("Restarting advertising");
  }

  unsigned long now = millis();
  if (now - lastBatteryUpdate >= BATTERY_UPDATE_INTERVAL_MS) {
    lastBatteryUpdate = now;
    updateBatteryLevel();
  }
}
