/*
 * Streamo — Browser window logic (Windows).
 * Multi-tabs + compact dark toolbar + smart search + internal player + ad-shield.
 * Domain lock: while you are inside a site (tracked per tab), any navigation/redirect to a
 * foreign eTLD+1 is blocked unless it is the site itself, a hop of a user-initiated action,
 * or it matches the anchor the user actually clicked.
 */
'use strict';

(function () {
  var params = new URLSearchParams(window.location.search);
  var browserPreload = params.get('browserPreload') || '';

  function toFileUrl(p) {
    if (!p) return '';
    var n = String(p).replace(/\\/g, '/');
    if (n.charAt(0) === '/') return 'file://' + n;
    return 'file:///' + n;
  }

  /* ================= Elements ================= */
  var viewsContainer = document.getElementById('views');
  var notifStack = document.getElementById('notifStack');
  var toastEl = document.getElementById('toast');
  var badge = document.getElementById('badgeLinks');
  var scrim = document.getElementById('scrim');
  var panelRight = document.getElementById('panelRight');
  var panelLeft = document.getElementById('panelLeft');
  var panelTabs = document.getElementById('panelTabs');
  var linksListContent = document.getElementById('linksListContent');
  var searchListContent = document.getElementById('searchListContent');
  var tabsList = document.getElementById('tabsList');
  var linksCount = document.getElementById('linksCount');
  var searchCount = document.getElementById('searchCount');
  var tabsCount = document.getElementById('tabsCount');
  var normalBar = document.getElementById('normalBar');
  var searchBar = document.getElementById('searchBar');
  var searchInput = document.getElementById('searchInput');
  var btnBack = document.getElementById('btnBack');
  var btnForward = document.getElementById('btnForward');
  var urlText = document.getElementById('urlText');
  var urlPill = document.getElementById('urlPill');
  var urlInput = document.getElementById('urlInput');
  var btnMenu = document.getElementById('btnMenu');
  var menuPop = document.getElementById('menuPop');
  var menuRecords = document.getElementById('menuRecords');
  var menuTabs = document.getElementById('menuTabs');
  var urlReload = document.getElementById('urlReload');
  var urlHome = document.getElementById('urlHome');
  var pillProgress = document.getElementById('pillProgress');
  var pillProgressBar = document.getElementById('pillProgressBar');

  var HOOK =
    "(function(){try{if(window.__streamoHookReady)return;window.__streamoHookReady=true;" +
    // Page-level dedupe: stops IPC storms from video players that re-request the same URL.
    "var sent=Object.create(null),sentN=0;" +
    "function send(u,isMedia,tagName){try{if(!u)return;var a=document.createElement('a');a.href=u;" +
    "if(a.protocol==='http:'||a.protocol==='https:'){var k=a.href;if(sent[k])return;sent[k]=1;sentN++;if(sentN>250){sent=Object.create(null);sentN=0;}" +
    "window.__streamoHook.send(k, !!isMedia, tagName||'');}}catch(e){}}" +
    "var gesture=function(){try{window.__streamoHook.gesture();}catch(e){}};" +
    "document.addEventListener('click',gesture,true);" +
    "document.addEventListener('pointerdown',gesture,true);" +
    // comment
    "var anchorSend=function(e){try{var t=e.target;var a=t&&t.closest?t.closest('a[href]'):null;" +
    "if(a&&a.href){window.__streamoHook.anchor(a.href);}}catch(e){}};" +
    "document.addEventListener('pointerdown',anchorSend,true);" +
    "document.addEventListener('click',anchorSend,true);" +
    // comment
    "document.addEventListener('click',function(e){try{var t=e.target;var a=t&&t.closest?t.closest('a[href]'):null;" +
    "if(a&&a.href&&window.__streamoHook&&window.__streamoHook.navIntent){window.__streamoHook.navIntent(a.href, !!e.defaultPrevented);}}catch(e){}},false);" +
    "var of=window.fetch;if(of){window.fetch=function(){try{var a=arguments[0];var u=(typeof a==='string')?a:(a&&a.url);send(u,false);}catch(e){}return of.apply(this,arguments);};}" +
    "var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{send(u,false);}catch(e){}return oo.apply(this,arguments);};" +
    "function seen(){try{if(window.__streamoHook&&window.__streamoHook.seen&&window.location&&window.location.href){window.__streamoHook.seen(window.location.href);}}catch(e){}}" +
    "seen();setInterval(seen,4000);" +
    // Debounced DOM scan: a streaming page can emit thousands of mutations per second.
    "var scanTimer=0;function scanNow(){try{var n=document.querySelectorAll('video,source');for(var i=0;i<n.length;i++){var t=n[i];send(t.currentSrc||t.src,true,'video');}}catch(e){}}" +
    "function scan(){if(scanTimer)return;scanTimer=setTimeout(function(){scanTimer=0;scanNow();},400);}" +
    "if(window.MutationObserver){new MutationObserver(scan).observe(document.documentElement||document,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});}" +
    "scanNow();setInterval(scan,8000);" +
    "}catch(e){}})();";

  var LINK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" stroke="#FFFFFF" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

  /* ================= Tabs ================= */
  var tabs = [];
  var tabSeq = 0;
  var activeTabId = null;
  var urlByTab = new Map();
  var titleByTab = new Map();
  var extractionLogged = new Set();
  var lastTestAt = new Map();
  var pendingTests = new Map(); // comment
  var anchorClicks = new Map(); // webContentsId -> { etld, ts }
  var pageByWebContents = new Map(); // webContentsId -> href (last known page for a webview)
  var strikes = new Map();
  var STRIKE_MS = 15000;
  var INTENT_MS = 8000;
  var ANCHOR_INTENT_MS = 5000;

  /* Memory manager state */
  var memByWcId = {};                 // webContentsId -> current MB from main
  var lastMemInfo = null;             // last report to keep the tabs panel fresh
  var IDLE_SLEEP_MS = 15 * 60 * 1000; // hidden tab sleeps after 15 min
  var PRESSURE_IDLE_MS = 45 * 1000;   // under pressure: only tabs idle >45s unless huge
  var lastSleepToastAt = 0;
  /* Notification cooldown: one capture card per movie per 2 minutes — a capture burst
     (master + variant + signature refreshes) shows exactly ONE card, never a stack. */
  var movieNotifyAt = new Map();
  var MOVIE_NOTIFY_WINDOW_MS = 2 * 60 * 1000;

  function isHttp(u) { return /^https?:\/\//i.test(String(u || '')); }

  function hostOf(u) {
    try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  }
  function etld1(host) {
    var p = String(host || '').split('.').filter(Boolean);
    return p.length <= 2 ? p.join('.') : p.slice(-2).join('.');
  }
  function isGoogleHost(host) {
    return /(^|\.)google\.[a-z.]{2,7}$/i.test(String(host || ''));
  }
  function shortHost(url) {
    var h = hostOf(url).replace(/^www\./, '');
    return h || 'link';
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '...' : s;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isAdDestination(url) {
    try {
      if (!window.streamoBridge.isAdNavQuiet) return false;
      return !!window.streamoBridge.isAdNavQuiet(url);
    } catch (e) { return false; }
  }

  /** Recent user gesture inside this webview (trusted click within 2s) */
  function gestureFresh(tab) {
    try {
      var wcId = tab.webContentsId;
      if (wcId == null || !window.streamoBridge.hasGesture) return false;
      return !!window.streamoBridge.hasGesture(wcId);
    } catch (e) { return false; }
  }

  function activeTab() {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeTabId) return tabs[i];
    return null;
  }
  function activeView() {
    var t = activeTab();
    return t ? t.view : null;
  }

  function trimAnchorMap() {
    if (anchorClicks.size <= 60) return;
    var now = Date.now();
    anchorClicks.forEach(function (v, k) {
      if (now - v.ts > ANCHOR_INTENT_MS) anchorClicks.delete(k);
    });
  }

  /** Recent anchor-click intent for this webview (anchor the user actually clicked) */
  function anchorIntent(wcId) {
    var rec = anchorClicks.get(wcId);
    if (!rec) return null;
    if (Date.now() - rec.ts > ANCHOR_INTENT_MS) { anchorClicks.delete(wcId); return null; }
    return rec;
  }

  /**
   * Smart navigation guard.
   */
  function decideNavigation(tab, destUrl, kind) {
    if (!isHttp(destUrl)) return 'allow';
    var dHost = hostOf(destUrl);
    var d = etld1(dHost);
    var c = etld1(hostOf(tab.url || ''));
    if (!d) return 'allow';
    if (c && d === c) return 'allow'; // same site
    if (isGoogleHost(hostOf(tab.url || '')) && isGoogleHost(dHost)) return 'allow'; // google -> google

    if (isAdDestination(destUrl)) {
      // comment
      var now = Date.now();
      var last = strikes.get(d);
      if (last && (now - last) < STRIKE_MS && gestureFresh(tab)) {
        strikes.delete(d);
        return 'allow';
      }
      if (gestureFresh(tab)) {
        strikes.set(d, now);
        return 'strike';
      }
      return 'block'; // no user gesture -> silently blocked
    }

    // comment
    if (tab.hostIntent && tab.hostIntent.freshTs && (Date.now() - tab.hostIntent.freshTs) < INTENT_MS) {
      return 'allow';
    }

    // comment
    var wcId = tab.webContentsId;
    var a = wcId != null ? anchorIntent(wcId) : null;
    if (a) {
      if (a.etld === d) return 'allow';       // the click was on an anchor to this domain
      if (kind === 'redirect') return 'allow'; // 3xx redirect chain of that same click (bit.ly type)
    }
    return 'block';
  }

  function makeWebview(url) {
    var view = document.createElement('webview');
    view.className = 'tab-view';
    view.setAttribute('partition', 'persist:streamo');
    // spellcheck=no removes a per-renderer dictionary; background throttling keeps
    // hidden tabs from burning CPU (both are defaults, stated explicitly).
    view.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,backgroundThrottling=yes,spellcheck=no');
    view.setAttribute('allowpopups', 'true'); // let popups flow to the host so domain policy can decide
    if (browserPreload) view.setAttribute('preload', toFileUrl(browserPreload));
    view.src = url || 'https://www.google.com/';
    return view;
  }

  /** Host-initiated navigation (typed URL / search / renew) — open transfer window */
  function hostNavigate(tab, url) {
    if (tab) {
      try { tab.hostIntent = { etld: etld1(hostOf(url)), freshTs: Date.now() }; } catch (e) {}
      tab.url = url || tab.url;
      if (!tab.view) restoreTabView(tab);
      try { tab.view.src = url; } catch (e) {}
    }
  }

  function createTab(url) {
    tabSeq += 1;
    var id = 't' + tabSeq;
    var view = makeWebview(url);
    viewsContainer.appendChild(view);
    var tab = {
      id: id,
      webContentsId: null,
      url: url || '',
      title: url || 'New Tab',
      view: view,
      hostIntent: { etld: etld1(hostOf(url || 'https://www.google.com/')), freshTs: Date.now() },
      lastActiveAt: Date.now(),
      sleeping: false,
      lastReloadAt: 0,
      crashCount: 0,
      lastCrashAt: 0
    };
    tabs.push(tab);
    attachViewHooks(tab);
    activateTab(id);
    return tab;
  }

  /** Recreate the webview of a sleeping tab without touching the tab itself. */
  function restoreTabView(tab) {
    if (!tab || tab.view) return;
    var view = makeWebview(tab.url || 'https://www.google.com/');
    view.style.display = 'none';
    viewsContainer.appendChild(view);
    tab.view = view;
    tab.sleeping = false;
    tab.webContentsId = null;
    attachViewHooks(tab);
    renderTabsList();
  }

  /** Destroy the webview but keep the tab + URL (memory saver / crash recovery). */
  function destroyTabView(tab) {
    if (!tab) return;
    var view = tab.view;
    if (!view) {
      tab.sleeping = true;
      tab.webContentsId = null;
      return;
    }
    try {
      if (typeof view.getURL === 'function') {
        var liveUrl = view.getURL();
        if (liveUrl) tab.url = liveUrl;
      }
    } catch (e) {}
    try {
      if (typeof view.getTitle === 'function') {
        var liveTitle = view.getTitle();
        if (liveTitle) tab.title = liveTitle;
      }
    } catch (e) {}
    try {
      if (typeof view.destroy === 'function') view.destroy();
      else if (view.parentNode) view.parentNode.removeChild(view);
    } catch (e) {
      try { if (view.parentNode) view.parentNode.removeChild(view); } catch (e2) {}
    }
    tab.view = null;
    tab.sleeping = true;
    var oldWc = tab.webContentsId;
    tab.webContentsId = null;
    if (oldWc != null) {
      urlByTab.delete(oldWc);
      titleByTab.delete(oldWc);
      anchorClicks.delete(oldWc);
      pageByWebContents.delete(oldWc);
      delete memByWcId[oldWc];
    }
  }

  function attachViewHooks(tab) {
    var view = tab.view;

    view.addEventListener('dom-ready', function () {
      try {
        tab.webContentsId = view.getWebContentsId();
        urlByTab.set(tab.webContentsId, tab.url);
        view.executeJavaScript(HOOK).catch(function () {});
        renderTabsList();
        updateMemoryStatus(lastMemInfo);
      } catch (e) {}
    });
    view.addEventListener('did-finish-load', function () {
      try { view.executeJavaScript(HOOK).catch(function () {}); } catch (e) {}
      finishLoadProgress();
      updateBackForward(tab);
      updateUrlPill(tab);
      renderTabsList();
    });

    var onNav = function (e) {
      tab.url = e.url || tab.url;
      if (tab.webContentsId != null) urlByTab.set(tab.webContentsId, tab.url);
      // comment
      tab.hostIntent = null;
      trackSearch(e.url, tab);
      updateBackForward(tab);
      updateUrlPill(tab);
      renderTabsList();
    };
    view.addEventListener('did-navigate', onNav);
    view.addEventListener('did-navigate-in-page', onNav);

    view.addEventListener('page-title-updated', function (e) {
      tab.title = e.title || tab.url;
      if (tab.webContentsId != null) titleByTab.set(tab.webContentsId, tab.title);
      renderTabsList();
    });

    view.addEventListener('will-navigate', function (event) {
      var url = event.url || '';
      var verdict = decideNavigation(tab, url, 'navigate');
      if (verdict === 'block') {
        event.preventDefault();
        toast('Blocked - redirect to a different site was stopped');
        return;
      }
      if (verdict === 'strike') {
        event.preventDefault();
        toast('Blocked - click again to continue');
        return;
      }
      startLoadProgress();
    });
    view.addEventListener('will-redirect', function (event) {
      var url = event.url || '';
      var verdict = decideNavigation(tab, url, 'redirect');
      if (verdict === 'block') {
        event.preventDefault();
        toast('Blocked - redirect to a different site was stopped');
        return;
      }
      if (verdict === 'strike') {
        event.preventDefault();
        toast('Blocked - click again to continue');
        return;
      }
    });
    // comment
    // comment
  }

  function updateUrlPill(tab) {
    if (!tab || tab.id !== activeTabId) return;
    var u = tab.url || '';
    urlText.textContent = u;
    urlPill.title = u + ' - click to search';
    if (editMode) urlInput.value = u;
  }

  function updateBackForward(tab) {
    tab = tab || activeTab();
    if (!tab || tab.id !== activeTabId) return;
    var view = tab.view;
    if (!view) {
      btnBack.disabled = true;
      btnForward.disabled = true;
      return;
    }
    try {
      var canBack = (typeof view.canGoBack === 'function') ? view.canGoBack() : true;
      var canFwd = (typeof view.canGoForward === 'function') ? view.canGoForward() : true;
      btnBack.disabled = !canBack;
      btnForward.disabled = !canFwd;
    } catch (e) {
      btnBack.disabled = true;
      btnForward.disabled = true;
    }
  }

  function activateTab(id) {
    var prev = activeTab();
    if (prev && prev.id !== id) prev.lastActiveAt = Date.now();
    activeTabId = id;
    var t = activeTab();
    if (t && !t.view) restoreTabView(t); // waking a sleeping tab
    for (var i = 0; i < tabs.length; i++) {
      var v = tabs[i].view;
      if (v) v.style.display = (tabs[i].id === id) ? '' : 'none';
    }
    if (t) {
      t.lastActiveAt = Date.now();
      urlText.textContent = t.url || '';
      urlPill.title = (t.url || '') + ' - click to copy (click the lock to type)';
      if (editMode) urlInput.value = t.url || '';
    }
    updateTabsCount();
    updateBackForward(t);
    renderTabsList();
    updateMemoryStatus(lastMemInfo);
  }

  function destroyTab(tab) {
    destroyTabView(tab);
  }

  function closeTab(id) {
    var idx = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var wasActive = tabs[idx].id === activeTabId;
    destroyTab(tabs[idx]);
    tabs.splice(idx, 1);
    if (tabs.length === 0) {
      createTab('https://www.google.com/');
      return;
    }
    if (wasActive) activateTab(tabs[tabs.length - 1].id);
    else { updateTabsCount(); renderTabsList(); }
  }

  function closeAllTabs() {
    for (var i = 0; i < tabs.length; i++) destroyTab(tabs[i]);
    tabs = [];
    activeTabId = null;
    createTab('https://www.google.com/');
  }

  function renderTabsList() {
    if (!tabsList) return;
    tabsList.innerHTML = '';
    for (var i = 0; i < tabs.length; i++) (function (tab) {
      var isActive = tab.id === activeTabId;
      var name = (tab.title || tab.url || 'Tab').trim();
      var initial = (hostOf(tab.url).replace(/^www\./, '') || 'T').charAt(0).toUpperCase();
      var mem = tabMemMB(tab);
      var memLabel = tab.sleeping ? 'sleeping' : (mem >= 50 ? Math.round(mem) + ' MB' : '');
      var item = document.createElement('div');
      item.className = 'tab-item' + (isActive ? ' active' : '') + (tab.sleeping ? ' sleeping' : '');
      item.setAttribute('role', 'button');
      item.setAttribute('data-tab', tab.id);
      item.innerHTML =
        '<div class="tab-favicon">' + escapeHtml(initial) + '</div>' +
        '<div class="tab-info">' +
          '<div class="tab-title">' + escapeHtml(name) +
            '<span class="tab-mem">' + (memLabel ? ' · ' + escapeHtml(memLabel) : '') + '</span>' +
          '</div>' +
          '<div class="tab-url" dir="ltr">' + escapeHtml(tab.url || '') + '</div>' +
        '</div>' +
        '<button class="tab-close" title="Close tab">X</button>';
      item.addEventListener('click', function (ev) {
        if (ev.target && ev.target.classList.contains('tab-close')) return;
        activateTab(tab.id);
        closePanel();
      });
      item.querySelector('.tab-close').addEventListener('click', function (ev) {
        ev.stopPropagation();
        closeTab(tab.id);
      });
      tabsList.appendChild(item);
    })(tabs[i]);
    scheduleSaveSession();
  }

  /* ================= Session restore =================
     A renderer crash / reload used to lose every tab. The list (URL + title) and the
     active index are saved to localStorage, and on boot only the active tab is
     loaded — the rest come back asleep, so restoring is cheap. After a FORCED UI kill
     the heavy page that drove the OOM is NEVER auto-woken: every tab restores asleep
     and a fresh benign tab opens instead (no freeze loop). */
  var SESSION_KEY = 'streamo.tabs.v1';
  var sessionSaveTimer = null;

  function saveSession() {
    try {
      var list = [];
      var activeIndex = 0;
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var u = t.url || '';
        if (!/^https?:\/\//i.test(u)) continue;
        if (t.id === activeTabId) activeIndex = list.length;
        list.push({ url: u, title: t.title || '' });
      }
      if (!list.length) return;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ urls: list, activeIndex: activeIndex, ts: Date.now() }));
    } catch (e) {}
  }

  function scheduleSaveSession() {
    if (sessionSaveTimer) return;
    sessionSaveTimer = window.setTimeout(function () {
      sessionSaveTimer = null;
      saveSession();
    }, 900);
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.urls) || !s.urls.length) return null;
      var list = s.urls.filter(function (x) { return x && /^https?:\/\//i.test(x.url || ''); }).slice(0, 30);
      if (!list.length) return null;
      return {
        urls: list,
        activeIndex: Math.max(0, Math.min(list.length - 1, Number(s.activeIndex) || 0))
      };
    } catch (e) { return null; }
  }

  function createSleepingTab(entry) {
    tabSeq += 1;
    var tab = {
      id: 't' + tabSeq,
      webContentsId: null,
      url: entry.url || '',
      title: entry.title || entry.url || 'New Tab',
      view: null,
      hostIntent: { etld: etld1(hostOf(entry.url || '')), freshTs: Date.now() },
      lastActiveAt: 0,
      sleeping: true,
      lastReloadAt: 0,
      crashCount: 0,
      lastCrashAt: 0
    };
    tabs.push(tab);
    return tab;
  }

  function restoreSession(allAsleep) {
    var s = readSession();
    if (!s) return false;
    for (var i = 0; i < s.urls.length; i++) createSleepingTab(s.urls[i]);
    if (allAsleep) {
      // The heavy page that caused the crash stays asleep — open a fresh benign tab instead.
      createTab('https://www.google.com/');
      toast('Recovered after a crash - your tabs were restored asleep');
      return true;
    }
    var active = tabs[Math.max(0, Math.min(tabs.length - 1, s.activeIndex))];
    if (!active) return false;
    activateTab(active.id); // wakes only this one; the rest stay asleep
    if (tabs.length > 1) {
      toast('Session restored - ' + tabs.length + ' tabs restored');
    }
    return true;
  }

  /* ================= Memory manager (side of the UI) ================= */

  function tabMemMB(tab) {
    if (!tab || tab.webContentsId == null) return 0;
    return Number(memByWcId[tab.webContentsId]) || 0;
  }

  function isTabAudible(tab) {
    try {
      return !!(tab && tab.view && typeof tab.view.isCurrentlyAudible === 'function' && tab.view.isCurrentlyAudible());
    } catch (e) { return false; }
  }

  /** Put a hidden tab to sleep: destroy its webview, keep URL/title, restore on click. */
  function sleepTab(tab, notify) {
    if (!tab || tab.id === activeTabId || !tab.view || tab.sleeping) return false;
    if (isTabAudible(tab)) return false; // never cut off audio the user is listening to
    var savedMB = tabMemMB(tab);
    destroyTabView(tab);
    if (notify && Date.now() - lastSleepToastAt > 60000) {
      lastSleepToastAt = Date.now();
      toast(savedMB >= 50 ? ('Tab asleep - ' + Math.round(savedMB) + ' MB saved') : 'Tab asleep - memory saved');
    }
    if (openSide === 'tabs') renderTabsList();
    return true;
  }

  /** Sleeping under pressure: biggest + least-recently-used hidden tabs first. */
  function sleepHiddenTabs(info, targetAppMB, includeRecent) {
    var now = Date.now();
    var candidates = [];
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (t.id === activeTabId || !t.view || t.sleeping) continue;
      if (isTabAudible(t)) continue;
      var own = tabMemMB(t);
      var idle = now - (t.lastActiveAt || now);
      if (!includeRecent && idle < PRESSURE_IDLE_MS && own < 350) continue;
      candidates.push({ tab: t, mb: own, idle: idle });
    }
    candidates.sort(function (a, b) { return (b.mb - a.mb) || (b.idle - a.idle); });
    var estimate = Number(info.appMB) || 0;
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      if (estimate <= targetAppMB && c.mb < 200) break;
      if (sleepTab(c.tab, true)) {
        estimate = Math.max(0, estimate - Math.max(c.mb, 120));
        if (estimate <= targetAppMB) break;
      }
    }
  }

  function fmtMemMB(mb) {
    mb = Number(mb) || 0;
    return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
  }

  function updateMemoryStatus(info) {
    if (!info) return;
    var el = document.getElementById('memStatus');
    if (el) {
      el.textContent = 'RAM ' + fmtMemMB(info.appMB) + '  ·  free ' + fmtMemMB(info.freeMB);
      el.className = 'mem-status ' + (info.level || 'ok');
      el.title = 'Streamo total ' + fmtMemMB(info.appMB) + ' / system free ' + fmtMemMB(info.freeMB) +
        ' / total ' + fmtMemMB(info.totalMB);
    }
    if (openSide === 'tabs' && tabsList) {
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var item = tabsList.querySelector('.tab-item[data-tab="' + t.id + '"]');
        if (!item) continue;
        var memEl = item.querySelector('.tab-mem');
        if (!memEl) continue;
        var mem = tabMemMB(t);
        memEl.textContent = t.sleeping ? ' · sleeping' : (mem >= 50 ? ' · ' + Math.round(mem) + ' MB' : '');
      }
    }
  }

  function memoryGovernor(info) {
    if (!info) return;
    memByWcId = {};
    var list = (info.tabs || []);
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (rec && rec.wcId != null) memByWcId[rec.wcId] = Number(rec.mb) || 0;
    }
    lastMemInfo = info;
    updateMemoryStatus(info);

    // The internal player decodes/buffers inside this very renderer. Drop it first
    // when the UI balloons, so the whole window never has to be killed.
    var uiMB = Number(info.windowMB) || 0;
    if (uiMB >= 800 && playerEl && playerEl.classList.contains('open')) {
      closePlayer();
      toast('Low RAM - player closed');
    }

    var level = info.level || 'ok';
    var now = Date.now();

    if (level === 'ok') {
      // Proactive idle sleep: keeps a long browsing session from ever reaching pressure.
      for (var j = 0; j < tabs.length; j++) {
        var tab = tabs[j];
        if (tab.id === activeTabId || !tab.view || tab.sleeping) continue;
        if (now - (tab.lastActiveAt || now) > IDLE_SLEEP_MS) sleepTab(tab, false);
      }
      return;
    }

    var target = level === 'critical'
      ? Math.round((info.warnMB || 1500) * 0.75)
      : Math.round((info.warnMB || 1500) * 0.9);
    sleepHiddenTabs(info, target, level === 'critical');

    // The active tab itself can be the leak (single vkvideo embed). Reload it
    // only when it is clearly huge, at most once every 30s.
    var active = activeTab();
    if (active && active.view) {
      var activeMB = tabMemMB(active);
      var activeLimit = level === 'critical' ? 650 : 950;
      if (activeMB >= activeLimit && now - (active.lastReloadAt || 0) > 30000) {
        active.lastReloadAt = now;
        toast('Low RAM - reloading this tab');
        try { active.view.reload(); } catch (e) {}
      }
    }
  }

  function updateTabsCount() {
    if (tabsCount) tabsCount.textContent = String(tabs.length);
  }

  /* ================= Search tracking ================= */
  function trackSearch(url) {
    try {
      var r = window.StreamoSearch.extract(url);
      if (r) {
        window.StreamoStore.addSearch(r.q, url, r.engine);
        refreshSearchIfOpen();
      }
    } catch (e) {}
  }

  /* ================= Toast ================= */
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  /* ================= Mini capture cards — منطق بسيط ================= */
  function flingNotif(div) {
    if (!div) return;
    div.classList.add('out');
    window.setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 280);
  }

  /* Entry ids of every capture still in-flight — these keep their mini card until ok/fail. */
  function pendingNotifIds() {
    var ids = new Set();
    pendingTests.forEach(function (p) { if (p && p.tmp && p.tmp.id) ids.add(p.tmp.id); });
    return ids;
  }

  /** Hide finished cards on panel open — cards still loading stay until the result arrives. */
  function clearAllNotifs() {
    var nodes = notifStack.querySelectorAll('.notif');
    for (var i = 0; i < nodes.length; i++) flingNotif(nodes[i]);
  }

  function addMiniCard(entry) {
    var div = document.createElement('div');
    div.className = 'notif';
    div.setAttribute('data-entry', entry.id);
    div.innerHTML =
      '<div class="notif-icon">' + LINK_SVG + '</div>' +
      '<div class="notif-text">' +
        '<div class="notif-title">' + escapeHtml(shortHost(entry.url)) + '</div>' +
        '<div class="notif-sub" dir="ltr">' + escapeHtml(truncate(entry.url, 58)) + '</div>' +
      '</div>' +
      '<div class="notif-end"><div class="spinner-ring"></div></div>';
    /* ✗ الفاشل: تطير وتنمسح من غير ما تفتح اللوحة · ✓ الناجح: تفتح اللوحة وتخفي كل الكروت */
    div.addEventListener('click', function (e) {
      e.stopPropagation();
      if (div.classList.contains('failed')) { flingNotif(div); return; }
      openPanel('links');
      clearAllNotifs();
      window.setTimeout(function () {
        var storedId = null;
        try {
          var all = window.StreamoStore.getLinks();
          for (var i = 0; i < all.length; i++) if (all[i].url === entry.url) { storedId = all[i].id; break; }
        } catch (e) {}
        if (storedId) window.StreamoPanelUI.flashEntry(linksListContent, storedId);
      }, 140);
    });
    notifStack.appendChild(div);
    // حد أقصى 5 كروت منتهية — مش بناخد الكروت اللسه بتتحمل، الكارت المحمل بيفضل لحد النتيجة
    for (var guard = 0; guard < 40 && notifStack.children.length > 5; guard++) {
      var pendingIds = pendingNotifIds();
      var oldestSettled = null;
      for (var ci = 0; ci < notifStack.children.length; ci++) {
        var node = notifStack.children[ci];
        if (!pendingIds.has(node.getAttribute('data-entry'))) { oldestSettled = node; break; }
      }
      if (oldestSettled) { flingNotif(oldestSettled); break; }
      break; // كل الكروت لسه بتتحمل — سيبهم، عددهم محدود بطبيعة التقاطات الفيديو
    }
  }

  function updateMiniCard(entryId, ok) {
    var div = notifStack.querySelector('.notif[data-entry="' + entryId + '"]');
    if (!div) return;
    div.classList.toggle('failed', !ok);
    var end = div.querySelector('.notif-end');
    if (end) {
      end.innerHTML = ok
        ? '<span class="notif-badge ok"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.5 4.5L18.5 7"/></svg></span>'
        : '<span class="notif-badge fail"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 7L7 17"/></svg></span>';
    }
    var title = div.querySelector('.notif-title');
    if (title) title.textContent = ok ? 'Link captured' : 'Link failed';
    // نجاح: 10 ثوان · فشل: 5 ثوان · لسه لودنج: لا يزول لو وجد تقرون
    window.setTimeout(function () {
      if (!div.parentNode) return;
      flingNotif(div);
    }, ok ? 10000 : 5000);
  }

  /* شارة "روابط جديدة" — بتظهر مرة واحدة بس قبل أول فتح للوحتها، ومش مطلوب تفتح اللوحة تاني في أي وقت */
  var STREAMO_BADGE_KEY = 'streamo.links.firstBadge';
  var badgeCount = 0;
  function refreshLinkBadge() {
    var seen = false;
    try { seen = localStorage.getItem(STREAMO_BADGE_KEY) === 'seen'; } catch (e) {}
    var n = 0;
    try { n = window.StreamoStore.getLinks().length; } catch (e) { n = 0; }
    badgeCount = Math.min(99, n);
    badge.textContent = String(badgeCount);
    badge.style.display = (!seen && badgeCount > 0) ? 'flex' : 'none';
  }
  function markBadgeSeen() {
    try { localStorage.setItem(STREAMO_BADGE_KEY, 'seen'); } catch (e) {}
    badge.style.display = 'none';
  }

  /* ================= Panels ================= */
  var openSide = null; // 'links' | 'search' | 'tabs' | null
  var linksSignature = '';
  var searchSignature = '';

  var linkActions = {
    onCopy: function (text) {
      var done = function () { toast('Copied OK'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    },
    onOpenGoogle: function (url) { try { window.streamoBridge.openExternal(url); } catch (e) {} closePanel(); },
    onOpen: function (url, kind) { try { window.streamoBridge.openExternal(url); } catch (e) {} closePanel(); },
    onPlay: function (url, item) { openPlayer(url, item && item.pageUrl); closePanel(); },
    onRenew: function (pageUrl, item) {
      if (!pageUrl) { toast('No source page for this link'); return; }
      var t = activeTab();
      if (t) {
        if (item && item.url) lastTestAt.delete(item.url);
        t.hostIntent = { etld: etld1(hostOf(pageUrl)), freshTs: Date.now() };
        t.view.src = pageUrl;
        toast('Re-capturing from the same page...');
      }
      try { closeMenu(); } catch (e) {}
      closePanel();
    },
    onOpenPage: function (pageUrl) { createTab(pageUrl); closePanel(); },
    onRefresh: function () { renderLinks(true); }
  };

  var searchActions = {
    onCopy: linkActions.onCopy,
    onOpen: function (url) { createTab(url); closePanel(); },
    onRefresh: function () { renderSearch(true); }
  };

  function renderLinks(force) {
    var all = window.StreamoStore.getLinks();
    var sig = JSON.stringify(all);
    linksCount.textContent = String(all.length);
    // Do not build hidden panel DOM on every captured link (300 cards churn CPU/RAM).
    if (!force && openSide !== 'links') { linksSignature = sig; return; }
    if (!force && sig === linksSignature) return;
    linksSignature = sig;
    window.StreamoPanelUI.mountLinks(linksListContent, linkActions);
  }
  function renderSearch(force) {
    var all = window.StreamoStore.getSearch();
    var sig = JSON.stringify(all);
    searchCount.textContent = String(all.length);
    if (!force && openSide !== 'search') { searchSignature = sig; return; }
    if (!force && sig === searchSignature) return;
    searchSignature = sig;
    window.StreamoPanelUI.mountSearch(searchListContent, searchActions);
  }
  function refreshSearchIfOpen() { if (openSide === 'search') renderSearch(true); }

  function openPanel(side) {
    if (openSide === side) { closePanel(); return; }
    openSide = side;
    clearAllNotifs(); // فتح أي لوحة — اخفي الإشعارات المُعلّقة على الإطلاق
    panelRight.classList.toggle('open', side === 'links');
    panelLeft.classList.toggle('open', side === 'search');
    panelTabs.classList.toggle('open', side === 'tabs');
    scrim.classList.add('show');
    if (side === 'links') { markBadgeSeen(); renderLinks(true); }
    else if (side === 'search') renderSearch(true);
    else if (side === 'tabs') renderTabsList();
  }
  function closePanel() {
    openSide = null;
    panelRight.classList.remove('open');
    panelLeft.classList.remove('open');
    panelTabs.classList.remove('open');
    scrim.classList.remove('show');
  }

  /** Close the player if it is open — first thing toolbar buttons do */
  function closePlayerIfOpen() {
    if (playerEl && playerEl.classList.contains('open')) closePlayer();
  }

  /* Menu popover — animated dropdown: Records + Tabs */
  var menuScrim = document.getElementById('menuScrim');
  function closeMenu() {
    if (menuPop) menuPop.classList.remove('open');
    if (btnMenu) btnMenu.classList.remove('active');
    if (menuScrim) menuScrim.classList.remove('show');
  }
  if (btnMenu && menuPop) {
    btnMenu.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var willOpen = !menuPop.classList.contains('open');
      if (willOpen) {
        menuPop.classList.add('open');
        btnMenu.classList.add('active');
        if (menuScrim) menuScrim.classList.add('show');
      }
      else closeMenu();
    });
    if (menuRecords) menuRecords.addEventListener('click', function () {
      closeMenu(); closePlayerIfOpen(); openPanel('search');
    });
    if (menuTabs) menuTabs.addEventListener('click', function () {
      closeMenu(); closePlayerIfOpen(); openPanel('tabs');
    });
    /* Clicking anywhere outside the popover closes it — with animation */
    if (menuScrim) menuScrim.addEventListener('click', closeMenu);
    document.addEventListener('click', function (ev) {
      if (!menuPop.classList.contains('open')) return;
      var t = ev.target;
      if (t && (menuPop.contains(t) || btnMenu.contains(t))) return;
      closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menuPop.classList.contains('open')) closeMenu();
    });
  }

  /* Real progress: the bar eases toward milestones the guest reports as the page loads
     (start → HTML response → DOM interactive → DOMContentLoaded → window load).
     Fallback: did-finish-load forces 100%. */
  var loadProgressTimer = null;
  var loadProgressVal = 0;
  var loadProgressTarget = 0;
  function setLoadProgress(v) {
    loadProgressVal = v;
    if (pillProgressBar) pillProgressBar.style.width = Math.max(0, Math.min(100, v)).toFixed(1) + '%';
  }
  function startLoadProgress() {
    if (loadProgressTimer) window.clearInterval(loadProgressTimer);
    loadProgressVal = 8;
    loadProgressTarget = 8;
    setLoadProgress(loadProgressVal);
    if (pillProgress) pillProgress.classList.add('active');
    loadProgressTimer = window.setInterval(function () {
      if (loadProgressVal < loadProgressTarget) {
        loadProgressVal = Math.min(loadProgressTarget, loadProgressVal + Math.max(0.5, (loadProgressTarget - loadProgressVal) * 0.16));
        setLoadProgress(loadProgressVal);
      }
    }, 50);
  }
  function setLoadPhase(phase) {
    var map = { start: 14, domLoading: 32, domInteractive: 55, domContentLoaded: 76, load: 100 };
    var v = map[phase];
    if (v == null) return;
    loadProgressTarget = v;
    if (v >= 100) finishLoadProgress();
  }
  function finishLoadProgress() {
    if (loadProgressTimer) { window.clearInterval(loadProgressTimer); loadProgressTimer = null; }
    loadProgressVal = 100;
    loadProgressTarget = 100;
    setLoadProgress(100);
    if (pillProgress) pillProgress.classList.add('active');
    window.setTimeout(function () {
      setLoadProgress(0);
      loadProgressVal = 0;
      loadProgressTarget = 0;
      if (pillProgress) pillProgress.classList.remove('active');
    }, 220);
  }

  document.getElementById('btnLinks').addEventListener('click', function () { closePlayerIfOpen(); openPanel('links'); });
  document.getElementById('closeLinks').addEventListener('click', closePanel);
  document.getElementById('closeSearch').addEventListener('click', closePanel);
  document.getElementById('closeTabs').addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);
  document.getElementById('newTabBtn').addEventListener('click', function () { closePlayerIfOpen(); createTab('https://www.google.com/'); closePanel(); });
  document.getElementById('closeAllTabsBtn').addEventListener('click', closeAllTabs);

  document.getElementById('clearLinksBtn').addEventListener('click', function () {
    window.StreamoPanelUI.armClearAll(this, 'links', function () { renderLinks(true); });
  });
  document.getElementById('clearSearchBtn').addEventListener('click', function () {
    window.StreamoPanelUI.armClearAll(this, 'search', function () { renderSearch(true); });
  });
  var creditLinks = document.querySelectorAll('.credit-link');
  for (var ci = 0; ci < creditLinks.length; ci++) {
    creditLinks[ci].addEventListener('click', function (ev) {
      ev.preventDefault();
      var url = this.getAttribute('data-url');
      if (url) window.streamoBridge.openExternal(url);
    });
  }

  setInterval(function () {
    if (openSide === 'links') renderLinks(false);
    else if (openSide === 'search') renderSearch(false);
  }, 1500);

  /* Housekeeping: these maps/sets served their purpose after a few seconds
     but were never pruned — harmless in a short test, a slow leak all day. */
  setInterval(function () {
    var now = Date.now();
    pendingTests.forEach(function (v, k) {
      if (!v || !v.tmp || now - v.tmp.ts > 30000) pendingTests.delete(k);
    });
    anchorClicks.forEach(function (v, k) {
      if (!v || now - v.ts > ANCHOR_INTENT_MS) anchorClicks.delete(k);
    });
    strikes.forEach(function (v, k) {
      if (now - v > STRIKE_MS) strikes.delete(k);
    });
    if (lastTestAt.size > 600) lastTestAt.clear();
    if (extractionLogged.size > 400) extractionLogged.clear();
  }, 60000);

  /* Editing mode — the pill morphs into a text field; back/forward/reload hide */
  var editMode = false;

  function setEditMode(on) {
    editMode = !!on;
    urlPill.classList.toggle('editing', editMode);
    if (editMode) {
      var t = activeTab();
      urlInput.value = (t && t.url) || '';
      urlPill.title = 'Type a URL or search - Enter to go';
      window.setTimeout(function () { try { urlInput.focus(); urlInput.select(); } catch (e) {} }, 30);
    } else {
      urlPill.title = 'Current page — click to search';
    }
  }

  /* The pill IS the search/edit affordance — clicking it morphs the pill into a
     text field prefilled with the current URL (in place, nothing hidden). */
  urlPill.addEventListener('click', function (ev) {
    if (editMode) return; // editing inside the address bar
    var t = ev.target;
    if (t && (btnBack === t || btnBack.contains(t) || btnForward === t || btnForward.contains(t) || urlReload === t || urlReload.contains(t) || urlHome === t || urlHome.contains(t))) return;
    setEditMode(true);
  });
  if (urlReload) {
    urlReload.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var v = activeView();
      urlReload.classList.remove('spinning');
      void urlReload.offsetWidth; // restart animation
      urlReload.classList.add('spinning');
      window.setTimeout(function () { urlReload.classList.remove('spinning'); }, 900);
      startLoadProgress();
      try { if (v && typeof v.reload === 'function') v.reload(); } catch (e) {}
    });
    urlReload.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.click(); }
    });
  }
  /* Home — jump to the app's homepage (Google) in the current tab */
  if (urlHome) {
    urlHome.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var t = activeTab();
      if (t) hostNavigate(t, 'https://www.google.com/');
      startLoadProgress();
    });
    urlHome.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.click(); }
    });
  }

  function isLikelyUrl(s) {
    if (/^https?:\/\//i.test(s)) return true;
    return /^[^\s\/]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(s);
  }

  function commitUrlEdit() {
    var raw = (urlInput.value || '').trim();
    if (!raw) { setEditMode(false); return; }
    var target;
    if (/^https?:\/\//i.test(raw)) target = raw;
    else if (isLikelyUrl(raw)) target = 'https://' + raw;
    else target = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
    var t = activeTab();
    if (t) hostNavigate(t, target);
    setEditMode(false);
  }

  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commitUrlEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditMode(false); }
  });
  urlInput.addEventListener('blur', function () { setEditMode(false); });

  /* Clicking anywhere outside the pill / search bar closes the edit or search state */
  function outsideChromeClick(ev) {
    var t = ev.target;
    if (editMode && urlPill && !(t && urlPill.contains(t))) setEditMode(false);
    if (searchBar && searchBar.style.display !== 'none' && t && !searchBar.contains(t)) exitSearchMode();
  }
  document.addEventListener('mousedown', outsideChromeClick, true);

  /* ================= Back / Forward ================= */
  function goBack() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (playerEl && playerEl.classList.contains('open')) { closePlayer(); return; }
    var v = activeView();
    if (v) { try { v.goBack(); } catch (e) {} }
  }
  function goForward() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (playerEl && playerEl.classList.contains('open')) { closePlayer(); return; }
    var v = activeView();
    if (v) { try { v.goForward(); } catch (e) {} }
  }
  btnBack.addEventListener('click', goBack);
  btnForward.addEventListener('click', goForward);

  /* comment */
  window.addEventListener('mouseup', function (e) {
    if (e.button === 3) { e.preventDefault(); goBack(); }
    else if (e.button === 4) { e.preventDefault(); goForward(); }
  });

  /* ================= Search mode ================= */
  function enterSearchMode() {
    closePanel();
    closePlayerIfOpen();
    normalBar.style.display = 'none';
    normalBar.classList.remove('bar-enter');
    searchBar.style.display = 'flex';
    searchBar.classList.remove('bar-leave');
    // comment
    void searchBar.offsetWidth;
    searchBar.classList.add('bar-enter');
    searchInput.value = '';
    searchInput.focus();
  }
  function exitSearchMode() {
    if (searchBar.style.display === 'none') return;
    searchBar.classList.remove('bar-enter');
    searchBar.classList.add('bar-leave');
    window.setTimeout(function () {
      if (searchBar.classList.contains('bar-leave')) {
        searchBar.style.display = 'none';
        searchBar.classList.remove('bar-leave');
        normalBar.style.display = 'flex';
        normalBar.classList.remove('bar-enter');
        void normalBar.offsetWidth;
        normalBar.classList.add('bar-enter');
      }
    }, 150);
  }

  /** The query goes to Google as-is — no forced "مشاهدة ... اونلاين" prefix. */
  function composeSearchQuery(text) {
    return String(text || '').trim();
  }

  function doSearch() {
    var q = composeSearchQuery(searchInput.value);
    if (!q) return;
    var t = activeTab();
    if (t) hostNavigate(t, 'https://www.google.com/search?q=' + encodeURIComponent(q));
    exitSearchMode();
  }

  /* The pill itself enters search mode — no dedicated search button anymore */
  document.getElementById('btnSearchBack').addEventListener('click', exitSearchMode);
  document.getElementById('btnDoSearch').addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch();
    else if (e.key === 'Escape') exitSearchMode();
  });

  /* ================= Link capture from main ================= */
  /* A movie's capture fires many times per second; testing every repeat with the full
     HLS chain each time made captures wait forever. We test once per movie per 60s —
     the result (and the merged entry) is good enough for everything else that arrives
     in between. */
  var PROBE_CACHE_MS = 60 * 1000;
  var recentProbeAt = new Map();
  function movieKeyOf(u) {
    try { var k = window.StreamoStore.movieKeyFor; return k ? k(String(u || '')) : ''; } catch (e) { return ''; }
  }

  if (window.streamoBridge.onLinkFound) {
    window.streamoBridge.onLinkFound(function (payload) {
      var url = payload && payload.url;
      if (!url) return;
      var activeForPage = activeTab();
      var tabId = payload.tabId;
      var reqInitiator = (typeof payload.initiator === 'string' && payload.initiator) ? payload.initiator : '';
      var pageUrl =
        (payload.pageUrl && payload.pageUrl) ||
        (tabId != null && pageByWebContents.get(tabId)) ||
        (tabId != null && urlByTab.get(tabId)) ||
        reqInitiator ||
        (activeForPage && activeForPage.url) || '';

      var now = Date.now();
      var tmpEntry = {
        id: 'pending-' + now.toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36),
        url: url,
        type: (window.StreamoStore.guessType ? window.StreamoStore.guessType(url) : 'unknown'),
        size: null, httpStatus: null, contentType: null, duration: null,
        status: 'testing', error: null, via: null, finalUrl: null,
        pageUrl: pageUrl, ts: now, testedAt: null
      };
      pendingTests.set(url, { tmp: tmpEntry, pageUrl: pageUrl, cardShown: !suppressCard });
      lastTestAt.set(url, now);
      if (pendingTests.size > 80) {
        var oldestPending = pendingTests.keys().next();
        if (!oldestPending.done) pendingTests.delete(oldestPending.value);
      }
      if (lastTestAt.size > 600) lastTestAt.clear();

      // One card per movie per 2-minute window — a capture burst shows ONE card;
      // same-movie followups stay silent. New movies always get their card.
      var movieKey = '';
      try { var keyOf = window.StreamoStore.movieKeyFor; if (keyOf) movieKey = keyOf(url) || ''; } catch (e) {}
      var suppressCard = false;
      if (movieKey) {
        var sinceLast = now - (movieNotifyAt.get(movieKey) || 0);
        if (sinceLast < MOVIE_NOTIFY_WINDOW_MS) suppressCard = true;
        else {
          movieNotifyAt.set(movieKey, now);
          if (movieNotifyAt.size > 1500) {
            // keep the map bounded — drop entries older than the window
            var cutoff = now - MOVIE_NOTIFY_WINDOW_MS;
            movieNotifyAt.forEach(function (ts, k) { if (ts < cutoff) movieNotifyAt.delete(k); });
          }
        }
      }

      // comment
      if (!suppressCard) addMiniCard(tmpEntry);

      // comment
      runLinkTest(url, pageUrl);
    });
  }

  /* comment */
  function applyTestResult(r) {
    if (!r || !r.url) return;
    var url = r.url;
    var ok = r.status === 'ok';
    var pending = pendingTests.get(url) || null;
    var entryId = pending ? pending.tmp.id : null;

    if (pending) { pendingTests.delete(url); }

    if (ok) {
      // comment
      var res = window.StreamoStore.addLink(url, pending ? (pending.pageUrl || '') : '', { isMaster: r.isMaster === true });
      var entry = res && res.entry ? res.entry : null;
      var targetId = entry ? entry.id : null;
      var patch = {
        status: 'ok',
        type: r.type || 'unknown',
        size: (r.size === undefined ? null : r.size),
        httpStatus: (r.httpStatus === undefined ? null : r.httpStatus),
        contentType: (r.contentType === undefined ? null : r.contentType),
        duration: (r.duration === undefined ? null : r.duration),
        via: (r.via === undefined ? null : r.via),
        finalUrl: (r.finalUrl === undefined ? null : r.finalUrl),
        error: (r.error === undefined ? null : r.error),
        isMaster: r.isMaster === true || (entry && entry.isMaster === true),
        probeV: 2
      };
      if (targetId) window.StreamoStore.updateLink(targetId, patch);
      // A merged duplicate is not a "new link" — let its card vanish quietly instead of flashing "Link captured"
      var mergedDup = !!(res && res.merged);
      if (mergedDup) {
        if (entryId) {
          var dupCard = notifStack.querySelector('.notif[data-entry="' + entryId + '"]');
          if (dupCard) flingNotif(dupCard);
        }
      } else {
        if (entryId) updateMiniCard(entryId, true);
      }
      // Records only for a successful capture whose card actually showed — silent
      // bursts (card suppressed) and failed links never reach the history panel.
      if (pending && pending.cardShown && pending.pageUrl && !extractionLogged.has(pending.pageUrl)) {
        if (extractionLogged.size > 400) extractionLogged.clear();
        extractionLogged.add(pending.pageUrl);
        window.StreamoStore.addSearch(pending.pageUrl, pending.pageUrl, 'Capture');
        refreshSearchIfOpen();
      }
      refreshLinkBadge();
      renderLinks(false);
      return;
    }

    // comment
    try { window.StreamoStore.removeLinkByUrl(url); } catch (e) {}
    if (entryId) updateMiniCard(entryId, false);
    renderLinks(false);
  }

  function runLinkTest(url, pageUrl) {
    var movieKey = movieKeyOf(url);
    if (movieKey) {
      var last = recentProbeAt.get(movieKey) || 0;
      if (Date.now() - last < PROBE_CACHE_MS) {
        // Same movie tested moments ago — the stored/merged entry carries fresh data
        return Promise.resolve();
      }
      recentProbeAt.set(movieKey, Date.now());
      if (recentProbeAt.size > 200) {
        var cutoff = Date.now() - PROBE_CACHE_MS;
        recentProbeAt.forEach(function (ts, k) { if (ts < cutoff) recentProbeAt.delete(k); });
      }
    }
    try {
      if (window.streamoBridge.testLink) {
        var p = window.streamoBridge.testLink(url, pageUrl || '').then(applyTestResult, function () {
          applyTestResult({ url: url, status: 'fail', error: 'NETWORK' });
        });
        return p;
      }
    } catch (e) {}
    applyTestResult({ url: url, status: 'fail', error: 'NO_BRIDGE' });
    return Promise.resolve();
  }

  /* New windows policy: same-domain -> new tab, blocked otherwise. */
  if (window.streamoBridge.onPopup) {
    window.streamoBridge.onPopup(function (payload) {
      if (!payload) return;
      var dest = typeof payload.url === 'string' ? payload.url : '';
      if (!isHttp(dest)) return; // blob: / javascript: / file: -> blocked
      var srcPage = (typeof payload.srcUrl === 'string' && payload.srcUrl)
        || (payload.wcId != null && (pageByWebContents.get(payload.wcId) || urlByTab.get(payload.wcId)))
        || (activeTab() && activeTab().url) || '';
      var dHost = hostOf(dest);
      var d = etld1(dHost);
      var c = etld1(hostOf(srcPage || ''));
      if (d && c && d === c) { createTab(dest); return; }           // same site -> open in a tab
      if (isGoogleHost(hostOf(srcPage || '')) && isGoogleHost(dHost)) { createTab(dest); return; }
      // comment
    });
  }

  /* comment */
  if (window.streamoBridge.onSeenPage) {
    window.streamoBridge.onSeenPage(function (payload) {
      if (!payload || payload.wcId == null) return;
      if (typeof payload.href !== 'string' || !/^https?:\/\//i.test(payload.href)) return;
      pageByWebContents.set(payload.wcId, payload.href);
      if (pageByWebContents.size > 120) {
        var first = pageByWebContents.keys().next();
        if (!first.done) pageByWebContents.delete(first.value);
      }
    });
  }

  /* Any mouse-down inside the guest page → close the popover, and any open panel */
  if (window.streamoBridge.onGuestClick) {
    window.streamoBridge.onGuestClick(function () {
      try { closeMenu(); } catch (e) {}
      try { if (openSide) closePanel(); } catch (e) {}
    });
  }
  /* Real page-load milestones from the guest → drive the toolbar progress line */
  if (window.streamoBridge.onLoadPhase) {
    window.streamoBridge.onLoadPhase(function (payload) {
      try { setLoadPhase(payload && payload.phase); } catch (e) {}
    });
  }
  /* A guest tab process died (crash) — revive the same tab in place instead of
     opening a duplicate every time. After 3 crashes in 2 minutes we leave it
     asleep and let the user click it to retry (stops crash/oom loops). */
  if (window.streamoBridge.onGuestGone) {
    window.streamoBridge.onGuestGone(function (payload) {
      try {
        var wcId = payload && payload.wcId;
        if (wcId == null) return;
        var tab = null;
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].webContentsId === wcId) { tab = tabs[i]; break; }
        }
        if (!tab || tab.sleeping) return;
        var wasActive = tab.id === activeTabId;
        var now = Date.now();
        if (!tab.lastCrashAt || now - tab.lastCrashAt > 120000) tab.crashCount = 0;
        tab.crashCount = (tab.crashCount || 0) + 1;
        tab.lastCrashAt = now;
        var reason = (payload && payload.reason) || 'crash';
        console.log('[tab-gone] tab crashed reason=' + reason + ' count=' + tab.crashCount);
        destroyTabView(tab);
        if (wasActive && tab.crashCount <= 3) {
          toast('A tab crashed - reloading it');
          activateTab(tab.id);
        } else if (wasActive) {
          toast('Tab crashed 3 times - click it to retry');
          updateUrlPill(tab);
          updateBackForward(tab);
          renderTabsList();
        } else {
          renderTabsList();
        }
      } catch (e) { console.error('[tab-gone] handler failed', e); }
    });
  }

  /* Live memory report from the main process — sleep hidden tabs before the OS freezes. */
  if (window.streamoBridge.onMemory) {
    window.streamoBridge.onMemory(function (info) {
      try { memoryGovernor(info); } catch (e) { console.error('[memory] governor failed', e); }
    });
  }

  /* Rescue: swallowed-click intent (same-domain) -> new tab */
  if (window.streamoBridge.onNavIntent) {
    window.streamoBridge.onNavIntent(function (payload) {
      if (!payload) return;
      var dest = typeof payload.href === 'string' ? payload.href : '';
      if (!isHttp(dest)) return;
      if (!payload.prevented) return; // the page did not prevent default
      var srcPage = (payload.wcId != null && (pageByWebContents.get(payload.wcId) || urlByTab.get(payload.wcId)))
        || (activeTab() && activeTab().url) || '';
      var dHost = hostOf(dest);
      var d = etld1(dHost);
      var c = etld1(hostOf(srcPage || ''));
      if (d && c && d === c) { createTab(dest); toast('Opened in new tab'); return; }
      if (isGoogleHost(hostOf(srcPage || '')) && isGoogleHost(dHost)) { createTab(dest); return; }
      // comment
    });
  }

  /* comment */
  if (window.streamoBridge.onAnchorClick) {
    window.streamoBridge.onAnchorClick(function (payload) {
      if (!payload || !payload.href) return;
      var wcId = payload.wcId;
      var etld = etld1(hostOf(payload.href));
      if (wcId == null || !etld) return;
      anchorClicks.set(wcId, { etld: etld, ts: Date.now() });
      trimAnchorMap();
    });
  }

  /* comment */
  var playerEl = document.getElementById('player');
  var playerStage = document.getElementById('playerStage');
  var playerVideo = document.getElementById('playerVideo');
  var playerTitle = document.getElementById('playerTitle');
  var playerToggle = document.getElementById('playerToggle');
  var iconPlay = document.getElementById('iconPlay');
  var iconPause = document.getElementById('iconPause');
  var playerTime = document.getElementById('playerTime');
  var progress = document.getElementById('progress');
  var progressTrack = document.getElementById('progressTrack');
  var progressFill = document.getElementById('progressFill');
  var progressThumb = document.getElementById('progressThumb');
  var progressTooltip = document.getElementById('progressTooltip');
  var playerSkipBack = document.getElementById('playerSkipBack');
  var playerSkipForward = document.getElementById('playerSkipForward');
  var playerTapFlash = document.getElementById('playerTapFlash');
  var tapFlashIcon = document.getElementById('tapFlashIcon');
  var playerRetry = document.getElementById('playerRetry');
  var playerClose = document.getElementById('playerClose');
  var playerFullscreenBtn = document.getElementById('playerFullscreen');
  var shakaPlayer = null;
  var currentPlayerUrl = '';
  var tapFlashTimer = null;
  var controlsTimer = null;
  var controlsDismissedByUser = false;
  var seeking = false;
  var seekPreview = null;       // seconds during drag
  var seekDraggingPointer = null;

  // comment
  try { if (window.shaka && window.shaka.polyfill && window.shaka.polyfill.installAll) window.shaka.polyfill.installAll(); } catch (e) {}

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  }
  function setPlayIcon(playing) {
    iconPlay.style.display = playing ? 'none' : '';
    iconPause.style.display = playing ? '' : 'none';
  }
  function isManifest(url) {
    return /\.m3u8(\?|#|$)/i.test(url || ''); // DASH is never offered (downloads, not streaming)
  }
  function setPlayerLoading(on) { playerEl.classList.toggle('loading', !!on); }
  function setPlayerError(on) { playerEl.classList.toggle('error', !!on); }

  /* comment */
  function currentDuration() {
    var d = playerVideo.duration;
    return isFinite(d) && d > 0 ? d : 0;
  }
  function setProgressPercent(percent) {
    var p = Math.max(0, Math.min(100, percent));
    progressTrack.style.setProperty('--p', p + '%');
    progress.setAttribute('aria-valuenow', String(Math.round(p)));
  }
  function shownTime() {
    return seekPreview != null ? seekPreview : (isFinite(playerVideo.currentTime) ? playerVideo.currentTime : 0);
  }
  function currentSeekPercent() {
    var dur = currentDuration();
    return dur > 0 ? (shownTime() / dur) * 100 : 0;
  }
  function renderProgressFromPreview(preview) {
    var dur = currentDuration();
    if (seekTooltipPosition(preview)) { /* position already set */ }
    setProgressPercent(seekPreviewToPercent(preview));
  }
  function seekPreviewToPercent(preview) {
    var dur = currentDuration();
    return dur > 0 ? (preview / dur) * 100 : 0;
  }
  function seekFromClientX(clientX) {
    var rect = progressTrack.getBoundingClientRect();
    var dur = currentDuration();
    var ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    ratio = Math.max(0, Math.min(1, ratio));
    return dur > 0 ? ratio * dur : 0;
  }
  function seekTooltipPosition(seconds) {
    var dur = currentDuration();
    if (dur <= 0 || !isFinite(seconds)) return null;
    var ratio = Math.max(0, Math.min(1, seconds / dur));
    progressTooltip.style.left = (ratio * 100).toFixed(2) + '%';
    progressTooltip.textContent = fmtTime(seconds);
    return ratio;
  }
  function syncSeekPosition(pct) {
    var p = Math.max(0, Math.min(100, pct));
    progressTrack.style.setProperty('--p', p.toFixed(1) + '%');
    progressTooltip.style.left = p.toFixed(2) + '%';
    progress.setAttribute('aria-valuenow', String(Math.round(p)));
  }

  progressTrack.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    seeking = true;
    seekDraggingPointer = e.pointerId;
    try { progressTrack.setPointerCapture(e.pointerId); } catch (err) {}
    progress.classList.add('dragging');
    seekPreview = seekFromClientX(e.clientX);
    seekTooltipPosition(seekPreview);
    syncSeekPosition(seekPreviewToPercent(seekPreview));
  });
  progressTrack.addEventListener('pointermove', function (e) {
    if (seeking) {
      seekPreview = seekFromClientX(e.clientX);
      seekTooltipPosition(seekPreview);
      syncSeekPosition(seekPreviewToPercent(seekPreview));
    } else {
      // comment
      var t = seekFromClientX(e.clientX);
      seekTooltipPosition(t);
    }
  });
  function commitSeek() {
    if (!seeking) return;
    seeking = false;
    progress.classList.remove('dragging');
    var target = seekPreview;
    seekPreview = null;
    if (target != null && isFinite(target)) {
      try { playerVideo.currentTime = target; } catch (e) {}
    }
    syncSeekPosition(currentSeekPercent());
  }
  progressTrack.addEventListener('pointerup', commitSeek);
  progressTrack.addEventListener('pointercancel', commitSeek);
  progressTrack.addEventListener('lostpointercapture', commitSeek);
  progressTrack.addEventListener('mouseleave', function () {
    if (!seeking) progressTooltip.style.display = '';
  });
  progressTrack.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 30 : 10;
    if (e.key === 'ArrowLeft') { e.preventDefault(); playerVideo.currentTime = Math.max(0, playerVideo.currentTime - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); playerVideo.currentTime = Math.min(currentDuration(), playerVideo.currentTime + step); }
  });

  /* ===== Lifecycle ===== */
  var currentPlayerPage = '';
  var playerAbort = null;
  var playerGeneration = 0;
  var mediaProxy = null;

  /** Normal HTTP URL on the loopback proxy (port + token from the main process). */
  function mediaProxyUrl(target, withCap) {
    if (!mediaProxy || !mediaProxy.port) return null;
    var r = '';
    try { r = currentPlayerPage ? new URL(currentPlayerPage).origin + '/' : ''; } catch (e) { r = ''; }
    return 'http://127.0.0.1:' + mediaProxy.port + '/p/' + mediaProxy.token +
      '?u=' + encodeURIComponent(String(target || '')) +
      (r ? '&r=' + encodeURIComponent(r) : '') +
      (withCap ? '&cap=1' : '');
  }
  function destroyShaka() {
    if (!shakaPlayer) return;
    try { shakaPlayer.destroy(); } catch (e) {}
    shakaPlayer = null;
  }

  function abortPlayerNetwork() {
    if (!playerAbort) return;
    try { playerAbort.abort(); } catch (e) {}
    playerAbort = null;
  }

  function proxiedUrl(url) {
    // MP4 fallback: <video> plays cross-origin without CORS; the loopback proxy is preferred (Referer attached)
    var local = mediaProxyUrl(url, false);
    if (local) return local;
    return String(url || '');
  }

  /* ===== Load watchdog =====
     An HLS link on a very slow CDN still delivers bytes — that is not an error.
     The watchdog only fires when NOTHING moves for 45 seconds, or when the
     absolute ceiling of 2 minutes passes, or when readyState reaches 3. */
  var loadWatch = { timer: null, lastProgressAt: 0, lastBytes: -1, openedAt: 0 };
  var playerLoadSub = null;

  function loadProgressBytes() {
    try {
      if (!shakaPlayer) return -1;
      var st = shakaPlayer.getStats ? shakaPlayer.getStats() : null;
      var b = Number(st && st.bytesDownloaded);
      return isFinite(b) ? b : -1;
    } catch (e) { return -1; }
  }
  function clearLoadWatch() {
    if (loadWatch.timer) { try { window.clearInterval(loadWatch.timer); } catch (e) {} }
    loadWatch.timer = null;
  }
  function updateLoadSub() {
    if (!playerLoadSub) { try { playerLoadSub = document.getElementById('playerLoadSub'); } catch (e) {} }
    if (!playerLoadSub) return;
    var b = loadProgressBytes();
    if (b < 0) { playerLoadSub.textContent = 'Buffering the stream'; return; }
    playerLoadSub.textContent = 'Downloaded ' + (b / 1048576).toFixed(1) + ' MB';
  }
  function startLoadWatch(gen, onSettledOk, onSettledErr) {
    clearLoadWatch();
    loadWatch.lastProgressAt = Date.now();
    loadWatch.lastBytes = Math.max(0, loadProgressBytes());
    loadWatch.openedAt = Date.now();
    loadWatch.timer = window.setInterval(function () {
      if (gen !== playerGeneration) { clearLoadWatch(); return; }
      if (playerVideo.readyState >= 3) { onSettledOk(); return; }
      var b = loadProgressBytes();
      if (b >= 0 && b > loadWatch.lastBytes) {
        loadWatch.lastBytes = b;
        loadWatch.lastProgressAt = Date.now();
        updateLoadSub();
        return;
      }
      var now = Date.now();
      if (now - loadWatch.lastProgressAt > 45000) { onSettledErr(); return; }  // no bytes for 45s
      if (now - loadWatch.openedAt > 120000) { onSettledErr(); }              // absolute 2-minute ceiling
    }, 1000);
  }

  function openPlayer(url, pageUrl) {
    // A Retry press used to build a second shaka.Player on the same <video>
    // without destroying the first one — every retry kept a full buffer alive.
    destroyShaka();
    abortPlayerNetwork();
    var gen = ++playerGeneration;
    try { playerAbort = new AbortController(); } catch (e) { playerAbort = null; }

    currentPlayerPage = pageUrl || '';
    currentPlayerUrl = url || '';
    playerTitle.textContent = url || '';
    playerEl.classList.add('open');
    playerEl.setAttribute('aria-hidden', 'false');
    playerEl.classList.remove('controls-hidden');
    setPlayerError(false);
    setPlayerLoading(true);
    try { playerLoadSub = document.getElementById('playerLoadSub'); if (playerLoadSub) playerLoadSub.textContent = 'Buffering the stream'; } catch (e) {}
    playerVideo.pause();
    playerVideo.removeAttribute('src');
    playerVideo.load();
    playerTime.textContent = '0:00 / 0:00';
    syncSeekPosition(0);

    var settled = false;
    // The watchdog (below) decides failure; an HLS master on a slow CDN can take
    // minutes to fill the buffer and that is still a healthy load.
    function settleOk() {
      if (gen !== playerGeneration) return;
      if (settled) return;
      settled = true;
      clearLoadWatch();
      setPlayerLoading(false);
      setPlayerError(false);
      // Data is in the buffer — a play() issued at src-set time may have been
      // interrupted before the pipeline was ready; retry now (user can still tap to toggle).
      try { playerVideo.play().catch(function () {}); } catch (e) {}
    }
    function settleErr() {
      if (gen !== playerGeneration) return; // a newer open/close owns the player now
      // A late failure must never cover a stream that already plays.
      if (playerVideo.readyState >= 3 && !playerVideo.paused && playerVideo.currentTime > 0) {
        settled = true;
        clearLoadWatch();
        setPlayerLoading(false);
        setPlayerError(false);
        return;
      }
      settled = true;
      clearLoadWatch();
      setPlayerLoading(false);
      setPlayerError(true);
      playerEl.classList.remove('controls-hidden'); // keep Close reachable
      // Kill the media pipeline COMPLETELY — no audio behind the error screen
      try { playerVideo.pause(); playerVideo.removeAttribute('src'); playerVideo.load(); } catch (e) {}
      destroyShaka();          // release every buffered segment now
      abortPlayerNetwork();
    }

    playerVideo.volume = 1;

    if (isManifest(url) && window.shaka && window.shaka.Player && (window.shaka.Player.isBrowserSupported ? window.shaka.Player.isBrowserSupported() : true)) {
      try {
        shakaPlayer = new shaka.Player();
        try {
          shakaPlayer.configure({
            streaming: { bufferingGoal: 8, rebufferingGoal: 2, bufferBehind: 10 },
            abr: { useNetworkInformation: false, defaultBandwidthEstimate: 500000, restrictions: { maxHeight: 1080 } }
          });
        } catch (e) {}

        // Every manifest AND segment request goes through the local HTTP proxy:
        // same-site Referer/Origin, Range forwarded, CORS allowed, byte-capped.
        function proxyFor(uri) {
          var local = mediaProxyUrl(uri, true);
          if (local) return local;
          return null; // proxy unavailable — the filter leaves the URI alone (direct fetch attempt)
        }
        shakaPlayer.attach(playerVideo).then(function () {
          // getNetworkingEngine() is null before attach(), so the filter must be
          // registered here — otherwise shaka fetches the CDN directly, CORS fails
          // and the player sits on "Loading" forever.
          try {
            var net = shakaPlayer.getNetworkingEngine();
            if (net) {
              net.registerRequestFilter(function (type, request) {
                try {
                  var list = (request && request.uris) || [];
                  var out = [];
                  for (var i = 0; i < list.length; i++) {
                    var uri = list[i];
                    var alreadyProxied = mediaProxy && mediaProxy.port &&
                      uri.indexOf('http://127.0.0.1:' + mediaProxy.port + '/p/') === 0;
                    if (alreadyProxied) { out.push(uri); continue; }
                    if (/^https?:\/\//i.test(uri)) {
                      var proxied = proxyFor(uri);
                      out.push(proxied || uri);
                    } else {
                      out.push(uri);
                    }
                  }
                  if (out.length) request.uris = out;
                } catch (e) {}
              });
            }
          } catch (e) {}
          return shakaPlayer.load(url);
        }).then(function () {
          settleOk();
          playerVideo.play().catch(function () {});
        }).catch(function () {
          settleErr();
        });
        shakaPlayer.addEventListener('error', function () {
          settleErr();
        });
      } catch (e) {
        playerVideo.src = proxiedUrl(url);
        playerVideo.addEventListener('loadedmetadata', settleOk, { once: true });
        playerVideo.addEventListener('canplay', settleOk, { once: true });
        playerVideo.addEventListener('error', settleErr, { once: true });
        playerVideo.play().catch(function () {});
      }
    } else {
      playerVideo.src = proxiedUrl(url);
      playerVideo.addEventListener('loadedmetadata', settleOk, { once: true });
      playerVideo.addEventListener('canplay', settleOk, { once: true });
      playerVideo.addEventListener('error', settleErr, { once: true });
      playerVideo.play().catch(function () {});
    }
    startLoadWatch(gen, settleOk, settleErr);
    setPlayIcon(true);
  }

  /* Playback can start long after the request: clear the overlay whenever it does. */
  playerVideo.addEventListener('playing', function () {
    setPlayerLoading(false);
    setPlayerError(false);
  });
  playerVideo.addEventListener('canplay', function () {
    setPlayerLoading(false);
  });
  /* Any byte arriving at the <video> element is proof of life for the load watchdog
     (covers the MP4 path where shaka stats are unavailable). */
  playerVideo.addEventListener('progress', function () {
    if (loadWatch.timer) { loadWatch.lastProgressAt = Date.now(); updateLoadSub(); }
  });

  function closePlayer() {
    try {
      playerGeneration++; // invalidate every pending settle/timeout of the old stream
      clearLoadWatch();
      playerVideo.pause();
      destroyShaka();
      abortPlayerNetwork();
      playerVideo.removeAttribute('src');
      playerVideo.load();
      playerEl.classList.remove('open');
      playerEl.setAttribute('aria-hidden', 'true');
      playerEl.classList.remove('loading', 'error');
      playerEl.classList.remove('controls-hidden');
      setPlayIcon(false);
      if (controlsTimer) { window.clearTimeout(controlsTimer); controlsTimer = null; }
      // The heavy media is gone; let the main process drop the Chromium media cache now
      try { if (window.streamoBridge && window.streamoBridge.notifyPlayerClosed) window.streamoBridge.notifyPlayerClosed(); } catch (e) {}
    } catch (e) {}
  }

  /* ===== Controls show/hide + auto-hide ===== */
  function showControls() {
    playerEl.classList.remove('controls-hidden');
    scheduleControlsHide();
  }
  function hideControls() {
    if (seeking) return; // comment
    playerEl.classList.add('controls-hidden');
  }
  function scheduleControlsHide() {
    if (controlsTimer) window.clearTimeout(controlsTimer);
    if (!playerVideo.paused && !playerEl.classList.contains('controls-hidden')) {
      controlsTimer = window.setTimeout(hideControls, 3800);
    }
  }
  playerStage.addEventListener('mousemove', function () {
    if (controlsDismissedByUser) return;
    showControls();
  });
  playerStage.addEventListener('mouseleave', function () {
    if (playerVideo.paused) return;
    if (controlsTimer) window.clearTimeout(controlsTimer);
    controlsTimer = window.setTimeout(hideControls, 900);
  });

  /* ===== Inputs ===== */
  function togglePlayPause() {
    if (playerVideo.paused) playerVideo.play().catch(function () {});
    else playerVideo.pause();
  }
  function seekDelta(delta) {
    var dur = currentDuration();
    playerVideo.currentTime = Math.max(0, Math.min(dur || 0, playerVideo.currentTime + delta));
  }
  if (playerToggle) playerToggle.addEventListener('click', function () { togglePlayPause(); });
  if (playerSkipBack) playerSkipBack.addEventListener('click', function () { seekDelta(-10); });
  if (playerSkipForward) playerSkipForward.addEventListener('click', function () { seekDelta(+10); });
  if (playerFullscreenBtn) playerFullscreenBtn.addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    var target = playerEl.requestFullscreen ? playerEl : (document.documentElement.requestFullscreen ? document.documentElement : null);
    if (target && target.requestFullscreen) target.requestFullscreen().catch(function () {});
  });
  if (playerRetry) playerRetry.addEventListener('click', function () { if (currentPlayerUrl) openPlayer(currentPlayerUrl, currentPlayerPage); });
  if (playerClose) playerClose.addEventListener('click', closePlayer);
  var playerErrorBack = document.getElementById('playerErrorBack');
  if (playerErrorBack) playerErrorBack.addEventListener('click', closePlayer);

  function flashTap(kind) {
    if (!playerTapFlash || !tapFlashIcon) return;
    tapFlashIcon.innerHTML = kind === 'play'
      ? '<path d="M8 5v14l11-7z"/>'
      : '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
    playerTapFlash.classList.remove('flash-on');
    void playerTapFlash.offsetWidth; // restart the flash animation
    playerTapFlash.classList.add('flash-on');
    if (tapFlashTimer) window.clearTimeout(tapFlashTimer);
    tapFlashTimer = window.setTimeout(function () { playerTapFlash.classList.remove('flash-on'); }, 460);
  }

  /* comment */
  playerStage.addEventListener('click', function (e) {
    // comment
    if (e.target.closest('.progress') || e.target.closest('.player-bottom') || e.target.closest('.player-top') || e.target.closest('.player-error') || e.target.closest('.player-loading')) return;
    var rect = playerStage.getBoundingClientRect();
    var x = (e.clientX - rect.left) / Math.max(1, rect.width);
    var y = (e.clientY - rect.top) / Math.max(1, rect.height);
    var isCenter = x > 0.32 && x < 0.68 && y > 0.24 && y < 0.76;
    if (isCenter) {
      togglePlayPause();
      flashTap(playerVideo.paused ? 'pause' : 'play');
      scheduleControlsHide();
    } else {
      if (playerEl.classList.contains('controls-hidden')) {
        controlsDismissedByUser = false;
        playerEl.classList.remove('controls-hidden');
        scheduleControlsHide();
      } else {
        controlsDismissedByUser = true;
        playerEl.classList.add('controls-hidden');
      }
    }
  });
  playerStage.addEventListener('dblclick', function (e) {
    if (e.target.closest('.progress') || e.target.closest('.player-bottom') || e.target.closest('.player-top') || e.target.closest('.player-error') || e.target.closest('.player-loading')) return;
    if (playerFullscreenBtn) playerFullscreenBtn.click();
  });

  playerVideo.addEventListener('play', function () { setPlayIcon(true); setPlayerLoading(false); scheduleControlsHide(); });
  playerVideo.addEventListener('pause', function () { setPlayIcon(false); if (controlsTimer) { window.clearTimeout(controlsTimer); } showControls(); });
  playerVideo.addEventListener('loadstart', function () { setPlayerLoading(true); });
  playerVideo.addEventListener('waiting', function () { setPlayerLoading(true); });
  playerVideo.addEventListener('playing', function () { setPlayerLoading(false); scheduleControlsHide(); });
  playerVideo.addEventListener('timeupdate', function () {
    playerTime.textContent = fmtTime(playerVideo.currentTime) + ' / ' + fmtTime(playerVideo.duration);
    if (!seeking) syncSeekPosition(currentSeekPercent());
  });
  playerVideo.addEventListener('loadedmetadata', function () {
    playerTime.textContent = '0:00 / ' + fmtTime(playerVideo.duration);
    if (isFinite(playerVideo.duration)) progress.setAttribute('aria-valuemax', String(Math.round(playerVideo.duration)));
  });
  playerVideo.addEventListener('durationchange', function () {
    if (isFinite(playerVideo.duration) && !seeking) syncSeekPosition(currentSeekPercent());
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) return;
  });

  /* ================= Keyboard ================= */
  document.addEventListener('keydown', function (e) {
    // comment
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'Left')) { e.preventDefault(); goBack(); return; }
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'Right')) { e.preventDefault(); goForward(); return; }
    if (e.key === 'Escape') {
      if (document.fullscreenElement) return; // fullscreen exit is the browser's job
      if (playerEl.classList.contains('open')) { closePlayer(); return; }
      if (searchBar.style.display !== 'none') { exitSearchMode(); return; }
      if (editMode) { setEditMode(false); return; }
      closePanel();
    }
  });

  /* ================= Boot ================= */
  /* Local automation/debug hook — drives the player from CDP during memory debugging. */
  try {
    window.__streamoDebug = {
      openPlayer: function (url, pageUrl) { openPlayer(url, pageUrl || ''); },
      closePlayer: closePlayer,
      links: function () { return window.StreamoStore.getLinks(); },
      tabs: function () { return tabs.map(function (t) { return { id: t.id, url: t.url, sleeping: !!t.sleeping, wc: t.webContentsId }; }); },
      mem: function () { return lastMemInfo; },
      player: function () {
        var buf = [];
        try { for (var i = 0; i < playerVideo.buffered.length; i++) buf.push([playerVideo.buffered.start(i), playerVideo.buffered.end(i)]); } catch (e) {}
        var stats = null;
        try { stats = shakaPlayer ? shakaPlayer.getStats() : null; } catch (e) {}
        return {
          open: playerEl.classList.contains('open'),
          error: playerEl.classList.contains('error'),
          loading: playerEl.classList.contains('loading'),
          url: currentPlayerUrl,
          time: playerVideo.currentTime,
          duration: playerVideo.duration,
          buffered: buf,
          shaka: !!shakaPlayer,
          stats: stats,
          ready: playerVideo.readyState,
          network: playerVideo.networkState,
          mediaError: playerVideo.error ? playerVideo.error.code : null,
          currentSrc: String(playerVideo.currentSrc || '').slice(0, 120)
        };
      },
      mediaProxy: function () { return mediaProxy; }
    };
  } catch (e) {}

  /* Restore the previous session. consumeCrashFlag() returns true exactly once —
     after a forced UI kill every tab boots asleep and a fresh tab opens, so the
     OOM page is never re-loaded into a freeze loop. */
  function bootSession(crashed) {
    if (!restoreSession(!!crashed)) createTab('https://www.google.com/');
  }
  try {
    if (window.streamoBridge.getMediaProxy) {
      window.streamoBridge.getMediaProxy().then(function (info) {
        if (info && info.port) mediaProxy = info;
      }).catch(function () {});
    }
  } catch (e) {}
  if (window.streamoBridge.consumeCrashFlag) {
    try {
      window.streamoBridge.consumeCrashFlag().then(function (crashed) {
        bootSession(crashed === true);
      }, function () { bootSession(false); });
    } catch (e) { bootSession(false); }
  } else {
    bootSession(false);
  }
  window.addEventListener('beforeunload', saveSession);
  setInterval(saveSession, 5000);
  /* The main process asks for a final synchronous flush on quit (before-quit). */
  try {
    if (window.streamoBridge.onFlushSession) {
      window.streamoBridge.onFlushSession(function () { saveSession(); });
    }
  } catch (e) {}
  renderLinks(false);
  refreshLinkBadge();
  /* One-time migration: links stored by older builds were probed with a weaker check.
     Re-test them one at a time (the CDN is slow) — anything that fails the deep media
     check (e.g. disguised-ad playlists composed of CDN images) is removed entirely,
     and same-movie duplicates merge keeping the best (master) entry. */
  try {
    var staleLinks = window.StreamoStore.getLinks().filter(function (l) {
      return l && l.status === 'ok' && l.probeV !== 2;
    });
    var chain = Promise.resolve();
    staleLinks.forEach(function (l) {
      chain = chain.then(function () { return runLinkTest(l.url, l.pageUrl || ''); });
    });
  } catch (e) {}
})();
