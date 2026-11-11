/*
 * Streamo Link — preload المتصفح الداخلي (الـ webview الرئيسي).
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
