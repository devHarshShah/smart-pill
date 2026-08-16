# MediLink MVP

Smart pill reminder prototype with:
- Next.js web app (landing + auth + dashboard)
- Device pairing/locking APIs
- ESP32 firmware polling commands from server
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
- `POST /api/device/poll`
- `POST /api/device/status`
- `POST /api/device/physical-reset`

## ESP32 Firmware

File:
- `firmware/esp32_pill_monitor_mvp.ino`

### Configure Constants

```cpp
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_BASE_URL = "http://192.168.1.10:3000";
const char* HARDWARE_ID = "esp32-pillbox-001";
const char* DEVICE_SECRET = "esp32-secret-001";
```

Notes:
- `SERVER_BASE_URL` must be your laptop LAN IP (not localhost).
- Laptop and ESP32 must be on same Wi-Fi network.

### Firmware Behavior (Current)

- Connect Wi-Fi at boot
- Register device with backend
- Poll commands every 4 seconds
- Push runtime status every 10 seconds
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

## MVP Constraints

- In-memory backend storage (state resets on server restart)
- Device poll endpoint consumes command queue
- Firmware command parsing is intentionally lightweight (string-based)
