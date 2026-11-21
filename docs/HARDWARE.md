# Hardware integration — tripod turnstiles

This document describes how the two physical turnstiles (`MEN-001`, `WOMEN-001`)
report **confirmed passages** to Smart Restroom, and exactly what must be verified
on the real turnstile model before going live.

> **Golden rule:** the system counts a visitor only when the turnstile reports that
> a person **actually passed** (rotation completed). The employee's release button
> is never counted — it is logged for auditing only.

---

## 1. Signal flow

```
 Customer pays cash ─► Employee presses RELEASE button ─► turnstile unlocks
                                                              │
                                         visitor pushes arm, rotor turns 120°
                                                              │
                          turnstile controller / rotation sensor emits PASSAGE signal
                                                              │
                     ┌────────────── opto-isolated input ─────┘
                     ▼
        ESP32 controller (one per turnstile)
          1. debounce + validate pulse
          2. append event to flash queue  (survives power loss)
          3. POST batch → /functions/v1/turnstile-events  (HTTPS, X-Device-Token)
          4. drop events from queue only after a final server status
                     │
                     ▼
        Supabase Edge Function ─► ingest_turnstile_event()  (one DB transaction)
          • verifies device token (sha256 hash)       • de-duplicates (device_id, event_id)
          • picks gender from the device              • locks + increments the active shift
          • writes entry_events + device_logs         • Realtime → dashboards update
```

## 2. What must be verified on the real turnstile (site survey checklist)

The electrical interface differs between manufacturers (PERCo, ZKTeco, Gotschlich,
Chinese OEM boards…). **Do not wire anything until these are confirmed** with the
turnstile's manual and a multimeter / logic probe:

| # | Question | Why it matters | How to verify |
|---|----------|----------------|---------------|
| 1 | Does the controller board expose a **"pass" / "passage complete" output** (dry contact, open collector or relay)? | Best signal: the turnstile itself confirms the rotation. | Manual: look for `PASS`, `OUT`, `COUNTER`, `Feedback` terminals. Watch it with a probe while walking through. |
| 2 | If not: is there a **rotation sensor** (optical disc, hall sensor, micro-switch) we can tap? | Fallback source of truth. | Locate the sensor on the rotor; count pulses per 120° turn. |
| 3 | **Pulses per passage** (1, 2 or 3?) | Sets `PULSES_PER_PASSAGE` in firmware. | Walk through 10 times, count pulses. |
| 4 | **Voltage & polarity** of the signal (5 V, 12 V, 24 V? active-low/high?) | Never feed > 3.3 V into ESP32. Sets `PASSAGE_ACTIVE_LOW`. | Multimeter at rest and during passage. |
| 5 | **Pulse length** and minimum time between passages | Sets `DEBOUNCE_MS` / `MIN_PASSAGE_GAP_MS`. | Logic analyser or scope. |
| 6 | Does a **reverse rotation / exit** produce the same signal? | Must not count people leaving through the turnstile. | Push the arm backwards; check direction outputs (`A`/`B`, `DIR`). Use a direction-specific output if available. |
| 7 | What happens on **timeout** (released but nobody passed)? | Must not count. Many boards emit nothing — good. Some emit a separate "timeout" signal → can be logged as `passage_timeout`. | Release, wait, don't pass. |
| 8 | Is **"free pass / emergency" mode** (arm dropped) possible? | Passages in that mode cannot be counted by rotation. | Ask the operator; consider an extra IR beam if needed. |
| 9 | Available **power** in the cabinet (12/24 V DC) | Power the ESP32 via a DC-DC buck converter to 5 V. | Check PSU rating. |
| 10 | **Network** at the location: Wi-Fi signal strength or Ethernet drop | Ethernet (ESP32-POE / WT32-ETH01) is preferred for reliability. | Phone Wi-Fi analyser at the turnstile. |

Record the answers per turnstile; both units may differ.

## 3. Reference wiring (to be adapted after the survey)

```
Turnstile "PASS" output (dry contact / open collector, 12–24 V side)
        │
        ├──[ R 2.2 kΩ ]──► PC817 LED (+)            ESP32 side (3.3 V)
        │                   PC817 LED (−) ──► GND_turnstile
        │
        PC817 transistor:  collector ──► GPIO27 (INPUT_PULLUP)
                           emitter   ──► GND_esp32

Release button (optional, monitoring only) → second PC817 → GPIO26
12/24 V → buck converter → 5 V → ESP32 VIN
```

* Galvanic isolation (optocoupler) keeps turnstile noise and voltage away from the ESP32.
* Keep cable runs short; use twisted pair for signal lines.
* For a relay-type "pass" output, wire the contact between GPIO27 and GND (INPUT_PULLUP).

## 4. Firmware

`hardware/esp32-turnstile/esp32-turnstile.ino` (Arduino core for ESP32 + ArduinoJson 7).

Configure at the top of the file:

| Constant | Meaning |
|----------|---------|
| `DEVICE_ID` | `MEN-001` or `WOMEN-001` |
| `DEVICE_TOKEN` | Generated in **Admin → Devices → Provision token** (shown once) or by `pnpm bootstrap` |
| `API_URL` | `https://<PROJECT_REF>.supabase.co/functions/v1/turnstile-events` |
| `PASSAGE_ACTIVE_LOW`, `PULSES_PER_PASSAGE`, `DEBOUNCE_MS`, `MIN_PASSAGE_GAP_MS` | From the site survey (§2) |

Behaviour:

* **Store first, send later.** Every confirmed passage is appended to `/queue.jsonl`
  on LittleFS and the file is closed (flushed) before any network activity.
  A power cut or reboot never loses an event; ~20 000 events fit in flash.
* **Ordered, batched delivery** (25 events per request) with exponential back-off
  (2 s → 64 s) while offline.
* **Exactly-once effect.** Each event has a unique `event_id`
  (`<DEVICE_ID>-<boot id>-<sequence>`). If an HTTP response is lost the controller
  re-sends; the backend answers `duplicate` and counts nothing twice.
* **Heartbeat** every 30 s with firmware version, queue depth and RSSI → the admin
  dashboard shows *Online / Offline / Syncing backlog*.
* **Clock:** NTP. If the clock is not synced the timestamp is omitted and the server
  time is used. Device timestamps more than 2 min in the future or 14 days in the
  past are ignored by the server.
* **Production TODO:** pin the Supabase root CA (`tls.setCACert`) instead of `setInsecure()`.

## 5. HTTP contract

`POST /functions/v1/turnstile-events`

Headers: `Content-Type: application/json`, `X-Device-Token: <token>` (or `Authorization: Bearer <token>`).

Single event:

```json
{
  "device_id": "MEN-001",
  "event_id": "MEN-001-1a2b3c4d-42",
  "event_type": "passage_confirmed",
  "timestamp": "2026-11-21T09:15:02Z"
}
```

Batch (offline queue flush, max 100):

```json
{ "events": [ { ...event }, { ...event } ] }
```

`event_type` values:

| Type | Counted? | Purpose |
|------|----------|---------|
| `passage_confirmed` | **Yes** (exactly once) | Rotation / passage completed |
| `heartbeat` | No | Liveness, firmware, queue depth (`meta`) |
| `release_button_pressed` | No | Audit of the employee's button |
| `passage_timeout` | No | Released but nobody passed |
| `fault`, `boot` | No | Diagnostics |

Per-event result `status`:

| Status | Meaning | Controller action |
|--------|---------|-------------------|
| `counted` | Stored and counted (`attribution`: `live`, `late`, `unassigned`) | remove from queue |
| `duplicate` | Already received earlier | remove from queue |
| `logged` / `ok` | Non-counting event accepted | remove |
| `rejected` | Device disabled, or simulated event in production | remove, raise alarm |
| `invalid` | Malformed event id | remove (firmware bug) |
| `unauthorized` (HTTP 401) | Wrong token | keep queue, alert |
| `retry` (HTTP 503) / network error | Transient | keep queue, back off |

**Attribution** (decided by the database, never by the device):

* `live` — an employee shift was active when the passage happened → shift counter +1.
* `late` — the event was delivered after its shift was closed (offline backlog).
  It is stored and shown as “+N late” next to that shift, but the closed shift's
  saved totals are never modified.
* `unassigned` — no shift was running. Stored and included in daily totals and reports
  (“outside any shift”), never lost.

## 6. Demo mode vs production mode

| | Demo | Production |
|---|---|---|
| Admin simulator buttons | enabled | disabled (server rejects) |
| `"simulated": true` events (e.g. `pnpm simulate`) | accepted, stored with `source = simulated` | **rejected** |
| Real hardware events | accepted (`source = hardware`) | accepted |
| UI | permanent “Demo mode” banner, “simulated” badges | no banner |

Switch in **Settings → System mode** once both controllers are online.

## 7. Bench & on-site acceptance test

1. Provision the token, flash the firmware, open **Admin → Devices**: status becomes *Online* within 30 s.
2. Start a shift as an employee. Walk through the men's turnstile 10 times → shift shows 10 men, 0 women.
3. Release without passing (10×) → count unchanged; `release_button_pressed` rows appear in the hardware log.
4. Push the arm backwards → count unchanged (verifies §2 item 6).
5. Unplug the network, pass 20 times, plug back → within a minute the count rises by exactly 20; the device log shows `counted_live`; queue depth returns to 0.
6. Power-cycle the controller mid-outage → queued events still arrive after reboot.
7. End the shift, then deliver a backlog from during that shift → the shift shows “+N late”, its saved totals stay unchanged.
8. Switch to production mode → `pnpm simulate` events are rejected; real passages still count.

You can rehearse steps 2–7 without hardware using the protocol-identical simulator:

```bash
pnpm simulate --device MEN-001 --token <token> --rate 10
#   [p] one passage   [o] toggle simulated network outage   [q] quit
```
