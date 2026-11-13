/*
 * Streamo - Windows app core (standalone Electron app, single portable .exe).
 * Browser + ad shield + link probing (simple HTTP Range request in the main process - no hidden webview).
 *
 * NOTE: Comments are intentionally ASCII-only. Arabic comments in the original file
 * were corrupted by repeated PowerShell read/write cycles and ballooned the file to >800KB.
 */
'use strict';

const { app, BrowserWindow, ipcMain, session, shell, protocol } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
// app.getAppMetrics() is the correct measurement source: memory = { workingSetSize, privateBytes, peakWorkingSetSize } (KB)

/* guest tracking for the memory governor */
const guests = new Set();        // every guest WebContents (tabs)
const os = require('os');
const path = require('path');
const defense = require('./renderer/shared/defense/defense.js');
const { probeLink } = require('./probe.js');

// Trim Chromium services that are not used by a link-capture browser.
try {
  app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints');
} catch (e) {}
// Give the UI renderer a bigger V8 heap so a heavy capture session never dies of a
// small-heap OOM; the memory governor (below) still trims real pressure.
try {
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
} catch (e) {}

// Dev only: expose CDP on localhost so the memory leak can be inspected while it happens.
if (process.env.STREAMO_DEV) {
  try { app.commandLine.appendSwitch('remote-debugging-port', '9333'); } catch (e) {}
}

// Register privileged schemes BEFORE app ready - without this the redirect never reaches the handler
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'streamo-stub',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

const PARTITION = 'persist:streamo';
const MEDIA_RE = /\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8)([?#].*)?$/i;
const TS_RE = /\.ts([?#].*)?$/i;
const MEDIA_MIME_RE = /^(video\/|audio\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/mpegurl)/i;
const DEDUPE_MS = 4 * 60 * 1000;
const MIN_TS_SIZE = 25 * 1024 * 1024; // ignore small HLS segments (<25MB are segments)
// DASH manifests are never offered as playable streams, and a URL asking for a byte
// range (?bytes=5417-62932) is a partial-content capture - useless and unplayable.
const MPD_RE = /\.mpd([?#].*)?$/i;
const RANGE_CAPTURE_RE = /[?&]bytes=\d+-\d*/i;
const isDashUrl = (url) => MPD_RE.test(String(url || ''));
const isRangeCapture = (url) => RANGE_CAPTURE_RE.test(String(url || ''));

const AUDIO_URL_RE = /(^|[\/_-])(audio|aac|m4a|mp4a)([\/_.-]|\?|#|$)/i;
const AUDIO_EXT_RE = /\.(mp3|m4a|aac|wav|opus|flac)(\?|#|$)/i;

/** Skip audio-only URLs (user wants video only). Manifests stay valid. */
function isAudioOnlyUrl(url) {
  const u = String(url || '');
  if (/\.(m3u8|mpd)(\?|#|$)/i.test(u)) return false;
  return AUDIO_EXT_RE.test(u) || AUDIO_URL_RE.test(u);
}

let win = null;
/* True while the app is deliberately quitting — during a normal close the renderer
   may still emit render-process-gone; treating it as a crash would flip the next
   boot into all-asleep + fresh-tab instead of restoring the user's session. */
let appIsQuitting = false;

/* ================= Crash recovery (black screen fix) =================
 * Root cause: the renderer (drawing) process dies silently. The window remains
 * visible titled "Streamo" with no content -> user sees a frozen black window.
 * Fix: watch render-process-gone for every webContents + child-process-gone (GPU/Utility),
 * log the reason, auto-reload the window, and if it happens >3 times in 5 minutes,
 * relaunch the app (with --disable-gpu if GPU is crashing).
 */
/* After a forced UI kill the renderer must NOT auto-wake the heavy page that drove
   the OOM (that was the freeze loop). A flag file written before the kill tells the
   next boot to restore every tab ASLEEP. */
function writeCrashFlag() {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'streamo-crash-flag.txt'), String(Date.now()));
  } catch (e) {}
}

let reloadCount = 0;
let reloadWindowStart = 0;
let gpuCrashCount = 0;
let gpuCrashWindowStart = 0;

function scheduleWindowRecovery(why) {
  const now = Date.now();
  if (appIsQuitting) {
    // Normal or user-driven close — do not touch the session; the tabs come back on next start
    console.log('[recovery] renderer gone during quit (' + why + ') — ignored, session preserved');
    return;
  }
  if (now - reloadWindowStart > 5 * 60 * 1000) { reloadWindowStart = now; reloadCount = 0; }
  reloadCount += 1;
  if (reloadCount > 3) {
    console.error('[recovery] repeated renderer crashes — relaunching app');
    writeCrashFlag();
    app.relaunch();
    app.exit(0);
    return;
  }
  /* A renderer died abnormally (usually OOM). Reload, but restore the session with every
     tab ASLEEP — the heavy page that killed the renderer must never re-load into a loop.
     Only flag this for actually abnormal reasons; a clean teardown is not a crash. */
  if (why.indexOf('clean-exit') === -1 && why.indexOf('killed') === -1) {
    writeCrashFlag();
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
    console.error('[recovery] repeated GPU crashes - relaunching with --disable-gpu');
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
        if (win && !win.isDestroyed()) win.webContents.send('streamo:guest-gone', { wcId: contents.id, reason: String(reason) });
      } catch (e) {}
    });
    contents.on('unresponsive', () => console.error('[recovery] unresponsive (' + label + ')'));
    contents.on('responsive', () => console.log('[recovery] responsive again (' + label + ')'));
    contents.on('did-navigate', (e, url) => {
      try { console.log('[nav] wc' + contents.id + ' -> ' + String(url || '').slice(0, 170)); } catch (e2) {}
    });
  } catch (e) {
    console.error('[recovery] watchContents failed:', e && e.message);
  }
}

/* ================= Memory Governor (app.getAppMetrics) - v6 =================
 * Why v5 froze: it measured peakWorkingSetSize (a historical max that never
 * drops), only reacted at 1100MB PER guest, never looked at the total, and
 * destroyed every tab when an out-of-process iframe was the leak.
 *
 * v6 works the way Chrome does:
 *   - every renderer process is mapped to its owning tab via WebFrameMain.osProcessId,
 *     so out-of-process iframes (the real vkvideo leak) are counted in the tab that owns them;
 *   - current memory (workingSetSize / privateBytes) is used, never the peak;
 *   - the UI is told the real numbers every 2s: it puts hidden tabs to sleep (destroys the
 *     webview, keeps the URL, recreates it on demand) before memory becomes critical;
 *   - the main process only reloads the window as a last resort after the UI has had
 *     12 seconds to release tabs, or when the chrome UI itself leaks (>700MB).
 */
const MB = 1024 * 1024;
const TOTAL_RAM_MB = Math.max(1024, Math.round(os.totalmem() / MB));
const clampMB = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const APP_WARN_MB = Math.round(clampMB(TOTAL_RAM_MB * 0.18, 1500, 3200));
const APP_CRIT_MB = Math.round(clampMB(TOTAL_RAM_MB * 0.26, 2200, 4600));
const FREE_WARN_MB = Math.round(clampMB(TOTAL_RAM_MB * 0.10, 900, 1800));
const FREE_CRIT_MB = Math.round(clampMB(TOTAL_RAM_MB * 0.05, 450, 900));
const MEM_TICK_MS = 2000;
/* Hard ceiling for the chrome UI renderer. The OOM log proved a soft win.reload()
 * cannot stop a busy renderer (865MB -> 2393MB while the reload was pending), so
 * above this limit the process is killed outright: the OS frees every byte at once
 * and the crash handler reloads the window with the session restored (all tabs
 * asleep - the heavy page never reloads itself into a freeze loop).
 * 2400MB is far above normal use (~90-130MB, ~250MB with the internal player). */
const MAIN_UI_LIMIT_MB = 2400;
const UI_LIMIT_STREAK = 2;              // 2 consecutive ticks (4s), avoids one-off spikes
const UI_RELOAD_COOLDOWN_MS = 120 * 1000;
const EMERGENCY_RELOAD_COOLDOWN_MS = 90 * 1000;

let memLevel = 'ok';
let criticalStreak = 0;
let uiHighStreak = 0;
let lastMemLogAt = 0;
let lastUiCrashAt = 0;
let lastEmergencyReloadAt = 0;
let lastMemLevel = 'ok';

function reloadWindowForMemory(why) {
  if (!win || win.isDestroyed()) return;
  console.error('[memory] ' + why + ' - reloading the window to release memory');
  writeCrashFlag(); // same freeze-loop protection for the last-resort reload
  try { win.reload(); } catch (e) {
    console.error('[memory] window reload failed:', e && e.message);
  }
}

function crashUiRenderer(why) {
  if (!win || win.isDestroyed()) return;
  console.error('[memory] ' + why + ' - killing the UI renderer to release memory now');
  writeCrashFlag(); // next boot restores tabs asleep - never reloads the heavy page into a freeze loop
  try {
    win.webContents.forcefullyCrashRenderer();
  } catch (e) {
    console.error('[memory] forcefullyCrashRenderer failed:', e && e.message);
    reloadWindowForMemory('UI renderer over limit (fallback reload)');
  }
}

/** Every OS process that renders a frame of this guest (main frame + OOP iframes). */
function pidsForGuest(g) {
  const pids = new Set();
  try {
    if (!g || (typeof g.isDestroyed === 'function' && g.isDestroyed())) return pids;
    const frames = g.mainFrame && g.mainFrame.framesInSubtree;
    if (Array.isArray(frames)) {
      for (const f of frames) {
        try {
          const pid = Number(f.osProcessId) || 0;
          if (pid) pids.add(pid);
        } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    const pid = Number(g.getOSProcessId && g.getOSProcessId()) || 0;
    if (pid) pids.add(pid);
  } catch (e) {}
  return pids;
}

setInterval(() => {
  try {
    const metrics = (app.getAppMetrics && app.getAppMetrics()) || [];
    if (!Array.isArray(metrics) || !metrics.length) return;

    const byPid = new Map();
    let appMB = 0;
    for (const m of metrics) {
      const mem = m.memory || {};
      const ws = Number(mem.workingSetSize) || 0;
      const prv = Number(mem.privateBytes) || 0;
      const mb = Math.max(0, Math.round(Math.max(ws, prv) / 1024));
      const pid = Number(m.pid) || 0;
      if (!pid) continue;
      byPid.set(pid, { mb, type: String(m.type || '?') });
      appMB += mb;
    }
    if (appMB <= 0) return;

    const freeMB = Math.round(os.freemem() / MB);

    // Per-tab memory = sum of every renderer process that owns one of its frames.
    const tabs = [];
    for (const g of Array.from(guests)) {
      if (!g || (typeof g.isDestroyed === 'function' && g.isDestroyed())) {
        guests.delete(g);
        continue;
      }
      let mb = 0;
      const pids = pidsForGuest(g);
      for (const pid of pids) {
        const rec = byPid.get(pid);
        if (rec) mb += rec.mb;
      }
      tabs.push({ wcId: g.id, mb: mb, pids: pids.size });
    }

    // The chrome UI renderer is a Tab as well - watch it separately.
    let windowMB = 0;
    let windowPid = 0;
    try {
      if (win && !win.isDestroyed()) {
        windowPid = win.webContents.getOSProcessId();
        const rec = byPid.get(windowPid);
        if (rec) windowMB = rec.mb;
      }
    } catch (e) {}

    let level = 'ok';
    if (freeMB <= FREE_CRIT_MB || appMB >= APP_CRIT_MB) level = 'critical';
    else if (freeMB <= FREE_WARN_MB || appMB >= APP_WARN_MB) level = 'warn';
    if (level === 'critical') criticalStreak += 1; else criticalStreak = 0;

    const payload = {
      appMB: appMB,
      freeMB: freeMB,
      totalMB: TOTAL_RAM_MB,
      level: level,
      windowMB: windowMB,
      windowPid: windowPid,
      tabs: tabs,
      warnMB: APP_WARN_MB,
      critMB: APP_CRIT_MB,
      freeWarnMB: FREE_WARN_MB,
      freeCritMB: FREE_CRIT_MB,
      ts: Date.now()
    };
    try {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('streamo:memory', payload);
      }
    } catch (e) {}

    const now = Date.now();
    const changed = level !== memLevel;
    memLevel = level;
    lastMemLevel = level;
    if (changed || now - lastMemLogAt > 20000) {
      lastMemLogAt = now;
      const top = tabs.slice().sort((a, b) => b.mb - a.mb).slice(0, 6)
        .map((t) => 'wc' + t.wcId + '=' + t.mb + 'MB').join(', ');
      const procs = Array.from(byPid.entries()).sort((a, b) => b[1].mb - a[1].mb).slice(0, 6)
        .map(([pid, r]) => r.type + ':' + pid + '=' + r.mb + 'MB').join(', ');
      console.log('[memory] level=' + level + ' app=' + appMB + 'MB free=' + freeMB + '/' + TOTAL_RAM_MB +
        'MB ui=' + windowMB + 'MB(pid ' + windowPid + ') tabs=[' + top + '] procs=[' + procs + ']');
    }

    // Chrome UI itself must never grow into a freeze. The renderer gets a chance to
    // close the internal player / sleep tabs first (it sees the same numbers), but if
    // it is still above the hard ceiling for two ticks the process is killed.
    if (windowMB > MAIN_UI_LIMIT_MB) uiHighStreak += 1;
    else uiHighStreak = 0;

    if (uiHighStreak >= UI_LIMIT_STREAK && now - lastUiCrashAt > UI_RELOAD_COOLDOWN_MS) {
      lastUiCrashAt = now;
      uiHighStreak = 0;
      crashUiRenderer('UI renderer using ' + windowMB + 'MB (pid ' + windowPid + ')');
      return;
    }

    // Last resort: the renderer has had 12s to sleep tabs and the OS is still starving.
    if (level === 'critical' && appMB >= APP_WARN_MB &&
        freeMB <= Math.round(FREE_CRIT_MB * 0.6) &&
        criticalStreak >= 6 &&
        now - lastEmergencyReloadAt > EMERGENCY_RELOAD_COOLDOWN_MS) {
      lastEmergencyReloadAt = now;
      reloadWindowForMemory('system memory critical (free ' + freeMB + 'MB, app ' + appMB + 'MB)');
    }
  } catch (e) {
    console.error('[memory] tick error:', e && e.message);
  }
}, MEM_TICK_MS).unref();

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


/* ================= Local media proxy (HTTP) =================
 * The internal player runs in the chrome UI renderer (file://). Fetching CDN media
 * directly from there is rejected (CORS / no site Referer), and shaka's custom-scheme
 * plugin proved unreliable. A tiny loopback server gives shaka and <video> a normal
 * HTTP URL: Range is forwarded, the site Referer/Origin are added, ACAO * is set, and
 * player requests are byte-capped so a Range-ignoring server cannot dump a movie into
 * the UI renderer. Bound to 127.0.0.1 with a random path token.
 */
let mediaProxyInfo = null;
let mediaProxyReady = null;

function startMediaProxyServer() {
  if (mediaProxyReady) return mediaProxyReady;
  const http = require('http');
  const https = require('https');
  const token = crypto.randomBytes(16).toString('hex');
  const CAP_BYTES = 100 * 1024 * 1024;
  const MAX_HOPS = 5;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const server = http.createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Range, Accept, Content-Type',
      'access-control-max-age': '86400',
      'access-control-expose-headers': 'content-length, content-range, accept-ranges'
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    let target = '', referer = '', cap = 0;
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/p/' + token) { res.writeHead(403, cors); res.end('forbidden'); return; }
      target = u.searchParams.get('u') || '';
      referer = u.searchParams.get('r') || '';
      cap = u.searchParams.get('cap') ? CAP_BYTES : 0;
    } catch (e) {
      res.writeHead(400, cors); res.end('bad request'); return;
    }
    if (!/^https?:\/\//i.test(target)) { res.writeHead(400, cors); res.end('bad target'); return; }

    const headers = {
      'User-Agent': UA,
      'Accept': '*/*',
      'Accept-Encoding': 'identity'
    };
    if (req.headers['range']) headers['Range'] = String(req.headers['range']);
    if (referer) {
      headers['Referer'] = referer;
      try { headers['Origin'] = new URL(referer).origin; } catch (e) {}
    }

    let up = null;
    let hops = 0;
    const respondCors = (status, body) => {
      try {
        if (res.headersSent) { try { res.destroy(); } catch (e) {} return; }
        res.writeHead(status, Object.assign({ 'content-type': 'text/plain', 'cache-control': 'no-store' }, cors));
        res.end(body || '');
      } catch (e) {}
    };

    /* Follow redirects server-side. Signed CDNs answer nearly every media URL with
       302, and the browser would hide it from the page - without this the player
       waits forever on a bare 302 with an empty body. */
    const requestAt = (url, method) => {
      const lib = url.startsWith('https:') ? https : http;
      try {
        up = lib.request(url, { method: method === 'HEAD' ? 'HEAD' : 'GET', headers, timeout: 20000 }, (r2) => {
          const status = r2.statusCode || 200;
          if ([301, 302, 303, 307, 308].includes(status) && r2.headers.location) {
            let next = null;
            try { next = new URL(r2.headers.location, url).href; } catch (e) { next = null; }
            try { r2.resume(); } catch (e) {}
            if (hops >= MAX_HOPS || !next || !/^https?:\/\//i.test(next)) {
              respondCors(502, 'bad redirect');
              return;
            }
            hops += 1;
            requestAt(next, method);
            return;
          }
          const declared = parseInt(r2.headers['content-length'] || '0', 10);
          if (cap > 0 && declared > cap) {
            // One request answered with a huge body: shaka would read it all into an
            // ArrayBuffer in the UI renderer. Refuse it instead.
            try { r2.destroy(); } catch (e) {}
            try { up.destroy(); } catch (e) {}
            respondCors(413, 'media response too large');
            return;
          }
          const out = Object.assign({}, cors, {
            'cache-control': 'no-store',
            'accept-ranges': String(r2.headers['accept-ranges'] || 'bytes'),
            'content-type': String(r2.headers['content-type'] || 'application/octet-stream')
          });
          ['content-length', 'content-range', 'etag', 'last-modified'].forEach((k) => {
            if (r2.headers[k]) out[k] = String(r2.headers[k]);
          });
          try {
            res.writeHead(status, out);
          } catch (e) {
            try { r2.destroy(); } catch (e2) {}
            return;
          }
          r2.pipe(res);
          r2.on('error', () => { try { res.destroy(); } catch (e) {} });
        });
      } catch (e) {
        respondCors(502, 'proxy error');
        return;
      }
      up.on('timeout', () => { try { up.destroy(); } catch (e) {} respondCors(504, 'upstream timeout'); });
      up.on('error', () => respondCors(502, 'upstream error'));
      up.end();
    };

    const kill = () => { try { if (up) up.destroy(); } catch (e) {} };
    req.on('close', kill);
    res.on('close', kill);
    requestAt(target, req.method);
  });

  mediaProxyReady = new Promise((resolve) => {
    server.on('error', (e) => {
      console.error('[media] local proxy error:', e && e.message);
      mediaProxyInfo = null;
      resolve(null);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      mediaProxyInfo = { port: port, token: token };
      console.log('[media] local proxy listening on 127.0.0.1:' + port);
      resolve(mediaProxyInfo);
    });
  });
  server.unref();
  return mediaProxyReady;
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

const LOOPBACK_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i;

function registerCapture() {
  defense.loadLists(path.join(__dirname, 'renderer', 'shared', 'defense'));
  const ses = session.fromPartition(PARTITION);
  // Every renderer keeps its own spellcheck dictionary; this app does not need one.
  try { ses.setSpellCheckerEnabled(false); } catch (e) {}

  // NET defense layer: decision for every request before it leaves (stub redirect / cancel ad redirect)
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const url = details.url || '';
    if (LOOPBACK_RE.test(url)) { callback({}); return; } // the loopback media proxy must never be filtered
    const resourceType = String(details.resourceType || '').toLowerCase();
    const isMainFrame = resourceType === 'mainframe';
    const pageUrl = details.initiator || '';
    const verdict = defense.decide(url, { isMainFrame, pageUrl });

    if (verdict === 'fail') {
      callback({ cancel: true });
      return;
    }
    if (verdict === 'stub') {
      // fetch/XHR/ping - CORS-block in streamo-stub causes retry storms in SDKs -> cancel directly
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

    // Capture media - only what is not an ad (video ads polluted the log).
    // DASH (.mpd) and byte-range partials are never offered as playable links.
    if (MEDIA_RE.test(url) && !TS_RE.test(url) && !isDashUrl(url) && !isRangeCapture(url) && !isAudioOnlyUrl(url) && shouldSend(url)) {
      sendLink({ url, source: 'request', tabId: details.tabId, initiator: details.initiator || '' });
    }
    callback({});
  });

  // Capture via Content-Type (URLs without extension or with fake extension)
  ses.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      // Cheap MIME check first: most responses are HTML/JS/CSS and never need
      // a defence decision or URL parsing here (huge CPU saver on ad-heavy sites).
      const mime = String(headerValue(details.responseHeaders, 'content-type') || '');
      if (!MEDIA_MIME_RE.test(mime)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const url = details.url || '';
      if (LOOPBACK_RE.test(url) || isDashUrl(url) || isRangeCapture(url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      // Downloads (Content-Disposition: attachment) are never playable streams - do not capture them
      const disposition = String(headerValue(details.responseHeaders, 'content-disposition') || '');
      if (/attachment/i.test(disposition)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      if (isAudioOnlyUrl(url) || defense.decide(url, { isMainFrame: false, pageUrl: details.initiator || '' }) !== 'allow') {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      const length = parseInt(headerValue(details.responseHeaders, 'content-length') || '0', 10);
      const isTs = TS_RE.test(url);
      const smallSegment = isTs && length > 0 && length < MIN_TS_SIZE;
      if (!smallSegment && shouldSend(url)) {
        sendLink({ url, contentType: mime, size: length > 0 ? length : null, source: 'mime', tabId: details.tabId, initiator: details.initiator || '' });
      }
      callback({ responseHeaders: details.responseHeaders });
    }
  );

  // Links from JS injection (video/audio tags + fetch/XHR) - carry the exact pageUrl of the page
  ipcMain.on('streamo:js-url', (event, payload) => {
    const url = payload && payload.url;
    const isMediaElement = payload && payload.isMediaElement;
    const tagName = payload && payload.tagName;
    const pageUrl = payload && typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (isDashUrl(url) || isRangeCapture(url)) return; // DASH manifests and byte-range partials are never offered
    if (defense.decide(url, { isMainFrame: false, pageUrl: '' }) !== 'allow') return;
    if (String(tagName || '').toLowerCase() === 'audio') return; // user does not want audio
    if (isAudioOnlyUrl(url)) return;                              // audio-only links skipped
    // media elements are accepted fully (even .ts if the page asked for it); other JS needs extension match, no .ts
    if (isMediaElement || (MEDIA_RE.test(url) && !TS_RE.test(url))) {
      if (shouldSend(url)) sendLink({ url, source: 'js', pageUrl });
    }
  });

  // Silent verdict for main-frame redirects (used for classification only - no counter)
  ipcMain.on('streamo:should-block-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // Silent verdict for domain classification (no counter/logging) - used by the navigation guard
  ipcMain.on('streamo:is-ad-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // Pass the link the user actually clicked to the UI - base of the smart lock
  ipcMain.on('streamo:anchor', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:anchor-click', { wcId: event.sender.id, href });
    }
  });

  // Pass the current page of any webview - base of capture attribution
  ipcMain.on('streamo:seen-page', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:seen-page', { wcId: event.sender.id, href });
    }
  });

  // Pass the navigation intent of the press (even if the page swallowed it) - base of ad rescue
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
    title: 'Streamo',
    icon: path.join(__dirname, 'assets', 'app_icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
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
    registerCapture();
    startMediaProxyServer();
  } catch (e) {
    console.error('defense registration failed:', e);
  }
  /* The renderer may ask for the proxy before server.listen() finishes. The handler
     waits for the listen callback, so callers always get a real port (never null). */
  ipcMain.handle('streamo:media-proxy', () => mediaProxyReady);
  /* After a forced UI kill this returns true exactly once. The renderer then boots
     every tab asleep instead of re-loading the heavy page (freeze-loop protection). */
  ipcMain.handle('streamo:consume-crash-flag', () => {
    try {
      const p = path.join(app.getPath('userData'), 'streamo-crash-flag.txt');
      if (!fs.existsSync(p)) return false;
      const raw = fs.readFileSync(p, 'utf8');
      try { fs.unlinkSync(p); } catch (e2) {}
      const ts = parseInt(String(raw || ''), 10) || 0;
      return (Date.now() - ts) < 10 * 60 * 1000; // only trust a recent crash
    } catch (e) {
      return false;
    }
  });
  /* The internal player is the heaviest consumer of the Chromium media cache.
     After a heavy session the memory level is 'warn'/'critical' — only then is the
     shared cache cleared. During normal use the warm cache is kept (fast revisits). */
  ipcMain.on('streamo:player-closed', () => {
    try {
      if (lastMemLevel === 'ok') return;
      const ses = session.fromPartition(PARTITION);
      Promise.resolve(ses.clearCache()).catch(() => {});
    } catch (e) {}
  });
  createMainWindow();

  // watch the main window - any renderer drop auto-reloads instead of a black window
  try { if (win && !win.isDestroyed()) watchContents(win.webContents, 'main-window'); } catch (e) {}

  // new window guard (Electron >=12): any window.open / target=_blank from any WebContents -> UI decides
  app.on('web-contents-created', (event, contents) => {
    // watch every guest/webview - if a tab dies silently the UI is notified
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
      // ignore the main window itself - the app window needs no guard
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

  // watch child processes - if GPU/Utility keep dying, relaunch safely
  app.on('child-process-gone', (event, details) => {
    try {
      console.error('[recovery] child-process-gone type=' + (details && details.type) +
        ' reason=' + (details && details.reason) + ' exitCode=' + (details && details.exitCode));
      if (details && details.type === 'GPU') noteGpuCrash();
    } catch (e) {}
  });

  // Link test from the renderer - answered via Promise
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

  // Any guest page mouse-down → tell the chrome UI to close popups/panels
  ipcMain.on('streamo:guest-click', () => {
    try { if (win && !win.isDestroyed()) win.webContents.send('streamo:guest-click'); } catch (e) {}
  });
  // Real page-load milestones from the guest → forward to the chrome UI
  ipcMain.on('streamo:load-phase', (event, payload) => {
    try { if (win && !win.isDestroyed()) win.webContents.send('streamo:load-phase', payload || {}); } catch (e) {}
  });

  ipcMain.on('streamo:open-external', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });
});

/* Set as the first thing the app does on the way out. The renderer may still emit
   render-process-gone while the window tears down; the recovery path treats that as
   a deliberate quit (no relaunch, no crash flag, session untouched). */
app.on('before-quit', () => {
  appIsQuitting = true;
  /* Last chance to persist the tab session: ask the renderer to flush synchronously. */
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('streamo:flush-session');
    }
  } catch (e) {}
});

app.on('window-all-closed', () => {
  app.quit();
});
