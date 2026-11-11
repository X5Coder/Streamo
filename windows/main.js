/*
 * Streamo Link — نواة تطبيق الويندوز (مستقل، ملف exe واحد).
 * المتصفح + درع الإعلانات + اختبار الروابط (طلب HTTP بسيط Range في النواة — لا يوجد webview مخفي).
 */
'use strict';

const { app, BrowserWindow, ipcMain, session, shell, protocol, webContents } = require('electron');
const path = require('path');
const defense = require('./renderer/shared/defense/defense.js');
const { probeLink } = require('./probe.js');

// تسجيل بروتوكول الـ stub كـ "متميز" قبل الجاهزية — بدونه الـ redirect لن يصل للـ handler
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
const MIN_TS_SIZE = 25 * 1024 * 1024; // تجاهل مقاطع HLS الصغيرة (أصغر من 25MB تعتبر segment)

let win = null;

/* ================= الاستشفاء من سقوط العمليات (إصلاح الشاشة السودة) =================
 * السبب الجذري للمشكلة: عملية الـ renderer (الرسم) بتموت بصمت → النافذة تفضل موجودة
 * بعنوان "Streamo Link" بس مفيش محتوى → المستخدم يشوف شاشة سودة متجمدة.
 * الحل: نراقب render-process-gone لكل webContents + child-process-gone (GPU/Utility)
 * ونسجّل السبب، ونعمل reload تلقائي للنافذة، ولو اتكرر أكتر من 3 مرات في 5 دقايق
 * نعمل relaunch للتطبيق (وبالـ --disable-gpu لو الـ GPU هو اللي بيقع).
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
      // webview guest مات → بلّغ الواجهة إن تاب معينة تحتاج reload
      try { win && !win.isDestroyed() && win.webContents.send('streamo:guest-gone', { wcId: contents.id, reason: String(reason) }); } catch (e) {}
    });
    contents.on('unresponsive', () => console.error('[recovery] unresponsive (' + label + ')'));
    contents.on('responsive', () => console.log('[recovery] responsive again (' + label + ')'));
  } catch (e) {
    console.error('[recovery] watchContents failed:', e && e.message);
  }
}

/* ================= Memory Watchdog =================
 * السبب الحقيقي للـ OOM: صفحات البث (vkvideo embeds) بتبلغ الذاكرة في الـ guest renderer
 * لحد ما ويندوز يقتلها (reason=oom exitCode=-536870904). بدل ما ينتظر القتل:
 * كل 20 ثانية نفحص ذاكرة كل WebContents — لو تاب تجاوزت الحد، نعيد إنشاءها بنفس الرابط
 * (الواجهة تستقبل 'streamo:guest-gone' بـ reason='memory-guard' وتعمل createTab + destroyTab).
 * لو النافذة نفسها هي اللي تجاوزت الحد → reloadWindow نفس مسار الاستشفاء.
 */
const MEM_WATCHDOG_MS = 15 * 1000;
const GUEST_LIMIT_MB = 1200;   // حد التاب — قبل ما ويندوز يقتل (٢.٦ GB كانت ضحية)
const WINDOW_LIMIT_MB = 900;   // حد النافذة نفسها

setInterval(() => {
  try {
    if (!webContents || typeof webContents.getAllWebContents !== 'function') return;
    const list = webContents.getAllWebContents() || [];
    for (const contents of list) {
      if (!contents || contents.isDestroyed()) continue;
      const isWindow = win && !win.isDestroyed() && contents.id === win.webContents.id;
      Promise.resolve(contents.getProcessMemoryInfo()).then((info) => {
        try {
          const kb = (k) => Number(info && info[k]) || 0;
          // Electron 33+: ProcessMemoryInfo = { private, residentSet, shared } بالكيلوبايت
          const mb = Math.round(Math.max(kb('private'), kb('residentSet'), kb('shared')) / 1024);
          if (mb <= 0) return;
          const label = isWindow ? 'main-window' : 'guest:' + contents.id;
          if (mb > 250) console.log('[watchdog]', label, 'using', mb, 'MB');
          if (isWindow && mb > WINDOW_LIMIT_MB) {
            console.error('[watchdog] main-window using', mb, 'MB — reloading');
            scheduleWindowRecovery('memory-guard');
            return;
          }
          if (!isWindow && mb > GUEST_LIMIT_MB) {
            console.error('[watchdog] guest', contents.id, 'using', mb, 'MB — recreating tab');
            try { win && !win.isDestroyed() && win.webContents.send('streamo:guest-gone', { wcId: contents.id, reason: 'memory-guard' }); } catch (e) {}
          }
        } catch (e) { /* الذاكرة متغيرة دائمًا — تجاهل */ }
      }).catch(() => {});
    }
  } catch (e) { /* watchdog لا يكسر شيء */ }
}, MEM_WATCHDOG_MS).unref();

/* ================= الدرع (نواة) ================= */

/** بروتوكول stub محلي: يرد 200 بجسم فاضي — الموقع لا يعرف أن الإعلان تم حبسه */
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

  // خط الدفاع NET: قرار لكل طلب قبل خروجه (إعادة توجيه لـ stub / إلغاء تحويلة إعلان)
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
      // fetch/XHR/ping — الـ CORS-block من streamo-stub بيخلي الـ SDKs تعمل retry storm → إلغاء مباشر بدل redirect
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

    // التقاط الوسائط — فقط ما ليس إعلانًا (إعلانات الفيديو كانت تلوّث السجل)
    if (MEDIA_RE.test(url) && !TS_RE.test(url) && shouldSend(url)) {
      sendLink({ url, source: 'request', tabId: details.tabId, initiator: details.initiator || '' });
    }
    callback({});
  });

  // صيد عبر Content-Type (الروابط بدون امتداد أو بامتداد مزيف)
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

  // روابط من حقن JS (وسوم video/audio + fetch/XHR) — تحمل pageUrl الدقيق من نفس الصفحة
  ipcMain.on('streamo:js-url', (event, payload) => {
    const url = payload && payload.url;
    const isMediaElement = payload && payload.isMediaElement;
    const pageUrl = payload && typeof payload.pageUrl === 'string' ? payload.pageUrl : '';
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (defense.decide(url, { isMainFrame: false, pageUrl: '' }) !== 'allow') return;
    // وسوم الوسائط تُقبل كاملة (حتى .ts لو الصفحة نفسها طالبة ياه)؛ باقي الـ JS فقط ما يطابق الامتداد مع استبعاد مقاطع .ts
    if (isMediaElement || (MEDIA_RE.test(url) && !TS_RE.test(url))) {
      if (shouldSend(url)) sendLink({ url, source: 'js', pageUrl });
    }
  });

  // حكم متزامن صامت للتحويلات الرئيسية (لاستخدامات التصنيف فقط — بدون عدّاد)
  ipcMain.on('streamo:should-block-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // حكم صامت لتصنيف الدومين (بدون عدّاد/تسجيل) — للاستخدام في حارس التنقل
  ipcMain.on('streamo:is-ad-nav', (event, url) => {
    const verdict = defense.decide(String(url || ''), { isMainFrame: true, pageUrl: '' });
    event.returnValue = (verdict === 'fail');
  });

  // تمرير الرابط اللي المستخدم ضغط عليه فعلاً للواجهة — أساس القفل الذكي
  ipcMain.on('streamo:anchor', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:anchor-click', { wcId: event.sender.id, href });
    }
  });

  // تمرير الصفحة الحالية بتاعة أي webview — أساس نسب الالتقاط للصفحة الصح
  ipcMain.on('streamo:seen-page', (event, href) => {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('streamo:seen-page', { wcId: event.sender.id, href });
    }
  });

  // تمرير نية النقل من الضغطة (حتى لو ابتلعتها الصفحة) — أساس rescue من الإعلانات
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
    show: false, // تُظهر فور الجاهزية (بدون سبلاش)
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Streamo Link',
    icon: path.join(__dirname, 'assets', 'app_icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // بدونها وسم <webview> لا يُنشأ خالص
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

  // راقب النافذة الرئيسية — أي سقوط لـ renderer هيحصل reloads تلقائي بدل الشاشة السودة
  try { if (win && !win.isDestroyed()) watchContents(win.webContents, 'main-window'); } catch (e) {}

  // حارس النوافذ الجديدة (Electron ≥12): أي window.open / target=_blank من أي WebContents → الواجهة تقرر
  app.on('web-contents-created', (event, contents) => {
    // راقب كل guest/webview — لو Tab مات بصمت الحالة تتسجل والواجهة تتبلغ
    try { watchContents(contents, 'guest:' + (contents.getType ? contents.getType() : 'unknown')); } catch (e) {}
    try {
      if (!contents) return;
      const w = win && !win.isDestroyed() ? win : null;
      // تجاهل النافذة الرئيسية نفسها — نافذة التطبيق ما بتحتاجش حد يمنعها
      if (w && contents.id === w.webContents.id) return;
      console.log('[popup] handler attached to contents', contents.id, 'type=', contents.getType && contents.getType());
      contents.setWindowOpenHandler(({ url }) => {
        // الصفحة المصدر — من نفس الـ WebContents مباشرة (لا حاجة لخرائط الواجهة)
        let src = '';
        try { src = contents.getURL() || ''; } catch (e) {}
        const w2 = win && !win.isDestroyed() ? win : null;
        console.log('[popup] request', url, '\n        from', src || '(unknown)');
        if (w2) {
          try { w2.webContents.send('streamo:popup', { wcId: contents.id, url, srcUrl: src }); } catch (e) {}
        }
        return { action: 'deny' }; // ماينفتحش كـ pop-up؛ الواجهة تقرر تفتحه كتابا لو سياسة الدومين تسمح
      });
    } catch (e) {
      console.error('window-open handler failed:', e);
    }
  });

  // مراقبة العمليات الابنة — GPU أو Utility لو ماتوا باستمرار نعيد الإطلاق بأمان
  app.on('child-process-gone', (event, details) => {
    try {
      console.error('[recovery] child-process-gone type=' + (details && details.type) +
        ' reason=' + (details && details.reason) + ' exitCode=' + (details && details.exitCode));
      if (details && details.type === 'GPU') noteGpuCrash();
    } catch (e) {}
  });

  // اختبار الرابط من الـ renderer — رد عبر Promise
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

  // تتبّع "ضغطة حقيقية" داخل أي WebView (إشارة ثقة للتحويلات)
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
