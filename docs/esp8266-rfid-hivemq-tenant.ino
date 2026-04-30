/*
  ESP8266 + PN532 + MQTT-only RFID

  Device dibuat ringan:
  - ESP8266 hanya membaca kartu dan publish event scan ke MQTT.
  - Laravel menjadi otak sistem untuk mode masuk/pulang, jadwal aktif,
    validasi kartu, enroll UID, audit log, dan response.
  - Tidak ada HTTP fallback, heartbeat HTTP, atau queue file lokal.

  Alur backend:
  - Mode "manual": scan masuk/pulang mengikuti jam manual di pengaturan.
  - Mode "auto": scan hanya diterima saat ada jadwal pelajaran aktif.
  - Mode "enroll": UID kartu disimpan ke rfid_scans kapan saja untuk
    didaftarkan ke user dari dashboard.

  Library yang dibutuhkan:
  - ESP8266 Board Package
  - Adafruit PN532
  - PubSubClient
  - ArduinoJson v6
*/

#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <Adafruit_PN532.h>
#include <ArduinoJson.h>
#include <time.h>

/* ================== KONFIGURASI WIFI ================== */
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

/* ================== IDENTITAS TENANT & DEVICE ================== */
const char* TENANT_SLUG = "sman1jombang";
const char* DEVICE_ID = "gerbang-utara-01";
const char* FIRMWARE_VERSION = "2.0.0-mqtt-only";

/* ================== KONFIGURASI MQTT ================== */
const char* MQTT_HOST = "mqtt.edusmart.example.com";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USER = "edusmart_sman1jombang_rfid";
const char* MQTT_PASS = "YOUR_MOSQUITTO_PASSWORD";
const bool MQTT_USE_TLS = true;

// Untuk produksi yang lebih ketat, ganti setInsecure() dengan CA certificate broker Mosquitto.
const bool MQTT_TLS_INSECURE = true;

const char* MQTT_TOPIC_SCAN = "edusmart/sman1jombang/rfid/scan";
const char* MQTT_TOPIC_RESPONSE = "edusmart/sman1jombang/rfid/response";
const char* MQTT_TOPIC_MODE = "edusmart/sman1jombang/rfid/mode";

/* ================== KONFIGURASI HARDWARE ================== */
#define PN532_SCK   D5
#define PN532_MISO  D6
#define PN532_MOSI  D7
#define PN532_SS    D0

#define LED_PIN      LED_BUILTIN
#define BUZZER_PIN   D2

Adafruit_PN532 nfc(PN532_SCK, PN532_MISO, PN532_MOSI, PN532_SS);

/* ================== TUNING DEVICE ================== */
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
const unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
const unsigned long MQTT_ACK_TIMEOUT_MS = 7000;
const unsigned long NTP_RESYNC_INTERVAL_MS = 3600000;
const unsigned long SCAN_COOLDOWN_MS = 3500;
const uint8_t MQTT_PUBLISH_RETRY_LIMIT = 3;
const long TZ_OFFSET_SECONDS = 7 * 3600;
const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.google.com";

/* ================== TOPIK MQTT ================== */
String topicScan;
String topicResponse;
String topicMode;

/* ================== CLIENT ================== */
WiFiClient mqttPlainClient;
BearSSL::WiFiClientSecure mqttSecureClient;
PubSubClient mqttClient;

/* ================== STATE ================== */
uint8_t lastUid[7];
uint8_t lastUidLength = 0;
bool hasLastUid = false;
unsigned long lastScanTime = 0;
unsigned long lastWiFiAttemptAt = 0;
unsigned long lastMqttAttemptAt = 0;
unsigned long lastNtpSyncAt = 0;
uint32_t eventCounter = 0;
String currentMode = "auto";

struct PendingEvent {
  bool active;
  String eventId;
  String cardUid;
  String mode;
  String scannedAt;
  String payload;
  uint8_t attempts;
  unsigned long lastPublishAt;
};

PendingEvent pendingEvent = { false, "", "", "auto", "", "", 0, 0 };

/* ================== BEEPER ================== */
void beepRaw(int durationMs) {
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(durationMs);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, HIGH);
}

void beepPattern(int count, int onMs, int offMs) {
  for (int i = 0; i < count; i++) {
    beepRaw(onMs);
    if (i < count - 1) {
      delay(offMs);
    }
  }
}

void sfxStartup()      { beepPattern(3, 100, 70); }
void sfxCardDetected() { beepPattern(1, 70, 0); }
void sfxSuccess()      { beepPattern(1, 220, 0); }
void sfxInfo()         { beepPattern(2, 90, 80); }
void sfxWarning()      { beepPattern(2, 120, 80); }
void sfxDenied()       { beepPattern(3, 160, 120); }
void sfxError()        { beepPattern(2, 280, 180); }

/* ================== HELPER STRING ================== */
String normalizeModeValue(String mode) {
  mode.trim();
  mode.toLowerCase();

  if (mode == "register") {
    return "enroll";
  }
  if (mode == "enroll") {
    return "enroll";
  }
  if (mode == "manual") {
    return "manual";
  }

  return "auto";
}

String sanitizeToken(String value) {
  value.trim();
  value.replace(" ", "-");
  value.replace("/", "-");
  value.replace("\\", "-");
  return value;
}

String jsonString(JsonVariantConst value, const char* fallback = "") {
  return String(value | fallback);
}

String uidToHexString(uint8_t* uid, uint8_t len) {
  String output = "";
  for (uint8_t i = 0; i < len; i++) {
    if (uid[i] < 0x10) {
      output += "0";
    }
    output += String(uid[i], HEX);
  }
  output.toUpperCase();
  return output;
}

bool isSameUid(uint8_t* uid, uint8_t uidLength) {
  if (!hasLastUid || uidLength != lastUidLength) {
    return false;
  }

  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] != lastUid[i]) {
      return false;
    }
  }

  return true;
}

bool timeIsSynced() {
  return time(nullptr) > 1700000000;
}

String currentIsoTimestamp() {
  if (!timeIsSynced()) {
    return "";
  }

  time_t now = time(nullptr);
  struct tm timeInfo;
  localtime_r(&now, &timeInfo);

  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S%z", &timeInfo);
  String stamp(buffer);
  if (stamp.length() >= 5) {
    stamp = stamp.substring(0, stamp.length() - 2) + ":" + stamp.substring(stamp.length() - 2);
  }

  return stamp;
}

String generateEventId() {
  eventCounter++;

  char stamp[28];
  if (timeIsSynced()) {
    time_t now = time(nullptr);
    struct tm timeInfo;
    localtime_r(&now, &timeInfo);
    snprintf(
      stamp,
      sizeof(stamp),
      "%04d%02d%02d-%02d%02d%02d",
      timeInfo.tm_year + 1900,
      timeInfo.tm_mon + 1,
      timeInfo.tm_mday,
      timeInfo.tm_hour,
      timeInfo.tm_min,
      timeInfo.tm_sec
    );
  } else {
    snprintf(stamp, sizeof(stamp), "boot-%lu", millis() / 1000UL);
  }

  char suffix[18];
  snprintf(suffix, sizeof(suffix), "%04lu", (unsigned long) (eventCounter % 10000UL));
  return "scan-" + sanitizeToken(String(DEVICE_ID)) + "-" + String(stamp) + "-" + String(suffix);
}

/* ================== WIFI & NTP ================== */
void configureSecureClient() {
  if (!MQTT_USE_TLS) {
    return;
  }

  mqttSecureClient.setTimeout(15000);
  if (MQTT_TLS_INSECURE) {
    mqttSecureClient.setInsecure();
  }
}

void connectWiFiIfNeeded(bool force = false) {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  unsigned long nowMs = millis();
  if (!force && (nowMs - lastWiFiAttemptAt) < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWiFiAttemptAt = nowMs;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.printf("[WIFI] Connecting to %s", WIFI_SSID);
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startedAt) < WIFI_CONNECT_TIMEOUT_MS) {
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    delay(400);
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_PIN, HIGH);
    Serial.printf("\n[WIFI] Connected. IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    digitalWrite(LED_PIN, HIGH);
    Serial.println("\n[WIFI] Belum tersambung.");
  }
}

void syncClockIfNeeded(bool force = false) {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  unsigned long nowMs = millis();
  if (!force && (nowMs - lastNtpSyncAt) < NTP_RESYNC_INTERVAL_MS) {
    return;
  }

  configTime(TZ_OFFSET_SECONDS, 0, NTP_SERVER_1, NTP_SERVER_2);
  Serial.print("[NTP] Sync time");

  unsigned long startedAt = millis();
  while (!timeIsSynced() && (millis() - startedAt) < 10000UL) {
    Serial.print(".");
    delay(500);
  }

  lastNtpSyncAt = millis();
  if (timeIsSynced()) {
    Serial.printf(" ok (%s)\n", currentIsoTimestamp().c_str());
  } else {
    Serial.println(" pending");
  }
}

/* ================== MODE ================== */
void applyModeFromValue(const String& rawMode) {
  String nextMode = normalizeModeValue(rawMode);
  if (nextMode == currentMode) {
    return;
  }

  currentMode = nextMode;
  Serial.printf("[MODE] Updated => %s\n", currentMode.c_str());
  sfxInfo();
}

void handleModeMessage(const String& message) {
  String incoming = message;
  incoming.trim();

  if (incoming.startsWith("{")) {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, incoming) == DeserializationError::Ok) {
      incoming = jsonString(doc["mode"], incoming.c_str());
    }
  }

  applyModeFromValue(incoming);
}

/* ================== MQTT ================== */
String buildMqttClientId() {
  return "rfid-" + String(ESP.getChipId(), HEX) + "-" + String(random(0xffff), HEX);
}

String configuredTopic(const char* configuredTopic, const String& fallback) {
  String topic(configuredTopic);
  topic.trim();

  return topic.length() > 0 ? topic : fallback;
}

bool responseCanClosePending(bool success, bool duplicate, int httpStatus) {
  if (success || duplicate) {
    return true;
  }

  return httpStatus > 0 && httpStatus < 500;
}

void resetPendingEvent() {
  pendingEvent.active = false;
  pendingEvent.eventId = "";
  pendingEvent.cardUid = "";
  pendingEvent.mode = "auto";
  pendingEvent.scannedAt = "";
  pendingEvent.payload = "";
  pendingEvent.attempts = 0;
  pendingEvent.lastPublishAt = 0;
}

void handleResponseFeedback(bool success, const String& reason) {
  if (success) {
    sfxSuccess();
    return;
  }

  if (
    reason == "already_scanned" ||
    reason == "no_schedule_now" ||
    reason == "outside_rfid_window" ||
    reason == "no_manual_window" ||
    reason == "duplicate_event"
  ) {
    sfxWarning();
    return;
  }

  if (
    reason == "rfid_not_registered" ||
    reason == "unauthorized_device" ||
    reason == "invalid_device_secret" ||
    reason == "device_blocked" ||
    reason == "invalid_card_uid"
  ) {
    sfxDenied();
    return;
  }

  sfxError();
}

void handleResponseMessage(const String& message) {
  StaticJsonDocument<2048> doc;
  DeserializationError err = deserializeJson(doc, message);
  if (err) {
    Serial.printf("[RESP] Invalid JSON: %s\n", err.c_str());
    return;
  }

  String deviceId = jsonString(doc["device_id"]);
  String eventId = jsonString(doc["event_id"]);
  bool success = doc["success"] | false;
  bool duplicate = doc["duplicate"] | false;
  int httpStatus = doc["http_status"] | 200;
  String reason = jsonString(doc["reason"]);

  if (deviceId.length() > 0 && deviceId != DEVICE_ID) {
    return;
  }

  if (!pendingEvent.active || eventId != pendingEvent.eventId) {
    return;
  }

  String nama = jsonString(doc["nama"], "-");
  String kelas = jsonString(doc["kelas"], "-");
  String mapel = jsonString(doc["mapel"], "-");
  String status = jsonString(doc["status"], "-");

  Serial.printf(
    "[RESP] event=%s success=%d duplicate=%d reason=%s nama=%s kelas=%s mapel=%s status=%s\n",
    pendingEvent.eventId.c_str(),
    success,
    duplicate,
    reason.c_str(),
    nama.c_str(),
    kelas.c_str(),
    mapel.c_str(),
    status.c_str()
  );

  bool closePending = responseCanClosePending(success, duplicate, httpStatus);
  handleResponseFeedback(success || duplicate, reason);

  if (closePending) {
    resetPendingEvent();
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    message += (char) payload[i];
  }

  String incomingTopic(topic);
  Serial.printf("[MQTT] %s => %s\n", incomingTopic.c_str(), message.c_str());

  if (incomingTopic == topicMode) {
    handleModeMessage(message);
    return;
  }

  if (incomingTopic == topicResponse) {
    handleResponseMessage(message);
  }
}

void connectMqttIfNeeded() {
  if (mqttClient.connected() || WiFi.status() != WL_CONNECTED) {
    return;
  }

  unsigned long nowMs = millis();
  if ((nowMs - lastMqttAttemptAt) < MQTT_RETRY_INTERVAL_MS) {
    return;
  }

  lastMqttAttemptAt = nowMs;
  String clientId = buildMqttClientId();

  Serial.printf("[MQTT] Connecting as %s ... ", clientId.c_str());
  bool connected = mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS);
  if (!connected) {
    Serial.printf("failed rc=%d\n", mqttClient.state());
    return;
  }

  Serial.println("connected");
  mqttClient.subscribe(topicResponse.c_str(), 1);
  mqttClient.subscribe(topicMode.c_str(), 1);
  Serial.printf("[MQTT] Subscribed response=%s mode=%s\n", topicResponse.c_str(), topicMode.c_str());
}

String buildScanPayload(const String& eventId, const String& cardUid, const String& mode, const String& scannedAt) {
  StaticJsonDocument<512> doc;
  doc["event_id"] = eventId;
  doc["device_id"] = DEVICE_ID;
  doc["tenant_slug"] = TENANT_SLUG;
  doc["card_uid"] = cardUid;
  doc["mode"] = mode;
  doc["transport"] = "mqtt";
  doc["firmware_version"] = FIRMWARE_VERSION;

  if (scannedAt.length() > 0) {
    doc["scanned_at"] = scannedAt;
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool publishPendingEvent() {
  if (!pendingEvent.active || !mqttClient.connected()) {
    return false;
  }

  bool ok = mqttClient.publish(topicScan.c_str(), pendingEvent.payload.c_str(), false);
  if (!ok) {
    Serial.println("[MQTT] Publish gagal.");
    return false;
  }

  pendingEvent.attempts++;
  pendingEvent.lastPublishAt = millis();
  Serial.printf(
    "[MQTT] Published event=%s uid=%s mode=%s attempt=%u\n",
    pendingEvent.eventId.c_str(),
    pendingEvent.cardUid.c_str(),
    pendingEvent.mode.c_str(),
    pendingEvent.attempts
  );

  return true;
}

void retryOrDropPendingIfNeeded() {
  if (!pendingEvent.active) {
    return;
  }

  if (!mqttClient.connected()) {
    return;
  }

  if (pendingEvent.attempts == 0) {
    publishPendingEvent();
    return;
  }

  if ((millis() - pendingEvent.lastPublishAt) <= MQTT_ACK_TIMEOUT_MS) {
    return;
  }

  if (pendingEvent.attempts < MQTT_PUBLISH_RETRY_LIMIT) {
    Serial.printf("[MQTT] ACK timeout. Retry event=%s\n", pendingEvent.eventId.c_str());
    publishPendingEvent();
    return;
  }

  Serial.printf("[MQTT] Event dibatalkan setelah %u percobaan: %s\n", pendingEvent.attempts, pendingEvent.eventId.c_str());
  resetPendingEvent();
  sfxError();
}

/* ================== NFC ================== */
void setupNfc() {
  nfc.begin();
  uint32_t versionData = nfc.getFirmwareVersion();
  if (!versionData) {
    Serial.println("[NFC] PN532 tidak terdeteksi.");
    while (true) {
      sfxError();
      delay(2000);
    }
  }

  nfc.SAMConfig();
  Serial.println("[NFC] PN532 ready.");
}

void handleScannedCard(const String& cardUid) {
  Serial.printf("[NFC] card_uid=%s mode=%s\n", cardUid.c_str(), currentMode.c_str());
  sfxCardDetected();

  if (pendingEvent.active) {
    Serial.println("[NFC] Masih menunggu response scan sebelumnya.");
    sfxWarning();
    return;
  }

  pendingEvent.active = true;
  pendingEvent.eventId = generateEventId();
  pendingEvent.cardUid = cardUid;
  pendingEvent.mode = normalizeModeValue(currentMode);
  pendingEvent.scannedAt = currentIsoTimestamp();
  pendingEvent.payload = buildScanPayload(
    pendingEvent.eventId,
    pendingEvent.cardUid,
    pendingEvent.mode,
    pendingEvent.scannedAt
  );
  pendingEvent.attempts = 0;
  pendingEvent.lastPublishAt = 0;

  if (!publishPendingEvent()) {
    Serial.println("[MQTT] Scan disimpan sementara di RAM sampai MQTT tersambung.");
  }
}

/* ================== SETUP ================== */
void setup() {
  Serial.begin(115200);
  delay(800);
  randomSeed(ESP.getChipId() ^ micros());

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, LOW);

  topicScan = configuredTopic(
    MQTT_TOPIC_SCAN,
    String("edusmart/") + String(TENANT_SLUG) + "/rfid/scan"
  );
  topicResponse = configuredTopic(
    MQTT_TOPIC_RESPONSE,
    String("edusmart/") + String(TENANT_SLUG) + "/rfid/response"
  );
  topicMode = configuredTopic(
    MQTT_TOPIC_MODE,
    String("edusmart/") + String(TENANT_SLUG) + "/rfid/mode"
  );

  Serial.println("\n=== ESP8266 PN532 RFID MQTT-only ===");
  Serial.printf("tenant=%s device=%s firmware=%s\n", TENANT_SLUG, DEVICE_ID, FIRMWARE_VERSION);
  Serial.printf("scan=%s\nresponse=%s\nmode=%s\n", topicScan.c_str(), topicResponse.c_str(), topicMode.c_str());

  sfxStartup();
  configureSecureClient();

  if (MQTT_USE_TLS) {
    mqttClient.setClient(mqttSecureClient);
  } else {
    mqttClient.setClient(mqttPlainClient);
  }
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(20);
  mqttClient.setSocketTimeout(5);
  mqttClient.setBufferSize(2048);

  connectWiFiIfNeeded(true);
  syncClockIfNeeded(true);
  connectMqttIfNeeded();
  setupNfc();

  Serial.println("[SYS] Ready.");
}

/* ================== LOOP ================== */
void loop() {
  connectWiFiIfNeeded();
  syncClockIfNeeded();
  connectMqttIfNeeded();

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  retryOrDropPendingIfNeeded();

  if (hasLastUid && (millis() - lastScanTime > SCAN_COOLDOWN_MS)) {
    hasLastUid = false;
    lastUidLength = 0;
  }

  uint8_t uid[7];
  uint8_t uidLength = 0;
  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50)) {
    if (isSameUid(uid, uidLength) && (millis() - lastScanTime < SCAN_COOLDOWN_MS)) {
      return;
    }

    lastScanTime = millis();
    memcpy(lastUid, uid, uidLength);
    lastUidLength = uidLength;
    hasLastUid = true;

    handleScannedCard(uidToHexString(uid, uidLength));
  }
}
