#include <WiFi.h>
#include <HTTPClient.h>
#include "HX711.h"

#define DATA_PIN               5
#define CLK_PIN                4
#define BUZZER_PIN             18
#define LED_PIN                19

#define PILL_CHANGE_THRESHOLD  0.6
#define CONFIRM_READS          5

// ----- Wi-Fi + backend config -----
const char* WIFI_SSID = "SarvehS22";
const char* WIFI_PASSWORD = "12345678";
const char* SERVER_BASE_URL = "https://dimple-depositional-sniffily.ngrok-free.dev";
const char* HARDWARE_ID = "esp32-pillbox-001";
const char* DEVICE_SECRET = "esp32-secret-001";

const unsigned long POLL_INTERVAL_MS = 4000;
const unsigned long STATUS_INTERVAL_MS = 10000;

unsigned long lastPollMs = 0;
unsigned long lastStatusMs = 0;

HX711 scale;

float pillWeight = 0;
int totalPills = 0;
int currentPills = 0;
bool setupDone = false;
bool pillUnitMode = true;
int pendingCount = -1;
int confirmStreak = 0;

String wifiStateLabel(wl_status_t s) {
  switch (s) {
    case WL_CONNECTED: return "WL_CONNECTED";
    case WL_NO_SHIELD: return "WL_NO_SHIELD";
    case WL_NO_SSID_AVAIL: return "WL_NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED: return "WL_SCAN_COMPLETED";
    case WL_CONNECT_FAILED: return "WL_CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "WL_CONNECTION_LOST";
    case WL_IDLE_STATUS: return "WL_IDLE_STATUS";
    case WL_DISCONNECTED: return "WL_DISCONNECTED";
    default: return "WL_UNKNOWN";
  }
}

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    digitalWrite(LED_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    delay(150);
  }
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  Serial.print("[NET] connect ssid=");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  Serial.print("[NET] status=");
  Serial.print(wifiStateLabel(WiFi.status()));
  Serial.print(" (");
  Serial.print((int)WiFi.status());
  Serial.print(") | ip=");
  Serial.println(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "-");
}

bool postJson(String path, String body, int& statusCode, String& responseBody) {
  if (WiFi.status() != WL_CONNECTED) {
    statusCode = -1;
    responseBody = "wifi_disconnected";
    return false;
  }

  HTTPClient http;
  String url = String(SERVER_BASE_URL) + path;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  statusCode = http.POST(body);
  responseBody = http.getString();
  http.end();
  return statusCode > 0;
}

void registerDeviceWithServer() {
  int code = 0;
  String res = "";
  String payload = "{\"hardwareId\":\"" + String(HARDWARE_ID) +
                   "\",\"deviceSecret\":\"" + String(DEVICE_SECRET) +
                   "\",\"label\":\"ESP32 Pill Box\"}";

  bool ok = postJson("/api/devices/register", payload, code, res);
  if (!ok) {
    Serial.println("[REG] request failed");
    return;
  }
  Serial.print("[REG] status=");
  Serial.println(code);
}

float getFastWeight() {
  float total = 0;
  for (int i = 0; i < 3; i++) {
    float w = scale.get_units(5);
    if (w < 0) w = -w;
    total += w;
    delay(10);
  }
  return total / 3;
}

int getFastPillCount() {
  if (!setupDone || pillWeight <= 0.0001f) return currentPills;

  float weight = getFastWeight();
  int count = (int)((weight + pillWeight * (1.0 - PILL_CHANGE_THRESHOLD)) / pillWeight);
  if (count < 0) count = 0;
  if (count > totalPills) count = totalPills;
  return count;
}

float extractFloat(String text, String key, float fallback) {
  String token = "\"" + key + "\":";
  int pos = text.indexOf(token);
  if (pos < 0) return fallback;
  pos += token.length();

  while (pos < (int)text.length() && (text[pos] == ' ' || text[pos] == '"')) pos++;
  int end = pos;
  while (end < (int)text.length()) {
    char c = text[end];
    if (!((c >= '0' && c <= '9') || c == '.' || c == '-')) break;
    end++;
  }

  if (end <= pos) return fallback;
  return text.substring(pos, end).toFloat();
}

int extractInt(String text, String key, int fallback) {
  return (int)extractFloat(text, key, (float)fallback);
}

bool extractBool(String text, String key, bool fallback) {
  String token = "\"" + key + "\":";
  int pos = text.indexOf(token);
  if (pos < 0) return fallback;
  pos += token.length();

  while (pos < (int)text.length() && text[pos] == ' ') pos++;
  if (text.substring(pos, pos + 4) == "true") return true;
  if (text.substring(pos, pos + 5) == "false") return false;
  return fallback;
}

void calibrateOnePillAsUnit() {
  Serial.println("[CAL] CALIBRATE_ONE_PILL started. Keep exactly one pill on scale.");
  long rawOnePill = scale.get_value(20);
  if (rawOnePill < 0) rawOnePill = -rawOnePill;

  if (rawOnePill < 50) {
    Serial.print("[CAL] failed, rawOnePill too small: ");
    Serial.println(rawOnePill);
    return;
  }

  float calibrationFactor = (float)rawOnePill / 1.0f;
  scale.set_scale(calibrationFactor);
  pillWeight = 1.0f;
  pillUnitMode = true;
  if (totalPills > 0 && currentPills <= 0) {
    currentPills = totalPills;
  }
  pendingCount = currentPills;
  setupDone = totalPills > 0;

  Serial.print("[CAL] success. factor=");
  Serial.print(calibrationFactor, 3);
  Serial.print(" | pillWeight=");
  Serial.print(pillWeight, 3);
  Serial.print(" | setupDone=");
  Serial.println(setupDone ? "true" : "false");
  beep(2);
}

void applySetupFromPayload(String json) {
  float nextPillWeight = extractFloat(json, "pillWeight", -1.0f);
  int nextTotalPills = extractInt(json, "totalPills", -1);
  int nextCurrentPills = extractInt(json, "currentPills", nextTotalPills);
  bool nextPillUnitMode = extractBool(json, "pillUnitMode", true);

  if (nextPillWeight <= 0 || nextTotalPills <= 0) {
    Serial.println("[SETUP] invalid SET_CALIBRATION payload");
    return;
  }

  pillWeight = nextPillWeight;
  pillUnitMode = nextPillUnitMode;
  totalPills = nextTotalPills;
  currentPills = nextCurrentPills;
  pendingCount = currentPills;
  confirmStreak = 0;
  setupDone = true;

  Serial.print("[SETUP] applied pillWeight=");
  Serial.print(pillWeight, 3);
  Serial.print(" pillUnitMode=");
  Serial.print(pillUnitMode ? "true" : "false");
  Serial.print(" totalPills=");
  Serial.print(totalPills);
  Serial.print(" currentPills=");
  Serial.println(currentPills);
  beep(2);
}

void handleCommands(String json) {
  if (json.indexOf("\"command\":\"CALIBRATE_ONE_PILL\"") >= 0) {
    calibrateOnePillAsUnit();
  }
  if (json.indexOf("\"command\":\"SET_CALIBRATION\"") >= 0) {
    applySetupFromPayload(json);
  }
  if (json.indexOf("\"command\":\"BUZZER_TEST\"") >= 0) {
    Serial.println("[CMD] BUZZER_TEST");
    beep(2);
  }
  if (json.indexOf("\"command\":\"LED_ON\"") >= 0) {
    Serial.println("[CMD] LED_ON");
    digitalWrite(LED_PIN, HIGH);
  }
  if (json.indexOf("\"command\":\"LED_OFF\"") >= 0) {
    Serial.println("[CMD] LED_OFF");
    digitalWrite(LED_PIN, LOW);
  }
  if (json.indexOf("\"command\":\"RESET_SETUP\"") >= 0) {
    setupDone = false;
    pillUnitMode = true;
    totalPills = 0;
    currentPills = 0;
    pillWeight = 0;
    Serial.println("[SETUP] reset");
  }
}

void pollServerCommands() {
  int code = 0;
  String res = "";
  String payload = "{\"hardwareId\":\"" + String(HARDWARE_ID) +
                   "\",\"deviceSecret\":\"" + String(DEVICE_SECRET) + "\"}";

  bool ok = postJson("/api/device/poll", payload, code, res);
  if (!ok) {
    Serial.println("[POLL] request failed");
    return;
  }
  if (code != 200) {
    Serial.print("[POLL] status=");
    Serial.println(code);
    return;
  }

  if (res.indexOf("\"commands\":[]") >= 0) {
    Serial.println("[POLL] no commands");
    return;
  }

  Serial.println("[POLL] commands received");
  handleCommands(res);
}

void pushRuntimeStatus() {
  int code = 0;
  String res = "";

  String payload = "{\"hardwareId\":\"" + String(HARDWARE_ID) +
                   "\",\"deviceSecret\":\"" + String(DEVICE_SECRET) +
                   "\",\"wifiConnected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") +
                   ",\"ip\":\"" + String(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "-") + "\"" +
                   ",\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -999) +
                   ",\"setupDone\":" + String(setupDone ? "true" : "false") +
                   ",\"pillUnitMode\":" + String(pillUnitMode ? "true" : "false") +
                   ",\"currentPills\":" + String(currentPills) +
                   ",\"totalPills\":" + String(totalPills) +
                   "}";

  bool ok = postJson("/api/device/status", payload, code, res);
  if (!ok) {
    Serial.println("[STATUS] push failed");
    return;
  }
  Serial.print("[STATUS] push status=");
  Serial.println(code);
}

void monitorPills() {
  if (!setupDone) return;

  int newCount = getFastPillCount();

  if (newCount != currentPills) {
    if (newCount == pendingCount) {
      confirmStreak++;
    } else {
      pendingCount = newCount;
      confirmStreak = 1;
    }

    if (confirmStreak >= CONFIRM_READS) {
      if (newCount < currentPills) {
        int taken = currentPills - newCount;
        Serial.print("[PILL] removed=");
        Serial.print(taken);
        Serial.print(" remaining=");
        Serial.println(newCount);
        beep(taken);
      } else {
        Serial.print("[PILL] added newCount=");
        Serial.println(newCount);
      }

      currentPills = newCount;
      pendingCount = newCount;
      confirmStreak = 0;
    }
  } else {
    confirmStreak = 0;
    pendingCount = currentPills;
  }
}

void setup() {
  Serial.begin(115200);
  delay(800);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  scale.begin(DATA_PIN, CLK_PIN);
  while (!scale.is_ready()) delay(100);
  scale.tare(20);

  Serial.println("===== ESP32 BOOT =====");
  Serial.print("[CFG] HARDWARE_ID: "); Serial.println(HARDWARE_ID);
  Serial.print("[CFG] SERVER_BASE_URL: "); Serial.println(SERVER_BASE_URL);
  Serial.print("[CFG] WIFI_SSID: "); Serial.println(WIFI_SSID);
  Serial.println("[BOOT] Wi-Fi first + UI-driven setup mode");

  connectWifi();
  if (WiFi.status() == WL_CONNECTED) {
    registerDeviceWithServer();
    pushRuntimeStatus();
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  unsigned long now = millis();

  if (WiFi.status() == WL_CONNECTED && now - lastPollMs >= POLL_INTERVAL_MS) {
    lastPollMs = now;
    pollServerCommands();
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    pushRuntimeStatus();
    Serial.print("[STATE] wifi=");
    Serial.print(wifiStateLabel(WiFi.status()));
    Serial.print(" setupDone=");
    Serial.print(setupDone ? "true" : "false");
    Serial.print(" pillUnitMode=");
    Serial.print(pillUnitMode ? "true" : "false");
    Serial.print(" current/total=");
    Serial.print(currentPills);
    Serial.print("/");
    Serial.println(totalPills);
  }

  monitorPills();
  delay(100);
}