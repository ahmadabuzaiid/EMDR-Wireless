#include <FastLED.h>
#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

// WiFi credentials
const char* ssid = "YourWiFiSSID";      // Replace with your WiFi SSID
const char* password = "YourWiFiPassword"; // Replace with your WiFi password

// Server setup
ESP8266WebServer server(80);

// LED Strip configuration
#define LED_PIN     2      // GPIO pin connected to the LED strip
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

// Function prototypes
void update_led_animation();
void handle_post_led_control();
bool validate_led_params(bool light_on, int r, int g, int b, int delay_val);

void setup() {
  Serial.begin(115200);
  
  // Initialize LED strip
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, LED_COUNT);
  FastLED.setBrightness(100);  // Set brightness (0-255)
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
  
  // Set up server endpoint
  server.on("/led/control", HTTP_POST, handle_post_led_control);
  
  // Start server
  server.begin();
  Serial.println(F("HTTP server started"));
}

void loop() {
  // Handle any incoming client requests
  server.handleClient();
  
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

// Handle POST request for LED control
void handle_post_led_control() {
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    DynamicJsonDocument doc(256); // Reduced size for optimization
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
      server.send(400, F("application/json"), F("{\"status\":\"error\",\"message\":\"Invalid JSON\"}"));
      return;
    }

    // Extract parameters from JSON
    if (!doc.containsKey("light_on") || 
        !doc.containsKey("light_r") || 
        !doc.containsKey("light_g") || 
        !doc.containsKey("light_b") || 
        !doc.containsKey("light_delay")) {
      server.send(400, F("application/json"), F("{\"status\":\"error\",\"message\":\"Missing required parameters\"}"));
      return;
    }

    bool light_on = doc["light_on"];
    int r = doc["light_r"];
    int g = doc["light_g"];
    int b = doc["light_b"];
    int delay_val = doc["light_delay"];

    // Validate LED parameters
    bool valid = validate_led_params(light_on, r, g, b, delay_val);
    
    if (valid) {
      // Update global state variables
      light_state = light_on;
      light_r = r;
      light_g = g;
      light_b = b;
      light_delay = delay_val;
      
      // Reset animation state if needed
      if (light_on && !animation_active) {
        current_led = 0;
        forward_direction = true;
      }
      
      server.send(200, F("application/json"), F("{\"status\":\"success\",\"message\":\"LED control updated\"}"));
    } else {
      server.send(400, F("application/json"), F("{\"status\":\"error\",\"message\":\"Invalid parameters\"}"));
    }
  } else {
    server.send(400, F("application/json"), F("{\"status\":\"error\",\"message\":\"No body provided\"}"));
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