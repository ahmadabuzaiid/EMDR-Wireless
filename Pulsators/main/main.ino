#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <ESP8266WebServer.h>

// WiFi credentials
const char* ssid = "YourWiFiSSID";      // Replace with your WiFi SSID
const char* password = "YourWiFiPassword"; // Replace with your WiFi password

// Server setup
ESP8266WebServer server(80);

// Motor configuration
#define MOTOR_PIN   2       // GPIO pin for motor control
#define VALID_MOTOR_ID  1   // The valid motor ID

// Motor state variables
bool motor_state = false;
int motor_delay = 0;
int motor_intensity = 0;
unsigned long motor_lastToggle = 0;

// Function prototypes
bool motor_control(int motor_id, bool motor_on, int motor_delay, int motor_intensity);
void handle_post_motor_control();

void setup() {
  Serial.begin(115200);
  
  // Initialize motor pin as output
  pinMode(MOTOR_PIN, OUTPUT);
  digitalWrite(MOTOR_PIN, LOW);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  
  // Set up server endpoint
  server.on("/motor/control", HTTP_POST, handle_post_motor_control);
  
  // Start server
  server.begin();
  Serial.println("HTTP server started");
}

void loop() {
  server.handleClient();
  
  // Handle motor cycling
  if (motor_state) {
    unsigned long currentMillis = millis();
    if (motor_delay > 0) {
      if (currentMillis - motor_lastToggle >= motor_delay) {
        motor_lastToggle = currentMillis;
        // Toggle motor state
        if (digitalRead(MOTOR_PIN) == HIGH) {
          analogWrite(MOTOR_PIN, 0);  // Turn off
        } else {
          analogWrite(MOTOR_PIN, motor_intensity);  // Turn on with intensity
        }
      }
    }
  }
}

// Handle POST request for motor control
void handle_post_motor_control() {
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
      server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
      return;
    }

    // Extract parameters from JSON
    if (!doc.containsKey("motor_id") || !doc.containsKey("motor_on") || 
        !doc.containsKey("motor_delay") || !doc.containsKey("motor_intensity")) {
      server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing required parameters\"}");
      return;
    }

    int motor_id = doc["motor_id"];
    bool motor_on = doc["motor_on"];
    int motor_delay = doc["motor_delay"];
    int motor_intensity = doc["motor_intensity"];

    // Call the motor control function
    bool success = motor_control(motor_id, motor_on, motor_delay, motor_intensity);
    
    if (success) {
      server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"Motor control updated\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid parameters\"}");
    }
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"No body provided\"}");
  }
}

// Motor control function that validates and applies motor settings
bool motor_control(int motor_id, bool motor_on, int motor_delay, int motor_intensity) {
  // Validate motor_id
  if (motor_id != VALID_MOTOR_ID) {
    Serial.println("Invalid motor ID");
    return false;
  }
  
  // Validate ranges
  if (motor_delay < 100 || motor_delay > 1500) {
    Serial.println("Invalid motor speed");
    return false;
  }
  
  if (motor_intensity < 40 || motor_intensity > 200) {
    Serial.println("Invalid motor intensity");
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
  
  Serial.println("Motor updated");
  
  return true;
}
