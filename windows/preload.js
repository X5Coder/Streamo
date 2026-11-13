/*
 * Streamo — renderer preload (contextIsolation on).
 * Only a narrow, explicit surface is exposed to the page.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('streamoBridge', {
  /** Open an external URL via the system (player / browser) */
  openExternal: (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      ipcRenderer.send('streamo:open-external', url);
    }
  },
  /** Receive captured links from the main process */
  onLinkFound: (callback) => {
    ipcRenderer.on('streamo:link', (event, payload) => {
      try { callback(payload); } catch (e) { console.error('link callback', e); }
    });
  },
  /** Sync verdict: is this main-frame destination an ad? */
  isAdNav: (url) => {
    try {
      return ipcRenderer.sendSync('streamo:should-block-nav', url) === true;
    } catch (e) {
      return false;
    }
  },
  /** Sync quiet verdict (no side effects) */
  isAdNavQuiet: (url) => {
    try {
      return ipcRenderer.sendSync('streamo:is-ad-nav', url) === true;
    } catch (e) {
      return false;
    }
  },
  /** Did the user genuinely click inside this webContents in the last 2s? */
  hasGesture: (webContentsId) => {
    try {
      return ipcRenderer.sendSync('streamo:gesture-for', webContentsId) === true;
    } catch (e) {
      return false;
    }
  },
  /** Test a link (single simple HTTP probe in the main process) */
  testLink: (url, pageUrl) => {
    try {
      return ipcRenderer.invoke('streamo:test-link', { url: String(url || ''), pageUrl: String(pageUrl || '') });
    } catch (e) {
      return Promise.resolve({ url: url, status: 'fail', error: 'EXCEPTION' });
    }
  },
  /** The href of the anchor the user actually clicked (for the domain lock) */
  onAnchorClick: (callback) => {
    ipcRenderer.on('streamo:anchor-click', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('anchor callback', e); }
    });
  },
  /** The current URL of any webview, reported by its preload (ref. wcId) */
  onSeenPage: (callback) => {
    ipcRenderer.on('streamo:seen-page', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('seen-page callback', e); }
    });
  },
  /** Requests to open a new window (window.open / target=_blank) — the app decides the policy */
  onPopup: (callback) => {
    ipcRenderer.on('streamo:popup', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('popup callback', e); }
    });
  },
  /** Click intent reported by the guest (maybe swallowed by the page's ad scripts) */
  onNavIntent: (callback) => {
    ipcRenderer.on('streamo:nav-intent', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('nav-intent callback', e); }
    });
  },
  /** Fired when a guest <webview> renderer dies — the UI should warn/reload the tab */
  onGuestGone: (callback) => {
    ipcRenderer.on('streamo:guest-gone', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('guest-gone callback', e); }
    });
  },
  /** Live memory report from the main process (per-tab, total, system free) */
  onMemory: (callback) => {
    ipcRenderer.on('streamo:memory', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('memory callback', e); }
    });
  },
  /** Loopback media proxy used by the internal player (port + random token) */
  getMediaProxy: () => {
    try { return ipcRenderer.invoke('streamo:media-proxy'); }
    catch (e) { return Promise.resolve(null); }
  },
  /** One-shot: did the app just crash? (used to restore every tab asleep) */
  consumeCrashFlag: () => {
    try { return ipcRenderer.invoke('streamo:consume-crash-flag'); }
    catch (e) { return Promise.resolve(false); }
  },
  /** The app is quitting now — flush the tab session synchronously before exit */
  onFlushSession: (callback) => {
    ipcRenderer.on('streamo:flush-session', () => {
      try { callback && callback(); } catch (e) {}
    });
  },
  /** Fired when a guest webview reports a mouse-down — close open popups/panels */
  onGuestClick: (callback) => {
    ipcRenderer.on('streamo:guest-click', () => {
      try { callback && callback(); } catch (e) { console.error('guest-click callback', e); }
    });
  },
  /** Real page-load milestones from the guest (start, domLoading, domInteractive, domContentLoaded, load) */
  onLoadPhase: (callback) => {
    ipcRenderer.on('streamo:load-phase', (event, payload) => {
      try { callback && callback(payload); } catch (e) { console.error('load-phase callback', e); }
    });
  },
  /** The internal player was closed - the heavy media cache can be dropped */
  notifyPlayerClosed: () => {
    try { ipcRenderer.send('streamo:player-closed'); } catch (e) {}
  }
});
