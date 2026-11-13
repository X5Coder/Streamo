package com.streamo.link.android.state

import android.app.ActivityManager
import android.app.Application
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.streamo.link.android.browser.TabInternal
import com.streamo.link.android.data.StreamoStore
import com.streamo.link.android.defense.Defense
import com.streamo.link.android.model.LinkEntry
import com.streamo.link.android.model.SearchEntry
import com.streamo.link.android.model.SessionEntry
import com.streamo.link.android.model.SessionState
import com.streamo.link.android.probe.Probe
import com.streamo.link.android.search.StreamoSearch
import com.streamo.link.android.util.Urls
import com.streamo.link.android.web.StreamoJsBridge
import com.streamo.link.android.web.StreamoWebChromeClient
import com.streamo.link.android.web.StreamoWebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/** Side panels */
enum class Panel { LINKS, SEARCH, TABS }

/** A capture-card notification */
data class Notif(
    val id: String,
    val url: String,
    val host: String,
    val state: NotifState, // TESTING | OK | FAILED
) {
    enum class NotifState { TESTING, OK, FAILED }
}

/** Tab snapshot for the UI */
data class TabUi(
    val id: Long,
    val url: String,
    val title: String,
    val sleeping: Boolean,
    val isActive: Boolean,
)

data class PlayerRequest(val url: String, val pageUrl: String?)
data class ToastMsg(val text: String, val ts: Long)
data class RamInfo(val text: String = "RAM --", val level: String = "ok")

/**
 * Streamo — the browser controller (port of the Windows chrome.js logic).
 * Owns: tabs, domain-lock navigation guard, link capture pipeline + probe,
 * session restore, memory governor (idle sleep / trim-memory), panels, notifications.
 */
class BrowserViewModel(app: Application) : AndroidViewModel(app),
    StreamoWebViewClient.StreamoWebHost,
    StreamoWebChromeClient.PopupHost,
    StreamoJsBridge.StreamoJsBridgeListener {

    val store = StreamoStore(app)

    companion object {
        const val HOME_URL = "https://www.google.com/"
        private const val DEDUPE_MS = 4 * 60 * 1000L
        private const val STRIKE_MS = 15_000L
        private const val INTENT_MS = 8_000L
        private const val ANCHOR_INTENT_MS = 5_000L
        private const val IDLE_SLEEP_MS = 15 * 60 * 1000L
        private const val PRESSURE_IDLE_MS = 45 * 1000L
        private const val MOVIE_NOTIFY_WINDOW_MS = 2 * 60 * 1000L
        private const val PROBE_CACHE_MS = 60 * 1000L
    }

    /* ---------- flows ---------- */
    private val _tabs = MutableStateFlow<List<TabUi>>(emptyList())
    val tabs: StateFlow<List<TabUi>> = _tabs.asStateFlow()

    private val _activeId = MutableStateFlow<Long?>(null)
    val activeId: StateFlow<Long?> = _activeId.asStateFlow()

    private val _urlText = MutableStateFlow("")
    val urlText: StateFlow<String> = _urlText.asStateFlow()

    private val _canGoBack = MutableStateFlow(false)
    val canGoBack: StateFlow<Boolean> = _canGoBack.asStateFlow()

    private val _canGoForward = MutableStateFlow(false)
    val canGoForward: StateFlow<Boolean> = _canGoForward.asStateFlow()

    private val _progress = MutableStateFlow(0f)
    val progress: StateFlow<Float> = _progress.asStateFlow()

    private val _progressActive = MutableStateFlow(false)
    val progressActive: StateFlow<Boolean> = _progressActive.asStateFlow()

    private val _panel = MutableStateFlow<Panel?>(null)
    val panel: StateFlow<Panel?> = _panel.asStateFlow()

    private val _links = MutableStateFlow<List<LinkEntry>>(emptyList())
    val links: StateFlow<List<LinkEntry>> = _links.asStateFlow()

    private val _searches = MutableStateFlow<List<SearchEntry>>(emptyList())
    val searches: StateFlow<List<SearchEntry>> = _searches.asStateFlow()

    private val _toast = MutableStateFlow<ToastMsg?>(null)
    val toast: StateFlow<ToastMsg?> = _toast.asStateFlow()

    private val _notifications = MutableStateFlow<List<Notif>>(emptyList())
    val notifications: StateFlow<List<Notif>> = _notifications.asStateFlow()

    private val _player = MutableStateFlow<PlayerRequest?>(null)
    val player: StateFlow<PlayerRequest?> = _player.asStateFlow()

    private val _ramInfo = MutableStateFlow(RamInfo())
    val ramInfo: StateFlow<RamInfo> = _ramInfo.asStateFlow()

    private val _badgeCount = MutableStateFlow(0)
    val badgeCount: StateFlow<Int> = _badgeCount.asStateFlow()

    private val _badgeSeen = MutableStateFlow(false)
    val badgeSeen: StateFlow<Boolean> = _badgeSeen.asStateFlow()

    private val _urlEditing = MutableStateFlow(false)
    val urlEditing: StateFlow<Boolean> = _urlEditing.asStateFlow()

    private val _searchMode = MutableStateFlow(false)
    val searchMode: StateFlow<Boolean> = _searchMode.asStateFlow()

    private val _menuOpen = MutableStateFlow(false)
    val menuOpen: StateFlow<Boolean> = _menuOpen.asStateFlow()

    /* ---------- internal state ---------- */
    private val tabsInternal = mutableListOf<TabInternal>()
    private val webViews = HashMap<Long, WebView>()
    private var tabSeq = 0L

    private val mainHandler = android.os.Handler(Looper.getMainLooper())

    private val recentCaptures = ConcurrentHashMap<String, Long>()
    private val lastTestAt = ConcurrentHashMap<String, Long>()
    private val pendingTests = ConcurrentHashMap<String, String>() // url -> tmp notif id
    private val pendingPageUrl = ConcurrentHashMap<String, String>() // url -> pageUrl
    private val movieNotifyAt = ConcurrentHashMap<String, Long>()
    private val recentProbeAt = ConcurrentHashMap<String, Long>()
    private val anchorClicks = ConcurrentHashMap<Long, AnchorClick>()
    private val pageByTab = ConcurrentHashMap<Long, String>()
    private val strikes = ConcurrentHashMap<String, Long>()
    private val gestures = ConcurrentHashMap<Long, Long>()
    private val extractionLogged = HashSet<String>()

    private data class AnchorClick(val etld: String, val ts: Long)

    private var idleSweepJob: Job? = null
    private var saveSessionJob: Job? = null

    var hookJs: String = ""
        private set

    /* ================= boot ================= */

    init {
        hookJs = try {
            getApplication<Application>().assets.open("hook.js").bufferedReader().use { it.readText() }
        } catch (e: Exception) { "" }

        store.sanitizeLinks()
        store.sanitizeSearchLog()

        _badgeSeen.value = store.badgeSeen()
        emitLinks()
        emitSearches()
        refreshLinkBadge()

        val crashed = store.consumeCrashFlag()
        val restored = restoreSession(allAsleep = crashed)
        if (!restored && tabsInternal.isEmpty()) {
            createTab(HOME_URL)
        }

        // One-time migration: links stored by older builds were probed with the older check.
        // Re-test them one at a time; anything that fails deep media check is removed.
        viewModelScope.launch {
            val stale = store.getLinks().filter { it.status == "ok" && it.probeV != 2 }
            for (l in stale) { runLinkTest(l.url, l.pageUrl); delay(50) }
        }

        // idle tab sweep — hidden tabs sleep after 15 minutes without user activity
        idleSweepJob = viewModelScope.launch {
            while (isActive) {
                delay(60_000L)
                val now = System.currentTimeMillis()
                val active = _activeId.value
                var changed = false
                for (t in tabsInternal.toList()) {
                    if (t.id == active || t.sleeping || now - t.lastActiveAt < IDLE_SLEEP_MS) continue
                    if (sleepTab(t, notify = false)) changed = true
                }
                if (changed) publishTabs()
                updateRamInfo(critical = false)
            }
        }
        updateRamInfo(critical = false)
    }

    override fun onCleared() {
        super.onCleared()
        idleSweepJob?.cancel()
        saveSessionJob?.cancel()
        for (view in webViews.values) { try { view.destroy() } catch (e: Exception) {} }
        webViews.clear()
    }

    /* ================= tabs ================= */

    fun createTab(url: String? = null, activate: Boolean = true): Long {
        tabSeq += 1
        val id = tabSeq
        val tab = TabInternal(
            id = id,
            url = url ?: HOME_URL,
            title = url ?: HOME_URL,
            lastActiveAt = System.currentTimeMillis(),
        )
        tab.hostIntent = TabInternal.HostIntent(Urls.etld1(Urls.hostOf(tab.url)), System.currentTimeMillis())
        tabsInternal.add(tab)
        if (activate) activateTab(id) else publishTabs()
        return id
    }

    fun acquireWebView(tabId: Long, context: Context): WebView {
        webViews[tabId]?.let { return it }
        val tab = tabInternal(tabId) ?: run {
            val fallback = WebView(context)
            return fallback
        }
        val view = com.streamo.link.android.web.TabWebViewFactory.create(
            context = context, // the AndroidView's context (the Activity) — WebView needs it
            tabId = tabId,
            webHost = this,
            popupHost = this,
            bridgeListener = this,
            initialUrl = tab.url,
        )
        // A tap inside the page dismisses open UI chrome (edit pill, panels, menu) — guest-click parity
        view.setOnTouchListener { _, ev ->
            if (ev.action == android.view.MotionEvent.ACTION_DOWN) {
                onWebViewContentTapped()
            }
            false // never consume — the WebView handles the gesture itself
        }
        webViews[tabId] = view
        tab.webView = view
        tab.sleeping = false
        // keep the page — creation already loads the tab url below
        view.loadUrl(tab.url)
        publishTabs()
        return view
    }

    fun tabInternal(tabId: Long): TabInternal? = tabsInternal.firstOrNull { it.id == tabId }

    fun activeTab(): TabInternal? = _activeId.value?.let { tabInternal(it) }

    /** Attach/detach handled by Compose: only the ACTIVE tab's WebView is in the hierarchy. */
    fun webViewFor(tabId: Long): WebView? = webViews[tabId]

    fun activateTab(id: Long) {
        val prev = activeTab()
        if (prev != null && prev.id != id) prev.lastActiveAt = System.currentTimeMillis()
        _activeId.value = id
        val tab = tabInternal(id) ?: return
        tab.lastActiveAt = System.currentTimeMillis()
        tab.sleeping = false
        _urlText.value = tab.url
        refreshBackForward()
        publishTabs()
        scheduleSaveSession()
    }

    fun closeTab(id: Long) {
        val idx = tabsInternal.indexOfFirst { it.id == id }
        if (idx < 0) return
        val wasActive = tabsInternal[idx].id == _activeId.value
        destroyTabView(tabsInternal[idx])
        tabsInternal.removeAt(idx)
        if (tabsInternal.isEmpty()) {
            createTab(HOME_URL)
            return
        }
        if (wasActive) activateTab(tabsInternal.last().id) else publishTabs()
        scheduleSaveSession()
    }

    fun closeAllTabs() {
        for (t in tabsInternal) destroyTabView(t)
        tabsInternal.clear()
        createTab(HOME_URL)
    }

    fun goBack() {
        // If the player is open it takes precedence — handled by the UI layer instead.
        activeTab()?.let { tab ->
            webViews[tab.id]?.let { if (it.canGoBack()) it.goBack() }
        }
    }

    fun goForward() {
        activeTab()?.let { tab ->
            webViews[tab.id]?.let { if (it.canGoForward()) it.goForward() }
        }
    }

    fun reloadActive() {
        val tab = activeTab() ?: return
        startLoadProgress(14f)
        webViews[tab.id]?.reload()
        tab.lastReloadAt = System.currentTimeMillis()
    }

    fun home() {
        val tab = activeTab() ?: return
        hostNavigate(tab, HOME_URL)
        startLoadProgress(14f)
    }

    fun hostNavigate(tab: TabInternal, url: String) {
        tab.hostIntent = TabInternal.HostIntent(Urls.etld1(Urls.hostOf(url)), System.currentTimeMillis())
        tab.url = url
        noteTabUrl(tab.id, url)
        tab.sleeping = false
        _urlText.value = url
        val view = webViews[tab.id]
        if (view != null) {
            view.loadUrl(url)
        } else {
            // WebView will be created by the composition; it loads tab.url on acquire
            publishTabs()
        }
    }

    fun navigateCommitted(url: String) {
        // typed URL / search from the pill or the search bar
        val t = activeTab() ?: return
        hostNavigate(t, url)
        startLoadProgress(14f)
    }

    private fun publishTabs() {
        val active = _activeId.value
        _tabs.value = tabsInternal.map { t ->
            TabUi(id = t.id, url = t.url, title = t.title, sleeping = t.sleeping, isActive = t.id == active)
        }
    }



    /** Guest-click parity (Windows onGuestClick): a tap inside the page closes open UI chrome. */
    fun onWebViewContentTapped() {
        if (_urlEditing.value) _urlEditing.value = false
        if (_searchMode.value) _searchMode.value = false
        if (_menuOpen.value) _menuOpen.value = false
        if (_panel.value != null) _panel.value = null
    }

    /* ================= navigation guard (domain lock) ================= */

    private fun etldOf(url: String?): String = Urls.etld1(Urls.hostOf(url ?: ""))

    private fun isAdDestination(url: String): Boolean =
        Defense.decide(url, isMainFrame = true, pageUrl = null) == Defense.Verdict.FAIL

    private fun isGoogleHostOf(url: String?): Boolean = Urls.isGoogleHost(Urls.hostOf(url ?: ""))

    private fun gestureFresh(tabId: Long): Boolean {
        val ts = gestures[tabId] ?: return false
        return System.currentTimeMillis() - ts < 2000L
    }

    private fun anchorIntent(tabId: Long): AnchorClick? {
        val rec = anchorClicks[tabId] ?: return null
        if (System.currentTimeMillis() - rec.ts > ANCHOR_INTENT_MS) { anchorClicks.remove(tabId); return null }
        return rec
    }

    /** Returns the navigation verdict for a main-frame navigation. */
    fun decideFor(tabId: Long, destUrl: String, kind: String): StreamoWebViewClient.NavVerdict {
        if (!Urls.isHttp(destUrl)) return StreamoWebViewClient.NavVerdict.ALLOW
        val d = etldOf(destUrl)
        val tab = tabInternal(tabId)
        val current = tab?.url ?: ""
        val c = etldOf(current)
        if (d.isEmpty()) return StreamoWebViewClient.NavVerdict.ALLOW
        if (c.isNotEmpty() && d == c) return StreamoWebViewClient.NavVerdict.ALLOW
        if (isGoogleHostOf(current) && isGoogleHostOf(destUrl)) return StreamoWebViewClient.NavVerdict.ALLOW

        if (isAdDestination(destUrl)) {
            val now = System.currentTimeMillis()
            val last = strikes[d]
            if (last != null && now - last < STRIKE_MS && gestureFresh(tabId)) {
                strikes.remove(d)
                return StreamoWebViewClient.NavVerdict.ALLOW
            }
            if (gestureFresh(tabId)) {
                strikes[d] = now
                return StreamoWebViewClient.NavVerdict.STRIKE
            }
            return StreamoWebViewClient.NavVerdict.BLOCK
        }

        val hi = tab?.hostIntent
        if (hi != null && System.currentTimeMillis() - hi.freshTs < INTENT_MS) {
            return StreamoWebViewClient.NavVerdict.ALLOW
        }

        // The anchor the user tapped authorizes the navigation, wherever its href points
        // (Google wraps result links in /url?q=… redirects — the destination is never the same etld,
        // so a strict etld match would block EVERY user click). Ad destinations were already
        // filtered by the strike rule above.
        val a = anchorIntent(tabId)
        if (a != null) return StreamoWebViewClient.NavVerdict.ALLOW
        return StreamoWebViewClient.NavVerdict.BLOCK
    }

    override fun decideNavigation(tabId: Long, destUrl: String, kind: String): StreamoWebViewClient.NavVerdict {
        val verdict = decideFor(tabId, destUrl, kind)
        if (verdict == StreamoWebViewClient.NavVerdict.BLOCK) {
            toast("Blocked - redirect to a different site was stopped")
        } else if (verdict == StreamoWebViewClient.NavVerdict.STRIKE) {
            toast("Blocked - click again to continue")
        }
        return verdict
    }

    /* ================= WebViewClient callbacks ================= */

    override fun onPageStarted(tabId: Long, url: String?) {
        mainHandler.post {
            val tab = tabInternal(tabId) ?: return@post
            url?.let {
                tab.url = it
                noteTabUrl(tabId, it)
            }
            tab.hostIntent = null
            tab.lastActiveAt = System.currentTimeMillis()
            if (tab.id == _activeId.value) {
                _urlText.value = tab.url
                startLoadProgress(14f)
                refreshBackForward()
            }
            publishTabs()
        }
    }

    override fun onPageFinished(tabId: Long, webView: WebView, url: String?) {
        mainHandler.post {
            val tab = tabInternal(tabId) ?: return@post
            url?.let {
                tab.url = it
                noteTabUrl(tabId, it)
            }
            try { tab.title = webView.title ?: tab.title } catch (e: Exception) {}
            webView.evaluateJavascript(hookJs, null)
            trackSearch(tab.url)
            if (tab.id == _activeId.value) {
                finishLoadProgress()
                refreshBackForward()
                _urlText.value = tab.url
            }
            publishTabs()
            scheduleSaveSession()
        }
    }

    override fun onProgressChanged(tabId: Long, progressValue: Int) {
        mainHandler.post {
            if (tabId != _activeId.value) return@post
            val p = progressValue.coerceIn(0, 100)
            _progress.value = maxOf(14f, (p * 0.95f))
            if (p >= 100) finishLoadProgress()
        }
    }

    override fun onReceivedError(tabId: Long, description: String?) {
        mainHandler.post {
            if (tabId == _activeId.value) finishLoadProgress()
            Log.w("Streamo", "main-frame error: $description")
        }
    }

    override fun onLinkCaptured(url: String, source: String, pageUrl: String?, httpStatus: Int?, contentType: String?, size: Long?) {
        // called on a WebView worker thread — hop to main
        mainHandler.post { onLinkCapturedMain(url, source, pageUrl, httpStatus, contentType, size) }
    }

    /* ================= JS bridge callbacks ================= */

    override fun onJsUrl(tabId: Long, url: String?, isMediaElement: Boolean, tagName: String?) {
        if (url.isNullOrBlank() || !Urls.isHttp(url)) return
        if (Urls.isDashUrl(url) || Urls.isRangeCapture(url)) return
        if (Defense.decide(url, isMainFrame = false, pageUrl = null) != Defense.Verdict.ALLOW) return
        if (tagName?.lowercase() == "audio") return
        if (Urls.isAudioOnlyUrl(url)) return
        if (isMediaElement || (Urls.MEDIA_RE.containsMatchIn(url) && !Urls.TS_RE.containsMatchIn(url))) {
            mainHandler.post {
                val pageUrl = pageByTab[tabId]
                    ?: tabInternal(tabId)?.url
                    ?: activeTab()?.url
                    ?: ""
                onLinkCapturedMain(url, "js", pageUrl, null, null, null)
            }
        }
    }

    override fun onGesture(tabId: Long) {
        gestures[tabId] = System.currentTimeMillis()
        if (gestures.size > 300) gestures.clear()
    }

    override fun onAnchorClick(tabId: Long, href: String?) {
        if (href.isNullOrBlank() || !Urls.isHttp(href)) return
        val etld = etldOf(href)
        if (etld.isEmpty()) return
        anchorClicks[tabId] = AnchorClick(etld, System.currentTimeMillis())
        if (anchorClicks.size > 60) {
            val now = System.currentTimeMillis()
            anchorClicks.entries.removeIf { now - it.value.ts > ANCHOR_INTENT_MS }
        }
    }

    override fun onSeenPage(tabId: Long, href: String?) {
        if (href.isNullOrBlank() || !Urls.isHttp(href)) return
        pageByTab[tabId] = href
        noteTabUrl(tabId, href)
        if (pageByTab.size > 120) pageByTab.entries.firstOrNull()?.let { pageByTab.remove(it.key) }
    }

    override fun onNavIntent(tabId: Long, href: String?, prevented: Boolean) {
        if (href.isNullOrBlank() || !Urls.isHttp(href)) return
        if (!prevented) return
        val srcPage = pageByTab[tabId] ?: tabInternal(tabId)?.url ?: activeTab()?.url ?: ""
        val d = etldOf(href)
        val c = etldOf(srcPage)
        if (d.isNotEmpty() && c.isNotEmpty() && d == c) {
            createTab(href)
            toast("Opened in new tab")
            return
        }
        if (isGoogleHostOf(srcPage) && isGoogleHostOf(href)) { createTab(href); return }
        // foreign site + ad/other domain — nothing to do
    }

    /** Popup routing: same-domain (or Google→Google) → new tab; otherwise drop the popup. */
    override fun onPopupUrl(tabId: Long, srcPageUrl: String?, destUrl: String) {
        if (!Urls.isHttp(destUrl)) return
        val src = srcPageUrl ?: tabInternal(tabId)?.url ?: activeTab()?.url ?: ""
        val d = etldOf(destUrl)
        val c = etldOf(src)
        if (d.isNotEmpty() && c.isNotEmpty() && d == c) { createTab(destUrl); return }
        if (isGoogleHostOf(src) && isGoogleHostOf(destUrl)) { createTab(destUrl); return }
        // cross-domain ad/popup — silently dropped
    }

    /* ================= link capture pipeline ================= */

    private val urlByTabAtomic = ConcurrentHashMap<Long, String>()

    /** Background-thread-safe current URL of a tab (WebView.getUrl() is off-limits there). */
    override fun tabUrl(tabId: Long): String? = urlByTabAtomic[tabId]

    private fun noteTabUrl(tabId: Long, url: String?) {
        if (!url.isNullOrBlank()) urlByTabAtomic[tabId] = url
    }

    private fun shouldSend(url: String): Boolean {
        val now = System.currentTimeMillis()
        val last = recentCaptures[url]
        if (last != null && now - last < DEDUPE_MS) return false
        if (recentCaptures.size > 300) recentCaptures.clear()
        recentCaptures[url] = now
        return true
    }

    private fun addNotif(id: String, url: String): Notif {
        val host = Urls.shortHost(url)
        val n = Notif(id, url, host, Notif.NotifState.TESTING)
        val cur = _notifications.value.toMutableList()
        cur.add(0, n)
        // max 5 cards; drop the oldest SETTLED ones, keep pending
        while (cur.size > 5) {
            val settledIdx = cur.indexOfLast { it.state != Notif.NotifState.TESTING }
            if (settledIdx >= 0) cur.removeAt(settledIdx) else break
        }
        _notifications.value = cur
        return n
    }

    private fun updateNotif(id: String, ok: Boolean) {
        val cur = _notifications.value.toMutableList()
        val ix = cur.indexOfFirst { it.id == id }
        if (ix < 0) return
        cur[ix] = cur[ix].copy(state = if (ok) Notif.NotifState.OK else Notif.NotifState.FAILED)
        _notifications.value = cur
    }

    fun dismissNotif(id: String) {
        _notifications.value = _notifications.value.filterNot { it.id == id }
    }

    private fun onLinkCapturedMain(url: String, source: String, pageUrl: String?, httpStatus: Int?, contentType: String?, size: Long?) {
        Log.d("StreamoCapture", "captured src=$source url=$url page=$pageUrl")
        if (!shouldSend(url)) { Log.d("StreamoCapture", "deduped"); return }
        val now = System.currentTimeMillis()

        val tmpId = "pending-" + java.lang.Long.toString(now, 36) + "-" + ((Math.random() * 1e4).toInt()).toString(36)
        pendingTests[url] = tmpId
        pendingPageUrl[url] = pageUrl ?: ""
        lastTestAt[url] = now
        if (pendingTests.size > 80) pendingTests.keys.firstOrNull()?.let { pendingTests.remove(it) }
        if (lastTestAt.size > 600) lastTestAt.clear()

        // One card per movie per 2-minute window — a capture burst shows exactly ONE card
        var movieKey = ""
        try { movieKey = store.linkDedupeKey(url) } catch (e: Exception) { movieKey = "" }
        var suppressCard = false
        if (movieKey.isNotEmpty()) {
            val sinceLast = now - (movieNotifyAt[movieKey] ?: 0L)
            if (sinceLast < MOVIE_NOTIFY_WINDOW_MS) {
                suppressCard = true
            } else {
                movieNotifyAt[movieKey] = now
                if (movieNotifyAt.size > 1500) {
                    val cutoff = now - MOVIE_NOTIFY_WINDOW_MS
                    movieNotifyAt.entries.removeIf { it.value < cutoff }
                }
            }
        }

        if (!suppressCard) addNotif(tmpId, url)

        // capture counts as "search activity" for the source page (like the Windows build)
        if (!pageUrl.isNullOrBlank() && extractionLogged.add(pageUrl)) {
            store.addSearch(pageUrl, pageUrl, "Capture")
            emitSearches()
        }

        probeAndApply(url, pageUrl ?: "")
    }

    private fun runLinkTest(url: String, pageUrl: String?) {
        val movieKey = try { store.linkDedupeKey(url) } catch (e: Exception) { "" }
        if (movieKey.isNotEmpty()) {
            val last = recentProbeAt[movieKey] ?: 0L
            if (System.currentTimeMillis() - last < PROBE_CACHE_MS) return
            recentProbeAt[movieKey] = System.currentTimeMillis()
            if (recentProbeAt.size > 200) {
                val cutoff = System.currentTimeMillis() - PROBE_CACHE_MS
                recentProbeAt.entries.removeIf { it.value < cutoff }
            }
        }
        probeAndApply(url, pageUrl ?: pendingPageUrl[url] ?: "")
    }

    private fun probeAndApply(url: String, pageUrl: String) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { Probe.probeLink(url, pageUrl) }
            applyTestResult(result, pageUrl)
        }
    }

    private fun applyTestResult(r: Probe.ProbeResult, pageUrlFallback: String) {
        Log.d("StreamoCapture", "probe result url=${r.url} status=${r.status} error=${r.error} type=${r.type} http=${r.httpStatus}")
        val url = r.url
        val ok = r.status == "ok"
        val entryId = pendingTests.remove(url)
        val pendingPage = pendingPageUrl.remove(url) ?: pageUrlFallback

        if (ok) {
            val add = store.addLink(url, pendingPage.ifBlank { null }, r.isMaster == true)
            val entry = add.entry
            if (entry != null) {
                store.updateLinkFields(
                    entry.id,
                    status = "ok",
                    type = r.type,
                    size = r.size,
                    httpStatus = r.httpStatus,
                    contentType = r.contentType,
                    duration = r.duration,
                    via = r.via,
                    finalUrl = r.finalUrl,
                    error = r.error,
                    isMaster = r.isMaster == true || entry.isMaster,
                )
            }
            // A merged duplicate (same movie, master upgraded in place) is not a "new link" —
            // let its card vanish quietly instead of flashing "Link captured".
            if (entryId != null) {
                if (add.merged) {
                    dismissNotif(entryId)
                } else {
                    updateNotif(entryId, true)
                }
            }
            refreshLinkBadge()
            emitLinks()
            return
        }

        // failure — drop the entry and mark the card failed
        store.removeLinkByUrl(url)
        if (entryId != null) updateNotif(entryId, false)
        emitLinks()
    }

    /* ================= search tracking ================= */

    private fun trackSearch(url: String?) {
        if (url.isNullOrBlank()) return
        val hit = StreamoSearch.extract(url) ?: return
        store.addSearch(hit.q, url, hit.engine)
        emitSearches()
    }

    /* ================= panels / actions ================= */

    fun togglePanel(panel: Panel) {
        val current = _panel.value
        _panel.value = if (current == panel) null else panel
        _menuOpen.value = false // opening a panel always closes the menu popover
        if (_panel.value == Panel.LINKS) { markBadgeSeen() }
    }

    fun clearToast() { _toast.value = null }

    fun closePanel() { _panel.value = null }

    fun toggleMenu() { _menuOpen.value = !_menuOpen.value }
    fun closeMenu() { _menuOpen.value = false }

    fun setSearchMode(on: Boolean) {
        _searchMode.value = on
        if (on) { _panel.value = null; _urlEditing.value = false }
    }

    fun setUrlEditing(on: Boolean) {
        _urlEditing.value = on
        if (on) _searchMode.value = false
    }

    fun emitLinks() {
        _links.value = store.getLinks()
    }

    fun emitSearches() {
        _searches.value = store.getSearch()
    }

    fun refreshLinkBadge() {
        try {
            val n = store.getLinks().size.coerceAtMost(99)
            _badgeCount.value = n
        } catch (e: Exception) { _badgeCount.value = 0 }
    }

    fun markBadgeSeen() {
        store.markBadgeSeen()
        _badgeSeen.value = true
    }

    fun clearAllLinks() = viewModelScope.launch { store.clearLinks(); emitLinks(); refreshLinkBadge() }
    fun clearAllSearches() = viewModelScope.launch { store.clearSearch(); emitSearches() }

    fun removeLink(id: String) = viewModelScope.launch { store.removeLink(id); emitLinks(); refreshLinkBadge() }
    fun removeSearch(id: String) = viewModelScope.launch { store.removeSearch(id); emitSearches() }

    /* Player / external actions */
    fun openPlayer(url: String, pageUrl: String?) {
        _player.value = PlayerRequest(url, pageUrl)
    }

    fun closePlayer() {
        _player.value = null
    }

    fun openExternal(url: String?) {
        val u = url ?: return
        if (!Urls.isHttp(u)) return
        try {
            getApplication<Application>().startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) { toast("No browser available to open the link") }
    }

    fun openSourcePage(pageUrl: String) = createTab(pageUrl)

    fun renewLink(pageUrl: String?, item: LinkEntry? = null) {
        if (pageUrl.isNullOrBlank()) { toast("No source page for this link"); return }
        val t = activeTab() ?: return
        item?.let { lastTestAt.remove(it.url) }
        t.hostIntent = TabInternal.HostIntent(Urls.etld1(Urls.hostOf(pageUrl)), System.currentTimeMillis())
        hostNavigate(t, pageUrl)
        toast("Re-capturing from the same page...")
    }

    fun copyToClipboard(text: String?) {
        if (text.isNullOrBlank()) return
        try {
            val cm = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("Streamo", text))
            toast("Copied OK")
        } catch (e: Exception) {
            toast("Copy failed")
        }
    }

    /* ================= session restore ================= */

    private fun sessionEntries(): List<SessionEntry> =
        tabsInternal.map { SessionEntry(it.url, it.title) }.filter { Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it.url) }

    fun saveSessionNow() {
        try {
            val urls = sessionEntries()
            if (urls.isEmpty()) return
            val activeIndex = tabsInternal.indexOfFirst { it.id == _activeId.value }.coerceAtLeast(0)
            store.saveSession(SessionState(urls, activeIndex.coerceIn(0, urls.size - 1), System.currentTimeMillis()))
        } catch (e: Exception) {}
    }

    private fun scheduleSaveSession() {
        if (saveSessionJob?.isActive == true) return
        saveSessionJob = viewModelScope.launch {
            delay(900L)
            saveSessionNow()
        }
    }

    private fun restoreSession(allAsleep: Boolean): Boolean {
        val s = store.readSession() ?: return false
        for (e in s.urls) {
            tabSeq += 1
            val t = TabInternal(id = tabSeq, url = e.url, title = e.title.ifBlank { e.url }, lastActiveAt = 0L)
            t.sleeping = true
            tabsInternal.add(t)
        }
        if (tabsInternal.isEmpty()) return false
        if (allAsleep) {
            // the heavy page that caused the crash stays asleep — open a fresh benign tab
            createTab(HOME_URL)
            toast("Recovered after a crash - your tabs were restored asleep")
            return true
        }
        val idx = s.activeIndex.coerceIn(0, tabsInternal.size - 1)
        activateTab(tabsInternal[idx].id)
        if (tabsInternal.size > 1) toast("Session restored - ${tabsInternal.size} tabs restored")
        return true
    }

    /* ================= memory governor ================= */

    /** Put a hidden tab to sleep: destroy its WebView, keep URL/title, restore on tap. */
    fun sleepTab(tab: TabInternal, notify: Boolean = false): Boolean {
        if (tab.id == _activeId.value) return false
        if (tab.sleeping) return false
        val view = webViews.remove(tab.id)
        if (view != null) {
            try { tab.url = view.url ?: tab.url } catch (e: Exception) {}
            try { tab.title = view.title?.takeIf { it.isNotBlank() } ?: tab.title } catch (e: Exception) {}
            tab.webView = null
            try { view.destroy() } catch (e: Exception) {}
        }
        tab.sleeping = true
        return true
    }

    fun sleepHiddenTabs(pressureHigh: Boolean) {
        val now = System.currentTimeMillis()
        val active = _activeId.value
        val candidates = tabsInternal.filter { t ->
            t.id != active && !t.sleeping && (pressureHigh || now - t.lastActiveAt > PRESSURE_IDLE_MS)
        }.sortedByDescending { now - it.lastActiveAt }
        if (pressureHigh) {
            for (t in candidates) sleepTab(t, notify = false)
        } else {
            // under warning: only sleep idle-heavy tabs — keep recent ones awake
            for (t in candidates) {
                if (now - t.lastActiveAt > PRESSURE_IDLE_MS) sleepTab(t, notify = false)
            }
        }
        publishTabs()
    }

    fun onTrimMemory(level: Int) {
        // TRIM_MEMORY_COMPLETE=80, CRITICAL=15, MODERATE=5, LOW=10 (approximate ordering by severity)
        when (level) {
            in 15..Int.MAX_VALUE -> sleepHiddenTabs(pressureHigh = true) // COMPLETE/CRITICAL
            in 5..14 -> sleepHiddenTabs(pressureHigh = true)            // MODERATE/LOW/RUNNING_LOW
            else -> sleepHiddenTabs(pressureHigh = false)                // RUNNING_MODERATE
        }
        updateRamInfo(critical = level >= 15)
    }

    fun updateRamInfo(critical: Boolean) {
        try {
            val app = getApplication<Application>()
            val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            am.getMemoryInfo(memInfo)
            val myPid = android.os.Process.myPid()
            val procInfos = am.getProcessMemoryInfo(intArrayOf(myPid))
            val appMB = procInfos.sumOf { it.totalPrivateDirty.toLong() * 1024 / (1024 * 1024) }
            val freeMB = memInfo.availMem / (1024 * 1024)
            val level = if (critical || memInfo.lowMemory) "critical"
            else if (freeMB < 600) "warn"
            else "ok"
            _ramInfo.value = RamInfo("RAM ${fmtMB(appMB)}  ·  free ${fmtMB(freeMB)}", level)
        } catch (e: Exception) {
            _ramInfo.value = RamInfo("RAM --", "ok")
        }
    }

    private fun fmtMB(mb: Long): String = mb.coerceAtLeast(0).let { if (it >= 1024) "%.1f GB".format(it / 1024.0) else "$it MB" }

    /* ================= misc ================= */

    fun toast(text: String) {
        _toast.value = ToastMsg(text, System.currentTimeMillis())
    }

    private fun startLoadProgress(v: Float) {
        _progress.value = v
        _progressActive.value = true
    }

    private fun finishLoadProgress() {
        _progress.value = 100f
        // UI fades the bar out after 220ms (in the composable)
        viewModelScope.launch {
            delay(220)
            _progress.value = 0f
            _progressActive.value = false
        }
    }

    private fun refreshBackForward() {
        val view = _activeId.value?.let { webViews[it] }
        _canGoBack.value = view?.canGoBack() == true
        _canGoForward.value = view?.canGoForward() == true
    }

    /** All WebViews destroyed + everything flushed — called from Activity.onDestroy. */
    fun disposeAll() {
        saveSessionNow()
        for (view in webViews.values) { try { view.destroy() } catch (e: Exception) {} }
        webViews.clear()
    }

    private fun destroyTabView(tab: TabInternal) {
        val view = webViews.remove(tab.id)
        if (view != null) {
            try { tab.url = view.url ?: tab.url } catch (e: Exception) {}
            try { tab.title = view.title?.takeIf { it.isNotBlank() } ?: tab.title } catch (e: Exception) {}
            tab.webView = null
            try { view.destroy() } catch (e: Exception) {}
        }
        tab.sleeping = true
    }

    /** For the debug/automation hook (mirrors window.__streamoDebug). */
    fun debugState(): Map<String, Any?> = mapOf(
        "tabs" to tabsInternal.map { mapOf("id" to it.id, "url" to it.url, "sleeping" to it.sleeping) },
        "activeId" to _activeId.value,
        "ram" to _ramInfo.value.text,
    )
}
