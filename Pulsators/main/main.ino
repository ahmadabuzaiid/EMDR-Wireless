#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// BLE UUIDs
#define PULSATOR_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define MOTOR_STATE_CHARACTERISTIC_UUID "668b943b-2cac-4de0-8091-332dedc91739"
#define MOTOR_INTENSITY_CHARACTERISTIC_UUID "9f1dc367-ee23-4254-a52a-e41b59f50502"
// Read+Notify: mirrors what was actually applied, so the app can resync its UI
// after a reconnect instead of guessing/assuming its last-known values are current.
#define DEVICE_STATE_CHARACTERISTIC_UUID "5d55e432-99f8-4293-ae12-a024c9510362"

// Standard Bluetooth SIG Battery Service - the 16-bit UUIDs below expand to the
// full 128-bit Base UUID automatically.
#define BATTERY_SERVICE_UUID "180F"
#define BATTERY_LEVEL_CHARACTERISTIC_UUID "2A19"

// Advertised BLE name. The two pulsators run this exact same sketch - change this
// to "Pulsator 1" or "Pulsator 2" to match whichever physical unit you're flashing.
// The companion app tells the two apart only by this name (see EmdrWirelessApp).
const String DEVICE_NAME = "Pulsator 1";

// Bumped whenever a characteristic's byte layout changes. Every write's first byte
// must match this, or firmware rejects it outright - this is what lets the app
// detect "this device is running firmware from a different protocol generation"
// instead of a write silently doing nothing because the old/new layouts happened
// to both pass the length/range checks. See root README's BLE protocol contract.
const uint8_t PROTOCOL_VERSION = 1;

// Motor configuration
const int MOTOR_PIN = 20;
const uint8_t DEFAULT_MOTOR_INTENSITY = 150;

// Battery: no voltage-divider hardware confirmed wired to this pin yet - the GATT
// plumbing is real and complete, but readBatteryPercent()'s calibration constants
// are placeholders until real hardware is wired. See that function's comment.
const int BATTERY_ADC_PIN = 0;
const unsigned long BATTERY_UPDATE_INTERVAL_MS = 60000;
unsigned long lastBatteryUpdate = 0;

// Motor state: the app is the clock in this design (it computes when to buzz, whether
// synced to the Light Bar or run standalone) and drives the motor live via MOTOR_STATE.
// The firmware just reacts to whatever it's told, immediately, with no local cycle timer.
volatile uint8_t motor_state = 0;
volatile uint8_t motor_intensity = DEFAULT_MOTOR_INTENSITY;

// BLE state
volatile bool deviceConnected = false;
BLEServer* pServer = nullptr;
BLECharacteristic* pDeviceStateChar = nullptr;
BLECharacteristic* pBatteryChar = nullptr;

// Pushes the current applied state onto DEVICE_STATE_CHARACTERISTIC and notifies
// any subscriber - call this after anything that changes motor_state/motor_intensity.
void updateDeviceState() {
  if (!pDeviceStateChar) return;
  uint8_t payload[3] = { PROTOCOL_VERSION, motor_state, motor_intensity };
  pDeviceStateChar->setValue(payload, 3);
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

// BLE Server callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    updateBatteryLevel();
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;

    // Stop the motor and reset to defaults so a new connection always starts from a clean, known state
    motor_state = 0;
    motor_intensity = DEFAULT_MOTOR_INTENSITY;
    analogWrite(MOTOR_PIN, 0);
    updateDeviceState();
  }
};

// Motor state characteristic callback - applies immediately, this is the live "buzz now" trigger
class MotorStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 2) {
      if (data[0] != PROTOCOL_VERSION) return;
      uint8_t value = data[1];
      if (value != 0 && value != 1) return;

      motor_state = value;
      analogWrite(MOTOR_PIN, motor_state ? motor_intensity : 0);
      updateDeviceState();
    }
  }
};

// Motor intensity characteristic callback - applies immediately
class MotorIntensityCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 2) {
      if (data[0] != PROTOCOL_VERSION) return;
      uint8_t value = data[1];
      if (value < 40 || value > 200) return;

      motor_intensity = value;
      if (motor_state) analogWrite(MOTOR_PIN, motor_intensity);
      updateDeviceState();
    }
  }
};

void setup() {
  pinMode(MOTOR_PIN, OUTPUT);
  analogWrite(MOTOR_PIN, 0);

  BLEDevice::init(DEVICE_NAME.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(PULSATOR_SERVICE_UUID);

  // Motor state characteristic
  BLECharacteristic* pMotorStateChar = pService->createCharacteristic(
    MOTOR_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pMotorStateChar->setCallbacks(new MotorStateCallback());

  // Motor intensity characteristic - WRITE_NR too, so the app can send it without
  // waiting for an ATT round-trip (see EmdrWirelessApp/src/ble/BleService.ts).
  BLECharacteristic* pMotorIntensityChar = pService->createCharacteristic(
    MOTOR_INTENSITY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  pMotorIntensityChar->setCallbacks(new MotorIntensityCallback());

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
  pAdvertising->addServiceUUID(PULSATOR_SERVICE_UUID);
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

  unsigned long now = millis();
  if (now - lastBatteryUpdate >= BATTERY_UPDATE_INTERVAL_MS) {
    lastBatteryUpdate = now;
    updateBatteryLevel();
  }
}
