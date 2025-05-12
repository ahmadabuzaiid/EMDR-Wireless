#include "config.h"
#include <FastLED.h>
#include <BLE2902.h>
#include <BLEUtils.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// LED Strip configuration
#define LED_PIN 2      // GPIO pin connected to the LED strip
#define LED_COUNT 20   // Number of LEDs in the strip
CRGB leds[LED_COUNT];  // Define the LED strip array

// BLE UUIDs
#define LIGHTBAR_SERVICE_UUID "1fb5c201-4faf-459e-8fcc-c5c9c331914b"
#define LED_STATE_CHARACTERISTIC_UUID "2cac943b-668b-4de0-8091-332dedc91739"
#define LED_COLOR_CHARACTERISTIC_UUID "526f1035-4262-4175-8ad0-16387b946fce"
#define LED_DELAY_CHARACTERISTIC_UUID "ee231dc3-9f67-4254-a52a-e41b59f50502"

// LED state variables
uint8_t light_state = 0;
uint8_t light_r = 0;
uint8_t light_g = 0;
uint8_t light_b = 0;
inuint8_tt light_delay = 20;

// Animation control variables
int current_led = 0;
bool forward_direction = true;
unsigned long last_led_update = 0;
bool animation_active = false;

// For handling new values between cycles
bool new_values_pending = false;
uint8_t new_light_state = 0;
uint8_t new_light_r = 0;
uint8_t new_light_g = 0;
uint8_t new_light_b = 0;
uint8_t new_light_delay = 20;

// BLE state
bool deviceConnected = false;
BLEServer* pServer = nullptr;

// Apply new LED parameters after cycle
void applyPendingValues() {
  if (new_values_pending) {
    Serial.println("Applying new LED parameters");

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

    Serial.println("LED updated with new values");
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

// LED state characteristic callback
class LedStateCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data) {
      uint8_t value = data[0];
      Serial.print("Received LED state: ");
      Serial.println(value);
      if (value != 0 && value != 1) {
        Serial.println("Invalid LED state");
        return;
      }

      new_light_state = value;
      new_values_pending = true;
      if (!light_state || !animation_active) applyPendingValues();
      else Serial.println("New LED state pending");
    }
  }
};

// LED color characteristic callback
class LedColorCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data && pCharacteristic->getLength() == 3) {
      uint8_t r = data[0];
      uint8_t g = data[1];
      uint8_t b = data[2];
      Serial.printf("Received LED color: R=%d, G=%d, B=%d\n", r, g, b);

      if (r > 255 || g > 255 || b > 255) {
        Serial.println("Invalid RGB values");
        return;
      }

      new_light_r = r;
      new_light_g = g;
      new_light_b = b;
      new_values_pending = true;
      if (!light_state || !animation_active) applyPendingValues();
      else Serial.println("New LED color pending");
    }
  }
};

// LED delay characteristic callback
class LedDelayCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    uint8_t* data = pCharacteristic->getData();
    if (data) {
      uint8_t value = data[0];
      Serial.print("Received LED delay: ");
      Serial.println(value);
      if (value < 5 || value > 75 || value % 5 != 0) {
        Serial.println("Invalid LED delay");
        return;
      }

      new_light_delay = value;
      new_values_pending = true;
      if (!light_state || !animation_active) applyPendingValues();
      else Serial.println("New LED delay pending");
    }
  }
};

// Non-blocking LED animation update
void update_led_animation() {
  unsigned long current_time = millis();

  // Only update if enough time has passed
  if (current_time - last_led_update >= light_delay) {
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
      current_led++;
      if (current_led >= LED_COUNT - 1) {
        current_led = LED_COUNT - 1;
        forward_direction = false;

        // Check for pending values when changing direction at the end
        if (new_values_pending) {
          applyPendingValues();
        }
      }
    } else {
      current_led--;
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

void setup() {
  Serial.begin(115200);
  Serial.println("Starting EMDR Light Bar BLE Server...");

  // Initialize LED strip
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, LED_COUNT);
  FastLED.clear();  // Clear all LEDs
  FastLED.show();   // Update LEDs with all off

  BLEDevice::init(device_Name.c_str());
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(LIGHTBAR_SERVICE_UUID);

  // LED state characteristic
  BLECharacteristic* pLedStateChar = pService->createCharacteristic(
    LED_STATE_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pLedStateChar->setCallbacks(new LedStateCallback());

  // LED color characteristic
  BLECharacteristic* pLedColorChar = pService->createCharacteristic(
    LED_COLOR_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pLedColorChar->setCallbacks(new LedColorCallback());

  // LED delay characteristic
  BLECharacteristic* pLedDelayChar = pService->createCharacteristic(
    LED_DELAY_CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  pLedDelayChar->setCallbacks(new LedDelayCallback());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(LIGHTBAR_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE server started and advertising...");
}

void loop() {
  while (!deviceConnected) {
    delay(500);
    pServer->startAdvertising();
    Serial.println("Restarting advertising");
  }
  // Update LED animation if active
  if (light_state) {
    update_led_animation();
  }
}
