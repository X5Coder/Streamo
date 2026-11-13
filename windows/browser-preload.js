/*
 * Streamo — preload المتصفح الداخلي (الـ webview الرئيسي).
 * يعرّض نافذة محدودة __streamoHook يستدعيها كود الحقن لمراقبة وسوم الفيديو وطلبات fetch/XHR.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__streamoHook', {
  send: (url, isMediaElement, tagName) => {
    if (typeof url !== 'string') return;
    ipcRenderer.send('streamo:js-url', {
      url: url,
      isMediaElement: !!isMediaElement,
      tagName: String(tagName || ''),
      pageUrl: String(window.location && window.location.href || '')
    });
  },
  /** Pass a genuine user click up to the main process (trust signal) */
  gesture: () => {
    ipcRenderer.send('streamo:gesture');
  },
  /** Pass the anchor href the user clicked (domain-lock signal) */
  anchor: (href) => {
    if (typeof href !== 'string') return;
    if (!/^https?:\/\//i.test(href)) return;
    ipcRenderer.send('streamo:anchor', href);
  },
  /** Ping the current location of this webview/page (used for captures) */
  seen: (href) => {
    if (typeof href !== 'string') return;
    if (!/^https?:\/\//i.test(href)) return;
    ipcRenderer.send('streamo:seen-page', href);
  },
  /** The page + target context of a click that may have been swallowed by the site (e.g. ad hijack) */
  navIntent: (href, prevented) => {
    if (typeof href !== 'string') return;
    if (!/^https?:\/\//i.test(href)) return;
    ipcRenderer.send('streamo:nav-intent', { href, prevented: !!prevented });
  }
});

/* Real page-load milestones, reported to the host so the toolbar progress
   line reflects actual page speed — not an animation. */
(function () {
  var sent = {};
  function send(phase) {
    if (sent[phase]) return; sent[phase] = 1;
    try { ipcRenderer.send('streamo:load-phase', { phase: phase, t: Date.now() }); } catch (e) {}
  }
  function probe() {
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
      if (nav) {
        if (nav.responseStart > 0) send('domLoading');
        if (nav.domInteractive > 0) send('domInteractive');
        if (nav.domContentLoadedEventEnd > 0) send('domContentLoaded');
        if (nav.loadEventEnd > 0) send('load');
      }
      var st = document.readyState;
      if (st === 'interactive') { send('domInteractive'); send('domContentLoaded'); }
      if (st === 'complete') send('load');
    } catch (e) {}
  }
  send('start');
  probe();
  var ticks = 0;
  var timer = setInterval(function () {
    try { probe(); } catch (e) {}
    if (++ticks > 300 || (document.readyState === 'complete' && sent['load'])) { clearInterval(timer); }
  }, 100);
  document.addEventListener('DOMContentLoaded', function () { send('domContentLoaded'); }, true);
  window.addEventListener('load', function () { send('load'); }, true);
})();

/* Report every mouse-down inside the guest page (capture phase) —
   the host uses it to close open popups / panels */
try {
  const reportGuestClick = () => { try { ipcRenderer.send('streamo:guest-click'); } catch (e) {} };
  document.addEventListener('mousedown', reportGuestClick, true);
  document.addEventListener('click', reportGuestClick, true);
} catch (e) {}
