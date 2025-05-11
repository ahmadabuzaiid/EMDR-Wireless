#include "config.h"
#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ArduinoJson.h>

// BLE UUIDs
#define PULSATOR_SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define MOTOR_STATE_CHARACTERISTIC_UUID "668b943b-2cac-4de0-8091-332dedc91739"
#define MOTOR_DELAY_CHARACTERISTIC_UUID "42621035-526f-4175-8ad0-16387b946fce"
#define MOTOR_INTENSITY_CHARACTERISTIC_UUID "9f1dc367-ee23-4254-a52a-e41b59f50502

// Motor configuration
const int MOTOR_PIN = 20;

// Motor state variables
uint8_t motor_state = 0;            // Current motor state (on/off)
uint16_t motor_delay = 500;               // Time between pulses in ms (default: 500ms)
uint8_t motor_intensity = 150;           // Motor intensity (PWM value, default: 150)
unsigned long motor_lastToggle = 0;  // Last time the motor was toggled

// For handling new values between cycles
bool new_values_pending = false;   // Flag for pending parameter updates
uint8_t new_motor_state = 0;      // New motor on/off state waiting to be applied
uint16_t new_motor_delay = 500;         // New delay value waiting to be applied
uint8_t new_motor_intensity = 150;     // New intensity value waiting to be applied

// Motor phase tracking
bool motor_onPhase = false;         // true for MOTOR_ID 2, fasle for MOTOR_ID 1

// BLE server pointers
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;

// Function prototypes - declare functions before use
void applyPendingValues();

// Apply pending values after cycle completion
void applyPendingValues() {
  if (new_values_pending) {
    Serial.println("Applying new motor parameters");
    
    // Apply settings to the motor
    motor_state = new_motor_state;
    motor_delay = new_motor_delay;
    motor_intensity = new_motor_intensity;
    
    if (!motor_state) {
      // Turn off the motor immediately if motor_on is false
      analogWrite(MOTOR_PIN, 0);  
    } else {
      // Reset the toggle timer to start a new cycle
      motor_lastToggle = millis();
      analogWrite(MOTOR_PIN, motor_intensity);  // Start with the motor on
      motor_onPhase = true;  // Reset phase to on
    }
    
    // Clear the pending flag
    new_values_pending = false;
    
    Serial.println("Motor updated with new values");
  }
}

// Callback for handling connection events
class ServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Device connected");
    }

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Device disconnected");
    }
};

// --- Callback for motor state characteristic ---
class MotorStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data != nullptr) {
      uint8_t value = data[0];
      Serial.print("Received motor state: ");
      Serial.println(value);

      if (value != 0 && value != 1) {
        Serial.println("Invalid motor state");
        return;
      }

      new_motor_state = value;
      new_values_pending = true;

      if (!motor_state) {
        applyPendingValues();
      } else {
        Serial.println("New motor state pending");
      }
    }
  }
};

// --- Callback for motor delay characteristic ---
class MotorDelayCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data != nullptr) {
      uint16_t value = *(uint16_t*)data;
      Serial.print("Received motor delay: ");
      Serial.println(value);

      if (value < 100 || value > 1500) {
        Serial.println("Invalid motor speed");
        return;
      }

      new_motor_delay = value;
      new_values_pending = true;

      if (!motor_state) {
        applyPendingValues();
      } else {
        Serial.println("New motor delay pending");
      }
    }
  }
};

// --- Callback for motor intensity characteristic ---
class MotorIntensityCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data != nullptr) {
      uint8_t value = data[0];
      Serial.print("Received motor intensity: ");
      Serial.println(value);

      if (value < 40 || value > 200) {
        Serial.println("Invalid motor intensity");
        return;
      }

      new_motor_intensity = value;
      new_values_pending = true;

      if (!motor_state) {
        applyPendingValues();
      } else {
        Serial.println("New motor intensity pending");
      }
    }
  }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting EMDR Pulsator BLE Server...");

  // Initialize motor pin as output
  pinMode(MOTOR_PIN, OUTPUT);
  analogWrite(MOTOR_PIN, 0);  // Start with motor off

  // Initialize BLE
  BLEDevice::init("EMDR_Pulsator");

  // Create the BLE Server
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  // Create the BLE Service
  BLEService *pService = pServer->createService(PULSATOR_LEFT_SERVICE_UUID);

  // Create Motor State Characteristic (Write-Only)
  BLECharacteristic *pMotorStateChar = pService->createCharacteristic(
    MOTOR_STATE_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pMotorStateChar->setCallbacks(new MotorStateCallback());

  // Create Motor Delay Characteristic (Write-Only)
  BLECharacteristic *pMotorDelayChar = pService->createCharacteristic(
    MOTOR_DELAY_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pMotorDelayChar->setCallbacks(new MotorDelayCallback());

  // Create Motor Intensity Characteristic (Write-Only)
  BLECharacteristic *pMotorIntensityChar = pService->createCharacteristic(
    MOTOR_INTENSITY_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pMotorIntensityChar->setCallbacks(new MotorIntensityCallback());

  // Start the service
  pService->start();

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(PULSATOR_LEFT_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // Helps with iPhone compatibility
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE server started and advertising...");
}

void loop() {
  // Handle motor cycling
  if (motor_state) {
    unsigned long currentMillis = millis();
    if (currentMillis - motor_lastToggle >= motor_delay) {
      motor_lastToggle = currentMillis;
      
      // Toggle motor state
      if (motor_onPhase) {
        // Turn motor OFF phase
        analogWrite(MOTOR_PIN, 0);
        motor_onPhase = false;
        
        // Check for pending values at the end of a complete cycle (when turning off)
        if (new_values_pending) {
          applyPendingValues();
        }
      } else {
        // Turn motor ON phase
        analogWrite(MOTOR_PIN, motor_intensity);
        motor_onPhase = true;
      }
    }
  }
  
  // Handle BLE connection state changes
  if (!deviceConnected) {
    delay(500); // Give Bluetooth stack time to get ready
    pServer->startAdvertising(); // Restart advertising
    Serial.println("Restarting advertising");
  }
}