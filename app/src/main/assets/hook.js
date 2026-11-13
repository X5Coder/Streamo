/*
 * Streamo Android — page hook (port of browser-preload.js + the HOOK bundle from chrome.js).
 * Injected on dom-ready / did-finish-load. Talks to the native app through window.__streamoHook.
 */
(function () {
  try {
    if (window.__streamoHookReady) return;
    window.__streamoHookReady = true;

    // Page-level dedupe: stops IPC storms from video players that re-request the same URL.
    var sent = Object.create(null), sentN = 0;

    function send(u, isMedia, tagName) {
      try {
        if (!u) return;
        var a = document.createElement('a');
        a.href = u;
        if (a.protocol === 'http:' || a.protocol === 'https:') {
          var k = a.href;
          if (sent[k]) return;
          sent[k] = 1; sentN++;
          if (sentN > 250) { sent = Object.create(null); sentN = 0; }
          window.__streamoHook.send(k, !!isMedia, tagName || '');
        }
      } catch (e) {}
    }

    var gesture = function () {
      try { window.__streamoHook.gesture(); } catch (e) {}
    };
    document.addEventListener('click', gesture, true);
    document.addEventListener('pointerdown', gesture, true);

    var anchorSend = function (e) {
      try {
        var t = e.target;
        var a = t && t.closest ? t.closest('a[href]') : null;
        if (a && a.href) { window.__streamoHook.anchor(a.href); }
      } catch (e) {}
    };
    document.addEventListener('pointerdown', anchorSend, true);
    document.addEventListener('click', anchorSend, true);

    document.addEventListener('click', function (e) {
      try {
        var t = e.target;
        var a = t && t.closest ? t.closest('a[href]') : null;
        if (a && a.href && window.__streamoHook && window.__streamoHook.navIntent) {
          window.__streamoHook.navIntent(a.href, !!e.defaultPrevented);
        }
      } catch (e) {}
    }, false);

    var of = window.fetch;
    if (of) {
      window.fetch = function () {
        try {
          var a = arguments[0];
          var u = (typeof a === 'string') ? a : (a && a.url);
          send(u, false);
        } catch (e) {}
        return of.apply(this, arguments);
      };
    }
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { send(u, false); } catch (e) {}
      return oo.apply(this, arguments);
    };

    function seen() {
      try {
        if (window.__streamoHook && window.__streamoHook.seen && window.location && window.location.href) {
          window.__streamoHook.seen(window.location.href);
        }
      } catch (e) {}
    }
    seen();
    setInterval(seen, 4000);

    // Debounced DOM scan: a streaming page can emit thousands of mutations per second.
    var scanTimer = 0;
    function scanNow() {
      try {
        var n = document.querySelectorAll('video,source');
        for (var i = 0; i < n.length; i++) {
          var t = n[i];
          send(t.currentSrc || t.src, true, 'video');
        }
      } catch (e) {}
    }
    function scan() {
      if (scanTimer) return;
      scanTimer = setTimeout(function () { scanTimer = 0; scanNow(); }, 400);
    }
    if (window.MutationObserver) {
      new MutationObserver(scan).observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['src']
      });
    }
    scanNow();
    setInterval(scan, 8000);
  } catch (e) {}
})();
