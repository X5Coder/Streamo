package com.streamo.link.android.browser

import android.webkit.WebView

/**
 * A live tab. The WebView may be null while the tab is asleep (URL kept, memory released) —
 * exactly like the Windows build's destroyTabView/restoreTabView.
 */
class TabInternal(
    val id: Long,
    var url: String,
    var title: String = url,
    var lastActiveAt: Long = System.currentTimeMillis(),
) {
    var webView: WebView? = null
    var sleeping: Boolean = true
    var crashCount: Int = 0
    var lastCrashAt: Long = 0L
    var lastReloadAt: Long = 0L

    /** Host-initiated navigation intent (typed URL / search / renew) — a short-lived allowance. */
    var hostIntent: HostIntent? = null

    data class HostIntent(val etld: String, val freshTs: Long)
}
