/*
 * Streamo Link — Windows app core (standalone Electron app, single portable .exe).
 * Browser + ad shield + link probing (simple HTTP Range request in the main process — no hidden webview).
 *
 * NOTE: Comments are intentionally ASCII-only. Arabic comments in the original file
 * were corrupted by repeated PowerShell read/write cycles and ballooned the file to >800KB.
 */
'use strict';

const { app, BrowserWindow, ipcMain, session, shell, protocol } = require('electron');
// app.getAppMetrics() is the correct measurement source: memory = { workingSetSize, privateBytes, peakWorkingSetSize } (KB)

/* guest tracking for the memory watchdog */
const guests = new Set();        // every guest WebContents (tabs) — used to destroy leak children
const destroyedByGuard = new Set(); // tabs the watchdog destroyed itself — dedupes guest-gone events
const path = require('path');
const defense = require('./renderer/shared/defense/defense.js');
const { probeLink } = require('./probe.js');

// Register privileged schemes BEFORE app ready — without this the redirect never reaches the handler
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'streamo-stub',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    // Media proxy for the internal player: fetches media with the page Referer/Origin + open CORS
    scheme: 'streamo-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

const PARTITION = 'persist:streamo';
const MEDIA_RE = /\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd)([?#].*)?$/i;
const TS_RE = /\.ts([?#].*)?$/i;
const MEDIA_MIME_RE = /^(video\/|audio\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/mpegurl|application\/dash\+xml)/i;
const DEDUPE_MS = 10 * 60 * 1000;
const MIN_TS_SIZE = 25 * 1024 * 1024; // ignore small HLS segments (<25MB are segments)

const AUDIO_URL_RE = /(^|[\/_-])(audio|aac|m4a|mp4a)([\/_.-]|\?|#|$)/i;
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|opus|flac)(\?|#|$)/i;

/** Skip audio-only URLs (user wants video only). Manifests stay valid. */
function isAudioOnlyUrl(url) {
  const u = String(url || '');
  if (/\.(m3u8|mpd)(\?|#|$)/i.test(u)) return false;
  return AUDIO_EXT_RE.test(u) || AUDIO_URL_RE.test(u);
}

let win = null;

/* ================= Crash recovery (black screen fix) =================
 * Root cause: the renderer (drawing) process dies silently. The window remains
 * visible titled "Streamo Link" with no content -> user sees a frozen black window.
 * Fix: watch render-process-gone for every webContents + child-process-gone (GPU/Utility),
 * log the reason, auto-reload the window, and if it happens >3 times in 5 minutes,
 * relaunch the app (with --disable-gpu if GPU is crashing).
 */
let reloadCount = 0;
let reloadWindowStart = 0;
let gpuCrashCount = 0;
let gpuCrashWindowStart = 0;

function scheduleWindowRecovery(why) {
  const now = Date.now();
  if (now - reloadWindowStart > 5 * 60 * 1000) { reloadWindowStart = now; reloadCount = 0; }
  reloadCount += 1;
  if (reloadCount > 3) {
    console.error('[recovery] repeated renderer crashes — relaunching app');
    app.relaunch();
    app.exit(0);
    return;
  }
  if (win && !win.isDestroyed()) {
    console.log('[recovery] reloading window after', why);
    try { win.reload(); } catch (e) {
      console.error('[recovery] win.reload failed, relaunching app:', e && e.message);
      app.relaunch();
      app.exit(0);
    }
  } else {
    app.relaunch();
    app.exit(0);
  }
}

function noteGpuCrash() {
  const now = Date.now();
  if (now - gpuCrashWindowStart > 5 * 60 * 1000) { gpuCrashWindowStart = now; gpuCrashCount = 0; }
  gpuCrashCount += 1;
  if (gpuCrashCount >= 3 && !process.argv.includes('--disable-gpu')) {
    console.error('[recovery] repeated GPU crashes — relaunching with --disable-gpu');
    app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu']) });
    app.exit(0);
  }
}

function watchContents(contents, label) {
  try {
    if (!contents) return;
    contents.on('render-process-gone', (event, details) => {
      const reason = (details && details.reason) || 'unknown';
      const exitCode = details && details.exitCode;
      console.error('[recovery] render-process-gone (' + label + ') reason=' + reason + ' exitCode=' + exitCode);
      if (win && !win.isDestroyed() && contents.id === win.webContents.id) {
        scheduleWindowRecovery('render-process-gone(' + reason + ')');
        return;
      }
      // a webview guest died -> ask the UI to recreate that tab
      try {
        if (destroyedByGuard.has(contents.id)) { destroyedByGuard.delete(contents.id); }
        else if (win && !win.isDestroyed()) win.webContents.send('streamo:guest-gone', { wcId: contents.id, reason: String(reason) });
      } catch (e) {}
    });
    contents.on('unresponsive', () => console.error('[recovery] unresponsive (' + label + ')'));
    contents.on('responsive', () => console.log('[recovery] responsive again (' + label + ')'));
  } catch (e) {
    console.error('[recovery] watchContents failed:', e && e.message);
  }
}

/* ================= Memory Watchdog (app.getAppMetrics) — v5 =================
 * Root cause of the OOM: streaming pages balloon a renderer process by ~60MB/s (vkvideo embeds).
 * Checks app.getAppMetrics() every 5s (main-thread, sync):
 *   - 'Browser' over WINDOW_LIMIT_MB -> reload the window (same recovery path).
 *   - 'Tab' over GUEST_LIMIT_MB -> destroy that guest (if matched by getOSProcessId)
 *     and tell the UI to recreate it at the same URL.
 *     If NO guest matches (site-isolated iframe leak) -> destroy ALL guests so the
 *     stuck process cannot stay alive (universal fallback for vkvideo iframes).
 */
const MEM_WATCHDOG_MS = 5 * 1000;
const GUEST_LIMIT_MB = 1100;
const WINDOW_LIMIT_MB = 900;
let __watchdogFirstTick = false;

setInterval(() => {
  try {
    const metrics = (app.getAppMetrics && app.getAppMetrics()) || [];
    if (!Array.isArray(metrics) || !metrics.length) return;
    if (!__watchdogFirstTick) {
      __watchdogFirstTick = true;
      try {
        if (!guests.size) console.log('[watchdog] guests set is EMPTY');
        for (const g of guests) console.log('[watchdog] registered guest id=' + g.id + ' osPid=' + (typeof g.getOSProcessId === 'function' ? g.getOSProcessId() : 'N/A') + ' type=' + (typeof g.getType === 'function' ? g.getType() : '?'));
      } catch (e) {}
    }
    for (const m of metrics) {
      const mem = m.memory || {};
      const peak = Number(mem.peakWorkingSetSize) || 0;
      const ws = Number(mem.workingSetSize) || 0;
      const priv = Number(mem.privateBytes) || 0;
      const mb = Math.round(Math.max(peak, ws, priv) / 1024);
      if (mb <= 0) continue;
      const cpu = m.cpu ? Number(m.cpu.percentCPUUsage) || 0 : 0;
      const type = String(m.type || '?');
      const pid = Number(m.pid) || 0;
      let target = null;
      for (const g of guests) {
        try { if (g.getOSProcessId && g.getOSProcessId() === pid) { target = g; break; } } catch (e) {}
      }
      if (mb > 250) console.log('[watchdog]', type + ':' + pid, (target ? 'guest#' + target.id : (win && !win.isDestroyed() && pid === (win.webContents.getOSProcessId ? win.webContents.getOSProcessId() : -1) ? 'window-renderer' : 'other')), 'using', mb, 'MB cpu=' + cpu.toFixed(1) + '%');
      if (type === 'Browser' && mb > WINDOW_LIMIT_MB) {
        console.error('[watchdog] window using', mb, 'MB — reloading');
        scheduleWindowRecovery('memory-guard');
        continue;
      }
      if (type !== 'Tab' || mb <= GUEST_LIMIT_MB) continue;
      const wcId = target ? target.id : null;
      console.error('[watchdog] Tab pid', pid, 'using', mb, 'MB — destroying', target ? 'guest#' + wcId : 'ALL ' + guests.size + ' guests (fallback)');
      if (target) {
        try { destroyedByGuard.add(target.id); target.destroy(); } catch (e) {}
        try { if (win && !win.isDestroyed()) win.webContents.send('streamo:guest-gone', { wcId, reason: 'memory-guard' }); } catch (e) {}
      } else {
        // universal fallback: an isolated iframe leaks — destroy every guest so the stuck process dies
        for (const g of Array.from(guests)) {
          try { destroyedByGuard.add(g.id); g.destroy(); } catch (e) {}
          try { if (win && !win.isDestroyed()) win.webContents.send('streamo:guest-gone', { wcId: g.id, reason: 'memory-guard' }); } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.error('[watchdog] tick error:', e && e.message);
  }
}, MEM_WATCHDOG_MS).unref();

/* ================= The Shield (core) ================= */

/** Local stub protocol: replies 200 with empty body so the page never knows the ad was blocked */
function registerStreamoStub() {
  protocol.handle('streamo-stub', (request) => {
    try {
      const u = new URL(request.url);
      const kind = decodeURIComponent(u.pathname.replace(/^\//, ''));
      const original = u.searchParams.get('u') || '';
      const stub = defense.stubFor(kind, original);
      return new Response(stub.body, {
        status: 200,
        headers: {
          'content-type': stub.mime,
          'access-control-allow-origin': '*',
          'cache-control': 'no-store'
        }
      });
    } catch (e) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
  });
}

/** Media proxy: fetch media through Node http/https (same code path as the probe, proven to work with vk CDNs). */
function registerMediaProxy() {
  const http = require('http');
  const https = require('https');
  const { Readable } = require('stream');
  protocol.handle('streamo-media', (request) => {
    return new Promise((resolve) => {
      try {
        const u = new URL(request.url);
        const target = u.searchParams.get('u') || '';
        const referer = u.searchParams.get('r') || '';
        if (!/^https?:\/\//i.test(target)) {
          return resolve(new Response('bad target', { status: 400, headers: { 'content-type': 'text/plain' } }));
        }
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Connection': 'close'
        };
        const range = request.headers.get('range');
        if (range) headers['Range'] = range;
        if (referer) {
          headers['Referer'] = referer;
          try { headers['Origin'] = new URL(referer).origin; } catch (e) {}
        }
        const lib = target.startsWith('https:') ? https : http;
        let req = null;
        try {
          req = lib.request(target, { method: 'GET', headers, timeout: 15000 }, (res) => {
            res.on('error', () => {}); // never throw on upstream stream errors
            const outHeaders = {
              'access-control-allow-origin': '*',
              'cache-control': 'no-store',
              'accept-ranges': String(res.headers['accept-ranges'] || 'bytes'),
              'content-type': String(res.headers['content-type'] || 'application/octet-stream')
            };
            if (res.headers['content-length']) outHeaders['content-length'] = String(res.headers['content-length']);
            if (res.headers['content-range']) outHeaders['content-range'] = String(res.headers['content-range']);
            if (res.headers['etag']) outHeaders['etag'] = String(res.headers['etag']);
            if (res.headers['last-modified']) outHeaders['last-modified'] = String(res.headers['last-modified']);
            const status = res.statusCode || 200;
            resolve(new Response(Readable.toWeb(res), { status, statusText: String(status), headers: outHeaders }));
          });
        } catch (e) {
          return resolve(new Response('media proxy error: ' + (e && e.message), { status: 502, headers: { 'content-type': 'text/plain' } }));
        }
        req.on('timeout', () => { try { req.destroy(); } catch (e) {} });
        req.on('error', (e) => {
          try { resolve(new Response('media proxy error: ' + (e && e.message), { status: 502, headers: { 'content-type': 'text/plain' } })); } catch (e2) {}
        });
        req.end();
      } catch (e) {
        try { resolve(new Response('media proxy error', { status: 502, headers: { 'content-type': 'text/plain' } })); } catch (e2) {}
      }
    });
  });
}

const recentCaptures = new Map();
function shouldSend(url) {
  const now = Date.now();
  const last = recentCaptures.get(url);
  if (last && now - last < DEDUPE_MS) return false;
  if (recentCaptures.size > 300) recentCaptures.clear();
  recentCaptures.set(url, now);
  return true;
}

function sendLink(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('streamo:link', payload);
}

function headerValue(headers, name) {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (!key) return null;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}

function registerCapture() {
  defense.loadLists(path.join(__dirname, 'renderer', 'shared', 'defense'));
  const ses = session.fromPartition(PARTITION);

  // NET defense layer: decision for every request before it leaves (stub redirect / cancel ad redirect)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const url = details.url || '';
    const resourceType = String(details.resourceType || '').toLowerCase();
    const isMainFrame = resourceType === 'mainframe';
    const pageUrl = details.initiator || '';
    const verdict = defense.decide(url, { isMainFrame, pageUrl });

    if (verdict === 'fail') {
      callback({ cancel: true });
      return;
    }
    if (verdict === 'stub') {
      // fetch/XHR/ping — CORS-block in streamo-stub causes retry storms in SDKs -> cancel directly
      const rt = String(details.resourceType || '').toLowerCase();
      if (rt === 'fetch' || rt === 'xmlhttprequest' || rt === 'ping' || rt === 'eventsource' || rt === 'websocket' || rt === 'manifest') {
        callback({ cancel: true });
        return;
      }
      callback({
        redirectURL: 'streamo-stub://ok/' + encodeURIComponent(resourceType || 'other') +
          '?u=' + encodeURIComponent(url)
      });
      return;
    }

    // Capture media — only what is not an ad (video ads polluted the log)
    if (MEDIA_RE.test(url) && !TS_RE.test(url) && !isAudioOnlyUrl(url) && shouldSend(url)) {
      sendLink({ url, source: 'request', tabId: details.tabId, initiator: details.initiator || '' });
    }
    callback({});
  });

  // Capture via Content-Type (URLs without extension or with fake extension)
  ses.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const url = details.url || '';
      if (defense.decide(url, { isMainFrame: false, pageUrl: details.initiator || '' }) !== 'allow') {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      if (isAudioOnlyUrl(url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const mime = String(headerValue(details.responseHeaders, 'content-type') || '');
      const length = parseInt(headerValue(details.responseHeaders, 'content-length') || '0', 10);
      if (MEDIA_MIME_RE.test(mime)) {
        const isTs = TS_RE.test(url);
        const smallSegment = isTs && length > 0 && length < MIN_TS_SIZE;
        if (!smallSegment && shouldSend(url)) {
          sendLink({ url, contentType: mime, size: length > 0 ? length : null, source: 'mime', tabId: details.tabId, initiator: details.initiator || '' });
        }
      }
      callback({ responseHeaders: details.responseHeaders });
    }
  );

  // Links from JS injection (video/audio tags + fetch/XHR) — carry the exact pageUrl of the page
  ipcMain.on('streamo:js-url', (event, payload) => {
    const url = payload && payload.url;
    const isMediaElement = payload && payload.isMediaElement;
    const tagName = payload && payload.tagName;
    const pageUrl = payload && typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (defense.decide(url, { isMainFrame: false, pageUrl: '' }) !== 'allow') return;
    if (String(tagName || '').toLowerCase() === 'audio') return; // user does not want audio
    if (isAudioOnlyUrl(url)) return;                              // audio-only links skipped
    // media elements are accepted fully (even .ts if the page asked for it); other JS needs extension match, no .ts
    if (isMediaElement || (MEDIA_RE.test(url) && !TS_RE.test(url))) {
      if (shouldSend(url)) sendLink({ url, source: 'js', pageUrl });
    }
  });

  // Silent verdict for main-frame redirects (used for classification only — no counter)
  ipcMain.on('streamo:should-block-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // Silent verdict for domain classification (no counter/logging) — used by the navigation guard
  ipcMain.on('streamo:is-ad-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // Pass the link the user actually clicked to the UI — base of the smart lock
  ipcMain.on('streamo:anchor', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:anchor-click', { wcId: event.sender.id, href });
    }
  });

  // Pass the current page of any webview — base of capture attribution
  ipcMain.on('streamo:seen-page', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:seen-page', { wcId: event.sender.id, href });
    }
  });

  // Pass the navigation intent of the press (even if the page swallowed it) — base of ad rescue
  ipcMain.on('streamo:nav-intent', (event, payload) => {
    const href = payload && typeof payload.href === 'string' ? payload.href : '';
    const prevented = !!(payload && payload.prevented);
    if (!/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:nav-intent', { wcId: event.sender.id, href, prevented });
    }
  });
}

function createMainWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 1000,
    minHeight: 560,
    show: false, // shown immediately when ready (no splash)
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Streamo Link',
    icon: path.join(__dirname, 'assets', 'app_icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // without this <webview> is never created
    }
  });
  win.removeMenu();

  win.once('ready-to-show', () => {
    win.show();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'chrome.html'), {
    query: {
      browserPreload: path.join(__dirname, 'browser-preload.js')
    }
  });
}

app.whenReady().then(() => {
  try {
    registerStreamoStub();
    registerMediaProxy();
    registerCapture();
  } catch (e) {
    console.error('defense registration failed:', e);
  }
  createMainWindow();

  // watch the main window — any renderer drop auto-reloads instead of a black window
  try { if (win && !win.isDestroyed()) watchContents(win.webContents, 'main-window'); } catch (e) {}

  // new window guard (Electron >=12): any window.open / target=_blank from any WebContents -> UI decides
  app.on('web-contents-created', (event, contents) => {
    // watch every guest/webview — if a tab dies silently the UI is notified
    try { watchContents(contents, 'guest:' + (contents.getType ? contents.getType() : 'unknown')); } catch (e) {}
    // register the guest in the watchdog's set (skip the main window itself)
    try {
      if (!(win && !win.isDestroyed() && contents.id === win.webContents.id)) guests.add(contents);
      contents.on('render-process-gone', () => { try { guests.delete(contents); } catch (e) {} });
      contents.on('destroyed', () => { try { guests.delete(contents); } catch (e) {} });
    } catch (e) {}
    try {
      if (!contents) return;
      const w = win && !win.isDestroyed() ? win : null;
      // ignore the main window itself — the app window needs no guard
      if (w && contents.id === w.webContents.id) return;
      console.log('[popup] handler attached to contents', contents.id, 'type=', contents.getType && contents.getType());
      contents.setWindowOpenHandler(({ url }) => {
        let src = '';
        try { src = contents.getURL() || ''; } catch (e) {}
        const w2 = win && !win.isDestroyed() ? win : null;
        console.log('[popup] request', url, '\n        from', src || '(unknown)');
        if (w2) {
          try { w2.webContents.send('streamo:popup', { wcId: contents.id, url, srcUrl: src }); } catch (e) {}
        }
        return { action: 'deny' }; // never open as a pop-up; UI decides to open it as a tab if domain policy allows
      });
    } catch (e) {
      console.error('window-open handler failed:', e);
    }
  });

  // watch child processes — if GPU/Utility keep dying, relaunch safely
  app.on('child-process-gone', (event, details) => {
    try {
      console.error('[recovery] child-process-gone type=' + (details && details.type) +
        ' reason=' + (details && details.reason) + ' exitCode=' + (details && details.exitCode));
      if (details && details.type === 'GPU') noteGpuCrash();
    } catch (e) {}
  });

  // Link test from the renderer — answered via Promise
  ipcMain.handle('streamo:test-link', async (event, payload) => {
    const url = payload && typeof payload.url === 'string' ? payload.url : '';
    const pageUrl = payload && typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
    if (!/^https?:\/\//i.test(url)) {
      return { url, status: 'fail', type: 'unknown', error: 'UNSUPPORTED', testedInMs: 0 };
    }
    try {
      return await probeLink(url, pageUrl);
    } catch (e) {
      return { url, status: 'fail', type: 'unknown', error: 'EXCEPTION', testedInMs: 0 };
    }
  });

  // Track "real press" inside any webview (trust signal for redirects)
  const gestures = new Map(); // nativeWebContentsId -> timestamp (cleared at >300)
  ipcMain.on('streamo:gesture', (event) => {
    gestures.set(event.sender.id, Date.now());
    if (gestures.size > 300) gestures.clear();
  });
  ipcMain.on('streamo:gesture-for', (event, id) => {
    const ts = gestures.get(Number(id));
    event.returnValue = !!ts && (Date.now() - ts) < 2000;
  });

  ipcMain.on('streamo:open-external', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
