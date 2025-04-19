#include "config.h"
#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

// Motor configuration
const int VALID_MOTOR_ID = 1;    // The valid motor ID
const int MOTOR_PIN = 2;         // GPIO2 (D4 on NodeMCU boards)

// Motor state variables
bool motor_state = false;
int motor_delay = 0;
int motor_intensity = 0;
unsigned long motor_lastToggle = 0;

// WebSocket client
WebSocketsClient webSocket;

// Function prototypes
bool motor_control(bool motor_on, int motor_delay, int motor_intensity);
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);

void setup() {
  Serial.begin(115200);
  
  // Initialize motor pin as output
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print(F("Connecting to WiFi"));
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(F("."));
  }
  
  Serial.println(F(""));
  Serial.println(F("WiFi connected"));
  Serial.print(F("IP address: "));
  Serial.println(WiFi.localIP());
  
  // Initialize WebSocket connection
  Serial.println(F("Connecting to WebSocket server"));
  webSocket.begin(websocket_server, websocket_port);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);  // Try to reconnect every 5 seconds if connection is lost
  
  Serial.println(F("WebSocket client started"));
}

void loop() {
  // Keep the WebSocket connection alive
  webSocket.loop();
  
  // Handle motor cycling
  bool motor_onPhase = (VALID_MOTOR_ID == 1);  // true if motor_id is 1 (on->off), false otherwise (off->on)

  if (motor_state) {
    unsigned long currentMillis = millis();
    if (motor_delay > 0) {
      if (currentMillis - motor_lastToggle >= motor_delay) {
        motor_lastToggle = currentMillis;

        if (motor_onPhase) {
          // Turn motor ON
          analogWrite(MOTOR_PIN, motor_intensity);
        } else {
          // Turn motor OFF
          analogWrite(MOTOR_PIN, 0);
        }

        // Flip phase for next cycle
        motor_onPhase = !motor_onPhase;
      }
    }
  }
}

// WebSocket event handler
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println(F("WebSocket disconnected"));
      break;
      
    case WStype_CONNECTED:
      Serial.println(F("WebSocket connected"));
      // Send a message to the server
      webSocket.sendTXT("ESP8266 motor control connected");
      break;
      
    case WStype_TEXT:
      Serial.printf("[WebSocket] Received: %s\n", payload);
      
      // Parse the incoming JSON
      DynamicJsonDocument doc(256);
      DeserializationError error = deserializeJson(doc, payload);
      
      if (error) {
        Serial.println(F("Failed to parse JSON message"));
        return;
      }
      
      // Check for required parameters
      if (!doc.containsKey("motor_on") || 
          !doc.containsKey("motor_delay") || !doc.containsKey("motor_intensity")) {
        Serial.println(F("Missing required parameters"));
        return;
      }
      
      // Extract parameters
      bool motor_on = doc["motor_on"];
      int motor_delay = doc["motor_delay"];
      int motor_intensity = doc["motor_intensity"];
      
      // Apply motor control
      bool success = motor_control(motor_on, motor_delay, motor_intensity);
      
      // Send response back to server
      if (success) {
        webSocket.sendTXT("{\"status\":\"success\",\"message\":\"Motor control updated\"}");
      } else {
        webSocket.sendTXT("{\"status\":\"error\",\"message\":\"Invalid parameters\"}");
      }
      break;
  }
}

// Motor control function that validates and applies motor settings
bool motor_control(bool motor_on, int motor_delay, int motor_intensity) {  
  // Validate ranges
  if (motor_delay < 100 || motor_delay > 1500) {
    Serial.println(F("Invalid motor speed"));
    return false;
  }
  
  if (motor_intensity < 40 || motor_intensity > 200) {
    Serial.println(F("Invalid motor intensity"));
    return false;
  }
  
  // Apply settings to the motor
  motor_state = motor_on;
  motor_delay = motor_delay;
  motor_intensity = motor_intensity;
  
  if (!motor_on) {
    analogWrite(MOTOR_PIN, 0);  // Turn off the motor immediately if motor_on is false
  } else {
    // Reset the toggle timer to start a new cycle
    motor_lastToggle = millis();
    analogWrite(MOTOR_PIN, motor_intensity);  // Start with the motor on
  }
  
  Serial.println(F("Motor updated"));
  
  return true;
}