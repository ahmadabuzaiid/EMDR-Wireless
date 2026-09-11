#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// BLE UUIDs
#define PULSATOR_SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define MOTOR_STATE_CHARACTERISTIC_UUID "668b943b-2cac-4de0-8091-332dedc91739"
#define MOTOR_INTENSITY_CHARACTERISTIC_UUID "9f1dc367-ee23-4254-a52a-e41b59f50502"

// Advertised BLE name. The two pulsators run this exact same sketch - change this
// to "Pulsator 1" or "Pulsator 2" to match whichever physical unit you're flashing.
// The companion app tells the two apart only by this name (see EmdrWirelessApp).
const String DEVICE_NAME = "Pulsator 1";

// Motor configuration
const int MOTOR_PIN = 20;
const uint8_t DEFAULT_MOTOR_INTENSITY = 150;

// Motor state: the app is the clock in this design (it computes when to buzz, whether
// synced to the Light Bar or run standalone) and drives the motor live via MOTOR_STATE.
// The firmware just reacts to whatever it's told, immediately, with no local cycle timer.
volatile uint8_t motor_state = 0;
volatile uint8_t motor_intensity = DEFAULT_MOTOR_INTENSITY;

// BLE state
volatile bool deviceConnected = false;
BLEServer* pServer = nullptr;

// BLE Server callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("Device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;

    // Stop the motor and reset to defaults so a new connection always starts from a clean, known state
    motor_state = 0;
    motor_intensity = DEFAULT_MOTOR_INTENSITY;
    analogWrite(MOTOR_PIN, 0);

    Serial.println("Device disconnected, motor stopped and reset");
  }
};

// Motor state characteristic callback - applies immediately, this is the live "buzz now" trigger
class MotorStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 1) {
      uint8_t value = data[0];
      Serial.print("Received motor state: ");
      Serial.println(value);
      if (value != 0 && value != 1) {
        Serial.println("Invalid motor state");
        return;
      }

      motor_state = value;
      analogWrite(MOTOR_PIN, motor_state ? motor_intensity : 0);
    }
  }
};

// Motor intensity characteristic callback - applies immediately
class MotorIntensityCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 1) {
      uint8_t value = data[0];
      Serial.print("Received motor intensity: ");
      Serial.println(value);

      if (value < 40 || value > 200) {
        Serial.println("Invalid motor intensity");
        return;
      }

      motor_intensity = value;
      if (motor_state) analogWrite(MOTOR_PIN, motor_intensity);
    }
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting EMDR Pulsator BLE Server...");

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

  // Motor intensity characteristic
  BLECharacteristic* pMotorIntensityChar = pService->createCharacteristic(
    MOTOR_INTENSITY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pMotorIntensityChar->setCallbacks(new MotorIntensityCallback());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(PULSATOR_SERVICE_UUID);
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
}
