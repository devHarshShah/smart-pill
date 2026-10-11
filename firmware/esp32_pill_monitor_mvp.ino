#include <WiFi.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <Preferences.h>
#include "HX711.h"

#define DATA_PIN               5
#define CLK_PIN                4
#define BUZZER_PIN             18
#define LED_PIN                19

#define PILL_CHANGE_THRESHOLD  0.6
#define CONFIRM_READS          5
#define CAL_ROUNDS             7
#define CAL_RAW_MIN            300
#define CAL_RAW_MAX            900

// ----- Wi-Fi + backend config -----
const char* WIFI_SSID = "OnePlus Nord 4";
const char* WIFI_PASSWORD = "harsh2004";
const char* SERVER_BASE_URL = "https://cffb-136-233-9-105.ngrok-free.app";
const char* WS_HOST = "9ac3-136-233-9-105.ngrok-free.app";
const uint16_t WS_PORT = 443;
const char* WS_PATH = "/";
const char* HARDWARE_ID = "esp32-pillbox-001";
const char* DEVICE_SECRET = "esp32-secret-001";

const unsigned long WS_RECONNECT_INTERVAL_MS = 5000;
const unsigned long STATUS_INTERVAL_MS = 10000;
const unsigned long MONITOR_WARMUP_MS = 1500;
const unsigned long OVERDOSE_BUZZ_MS = 5000;
const unsigned long RESTORE_VALIDATE_DELAY_MS = 3000;

unsigned long lastStatusMs = 0;
unsigned long setupAppliedAtMs = 0;
unsigned long lastWsConnectAttemptMs = 0;
unsigned long bootAtMs = 0;

HX711 scale;
WebSocketsClient wsClient;
Preferences prefs;
bool wsAuthenticated = false;
bool wsConnectPending = false;

float pillWeight = 0;
float calibrationFactor = 1.0f;
bool calibrationFactorKnown = false;
int totalPills = 0;
int currentPills = 0;
bool setupDone = false;
bool pillUnitMode = true;
bool setupMismatch = false;
int detectedPills = 0;
int pendingCount = -1;
int confirmStreak = 0;
bool restoredStateValidated = false;

// ----- Calibration state machine -----
enum CalState { CAL_IDLE, CAL_WAIT_CLEAR, CAL_WAIT_PILL, CAL_SAMPLING };
CalState calState = CAL_IDLE;
unsigned long calStateEnterMs = 0;

bool reminderActive = false;
String activeDoseId = "";
String activePillName = "";
int activeRequiredPills = 1;
int activeTakenPills = 0;

void saveRuntimeState() {
  if (!prefs.begin("pillbox", false)) return;
  prefs.putBool("init", true);
  prefs.putBool("setupDone", setupDone);
  prefs.putBool("pillMode", pillUnitMode);
  prefs.putBool("mismatch", setupMismatch);
  prefs.putBool("cfKnown", calibrationFactorKnown);
  prefs.putFloat("pillW", pillWeight);
  prefs.putFloat("calF", calibrationFactor);
  prefs.putInt("total", totalPills);
  prefs.putInt("current", currentPills);
  prefs.putInt("detected", detectedPills);
  prefs.end();
}

void loadRuntimeState() {
  if (!prefs.begin("pillbox", true)) return;
  bool hasState = prefs.getBool("init", false);
  if (!hasState) {
    prefs.end();
    Serial.println("[CFG] no saved runtime state");
    return;
  }

  setupDone = prefs.getBool("setupDone", false);
  pillUnitMode = prefs.getBool("pillMode", true);
  setupMismatch = prefs.getBool("mismatch", false);
  calibrationFactorKnown = prefs.getBool("cfKnown", false);
  pillWeight = prefs.getFloat("pillW", 0.0f);
  calibrationFactor = prefs.getFloat("calF", 1.0f);
  totalPills = prefs.getInt("total", 0);
  currentPills = prefs.getInt("current", 0);
  detectedPills = prefs.getInt("detected", currentPills);
  prefs.end();

  if (totalPills < 0) totalPills = 0;
  if (currentPills < 0) currentPills = 0;
  if (detectedPills < 0) detectedPills = 0;
  if (totalPills > 0 && currentPills > totalPills) currentPills = totalPills;
  if (totalPills > 0 && detectedPills > totalPills) detectedPills = totalPills;

  if (setupDone && calibrationFactorKnown && calibrationFactor > 0.0f) {
    scale.set_scale(calibrationFactor);
  }

  pendingCount = currentPills;
  confirmStreak = 0;
  setupAppliedAtMs = millis();
  restoredStateValidated = !setupDone;

  Serial.print("[CFG] restored setupDone=");
  Serial.print(setupDone ? "true" : "false");
  Serial.print(" current/total=");
  Serial.print(currentPills);
  Serial.print("/");
  Serial.print(totalPills);
  Serial.print(" pillWeight=");
  Serial.print(pillWeight, 3);
  Serial.print(" calFactor=");
  Serial.println(calibrationFactor, 3);
}

void validateRestoredSetupState() {
  if (restoredStateValidated) return;
  if (!setupDone) {
    restoredStateValidated = true;
    return;
  }
  if (millis() - bootAtMs < RESTORE_VALIDATE_DELAY_MS) return;

  // If persisted setup says ready but reading is not aligned, force re-setup instead of
  // treating startup drift as illegal pill removal.
  int measured = getStablePillCount();
  detectedPills = measured;
  if (measured != currentPills) {
    Serial.print("[BOOT] persisted count mismatch; saved=");
    Serial.print(currentPills);
    Serial.print(" measured=");
    Serial.println(measured);

    setupMismatch = true;
    setupDone = false;
    currentPills = measured;
    pendingCount = measured;
    confirmStreak = 0;
    saveRuntimeState();
  } else {
    setupMismatch = false;
    saveRuntimeState();
    Serial.println("[BOOT] persisted setup validated");
  }
  restoredStateValidated = true;
}

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
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
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

void sendWsAuth() {
  String payload = "{\"type\":\"AUTH\",\"hardwareId\":\"" + String(HARDWARE_ID) +
                   "\",\"deviceSecret\":\"" + String(DEVICE_SECRET) + "\"}";
  wsClient.sendTXT(payload);
  Serial.println("[WS] AUTH sent");
}

void connectWebSocket() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (wsClient.isConnected()) return;
  if (wsConnectPending) return;

  unsigned long now = millis();
  if (now - lastWsConnectAttemptMs < WS_RECONNECT_INTERVAL_MS) return;
  lastWsConnectAttemptMs = now;

  Serial.print("[WS] connecting wss://");
  Serial.print(WS_HOST);
  Serial.print(":");
  Serial.print(WS_PORT);
  Serial.print(WS_PATH);
  Serial.println();

  wsConnectPending = true;
  wsClient.beginSSL(WS_HOST, WS_PORT, WS_PATH);
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
  float s[5];
  for (int i = 0; i < 5; i++) {
    float w = scale.get_units(5);
    s[i] = w < 0 ? -w : w;
    if (i < 4) delay(10);
  }
  // insertion sort (5 elements)
  for (int i = 1; i < 5; i++) {
    float key = s[i];
    int j = i - 1;
    while (j >= 0 && s[j] > key) { s[j+1] = s[j]; j--; }
    s[j+1] = key;
  }
  return s[2];  // median
}

int getFastPillCount(bool clampToConfiguredTotal = true) {
  if (!setupDone || pillWeight <= 0.0001f) return currentPills;

  float weight = getFastWeight();
  Serial.print("[DBG] weight="); Serial.print(weight, 2);
  Serial.print(" pillWeight="); Serial.println(pillWeight, 3);
  int count = (int)(weight / pillWeight + 0.5f);
  if (count < 0) count = 0;
  if (clampToConfiguredTotal && totalPills > 0 && count > totalPills) count = totalPills;
  return count;
}

float getStablePillUnits() {
  const int VROUNDS = 5;
  float readings[VROUNDS];
  for (int i = 0; i < VROUNDS; i++) {
    float units = getFastWeight() / pillWeight;
    readings[i] = units < 0 ? -units : units;
    if (i < VROUNDS - 1) delay(120);
  }
  for (int i = 1; i < VROUNDS; i++) {
    float key = readings[i];
    int j = i - 1;
    while (j >= 0 && readings[j] > key) { readings[j + 1] = readings[j]; j--; }
    readings[j + 1] = key;
  }
  return readings[VROUNDS / 2];
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

String extractString(String text, String key, String fallback) {
  String token = "\"" + key + "\":";
  int pos = text.indexOf(token);
  if (pos < 0) return fallback;
  pos += token.length();

  while (pos < (int)text.length() && text[pos] == ' ') pos++;
  if (pos >= (int)text.length() || text[pos] != '"') return fallback;
  pos += 1;

  int end = text.indexOf("\"", pos);
  if (end < 0) return fallback;
  return text.substring(pos, end);
}

void buzzContinuous(unsigned long ms) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

void postCalStatus(String step, String detailsJson = "") {
  if (!wsClient.isConnected() || !wsAuthenticated) return;
  String payload = "{\"type\":\"CAL_STATUS\",\"step\":\"" + step + "\"";
  if (detailsJson.length() > 0) {
    payload += "," + detailsJson;
  }
  payload += "}";
  wsClient.sendTXT(payload);
  Serial.print("[CAL] status sent step="); Serial.println(step);
}


void postDeviceEvent(String type, String payloadJsonObject) {
  if (!wsClient.isConnected() || !wsAuthenticated) {
    Serial.println("[EVENT] ws not ready, event skipped");
    return;
  }

  String payload = "{\"type\":\"DOSE_EVENT\",\"event\":\"" + type + "\",\"payload\":" + payloadJsonObject + "}";
  wsClient.sendTXT(payload);
  Serial.println("[EVENT] sent over ws");
}

void startDoseReminder(String json) {
  String nextDoseId = extractString(json, "doseId", "");
  String nextPillName = extractString(json, "pillName", "Medicine");
  int nextRequiredPills = extractInt(json, "requiredPills", 1);
  if (nextRequiredPills <= 0) nextRequiredPills = 1;

  bool sameActiveDose = reminderActive && nextDoseId.length() > 0 && nextDoseId == activeDoseId;
  if (!sameActiveDose) {
    activeDoseId = nextDoseId;
    activePillName = nextPillName;
    activeRequiredPills = nextRequiredPills;
    activeTakenPills = 0;
  }
  reminderActive = true;

  digitalWrite(LED_PIN, HIGH);
  beep(2);

  Serial.print("[REMINDER] active doseId=");
  Serial.print(activeDoseId);
  Serial.print(" pill=");
  Serial.print(activePillName);
  Serial.print(" requiredPills=");
  Serial.println(activeRequiredPills);
}

// Called from handleCommands — just kicks off the state machine, returns immediately.
void calibrateOnePillAsUnit() {
  Serial.println("[CAL] CALIBRATE_ONE_PILL requested — starting state machine.");
  calState = CAL_WAIT_CLEAR;
  calStateEnterMs = millis();
  postCalStatus("CLEAR_BOX");
  beep(1);
}

// Called every loop() iteration — advances calibration without blocking.
void tickCalibration() {
  if (calState == CAL_IDLE) return;

  unsigned long elapsed = millis() - calStateEnterMs;

  if (calState == CAL_WAIT_CLEAR) {
    if (elapsed < 10000) return;  // wait 10s for user to clear scale
    scale.tare(10);
    Serial.println("[CAL] tare done");
    calState = CAL_WAIT_PILL;
    calStateEnterMs = millis();
    postCalStatus("PLACE_PILL");
    beep(2);
    return;
  }

  if (calState == CAL_WAIT_PILL) {
    if (elapsed < 8000) return;  // wait 8s for user to place 1 pill
    calState = CAL_SAMPLING;
    calStateEnterMs = millis();
    return;
  }

  if (calState == CAL_SAMPLING) {
    // Sample with insertion sort
    const int ROUNDS = CAL_ROUNDS;
    long samples[CAL_ROUNDS];
    for (int i = 0; i < ROUNDS; i++) {
      long raw = scale.get_value(30);
      samples[i] = raw < 0 ? -raw : raw;
      Serial.print("[CAL] round "); Serial.print(i+1);
      Serial.print(" raw="); Serial.println(samples[i]);
      if (i < ROUNDS - 1) delay(300);
    }

    // insertion sort
    for (int i = 1; i < ROUNDS; i++) {
      long key = samples[i]; int j = i - 1;
      while (j >= 0 && samples[j] > key) { samples[j+1] = samples[j]; j--; }
      samples[j+1] = key;
    }

    // reject lowest and highest, average the middle 5
    long sum = 0;
    for (int i = 1; i < ROUNDS - 1; i++) sum += samples[i];
    long rawOnePill = sum / (ROUNDS - 2);

    Serial.print("[CAL] median-trimmed raw="); Serial.println(rawOnePill);
    calState = CAL_IDLE;

    if (rawOnePill < CAL_RAW_MIN || rawOnePill > CAL_RAW_MAX) {
      Serial.print("[CAL] failed, raw out of range: "); Serial.println(rawOnePill);
      postCalStatus("FAILED");
      return;
    }

    calibrationFactor = (float)rawOnePill / 1.0f;
    calibrationFactorKnown = true;
    scale.set_scale(calibrationFactor);
    pillWeight = 1.0f;
    pillUnitMode = true;
    pendingCount = currentPills;
    setupDone = false;

    Serial.print("[CAL] success. factor="); Serial.print(calibrationFactor, 3);
    Serial.print(" | pillWeight="); Serial.print(pillWeight, 3);
    Serial.print(" | setupDone="); Serial.println(setupDone ? "true" : "false");
    saveRuntimeState();
    postCalStatus("DONE");
    beep(2);
  }
}

int getStablePillCount() {
  const int VROUNDS = 5;
  int counts[VROUNDS];
  for (int i = 0; i < VROUNDS; i++) {
    counts[i] = getFastPillCount(false);
    Serial.print("[VFY] round "); Serial.print(i+1);
    Serial.print(" count="); Serial.println(counts[i]);
    if (i < VROUNDS - 1) delay(200);
  }
  // insertion sort
  for (int i = 1; i < VROUNDS; i++) {
    int key = counts[i]; int j = i - 1;
    while (j >= 0 && counts[j] > key) { counts[j+1] = counts[j]; j--; }
    counts[j+1] = key;
  }
  // check all readings agree (no spread > 1)
  if (counts[VROUNDS-1] - counts[0] > 1) {
    Serial.println("[VFY] unstable readings, using median");
  }
  return counts[VROUNDS / 2]; // median
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
  setupDone = false;
  setupAppliedAtMs = millis();

  delay(500);  // let scale settle after config
  detectedPills = getStablePillCount();
  setupMismatch = (detectedPills != currentPills);

  if (setupMismatch) {
    Serial.print("[SETUP] MISMATCH detected=");
    Serial.print(detectedPills);
    Serial.print(" expected=");
    Serial.println(currentPills);
    postCalStatus(
      "COUNT_MISMATCH",
      "\"expected\":" + String(currentPills) +
      ",\"detected\":" + String(detectedPills) +
      ",\"current\":" + String(detectedPills) +
      ",\"total\":" + String(totalPills) +
      ",\"message\":\"Mismatch after loading pills\""
    );
    currentPills = detectedPills;
    pendingCount = currentPills;
    setupDone = false;
  } else {
    Serial.println("[SETUP] count verified OK");
    setupDone = true;

    if (calibrationFactorKnown && currentPills > 0) {
      float measuredUnits = getStablePillUnits();
      float ratio = measuredUnits / (float)currentPills;
      float delta = ratio - 1.0f;

      if (ratio > 0.75f && ratio < 1.25f && (delta > 0.03f || delta < -0.03f)) {
        float nextFactor = calibrationFactor * ratio;
        Serial.print("[CAL] auto-trim factor ");
        Serial.print(calibrationFactor, 3);
        Serial.print(" -> ");
        Serial.print(nextFactor, 3);
        Serial.print(" (measuredUnits=");
        Serial.print(measuredUnits, 2);
        Serial.print(" expected=");
        Serial.print(currentPills);
        Serial.println(")");

        calibrationFactor = nextFactor;
        scale.set_scale(calibrationFactor);
        delay(300);

        detectedPills = getStablePillCount();
        setupMismatch = (detectedPills != currentPills);
        if (setupMismatch) {
          Serial.println("[CAL] auto-trim produced mismatch, keeping setupMismatch=true");
        }
      }
    }

    postCalStatus(
      "COUNT_VERIFIED",
      "\"expected\":" + String(currentPills) +
      ",\"detected\":" + String(detectedPills) +
      ",\"current\":" + String(currentPills) +
      ",\"total\":" + String(totalPills) +
      ",\"message\":\"Count verified proceed\""
    );
  }

  Serial.print("[SETUP] applied pillWeight=");
  Serial.print(pillWeight, 3);
  Serial.print(" pillUnitMode=");
  Serial.print(pillUnitMode ? "true" : "false");
  Serial.print(" totalPills=");
  Serial.print(totalPills);
  Serial.print(" currentPills=");
  Serial.println(currentPills);
  saveRuntimeState();
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
  if (json.indexOf("\"command\":\"REMINDER_START\"") >= 0) {
    startDoseReminder(json);
  }
  if (json.indexOf("\"command\":\"RESET_SETUP\"") >= 0) {
    setupDone = false;
    pillUnitMode = true;
    setupMismatch = false;
    detectedPills = 0;
    totalPills = 0;
    currentPills = 0;
    pillWeight = 0;
    calibrationFactor = 1.0f;
    calibrationFactorKnown = false;
    reminderActive = false;
    activeDoseId = "";
    activePillName = "";
    activeRequiredPills = 1;
    activeTakenPills = 0;
    digitalWrite(LED_PIN, LOW);
    Serial.println("[SETUP] reset");
    saveRuntimeState();
  }
}

void handleWebSocketMessage(String json) {
  Serial.print("[WS] msg: ");
  Serial.println(json);

  if (json.indexOf("\"type\":\"AUTH_OK\"") >= 0) {
    wsAuthenticated = true;
    Serial.println("[WS] AUTH_OK");
    return;
  }

  if (json.indexOf("\"type\":\"COMMAND\"") >= 0) {
    Serial.println("[WS] command received");
    handleCommands(json);
    return;
  }

  if (json.indexOf("\"type\":\"COMMANDS\"") >= 0) {
    Serial.println("[WS] commands received");
    handleCommands(json);
    return;
  }

  if (json.indexOf("\"type\":\"ERROR\"") >= 0) {
    Serial.print("[WS] server error: ");
    Serial.println(json);
  }
}

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsAuthenticated = false;
      wsConnectPending = false;
      Serial.println("[WS] disconnected");
      break;
    case WStype_CONNECTED:
      wsAuthenticated = false;
      wsConnectPending = false;
      Serial.println("[WS] connected");
      sendWsAuth();
      break;
    case WStype_TEXT:
      {
        String msg = "";
        msg.reserve(length + 1);
        for (size_t i = 0; i < length; i++) {
          msg += (char)payload[i];
        }
        handleWebSocketMessage(msg);
      }
      break;
    case WStype_ERROR:
      wsAuthenticated = false;
      wsConnectPending = false;
      Serial.println("[WS] error");
      break;
    default:
      break;
  }
}

void pushRuntimeStatus() {
  if (!wsClient.isConnected() || !wsAuthenticated) {
    Serial.println("[STATUS] ws not ready");
    return;
  }

  String payload = String("{\"type\":\"STATUS\"") +
                   ",\"wifiConnected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") +
                   ",\"ip\":\"" + String(WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "-") + "\"" +
                   ",\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -999) +
                   ",\"setupDone\":" + String(setupDone ? "true" : "false") +
                   ",\"setupMismatch\":" + String(setupMismatch ? "true" : "false") +
                   ",\"detectedPills\":" + String(detectedPills) +
                   ",\"pillWeight\":" + String(pillWeight, 3) +
                   ",\"threshold\":" + String(PILL_CHANGE_THRESHOLD, 3) +
                   ",\"confirmReads\":" + String(CONFIRM_READS) +
                   ",\"pillUnitMode\":" + String(pillUnitMode ? "true" : "false") +
                   ",\"currentPills\":" + String(currentPills) +
                   ",\"totalPills\":" + String(totalPills) +
                   "}";
  wsClient.sendTXT(payload);
  Serial.println("[STATUS] sent over ws");
}

void monitorPills() {
  if (!wsAuthenticated) return;
  if (!restoredStateValidated) return;
  if (!setupDone) return;
  if (millis() - setupAppliedAtMs < MONITOR_WARMUP_MS) return;

  int newCount = getFastPillCount();

  if (newCount != currentPills) {
    if (newCount == pendingCount) {
      confirmStreak++;
    } else {
      pendingCount = newCount;
      confirmStreak = 1;
    }

    int requiredReads = (abs(newCount - currentPills) > 2) ? CONFIRM_READS * 2 : CONFIRM_READS;
    if (confirmStreak >= requiredReads) {
      if (newCount < currentPills) {
        int taken = currentPills - newCount;
        Serial.print("[PILL] removed=");
        Serial.print(taken);
        Serial.print(" remaining=");
        Serial.println(newCount);

        if (reminderActive) {
          activeTakenPills += taken;

          if (activeTakenPills > activeRequiredPills) {
            Serial.println("[REMINDER] overdose detected");
            buzzContinuous(OVERDOSE_BUZZ_MS);
            digitalWrite(LED_PIN, LOW);
            reminderActive = false;
            postDeviceEvent("DOSE_OVERDOSE",
              "{\"doseId\":\"" + activeDoseId + "\",\"pillName\":\"" + activePillName +
              "\",\"requiredPills\":" + String(activeRequiredPills) +
              ",\"takenPills\":" + String(activeTakenPills) + "}");
            activeDoseId = "";
            activePillName = "";
            activeRequiredPills = 1;
            activeTakenPills = 0;
          } else if (activeTakenPills == activeRequiredPills) {
            Serial.println("[REMINDER] dose completed");
            beep(1);
            digitalWrite(LED_PIN, LOW);
            reminderActive = false;
            postDeviceEvent("DOSE_COMPLETED",
              "{\"doseId\":\"" + activeDoseId + "\",\"pillName\":\"" + activePillName +
              "\",\"requiredPills\":" + String(activeRequiredPills) +
              ",\"takenPills\":" + String(activeTakenPills) + "}");
            activeDoseId = "";
            activePillName = "";
            activeRequiredPills = 1;
            activeTakenPills = 0;
          }
        } else {
          Serial.println("[SEC] Illegal pill removal (outside active reminder)");
          buzzContinuous(15000);
          postDeviceEvent("ILLEGAL_PILL_REMOVAL",
            "{\"pillName\":\"" + activePillName +
            "\",\"removedPills\":" + String(taken) +
            ",\"remainingPills\":" + String(newCount) +
            ",\"scheduled\":false}");
        }
      } else {
        Serial.print("[PILL] added newCount=");
        Serial.println(newCount);
      }

      currentPills = newCount;
      detectedPills = newCount;
      setupMismatch = false;
      pendingCount = newCount;
      confirmStreak = 0;
      saveRuntimeState();
    }
  } else {
    confirmStreak = 0;
    pendingCount = currentPills;
  }
}

void setup() {
  Serial.begin(115200);
  delay(800);
  bootAtMs = millis();

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  scale.begin(DATA_PIN, CLK_PIN);
  while (!scale.is_ready()) delay(100);
  scale.tare(20);
  loadRuntimeState();

  Serial.println("===== ESP32 BOOT =====");
  Serial.print("[CFG] HARDWARE_ID: "); Serial.println(HARDWARE_ID);
  Serial.print("[CFG] SERVER_BASE_URL: "); Serial.println(SERVER_BASE_URL);
  Serial.print("[CFG] WS_HOST: "); Serial.println(WS_HOST);
  Serial.print("[CFG] WIFI_SSID: "); Serial.println(WIFI_SSID);
  Serial.println("[BOOT] Wi-Fi + WebSocket mode");

  wsClient.onEvent(onWebSocketEvent);
  // Use a single reconnect strategy: manual connectWebSocket() loop below.
  // Auto-reconnect + manual reconnect together can cause connect/disconnect thrashing.
  wsClient.enableHeartbeat(30000, 5000, 5);

  connectWifi();
  if (WiFi.status() == WL_CONNECTED) {
    registerDeviceWithServer();
    connectWebSocket();
  }

}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    wsAuthenticated = false;
    wsConnectPending = false;
  }

  if (WiFi.status() == WL_CONNECTED) {
    connectWebSocket();
  }

  wsClient.loop();
  validateRestoredSetupState();

  unsigned long now = millis();
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

  tickCalibration();
  if (calState == CAL_IDLE) monitorPills();
  delay(100);
}