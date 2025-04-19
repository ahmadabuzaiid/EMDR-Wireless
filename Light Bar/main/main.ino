#include <FastLED.h>
#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

// WiFi credentials
const char* ssid = "YourWiFiSSID";      // Replace with your WiFi SSID
const char* password = "YourWiFiPassword"; // Replace with your WiFi password

// WebSocket settings
const char* websocket_server = "your-websocket-server.com";  // Replace with your WebSocket server
const int websocket_port = 8080;  // Replace with your WebSocket port

// LED Strip configuration
#define LED_PIN      2      // GPIO pin connected to the LED strip
#define LED_COUNT   20      // Number of LEDs in the strip
CRGB leds[LED_COUNT];       // Define the LED strip array

// LED state variables
bool light_state = false;
int light_r = 0;
int light_g = 0;
int light_b = 0;
int light_delay = 20;

// Animation control variables
int current_led = 0;
bool forward_direction = true;
unsigned long last_led_update = 0;
bool animation_active = false;

// WebSocket client
WebSocketsClient webSocket;

// Function prototypes
void update_led_animation();
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
bool validate_led_params(bool light_on, int r, int g, int b, int delay_val);

void setup() {
  Serial.begin(115200);
  
  // Initialize LED strip
  FastLED.addLeds<NEOPIXEL, LED_PIN>(leds, LED_COUNT);
  FastLED.clear();             // Clear all LEDs
  FastLED.show();              // Update LEDs with all off
  
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
  
  // Update LED animation if active
  if (light_state) {
    update_led_animation();
  } else if (animation_active) {
    // Turn off all LEDs when light_state becomes false
    FastLED.clear();
    FastLED.show();
    animation_active = false;
  }
}

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
      }
    } else {
      current_led--;
      if (current_led <= 0) {
        current_led = 0;
        forward_direction = true;
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
      webSocket.sendTXT("ESP8266 LED control connected");
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
      if (!doc.containsKey("light_on") || 
          !doc.containsKey("light_r") || 
          !doc.containsKey("light_g") || 
          !doc.containsKey("light_b") || 
          !doc.containsKey("light_delay")) {
        Serial.println(F("Missing required parameters"));
        return;
      }
      
      // Extract parameters
      bool light_on_new = doc["light_on"];
      int r = doc["light_r"];
      int g = doc["light_g"];
      int b = doc["light_b"];
      int delay_val = doc["light_delay"];
      
      // Validate LED parameters
      bool valid = validate_led_params(light_on_new, r, g, b, delay_val);
      
      if (valid) {
        // Update global state variables
        light_state = light_on_new;
        light_r = r;
        light_g = g;
        light_b = b;
        light_delay = delay_val;
        
        // Reset animation state if needed
        if (light_on_new && !animation_active) {
          current_led = 0;
          forward_direction = true;
        }
        
        // Send response back to server
        webSocket.sendTXT("{\"status\":\"success\",\"message\":\"LED control updated\"}");
      } else {
        webSocket.sendTXT("{\"status\":\"error\",\"message\":\"Invalid parameters\"}");
      }
      break;
  }
}

// Validate LED parameters
bool validate_led_params(bool light_on, int r, int g, int b, int delay_val) {
  // Check RGB ranges (0-255)
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
    Serial.println(F("Invalid RGB values"));
    return false;
  }
  
  // Check delay range (5-75) and divisibility by 5
  if (delay_val < 5 || delay_val > 75 || delay_val % 5 != 0) {
    Serial.println(F("Invalid delay value"));
    return false;
  }
  
  return true;
}
