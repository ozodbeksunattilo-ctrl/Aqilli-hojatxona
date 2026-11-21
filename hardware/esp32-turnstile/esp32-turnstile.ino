/*
 * Smart Restroom — ESP32 turnstile controller (reference firmware)
 *
 * One controller per turnstile. It watches the turnstile's PASSAGE signal
 * (rotation-complete / passage sensor), never the release button, stores each
 * confirmed passage in flash first, then delivers it to the backend.
 *
 * Board:     ESP32 (ESP32-DevKitC / ESP32-POE for Ethernet)
 * Libraries: ArduinoJson 7.x  (WiFi, HTTPClient, LittleFS ship with the ESP32 core)
 *
 * !! The electrical interface of your turnstile model MUST be confirmed on site.
 *    See docs/HARDWARE.md — section "What must be verified on the real turnstile".
 *    Never connect 12/24 V turnstile outputs directly to ESP32 GPIO: use an
 *    optocoupler (e.g. PC817) or a dry-contact relay output.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <time.h>

// ---------------------------------------------------------------- configuration
#define DEVICE_ID          "MEN-001"          // or "WOMEN-001"
#define DEVICE_TOKEN       "<paste token from Admin → Devices>"
#define WIFI_SSID          "<wifi>"
#define WIFI_PASSWORD      "<password>"
#define API_URL            "https://<PROJECT_REF>.supabase.co/functions/v1/turnstile-events"
#define FIRMWARE_VERSION   "1.0.0"

#define PASSAGE_PIN        27     // opto-isolated "passage complete" / rotation sensor
#define RELEASE_PIN        26     // optional: monitors the release button (logged only, never counted)
#define STATUS_LED         2
#define PASSAGE_ACTIVE_LOW true   // depends on the opto wiring — verify on site
#define DEBOUNCE_MS        40     // signal must be stable this long
#define MIN_PASSAGE_GAP_MS 700    // a tripod cannot complete two rotations faster than this
#define PULSES_PER_PASSAGE 1      // some rotors emit several pulses per 120° turn — verify on site
#define HEARTBEAT_MS       30000
#define BATCH_SIZE         25
#define MAX_QUEUE_LINES    20000  // ~1.5 MB on LittleFS

static const char *QUEUE_FILE = "/queue.jsonl";

// ---------------------------------------------------------------- state
volatile uint32_t isrPulses = 0;
volatile uint32_t isrLastEdgeMs = 0;
uint32_t bootId = 0;
uint32_t seqNo = 0;
uint32_t queueLines = 0;
uint32_t lastHeartbeat = 0;
uint32_t retryAt = 0;
uint8_t failures = 0;
uint32_t lastPassageMs = 0;
uint32_t pulseAccumulator = 0;

void IRAM_ATTR onPassageEdge() {
  isrLastEdgeMs = millis();
  isrPulses++;
}

// ---------------------------------------------------------------- persistent queue
uint32_t countQueue() {
  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return 0;
  uint32_t n = 0;
  while (f.available()) if (f.read() == '\n') n++;
  f.close();
  return n;
}

String isoNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return "";  // clock not synced yet → server time will be used
  struct tm t;
  gmtime_r(&now, &t);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

void enqueue(const char *type) {
  if (queueLines >= MAX_QUEUE_LINES) {
    Serial.println("[queue] FULL — event dropped (check connectivity!)");
    return;
  }
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  char id[64];
  snprintf(id, sizeof(id), "%s-%08lx-%lu", DEVICE_ID, (unsigned long)bootId, (unsigned long)++seqNo);
  doc["event_id"] = id;
  doc["event_type"] = type;
  String ts = isoNow();
  if (ts.length()) doc["timestamp"] = ts;

  File f = LittleFS.open(QUEUE_FILE, FILE_APPEND);
  serializeJson(doc, f);
  f.print('\n');
  f.close();  // close() flushes to flash before we do anything else
  queueLines++;
  Serial.printf("[queue] +%s %s (pending %lu)\n", type, id, (unsigned long)queueLines);
}

// Removes the first `n` lines after they were acknowledged.
void dropHead(uint32_t n) {
  File in = LittleFS.open(QUEUE_FILE, FILE_READ);
  File out = LittleFS.open("/queue.tmp", FILE_WRITE);
  uint32_t line = 0;
  while (in.available()) {
    String s = in.readStringUntil('\n');
    if (line++ >= n && s.length()) { out.print(s); out.print('\n'); }
  }
  in.close();
  out.close();
  LittleFS.remove(QUEUE_FILE);
  LittleFS.rename("/queue.tmp", QUEUE_FILE);
  queueLines = queueLines > n ? queueLines - n : 0;
}

// ---------------------------------------------------------------- network
int post(const String &body, String &response) {
  WiFiClientSecure tls;
  tls.setInsecure();  // TODO(production): pin the Supabase root CA with tls.setCACert(...)
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(tls, API_URL)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = http.POST(body);
  response = code > 0 ? http.getString() : "";
  http.end();
  return code;
}

// Sends the oldest BATCH_SIZE events. Returns true if the queue made progress.
bool flushBatch() {
  if (queueLines == 0 || WiFi.status() != WL_CONNECTED) return false;
  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  String body = "{\"events\":[";
  uint32_t n = 0;
  while (f.available() && n < BATCH_SIZE) {
    String line = f.readStringUntil('\n');
    if (!line.length()) continue;
    if (n++) body += ',';
    body += line;
  }
  f.close();
  body += "]}";

  String resp;
  int code = post(body, resp);
  if (code == 422) { dropHead(1); return true; }       // malformed head: never block the queue
  if (code != 200 && code != 503) return false;        // network / auth / server error → retry later

  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  // Acknowledge the longest prefix with a final status (queue order is preserved).
  uint32_t acked = 0;
  for (JsonObject r : doc["results"].as<JsonArray>()) {
    const char *s = r["status"] | "";
    bool final = !strcmp(s, "counted") || !strcmp(s, "duplicate") || !strcmp(s, "logged") ||
                 !strcmp(s, "rejected") || !strcmp(s, "invalid");
    if (!final) break;
    acked++;
  }
  if (acked) dropHead(acked);
  return acked > 0;
}

void heartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["event_type"] = "heartbeat";
  doc["meta"]["firmware"] = FIRMWARE_VERSION;
  doc["meta"]["queue_depth"] = queueLines;
  doc["meta"]["rssi"] = WiFi.RSSI();
  String body, resp;
  serializeJson(doc, body);
  post(body, resp);
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  pinMode(PASSAGE_PIN, PASSAGE_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  pinMode(RELEASE_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PASSAGE_PIN), onPassageEdge, PASSAGE_ACTIVE_LOW ? FALLING : RISING);

  LittleFS.begin(true);
  queueLines = countQueue();
  bootId = esp_random();
  Serial.printf("[boot] %s fw %s, %lu events pending\n", DEVICE_ID, FIRMWARE_VERSION, (unsigned long)queueLines);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  enqueue("boot");
}

void loop() {
  uint32_t now = millis();

  // 1) Debounced passage detection (the ISR only records edges).
  noInterrupts();
  uint32_t pulses = isrPulses;
  uint32_t lastEdge = isrLastEdgeMs;
  isrPulses = 0;
  interrupts();
  pulseAccumulator += pulses;
  bool stable = (now - lastEdge) >= DEBOUNCE_MS &&
                digitalRead(PASSAGE_PIN) == (PASSAGE_ACTIVE_LOW ? HIGH : LOW);  // back at rest
  if (pulseAccumulator >= PULSES_PER_PASSAGE && stable) {
    if (now - lastPassageMs >= MIN_PASSAGE_GAP_MS) {
      lastPassageMs = now;
      enqueue("passage_confirmed");
    }
    pulseAccumulator = 0;
  }

  // 2) Release button is informational only (never counted as a visitor).
  static bool lastRelease = HIGH;
  bool release = digitalRead(RELEASE_PIN);
  if (lastRelease == HIGH && release == LOW) enqueue("release_button_pressed");
  lastRelease = release;

  // 3) Deliver the queue with exponential backoff.
  if (queueLines && now >= retryAt) {
    if (flushBatch()) {
      failures = 0;
      retryAt = now + 50;
    } else {
      failures = min<uint8_t>(failures + 1, 6);
      retryAt = now + (1000UL << failures);  // 2 s … 64 s
    }
  }

  // 4) Heartbeat so the admin dashboard can show online/offline.
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    heartbeat();
  }

  digitalWrite(STATUS_LED, WiFi.status() == WL_CONNECTED ? (queueLines ? (now / 150) % 2 : HIGH) : (now / 600) % 2);
  delay(5);
}
