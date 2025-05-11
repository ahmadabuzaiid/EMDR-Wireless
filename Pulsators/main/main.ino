#include "config.h"
#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// BLE UUIDs
#define PULSATOR_SERVICE_UUID              "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define MOTOR_STATE_CHARACTERISTIC_UUID    "668b943b-2cac-4de0-8091-332dedc91739"
#define MOTOR_DELAY_CHARACTERISTIC_UUID    "42621035-526f-4175-8ad0-16387b946fce"
#define MOTOR_INTENSITY_CHARACTERISTIC_UUID "9f1dc367-ee23-4254-a52a-e41b59f50502"

// Motor configuration
const int MOTOR_PIN = 20;

// Motor state variables
bool motor_onPhase = false;
uint8_t motor_state = 0;
uint16_t motor_delay = 500;
uint8_t motor_intensity = 150;
unsigned long motor_lastToggle = 0;

// For handling new values between cycles
bool new_values_pending = false;
uint8_t new_motor_state = 0;
uint16_t new_motor_delay = 500;
uint8_t new_motor_intensity = 150;

// BLE state
bool deviceConnected = false;
BLEServer* pServer = nullptr;

// Apply new motor parameters after cycle
void applyPendingValues() {
  if (new_values_pending) {
    Serial.println("Applying new motor parameters");

    motor_state = new_motor_state;
    motor_delay = new_motor_delay;
    motor_intensity = new_motor_intensity;

    if (!motor_state) {
      analogWrite(MOTOR_PIN, 0);
    } else {
      motor_lastToggle = millis();
      analogWrite(MOTOR_PIN, motor_intensity);
      motor_onPhase = true;
    }

    new_values_pending = false;

    Serial.println("Motor updated with new values");
  }
}

// BLE Server callbacks
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("Device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("Device disconnected");
  }
};

// Characteristic callbacks
class MotorStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data) {
      uint8_t value = data[0];
      Serial.print("Received motor state: ");
      Serial.println(value);
      if (value != 0 && value != 1) {
        Serial.println("Invalid motor state");
        return;
      }

      new_motor_state = value;
      new_values_pending = true;
      if (!motor_state) applyPendingValues();
      else Serial.println("New motor state pending");
    }
  }
};

class MotorDelayCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data) {
      uint16_t value = *(uint16_t*)data;
      Serial.print("Received motor delay: ");
      Serial.println(value);
      if (value < 100 || value > 1500) {
        Serial.println("Invalid motor speed");
        return;
      }

      new_motor_delay = value;
      new_values_pending = true;
      if (!motor_state) applyPendingValues();
      else Serial.println("New motor delay pending");
    }
  }
};

class MotorIntensityCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data) {
      uint8_t value = data[0];
      Serial.print("Received motor intensity: ");
      Serial.println(value);
      if (value < 40 || value > 200) {
        Serial.println("Invalid motor intensity");
        return;
      }

      new_motor_intensity = value;
      new_values_pending = true;
      if (!motor_state) applyPendingValues();
      else Serial.println("New motor intensity pending");
    }
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting EMDR Pulsator BLE Server...");

  pinMode(MOTOR_PIN, OUTPUT);
  analogWrite(MOTOR_PIN, 0);

  BLEDevice::init("EMDR_Pulsator");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(PULSATOR_SERVICE_UUID);

  // Motor state characteristic
  BLECharacteristic* pMotorStateChar = pService->createCharacteristic(
    MOTOR_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pMotorStateChar->setCallbacks(new MotorStateCallback());

  // Motor delay characteristic
  BLECharacteristic* pMotorDelayChar = pService->createCharacteristic(
    MOTOR_DELAY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pMotorDelayChar->setCallbacks(new MotorDelayCallback());

  // Motor intensity characteristic
  BLECharacteristic* pMotorIntensityChar = pService->createCharacteristic(
    MOTOR_INTENSITY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pMotorIntensityChar->setCallbacks(new MotorIntensityCallback());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(PULSATOR_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE server started and advertising...");
}

void loop() {
  if (motor_state) {
    unsigned long currentMillis = millis();
    if (currentMillis - motor_lastToggle >= motor_delay) {
      motor_lastToggle = currentMillis;

      if (motor_onPhase) {
        analogWrite(MOTOR_PIN, 0);
        motor_onPhase = false;

        if (new_values_pending) {
          applyPendingValues();
        }
      } else {
        analogWrite(MOTOR_PIN, motor_intensity);
        motor_onPhase = true;
      }
    }
  }

  if (!deviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("Restarting advertising");
  }
}
