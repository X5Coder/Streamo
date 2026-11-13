# Streamo — Android Edition

Or, the Android build of **Streamo** — a standalone browser/video-capture app focused on
capturing direct video links from the web (Egyptian-style pirate streaming sites supported
via an ad shield). Android port of the Windows build (`streamo_win/`), 1:1 feature parity.

- **Windows** project lives in a sibling folder (`../streamo_win/`) — Electron + Chromium.
- This project is **pure Android / Kotlin + Jetpack Compose** (no WebView content UI, no Flutter).
- minSdk 26 · target/compile SDK **37** · AGP 9.5.1 · Gradle 9.9.1 · Kotlin 2.4.21 (AGP built-in Kotlin).

## What's inside

| Area | What it does |
|---|---|
| `app/src/main/java/.../MainActivity.kt` | Single-activity host (`BrowserScreen`) |
| `.../StreamoApp.kt` | App: defense lists load, crash-flag persistence |
| `.../state/BrowserViewModel.kt` | The browser controller: tabs, capture pipeline, probe, session, memory governor, panels, notifications, domain lock (1:1 port of the Windows `chrome.js`) |
| `.../browser/TabInternal.kt` | Tab model (sleeping tabs keep URL, destroyed WebView) |
| `.../web/StreamoWebViewClient.kt` | `shouldInterceptRequest` → NET shield (stub 200 responses) + media capture; `shouldOverrideUrlLoading` → domain lock |
| `.../web/StreamoWebChromeClient.kt` | Popup policy (same-domain → new tab, else drop) |
| `.../web/TabWebViewFactory.kt` | WebView creation (JS on, mobile UA, mixed content compatible) |
| `.../web/StreamoJsBridge.kt` | `window.__streamoHook` (page hook → capture/gesture/anchor/seen) |
| `.../defense/Defense.kt` | Ad shield: NET + HEURISTIC + ALLOWLIST (HaGeZi 4.6 MB list in assets) |
| `.../probe/Probe.kt` | Range-GET link probe (redirects, magic bytes, HLS deep-check) |
| `.../data/StreamoStore.kt` | SharedPreferences store (links / search history / session, master-merge, sanitizers) |
| `.../search/StreamoSearch.kt` | Search-engine query detection (Google/YouTube/…) |
| `.../ui/*.kt` | Toolbar (dark, URL pill + progress), panels (Extracted Links / Search History / Tabs), mini capture cards, the internal player (Media3 ExoPlayer), notifications, streaming progress, toasts |
| `assets/defense/` | HaGeZi + custom blocklists (same files as Windows) |
| `assets/hook.js` | Page hook injected into every page (fetch/XHR/video/source observers) |
| `dev/dev-reload.mjs` | Dev hot-reload watcher (rebuild + reinstall + relaunch) |

## Run it

```bash
# debug APK
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk

# hot-reload dev loop (rebuild + reinstall + relaunch on change)
node dev\dev-reload.mjs                # first connected device
node dev\dev-reload.mjs JVWWK7797HEE6H5X   # pin a specific USB device
# or double-click dev\dev-reload.cmd
```

## Architecture notes / known trade-offs vs Windows

| Windows (Electron) | Android (this project) |
|---|---|
| `<webview>` tabs | Android WebView instances, hidden-from-composition kept alive, sleeping tabs destroy WebViews, mirror "destroy/restore" semantics |
| `webRequest` interception (resourceType + response Content-Type) | `shouldInterceptRequest` sees URLs only — MIME-based capture is done by the page hook (`video/source` elements + fetch/XHR); URL-pattern capture happens in `shouldInterceptRequest` |
| shaka-player + loopback media proxy (with Referer) | Media3 ExoPlayer with custom `DefaultHttpDataSource` (Referer/Origin header) — HLS/DASH/MP4 play natively, no proxy needed |
| `app.getAppMetrics()` per-process memory | `onTrimMemory` + idle-sleep (15 min) + approximate RAM readout via `ActivityManager.getMemoryInfo` |
| localStorage | SharedPreferences JSON (same keys `streamo.links.v1`, `streamo.search.v1`, `streamo.tabs.v1`) |
| HashRouter in chrome.html | None — pure Compose, no router |
| Hot reload (`npm run dev`) | Watch-and-rebuild loop (`dev/dev-reload.mjs`); Android ART has no Flutter-style code swapping, and Compose hot reload is not available without the desktop JVM target |
| Windows UA ("Chrome 131 desktop") | Mobile UA — sites serve the phone layout |

## Privacy / safety

- **No DRM handling** — Widevine-protected streams are detected by the probe and marked as failed/expired; by design we never circumvent it.
- The app is an *ad-shield + link capture* tool. Its blocklists are bundled; no telemetry is collected.
