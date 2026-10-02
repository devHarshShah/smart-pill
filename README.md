# MediLink MVP

Smart pill reminder prototype with:
- Next.js web app (landing + auth + dashboard)
- Device pairing/locking APIs
- ESP32 firmware using WebSocket for commands/status/events
- UI-driven device setup (`SET_CALIBRATION` command)

## Run App

1. Install deps:
```bash
pnpm install
```

2. Create env:
```bash
cp .env.local.example .env.local
```

3. Set secret in `.env.local`:
```env
AUTH_SECRET=replace-with-long-random-secret
```

4. Start:
```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000)

Local ports:
- App: `3000`
- WebSocket server: `8070`

## Web Flow

1. Landing page: `/`
2. Login/Signup page: `/auth`
3. Device dashboard: `/dashboard`

Dashboard sections:
- Device identity registration
- Pair code creation + confirm
- UI-driven setup command (`SET_CALIBRATION`)
- Custom command queue (`BUZZER_TEST`, `LED_ON`, `LED_OFF`)
- Device runtime status display

## API Overview

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/devices/register`
- `GET /api/devices`
- `POST /api/pairing/session`
- `POST /api/pairing/confirm`
- `POST /api/devices/:deviceId/commands`
- `POST /api/device/physical-reset`
- WebSocket: `ws://localhost:8070` (device `AUTH`, `STATUS`, `DOSE_EVENT`)

## ESP32 Firmware

File:
- `firmware/esp32_pill_monitor_mvp.ino`

### Configure Constants

```cpp
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_BASE_URL = "http://192.168.1.10:3000";
const char* WS_HOST = "192.168.1.10";
const uint16_t WS_PORT = 8070;
const char* WS_PATH = "/";
const char* HARDWARE_ID = "esp32-pillbox-001";
const char* DEVICE_SECRET = "esp32-secret-001";
```

Notes:
- `SERVER_BASE_URL` must be your laptop LAN IP (not localhost).
- Laptop and ESP32 must be on same Wi-Fi network.

### Firmware Behavior (Current)

- Connect Wi-Fi at boot
- Register device with backend
- Authenticate to WebSocket server
- Receive commands over WebSocket
- Push runtime status every 10 seconds over WebSocket
- Send dose events over WebSocket
- Apply `SET_CALIBRATION` from dashboard to enable pill monitoring

### Supported Commands

- `SET_CALIBRATION` payload:
```json
{ "pillWeight": 0.52, "totalPills": 15, "currentPills": 15 }
```
- `BUZZER_TEST`
- `LED_ON`
- `LED_OFF`
- `RESET_SETUP`

## Ngrok Setup (Both Ports)

1. Keep `pnpm dev` running.
2. Create `ngrok.yml` (example below), then run:
```bash
ngrok start --all --config ./ngrok.yml
```
3. Use tunnel URLs:
- App tunnel URL as `SERVER_BASE_URL` in firmware.
- WS tunnel hostname as `WS_HOST`, with `WS_PORT=443`, `WS_PATH="/"`.

Example `ngrok.yml`:
```yaml
version: "3"
agent:
  authtoken: YOUR_NGROK_AUTHTOKEN
tunnels:
  medilink-app:
    proto: http
    addr: 3000
  medilink-ws:
    proto: http
    addr: 8070
```

## MVP Constraints

- In-memory backend storage (state resets on server restart)
- Firmware command parsing is intentionally lightweight (string-based)
