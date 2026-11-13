package com.streamo.link.android.web

import android.webkit.JavascriptInterface

/**
 * Bridge exposed to pages as window.__streamoHook (mirrors browser-preload.js).
 * One bridge per WebView; it carries the owning tab id.
 * Every method is called on a JavaScript worker thread — the listener must post to main.
 */
class StreamoJsBridge(
    private val tabId: Long,
    private val listener: StreamoJsBridgeListener,
) {

    interface StreamoJsBridgeListener {
        fun onJsUrl(tabId: Long, url: String?, isMediaElement: Boolean, tagName: String?)
        fun onGesture(tabId: Long)
        fun onAnchorClick(tabId: Long, href: String?)
        fun onSeenPage(tabId: Long, href: String?)
        fun onNavIntent(tabId: Long, href: String?, prevented: Boolean)
    }

    @JavascriptInterface
    fun send(url: String?, isMediaElement: Boolean, tagName: String?) = listener.onJsUrl(tabId, url, isMediaElement, tagName)

    @JavascriptInterface
    fun gesture() = listener.onGesture(tabId)

    @JavascriptInterface
    fun anchor(href: String?) = listener.onAnchorClick(tabId, href)

    @JavascriptInterface
    fun seen(href: String?) = listener.onSeenPage(tabId, href)

    @JavascriptInterface
    fun navIntent(href: String?, prevented: Boolean) = listener.onNavIntent(tabId, href, prevented)
}
