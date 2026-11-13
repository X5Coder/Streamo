# Streamo — Windows Edition

Streamo for Windows — a standalone Electron-based browser/app focused on capturing video links from the web (Egyptian-style pirate streaming sites supported via ad shield).

## Features
- **Built-in browser toolbar** — back / forward / tabs / search history / link history / domain-locked URL bar with lock-to-edit pill.
- **Smart ad shield** — NET / TABS / ALLOWLIST / HEURISTIC — ported from X5 Coder's `X5 Agent` project. Blocks ad redirects, pop-ups, and known ad domains.
- **Smart domain lock** — while you're inside a site (detected per tab), any redirect or navigation to a different eTLD+1 is silently blocked — unless you click on an `<a>` link pointing to it (two-click rule for tabs). Google stays unlocked.
- **Link capture engine** — `webRequest`, `Content-Type`, and JS injection observe every media request and store the source page. Dedupes repeat captures, tracks the same URL as one entry even across signatures (`.m3u8/.mpd/.ts` collapse to origin+pathname).
- **HTTP probe tester** — single range-GET with `Range: bytes=0-4095` + `Content-Length` + magic-byte sniff to verify a link is alive and is media.
- **Notification mini-cards** with automatic fade-out (10s success / 5s fail), max 5 stack, swipe / click-to-dismiss.
- **Pro internal player** (no chat, no room, no sync): seek bar with drag/hover tooltip, ±10s skip, auto-hide controls, retry on failure, fullscreen.
- **Open in external browser** — link cards / search history can open the source in the system default browser (or internal tab, configurable).
- **Side panels** — Extracted Links (test report, grouped by site, swipe-to-delete), Search History (swipe), Tabs. Includes `Streamo · v2.0.0` version footer.
- **Hot reload dev-mode** — `npm run dev` (Node + fs watch) — any change rebuilds shared assets & relaunches the app in ~1s.

## Build

```bash
cd windows
npm install
npm run dist   # syncs shared assets and builds Windows portable .exe
```

Output: `dist/Streamo-Link-v2.0.0-portable.exe`

Dev (hot reload): `npm run dev`

## License

Internal / private — not for redistribution outside X5Coder.
