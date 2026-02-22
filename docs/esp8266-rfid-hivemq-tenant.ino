#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <SPI.h>
#include <Adafruit_PN532.h>
#include <ArduinoJson.h>

/* ================== WIFI ================== */
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

/* ================== TENANT ================== */
const char* TENANT_SLUG = "sma-bali";
const char* DEVICE_ID = "WEMOS_D1_GERBANG_UTAMA";

/* ================== MQTT (HiveMQ Cloud) ================== */
const char* MQTT_SERVER = "YOUR_HIVEMQ_HOST.s1.eu.hivemq.cloud";
const int   MQTT_PORT   = 8883;
const char* MQTT_USER   = "YOUR_HIVEMQ_USERNAME";
const char* MQTT_PASS   = "YOUR_HIVEMQ_PASSWORD";

String topicScan;
String topicResponse;
String topicMode;

/* ================== HARDWARE ================== */
#define PN532_SCK   D5
#define PN532_MISO  D6
#define PN532_MOSI  D7
#define PN532_SS    D0
#define LED_PIN     LED_BUILTIN
#define BUZZER_PIN  D2

Adafruit_PN532 nfc(PN532_SCK, PN532_MISO, PN532_MOSI, PN532_SS);

WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);

/* ================== STATE ================== */
uint8_t lastUid[7];
uint8_t lastUidLength = 0;
bool hasLastUid = false;
unsigned long lastScanTime = 0;
const unsigned long SCAN_COOLDOWN_MS = 4000;

bool manualModeEnabled = false;

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
    if (i < count - 1) delay(offMs);
  }
}

void sfxStartup()      { beepPattern(3, 120, 80); }
void sfxCardDetected() { beepPattern(1, 80, 0); }
void sfxSuccess()      { beepPattern(1, 220, 0); }
void sfxWarning()      { beepPattern(2, 120, 80); }
void sfxDenied()       { beepPattern(3, 180, 180); }
void sfxError()        { beepPattern(2, 300, 200); }

/* ================== HELPERS ================== */
String uidToHexString(uint8_t *uid, uint8_t len) {
  String s = "";
  for (uint8_t i = 0; i < len; i++) {
    if (uid[i] < 0x10) s += "0";
    s += String(uid[i], HEX);
  }
  s.toUpperCase();
  return s;
}

bool isSameUid(uint8_t *uid, uint8_t uidLength) {
  if (!hasLastUid || uidLength != lastUidLength) return false;
  for (uint8_t i = 0; i < uidLength; i++) if (uid[i] != lastUid[i]) return false;
  return true;
}

/* ================== WIFI ================== */
void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.printf("\n[WIFI] Connecting to %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }

  digitalWrite(LED_PIN, HIGH);
  Serial.printf("\n[WIFI] Connected. IP=%s\n", WiFi.localIP().toString().c_str());
}

/* ================== MQTT CALLBACK ================== */
void handleModeMessage(const String &message) {
  String incoming = message;
  incoming.trim();

  String mode = incoming;
  if (incoming.startsWith("{")) {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, incoming) == DeserializationError::Ok) {
      mode = doc["mode"] | incoming;
    }
  }

  mode.toLowerCase();
  bool nextManual = (mode == "manual");

  if (nextManual != manualModeEnabled) {
    manualModeEnabled = nextManual;
    beepPattern(2, 120, 120);
    Serial.printf("[MODE] Changed to: %s\n", manualModeEnabled ? "manual" : "auto");
  }
}

void handleResponseMessage(const String &message) {
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, message);
  if (err) {
    Serial.println("[RESP] Invalid JSON response.");
    sfxError();
    return;
  }

  bool success = doc["success"] | false;
  String reason = doc["reason"] | "";
  String tenant = doc["tenant_slug"] | "";

  if (success) {
    String nama = doc["nama"] | "-";
    String kelas = doc["kelas"] | "-";
    String mapel = doc["mapel"] | "-";
    String status = doc["status"] | "-";
    Serial.printf("[RESP][OK] tenant=%s nama=%s kelas=%s mapel=%s status=%s\n",
      tenant.c_str(), nama.c_str(), kelas.c_str(), mapel.c_str(), status.c_str());
    sfxSuccess();
    return;
  }

  Serial.printf("[RESP][REJECT] reason=%s msg=%s\n",
    reason.c_str(), String(doc["message"] | "").c_str());

  if (reason == "rfid_not_registered" || reason == "unauthorized_device") {
    sfxDenied();
  } else if (
    reason == "no_schedule_now" ||
    reason == "outside_rfid_window" ||
    reason == "no_manual_window" ||
    reason == "already_scanned"
  ) {
    sfxWarning();
  } else {
    sfxError();
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char) payload[i];
  }

  String inTopic(topic);
  Serial.printf("[MQTT] %s => %s\n", inTopic.c_str(), message.c_str());

  if (inTopic == topicMode) {
    handleModeMessage(message);
    return;
  }

  if (inTopic == topicResponse) {
    handleResponseMessage(message);
  }
}

/* ================== MQTT ================== */
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    String clientId = "esp-rfid-" + String(ESP.getChipId(), HEX) + "-" + String(random(0xffff), HEX);
    Serial.printf("[MQTT] Connecting as %s ... ", clientId.c_str());

    if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("connected");
      mqttClient.subscribe(topicResponse.c_str(), 1);
      mqttClient.subscribe(topicMode.c_str(), 1);
      Serial.printf("[MQTT] Subscribed response=%s mode=%s\n", topicResponse.c_str(), topicMode.c_str());
    } else {
      Serial.printf("failed rc=%d, retry in 5s\n", mqttClient.state());
      delay(5000);
    }
  }
}

void publishScan(const String &uidHex) {
  StaticJsonDocument<256> doc;
  doc["card_uid"] = uidHex;
  doc["device_id"] = DEVICE_ID;
  doc["tenant_slug"] = TENANT_SLUG;
  doc["mode"] = manualModeEnabled ? "manual" : "auto";

  char out[256];
  size_t len = serializeJson(doc, out, sizeof(out));
  if (len == 0) {
    Serial.println("[MQTT] Failed serialize payload.");
    sfxError();
    return;
  }

  bool ok = mqttClient.publish(topicScan.c_str(), out, false);
  if (ok) {
    Serial.printf("[MQTT] Published scan => %s | uid=%s\n", topicScan.c_str(), uidHex.c_str());
  } else {
    Serial.println("[MQTT] Publish failed.");
    sfxError();
  }
}

/* ================== SETUP ================== */
void setup() {
  Serial.begin(115200);
  delay(800);

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, LOW);

  topicScan = "edusmart/" + String(TENANT_SLUG) + "/rfid/scan";
  topicResponse = "edusmart/" + String(TENANT_SLUG) + "/rfid/response";
  topicMode = "edusmart/" + String(TENANT_SLUG) + "/rfid/mode";

  Serial.println("\n=== ESP8266 RFID MQTT (Tenant-Aware) ===");
  Serial.printf("tenant=%s device=%s\n", TENANT_SLUG, DEVICE_ID);
  Serial.printf("scan=%s\nresponse=%s\nmode=%s\n", topicScan.c_str(), topicResponse.c_str(), topicMode.c_str());

  sfxStartup();
  setupWiFi();

  // For simplicity on ESP8266 memory, skip CA validation.
  // For production with strict TLS, use setTrustAnchors().
  tlsClient.setInsecure();

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(2048);

  nfc.begin();
  uint32_t versionData = nfc.getFirmwareVersion();
  if (!versionData) {
    Serial.println("[NFC] PN532 not detected.");
    while (1) { sfxError(); delay(2000); }
  }
  nfc.SAMConfig();

  Serial.println("[SYS] Ready.");
}

/* ================== LOOP ================== */
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    setupWiFi();
  }

  if (!mqttClient.connected()) {
    reconnectMQTT();
  }

  mqttClient.loop();

  if (hasLastUid && (millis() - lastScanTime > SCAN_COOLDOWN_MS)) {
    hasLastUid = false;
    lastUidLength = 0;
  }

  uint8_t uid[7];
  uint8_t uidLength;
  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50)) {
    if (isSameUid(uid, uidLength) && (millis() - lastScanTime < SCAN_COOLDOWN_MS)) {
      return;
    }

    lastScanTime = millis();
    memcpy(lastUid, uid, uidLength);
    lastUidLength = uidLength;
    hasLastUid = true;

    String uidHex = uidToHexString(uid, uidLength);
    Serial.printf("[NFC] card_uid=%s\n", uidHex.c_str());
    sfxCardDetected();
    publishScan(uidHex);
  }
}

