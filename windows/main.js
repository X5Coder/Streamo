/*
 * Streamo Link Ã¢â‚¬â€ Ã™â€ Ã™Ë†Ã˜Â§Ã˜Â© Ã˜ÂªÃ˜Â·Ã˜Â¨Ã™Å Ã™â€š Ã˜Â§Ã™â€žÃ™Ë†Ã™Å Ã™â€ Ã˜Â¯Ã™Ë†Ã˜Â² (Ã™â€¦Ã˜Â³Ã˜ÂªÃ™â€šÃ™â€žÃ˜Å’ Ã™â€¦Ã™â€žÃ™Â exe Ã™Ë†Ã˜Â§Ã˜Â­Ã˜Â¯).
 * Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ˜ÂµÃ™ÂÃ˜Â­ + Ã˜Â¯Ã˜Â±Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€ Ã˜Â§Ã˜Âª + Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â¨Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â±Ã™Ë†Ã˜Â§Ã˜Â¨Ã˜Â· (Ã˜Â·Ã™â€žÃ˜Â¨ HTTP Ã˜Â¨Ã˜Â³Ã™Å Ã˜Â· Range Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™â€ Ã™Ë†Ã˜Â§Ã˜Â© Ã¢â‚¬â€ Ã™â€žÃ˜Â§ Ã™Å Ã™Ë†Ã˜Â¬Ã˜Â¯ webview Ã™â€¦Ã˜Â®Ã™ÂÃ™Å ).
 */
'use strict';

const { app, BrowserWindow, ipcMain, session, shell, protocol, webContents } = require('electron');
// app.getAppMetrics() Ã™â€¡Ã™Ë† Ã™â€¦Ã˜ÂµÃ˜Â¯Ã˜Â± Ã˜Â§Ã™â€žÃ™â€šÃ™Å Ã˜Â§Ã˜Â³ Ã˜Â§Ã™â€žÃ˜ÂµÃ˜Â­Ã™Å Ã˜Â­: memory={privateBytes, workingSetSize, peakWorkingSetSize}

/* Ã˜Â®Ã˜Â±Ã™Å Ã˜Â·Ã˜Â© PID Ã¢â€ â€™ webContentsId Ã™â€žÃ™â€žÃ™â‚¬ guests Ã¢â‚¬â€ Ã˜Â¹Ã˜Â´Ã˜Â§Ã™â€  Ã˜Â§Ã™â€žÃ™â‚¬ watchdog Ã™Å Ã™â€šÃ˜Â¯Ã˜Â± Ã™Å Ã˜Â±Ã˜Â¬Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â¨ Ã˜Â¨Ã˜Â§Ã™â€žÃ™â‚¬ wcId */
const guestPidToWcId = new Map();
const path = require('path');
const defense = require('./renderer/shared/defense/defense.js');
const { probeLink } = require('./probe.js');

// Ã˜ÂªÃ˜Â³Ã˜Â¬Ã™Å Ã™â€ž Ã˜Â¨Ã˜Â±Ã™Ë†Ã˜ÂªÃ™Ë†Ã™Æ’Ã™Ë†Ã™â€ž Ã˜Â§Ã™â€žÃ™â‚¬ stub Ã™Æ’Ã™â‚¬ "Ã™â€¦Ã˜ÂªÃ™â€¦Ã™Å Ã˜Â²" Ã™â€šÃ˜Â¨Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â§Ã™â€¡Ã˜Â²Ã™Å Ã˜Â© Ã¢â‚¬â€ Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€ Ã™â€¡ Ã˜Â§Ã™â€žÃ™â‚¬ redirect Ã™â€žÃ™â€  Ã™Å Ã˜ÂµÃ™â€ž Ã™â€žÃ™â€žÃ™â‚¬ handler
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'streamo-stub',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

const PARTITION = 'persist:streamo';
const MEDIA_RE = /\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd)([?#].*)?$/i;
const TS_RE = /\.ts([?#].*)?$/i;
const MEDIA_MIME_RE = /^(video\/|audio\/|application\/vnd\.apple\.mpegurl|application\/x-mpegurl|application\/mpegurl|application\/dash\+xml)/i;
const DEDUPE_MS = 10 * 60 * 1000;
const MIN_TS_SIZE = 25 * 1024 * 1024; // Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡Ã™â€ž Ã™â€¦Ã™â€šÃ˜Â§Ã˜Â·Ã˜Â¹ HLS Ã˜Â§Ã™â€žÃ˜ÂµÃ˜ÂºÃ™Å Ã˜Â±Ã˜Â© (Ã˜Â£Ã˜ÂµÃ˜ÂºÃ˜Â± Ã™â€¦Ã™â€  25MB Ã˜ÂªÃ˜Â¹Ã˜ÂªÃ˜Â¨Ã˜Â± segment)

let win = null;

/* ================= Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ˜Â´Ã™ÂÃ˜Â§Ã˜Â¡ Ã™â€¦Ã™â€  Ã˜Â³Ã™â€šÃ™Ë†Ã˜Â· Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™â€žÃ™Å Ã˜Â§Ã˜Âª (Ã˜Â¥Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­ Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã˜Â´Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â³Ã™Ë†Ã˜Â¯Ã˜Â©) =================
 * Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â°Ã˜Â±Ã™Å  Ã™â€žÃ™â€žÃ™â€¦Ã˜Â´Ã™Æ’Ã™â€žÃ˜Â©: Ã˜Â¹Ã™â€¦Ã™â€žÃ™Å Ã˜Â© Ã˜Â§Ã™â€žÃ™â‚¬ renderer (Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â³Ã™â€¦) Ã˜Â¨Ã˜ÂªÃ™â€¦Ã™Ë†Ã˜Âª Ã˜Â¨Ã˜ÂµÃ™â€¦Ã˜Âª Ã¢â€ â€™ Ã˜Â§Ã™â€žÃ™â€ Ã˜Â§Ã™ÂÃ˜Â°Ã˜Â© Ã˜ÂªÃ™ÂÃ˜Â¶Ã™â€ž Ã™â€¦Ã™Ë†Ã˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â©
 * Ã˜Â¨Ã˜Â¹Ã™â€ Ã™Ë†Ã˜Â§Ã™â€  "Streamo Link" Ã˜Â¨Ã˜Â³ Ã™â€¦Ã™ÂÃ™Å Ã˜Â´ Ã™â€¦Ã˜Â­Ã˜ÂªÃ™Ë†Ã™â€° Ã¢â€ â€™ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã™Å Ã˜Â´Ã™Ë†Ã™Â Ã˜Â´Ã˜Â§Ã˜Â´Ã˜Â© Ã˜Â³Ã™Ë†Ã˜Â¯Ã˜Â© Ã™â€¦Ã˜ÂªÃ˜Â¬Ã™â€¦Ã˜Â¯Ã˜Â©.
 * Ã˜Â§Ã™â€žÃ˜Â­Ã™â€ž: Ã™â€ Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨ render-process-gone Ã™â€žÃ™Æ’Ã™â€ž webContents + child-process-gone (GPU/Utility)
 * Ã™Ë†Ã™â€ Ã˜Â³Ã˜Â¬Ã™â€˜Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â¨Ã˜Å’ Ã™Ë†Ã™â€ Ã˜Â¹Ã™â€¦Ã™â€ž reload Ã˜ÂªÃ™â€žÃ™â€šÃ˜Â§Ã˜Â¦Ã™Å  Ã™â€žÃ™â€žÃ™â€ Ã˜Â§Ã™ÂÃ˜Â°Ã˜Â©Ã˜Å’ Ã™Ë†Ã™â€žÃ™Ë† Ã˜Â§Ã˜ÂªÃ™Æ’Ã˜Â±Ã˜Â± Ã˜Â£Ã™Æ’Ã˜ÂªÃ˜Â± Ã™â€¦Ã™â€  3 Ã™â€¦Ã˜Â±Ã˜Â§Ã˜Âª Ã™ÂÃ™Å  5 Ã˜Â¯Ã™â€šÃ˜Â§Ã™Å Ã™â€š
 * Ã™â€ Ã˜Â¹Ã™â€¦Ã™â€ž relaunch Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â·Ã˜Â¨Ã™Å Ã™â€š (Ã™Ë†Ã˜Â¨Ã˜Â§Ã™â€žÃ™â‚¬ --disable-gpu Ã™â€žÃ™Ë† Ã˜Â§Ã™â€žÃ™â‚¬ GPU Ã™â€¡Ã™Ë† Ã˜Â§Ã™â€žÃ™â€žÃ™Å  Ã˜Â¨Ã™Å Ã™â€šÃ˜Â¹).
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
    console.error('[recovery] repeated renderer crashes Ã¢â‚¬â€ relaunching app');
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
    console.error('[recovery] repeated GPU crashes Ã¢â‚¬â€ relaunching with --disable-gpu');
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
      // webview guest Ã™â€¦Ã˜Â§Ã˜Âª Ã¢â€ â€™ Ã˜Â¨Ã™â€žÃ™â€˜Ã˜Âº Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â§Ã˜Â¬Ã™â€¡Ã˜Â© Ã˜Â¥Ã™â€  Ã˜ÂªÃ˜Â§Ã˜Â¨ Ã™â€¦Ã˜Â¹Ã™Å Ã™â€ Ã˜Â© Ã˜ÂªÃ˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬ reload
      try { win && !win.isDestroyed() && win.webContents.send('streamo:guest-gone', { wcId: contents.id, reason: String(reason) }); } catch (e) {}
    });
    contents.on('unresponsive', () => console.error('[recovery] unresponsive (' + label + ')'));
    contents.on('responsive', () => console.log('[recovery] responsive again (' + label + ')'));
  } catch (e) {
    console.error('[recovery] watchContents failed:', e && e.message);
  }
}

/* ================= Memory Watchdog (app.getAppMetrics) =================
 * Ø§Ù„Ø±ØµØ¯ Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ Ù„Ù„Ø°Ø§ÙƒØ±Ø©: workingSetSize/privateBytes/peakWorkingSetSize (KB) Ù„ÙƒÙ„ Ø¹Ù…Ù„ÙŠØ©.
 * Ù„Ùˆ ØªØ§Ø¨ ØªØ¬Ø§ÙˆØ²Øª Ø§Ù„Ø­Ø¯ => streamo:guest-gone (Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© ØªØ¹ÙŠØ¯ Ø¥Ù†Ø´Ø§Ø¡Ù‡Ø§ Ø¨Ù†ÙØ³ Ø§Ù„Ø±Ø§Ø¨Ø·).
 * Ù„Ùˆ Ø§Ù„Ù†Ø§ÙØ°Ø© Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ© ØªØ¬Ø§ÙˆØ²Øª Ø§Ù„Ø­Ø¯ => reloadWindow Ù†ÙØ³ Ù…Ø³Ø§Ø± Ø§Ù„Ø§Ø³ØªØ´ÙØ§Ø¡.
 */
const MEM_WATCHDOG_MS = 10 * 1000;
const GUEST_LIMIT_MB = 1200;   // Ø­Ø¯ Ø§Ù„ØªØ§Ø¨ â€” Ù‚Ø¨Ù„ Ù…Ø§ ÙˆÙŠÙ†Ø¯ÙˆØ² ÙŠÙ‚ØªÙ„ (Ù¢.Ù¦ GB ÙƒØ§Ù†Øª Ø§Ù„Ø¶Ø­ÙŠØ©)
const WINDOW_LIMIT_MB = 900;   // Ø­Ø¯ Ø§Ù„Ù†Ø§ÙØ°Ø© Ù†ÙØ³Ù‡Ø§

setInterval(() => {
  try {
    const metrics = (app.getAppMetrics && app.getAppMetrics()) || [];
    for (const m of metrics) {
      const mem = m.memory || {};
      const peak = Number(mem.peakWorkingSetSize) || 0;
      const ws = Number(mem.workingSetSize) || 0;
      const priv = Number(mem.privateBytes) || 0;
      const mb = Math.round(Math.max(peak, ws, priv) / 1024);
      if (mb <= 0) continue;
      const cpu = m.cpu ? Number(m.cpu.percentCPUUsage) || 0 : 0;
      const type = String(m.type || '?');
      const pid = m.pid || 0;
      if (mb > 250) console.log('[watchdog]', type + ':' + pid, 'using', mb, 'MB cpu=' + cpu.toFixed(1) + '%');
      if (type === 'Browser' && mb > WINDOW_LIMIT_MB) {
        console.error('[watchdog] window using', mb, 'MB â€” reloading');
        scheduleWindowRecovery('memory-guard');
        return;
      }
      if (type === 'Tab' && mb > GUEST_LIMIT_MB) {
        const wcId = guestPidToWcId.get(pid);
        console.error('[watchdog] Tab pid', pid, 'using', mb, 'MB â€” recreating tab (wcId=' + wcId + ')');
        try {
          if (win && !win.isDestroyed()) {
            win.webContents.send('streamo:guest-gone', { wcId: wcId || null, pid: pid, reason: 'memory-guard' });
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('[watchdog] tick error:', e && e.message);
  }
}, MEM_WATCHDOG_MS).unref();

/* ================= Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¹ (Ã™â€ Ã™Ë†Ã˜Â§Ã˜Â©) ================= */

/** Ã˜Â¨Ã˜Â±Ã™Ë†Ã˜ÂªÃ™Ë†Ã™Æ’Ã™Ë†Ã™â€ž stub Ã™â€¦Ã˜Â­Ã™â€žÃ™Å : Ã™Å Ã˜Â±Ã˜Â¯ 200 Ã˜Â¨Ã˜Â¬Ã˜Â³Ã™â€¦ Ã™ÂÃ˜Â§Ã˜Â¶Ã™Å  Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã™â€šÃ˜Â¹ Ã™â€žÃ˜Â§ Ã™Å Ã˜Â¹Ã˜Â±Ã™Â Ã˜Â£Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€  Ã˜ÂªÃ™â€¦ Ã˜Â­Ã˜Â¨Ã˜Â³Ã™â€¡ */
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

  // Ã˜Â®Ã˜Â· Ã˜Â§Ã™â€žÃ˜Â¯Ã™ÂÃ˜Â§Ã˜Â¹ NET: Ã™â€šÃ˜Â±Ã˜Â§Ã˜Â± Ã™â€žÃ™Æ’Ã™â€ž Ã˜Â·Ã™â€žÃ˜Â¨ Ã™â€šÃ˜Â¨Ã™â€ž Ã˜Â®Ã˜Â±Ã™Ë†Ã˜Â¬Ã™â€¡ (Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ™Ë†Ã˜Â¬Ã™Å Ã™â€¡ Ã™â€žÃ™â‚¬ stub / Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜ÂªÃ˜Â­Ã™Ë†Ã™Å Ã™â€žÃ˜Â© Ã˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€ )
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
      // fetch/XHR/ping Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ™â‚¬ CORS-block Ã™â€¦Ã™â€  streamo-stub Ã˜Â¨Ã™Å Ã˜Â®Ã™â€žÃ™Å  Ã˜Â§Ã™â€žÃ™â‚¬ SDKs Ã˜ÂªÃ˜Â¹Ã™â€¦Ã™â€ž retry storm Ã¢â€ â€™ Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã™â€¦Ã˜Â¨Ã˜Â§Ã˜Â´Ã˜Â± Ã˜Â¨Ã˜Â¯Ã™â€ž redirect
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

    // Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â§Ã˜Â· Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â³Ã˜Â§Ã˜Â¦Ã˜Â· Ã¢â‚¬â€ Ã™ÂÃ™â€šÃ˜Â· Ã™â€¦Ã˜Â§ Ã™â€žÃ™Å Ã˜Â³ Ã˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€ Ã™â€¹Ã˜Â§ (Ã˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™ÂÃ™Å Ã˜Â¯Ã™Å Ã™Ë† Ã™Æ’Ã˜Â§Ã™â€ Ã˜Âª Ã˜ÂªÃ™â€žÃ™Ë†Ã™â€˜Ã˜Â« Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¬Ã™â€ž)
    if (MEDIA_RE.test(url) && !TS_RE.test(url) && shouldSend(url)) {
      sendLink({ url, source: 'request', tabId: details.tabId, initiator: details.initiator || '' });
    }
    callback({});
  });

  // Ã˜ÂµÃ™Å Ã˜Â¯ Ã˜Â¹Ã˜Â¨Ã˜Â± Content-Type (Ã˜Â§Ã™â€žÃ˜Â±Ã™Ë†Ã˜Â§Ã˜Â¨Ã˜Â· Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â§Ã™â€¦Ã˜ÂªÃ˜Â¯Ã˜Â§Ã˜Â¯ Ã˜Â£Ã™Ë† Ã˜Â¨Ã˜Â§Ã™â€¦Ã˜ÂªÃ˜Â¯Ã˜Â§Ã˜Â¯ Ã™â€¦Ã˜Â²Ã™Å Ã™Â)
  ses.webRequest.onHeadersReceived(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const url = details.url || '';
      if (defense.decide(url, { isMainFrame: false, pageUrl: details.initiator || '' }) !== 'allow') {
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

  // Ã˜Â±Ã™Ë†Ã˜Â§Ã˜Â¨Ã˜Â· Ã™â€¦Ã™â€  Ã˜Â­Ã™â€šÃ™â€  JS (Ã™Ë†Ã˜Â³Ã™Ë†Ã™â€¦ video/audio + fetch/XHR) Ã¢â‚¬â€ Ã˜ÂªÃ˜Â­Ã™â€¦Ã™â€ž pageUrl Ã˜Â§Ã™â€žÃ˜Â¯Ã™â€šÃ™Å Ã™â€š Ã™â€¦Ã™â€  Ã™â€ Ã™ÂÃ˜Â³ Ã˜Â§Ã™â€žÃ˜ÂµÃ™ÂÃ˜Â­Ã˜Â©
  ipcMain.on('streamo:js-url', (event, payload) => {
    const url = payload && payload.url;
    const isMediaElement = payload && payload.isMediaElement;
    const pageUrl = payload && typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (defense.decide(url, { isMainFrame: false, pageUrl: '' }) !== 'allow') return;
    // Ã™Ë†Ã˜Â³Ã™Ë†Ã™â€¦ Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â³Ã˜Â§Ã˜Â¦Ã˜Â· Ã˜ÂªÃ™ÂÃ™â€šÃ˜Â¨Ã™â€ž Ã™Æ’Ã˜Â§Ã™â€¦Ã™â€žÃ˜Â© (Ã˜Â­Ã˜ÂªÃ™â€° .ts Ã™â€žÃ™Ë† Ã˜Â§Ã™â€žÃ˜ÂµÃ™ÂÃ˜Â­Ã˜Â© Ã™â€ Ã™ÂÃ˜Â³Ã™â€¡Ã˜Â§ Ã˜Â·Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â© Ã™Å Ã˜Â§Ã™â€¡)Ã˜â€º Ã˜Â¨Ã˜Â§Ã™â€šÃ™Å  Ã˜Â§Ã™â€žÃ™â‚¬ JS Ã™ÂÃ™â€šÃ˜Â· Ã™â€¦Ã˜Â§ Ã™Å Ã˜Â·Ã˜Â§Ã˜Â¨Ã™â€š Ã˜Â§Ã™â€žÃ˜Â§Ã™â€¦Ã˜ÂªÃ˜Â¯Ã˜Â§Ã˜Â¯ Ã™â€¦Ã˜Â¹ Ã˜Â§Ã˜Â³Ã˜ÂªÃ˜Â¨Ã˜Â¹Ã˜Â§Ã˜Â¯ Ã™â€¦Ã™â€šÃ˜Â§Ã˜Â·Ã˜Â¹ .ts
    if (isMediaElement || (MEDIA_RE.test(url) && !TS_RE.test(url))) {
      if (shouldSend(url)) sendLink({ url, source: 'js', pageUrl });
    }
  });

  // Ã˜Â­Ã™Æ’Ã™â€¦ Ã™â€¦Ã˜ÂªÃ˜Â²Ã˜Â§Ã™â€¦Ã™â€  Ã˜ÂµÃ˜Â§Ã™â€¦Ã˜Âª Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â­Ã™Ë†Ã™Å Ã™â€žÃ˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¦Ã™Å Ã˜Â³Ã™Å Ã˜Â© (Ã™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã˜Â§Ã™â€¦Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ™â€ Ã™Å Ã™Â Ã™ÂÃ™â€šÃ˜Â· Ã¢â‚¬â€ Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â¹Ã˜Â¯Ã™â€˜Ã˜Â§Ã˜Â¯)
  ipcMain.on('streamo:should-block-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // Ã˜Â­Ã™Æ’Ã™â€¦ Ã˜ÂµÃ˜Â§Ã™â€¦Ã˜Âª Ã™â€žÃ˜ÂªÃ˜ÂµÃ™â€ Ã™Å Ã™Â Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã™â€¦Ã™Å Ã™â€  (Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â¹Ã˜Â¯Ã™â€˜Ã˜Â§Ã˜Â¯/Ã˜ÂªÃ˜Â³Ã˜Â¬Ã™Å Ã™â€ž) Ã¢â‚¬â€ Ã™â€žÃ™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã˜Â§Ã™â€¦ Ã™ÂÃ™Å  Ã˜Â­Ã˜Â§Ã˜Â±Ã˜Â³ Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€ Ã™â€šÃ™â€ž
  ipcMain.on('streamo:is-ad-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // Ã˜ÂªÃ™â€¦Ã˜Â±Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â§Ã˜Â¨Ã˜Â· Ã˜Â§Ã™â€žÃ™â€žÃ™Å  Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã˜Â¶Ã˜ÂºÃ˜Â· Ã˜Â¹Ã™â€žÃ™Å Ã™â€¡ Ã™ÂÃ˜Â¹Ã™â€žÃ˜Â§Ã™â€¹ Ã™â€žÃ™â€žÃ™Ë†Ã˜Â§Ã˜Â¬Ã™â€¡Ã˜Â© Ã¢â‚¬â€ Ã˜Â£Ã˜Â³Ã˜Â§Ã˜Â³ Ã˜Â§Ã™â€žÃ™â€šÃ™ÂÃ™â€ž Ã˜Â§Ã™â€žÃ˜Â°Ã™Æ’Ã™Å 
  ipcMain.on('streamo:anchor', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:anchor-click', { wcId: event.sender.id, href });
    }
  });

  // Ã˜ÂªÃ™â€¦Ã˜Â±Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜ÂµÃ™ÂÃ˜Â­Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å Ã˜Â© Ã˜Â¨Ã˜ÂªÃ˜Â§Ã˜Â¹Ã˜Â© Ã˜Â£Ã™Å  webview Ã¢â‚¬â€ Ã˜Â£Ã˜Â³Ã˜Â§Ã˜Â³ Ã™â€ Ã˜Â³Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ˜Â§Ã˜Â· Ã™â€žÃ™â€žÃ˜ÂµÃ™ÂÃ˜Â­Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂµÃ˜Â­
  ipcMain.on('streamo:seen-page', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:seen-page', { wcId: event.sender.id, href });
    }
  });

  // Ã˜ÂªÃ™â€¦Ã˜Â±Ã™Å Ã˜Â± Ã™â€ Ã™Å Ã˜Â© Ã˜Â§Ã™â€žÃ™â€ Ã™â€šÃ™â€ž Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¶Ã˜ÂºÃ˜Â·Ã˜Â© (Ã˜Â­Ã˜ÂªÃ™â€° Ã™â€žÃ™Ë† Ã˜Â§Ã˜Â¨Ã˜ÂªÃ™â€žÃ˜Â¹Ã˜ÂªÃ™â€¡Ã˜Â§ Ã˜Â§Ã™â€žÃ˜ÂµÃ™ÂÃ˜Â­Ã˜Â©) Ã¢â‚¬â€ Ã˜Â£Ã˜Â³Ã˜Â§Ã˜Â³ rescue Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€ Ã˜Â§Ã˜Âª
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
    show: false, // Ã˜ÂªÃ™ÂÃ˜Â¸Ã™â€¡Ã˜Â± Ã™ÂÃ™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â§Ã™â€¡Ã˜Â²Ã™Å Ã˜Â© (Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â³Ã˜Â¨Ã™â€žÃ˜Â§Ã˜Â´)
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Streamo Link',
    icon: path.join(__dirname, 'assets', 'app_icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€ Ã™â€¡Ã˜Â§ Ã™Ë†Ã˜Â³Ã™â€¦ <webview> Ã™â€žÃ˜Â§ Ã™Å Ã™ÂÃ™â€ Ã˜Â´Ã˜Â£ Ã˜Â®Ã˜Â§Ã™â€žÃ˜Âµ
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
  } catch (e) {
    console.error('defense registration failed:', e);
  }
  createMainWindow();

  // Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨ Ã˜Â§Ã™â€žÃ™â€ Ã˜Â§Ã™ÂÃ˜Â°Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¦Ã™Å Ã˜Â³Ã™Å Ã˜Â© Ã¢â‚¬â€ Ã˜Â£Ã™Å  Ã˜Â³Ã™â€šÃ™Ë†Ã˜Â· Ã™â€žÃ™â‚¬ renderer Ã™â€¡Ã™Å Ã˜Â­Ã˜ÂµÃ™â€ž reloads Ã˜ÂªÃ™â€žÃ™â€šÃ˜Â§Ã˜Â¦Ã™Å  Ã˜Â¨Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â´Ã˜Â§Ã˜Â´Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â³Ã™Ë†Ã˜Â¯Ã˜Â©
  try { if (win && !win.isDestroyed()) watchContents(win.webContents, 'main-window'); } catch (e) {}

  // Ã˜Â­Ã˜Â§Ã˜Â±Ã˜Â³ Ã˜Â§Ã™â€žÃ™â€ Ã™Ë†Ã˜Â§Ã™ÂÃ˜Â° Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯Ã˜Â© (Electron Ã¢â€°Â¥12): Ã˜Â£Ã™Å  window.open / target=_blank Ã™â€¦Ã™â€  Ã˜Â£Ã™Å  WebContents Ã¢â€ â€™ Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â§Ã˜Â¬Ã™â€¡Ã˜Â© Ã˜ÂªÃ™â€šÃ˜Â±Ã˜Â±
  app.on('web-contents-created', (event, contents) => {
    // Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨ Ã™Æ’Ã™â€ž guest/webview Ã¢â‚¬â€ Ã™â€žÃ™Ë† Tab Ã™â€¦Ã˜Â§Ã˜Âª Ã˜Â¨Ã˜ÂµÃ™â€¦Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ˜Â© Ã˜ÂªÃ˜ÂªÃ˜Â³Ã˜Â¬Ã™â€ž Ã™Ë†Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â§Ã˜Â¬Ã™â€¡Ã˜Â© Ã˜ÂªÃ˜ÂªÃ˜Â¨Ã™â€žÃ˜Âº
    try { watchContents(contents, 'guest:' + (contents.getType ? contents.getType() : 'unknown')); } catch (e) {}
    try {
      if (contents && contents.getProcessId) guestPidToWcId.set(contents.getProcessId(), contents.id);
      contents.on('render-process-gone', () => { try { guestPidToWcId.delete(contents.getProcessId()); } catch (e) {} });
      contents.on('destroyed', () => { try { guestPidToWcId.delete(contents.getProcessId()); } catch (e) {} });
    } catch (e) {}
    try {
      if (!contents) return;
      const w = win && !win.isDestroyed() ? win : null;
      // Ã˜ÂªÃ˜Â¬Ã˜Â§Ã™â€¡Ã™â€ž Ã˜Â§Ã™â€žÃ™â€ Ã˜Â§Ã™ÂÃ˜Â°Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â¦Ã™Å Ã˜Â³Ã™Å Ã˜Â© Ã™â€ Ã™ÂÃ˜Â³Ã™â€¡Ã˜Â§ Ã¢â‚¬â€ Ã™â€ Ã˜Â§Ã™ÂÃ˜Â°Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â·Ã˜Â¨Ã™Å Ã™â€š Ã™â€¦Ã˜Â§ Ã˜Â¨Ã˜ÂªÃ˜Â­Ã˜ÂªÃ˜Â§Ã˜Â¬Ã˜Â´ Ã˜Â­Ã˜Â¯ Ã™Å Ã™â€¦Ã™â€ Ã˜Â¹Ã™â€¡Ã˜Â§
      if (w && contents.id === w.webContents.id) return;
      console.log('[popup] handler attached to contents', contents.id, 'type=', contents.getType && contents.getType());
      contents.setWindowOpenHandler(({ url }) => {
        // Ã˜Â§Ã™â€žÃ˜ÂµÃ™ÂÃ˜Â­Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂµÃ˜Â¯Ã˜Â± Ã¢â‚¬â€ Ã™â€¦Ã™â€  Ã™â€ Ã™ÂÃ˜Â³ Ã˜Â§Ã™â€žÃ™â‚¬ WebContents Ã™â€¦Ã˜Â¨Ã˜Â§Ã˜Â´Ã˜Â±Ã˜Â© (Ã™â€žÃ˜Â§ Ã˜Â­Ã˜Â§Ã˜Â¬Ã˜Â© Ã™â€žÃ˜Â®Ã˜Â±Ã˜Â§Ã˜Â¦Ã˜Â· Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â§Ã˜Â¬Ã™â€¡Ã˜Â©)
        let src = '';
        try { src = contents.getURL() || ''; } catch (e) {}
        const w2 = win && !win.isDestroyed() ? win : null;
        console.log('[popup] request', url, '\n        from', src || '(unknown)');
        if (w2) {
          try { w2.webContents.send('streamo:popup', { wcId: contents.id, url, srcUrl: src }); } catch (e) {}
        }
        return { action: 'deny' }; // Ã™â€¦Ã˜Â§Ã™Å Ã™â€ Ã™ÂÃ˜ÂªÃ˜Â­Ã˜Â´ Ã™Æ’Ã™â‚¬ pop-upÃ˜â€º Ã˜Â§Ã™â€žÃ™Ë†Ã˜Â§Ã˜Â¬Ã™â€¡Ã˜Â© Ã˜ÂªÃ™â€šÃ˜Â±Ã˜Â± Ã˜ÂªÃ™ÂÃ˜ÂªÃ˜Â­Ã™â€¡ Ã™Æ’Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â§ Ã™â€žÃ™Ë† Ã˜Â³Ã™Å Ã˜Â§Ã˜Â³Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã™â€¦Ã™Å Ã™â€  Ã˜ÂªÃ˜Â³Ã™â€¦Ã˜Â­
      });
    } catch (e) {
      console.error('window-open handler failed:', e);
    }
  });

  // Ã™â€¦Ã˜Â±Ã˜Â§Ã™â€šÃ˜Â¨Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€¦Ã™â€žÃ™Å Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¨Ã™â€ Ã˜Â© Ã¢â‚¬â€ GPU Ã˜Â£Ã™Ë† Utility Ã™â€žÃ™Ë† Ã™â€¦Ã˜Â§Ã˜ÂªÃ™Ë†Ã˜Â§ Ã˜Â¨Ã˜Â§Ã˜Â³Ã˜ÂªÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â± Ã™â€ Ã˜Â¹Ã™Å Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â·Ã™â€žÃ˜Â§Ã™â€š Ã˜Â¨Ã˜Â£Ã™â€¦Ã˜Â§Ã™â€ 
  app.on('child-process-gone', (event, details) => {
    try {
      console.error('[recovery] child-process-gone type=' + (details && details.type) +
        ' reason=' + (details && details.reason) + ' exitCode=' + (details && details.exitCode));
      if (details && details.type === 'GPU') noteGpuCrash();
    } catch (e) {}
  });

  // Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â¨Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â±Ã˜Â§Ã˜Â¨Ã˜Â· Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ™â‚¬ renderer Ã¢â‚¬â€ Ã˜Â±Ã˜Â¯ Ã˜Â¹Ã˜Â¨Ã˜Â± Promise
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

  // Ã˜ÂªÃ˜ÂªÃ˜Â¨Ã™â€˜Ã˜Â¹ "Ã˜Â¶Ã˜ÂºÃ˜Â·Ã˜Â© Ã˜Â­Ã™â€šÃ™Å Ã™â€šÃ™Å Ã˜Â©" Ã˜Â¯Ã˜Â§Ã˜Â®Ã™â€ž Ã˜Â£Ã™Å  WebView (Ã˜Â¥Ã˜Â´Ã˜Â§Ã˜Â±Ã˜Â© Ã˜Â«Ã™â€šÃ˜Â© Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â­Ã™Ë†Ã™Å Ã™â€žÃ˜Â§Ã˜Âª)
  const gestures = new Map(); // webContentsId -> timestamp
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
