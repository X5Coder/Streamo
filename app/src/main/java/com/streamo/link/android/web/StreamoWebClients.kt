package com.streamo.link.android.web

import android.graphics.Bitmap
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.streamo.link.android.defense.Defense
import com.streamo.link.android.util.Urls
import java.io.ByteArrayInputStream

/**
 * WebViewClient for a browser tab. Wires:
 *  - the NET shield (shouldInterceptRequest → stub for ads),
 *  - media capture (URL-pattern path, like onBeforeRequest),
 *  - the smart domain-lock navigation guard (shouldOverrideUrlLoading),
 *  - page lifecycle events.
 *
 * Note: Android's shouldInterceptRequest does not expose the resource type nor the
 * response Content-Type (the Windows build captured those via onHeadersReceived).
 * MIME-based capture is therefore done by the PAGE hook (video/source elements +
 * fetch/XHR) — the URL-pattern capture stays here.
 */
class StreamoWebViewClient(
    private val host: StreamoWebHost,
    private val tabId: Long,
) : WebViewClient() {

    interface StreamoWebHost {
        /** Called on a WebView worker thread — must not touch UI directly. */
        fun onLinkCaptured(url: String, source: String, pageUrl: String?, httpStatus: Int?, contentType: String?, size: Long?)
        fun tabUrl(tabId: Long): String?
        fun decideNavigation(tabId: Long, destUrl: String, kind: String): NavVerdict
        fun onPageStarted(tabId: Long, url: String?)
        fun onPageFinished(tabId: Long, webView: WebView, url: String?)
        fun onProgressChanged(tabId: Long, progress: Int)
        fun onReceivedError(tabId: Long, description: String?)
    }

    enum class NavVerdict { ALLOW, BLOCK, STRIKE }

    private fun guessResourceType(url: String): String {
        val u = url.lowercase()
        return when {
            u.endsWith(".css") || u.endsWith(".map") -> "stylesheet"
            u.endsWith(".js") || u.endsWith(".mjs") -> "script"
            Regex("""\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|#|$)""").containsMatchIn(u) -> "image"
            Regex("""\.(woff2?|ttf|otf|eot)(\?|#|$)""").containsMatchIn(u) -> "font"
            Regex("""\.(mp4|webm|m3u8|mpd|mp3|m4a|aac|wav|opus|flac|ts)(\?|#|$)""").containsMatchIn(u) -> "media"
            else -> "other"
        }
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest?): WebResourceResponse? {
        val req = request ?: return null
        val url = req.url?.toString() ?: return null
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) return null

        val headers = req.requestHeaders
        val initiator = headers?.get("Referer") ?: host.tabUrl(tabId)

        // ---- NET defense (subresources): main-frame ads are handled in shouldOverrideUrlLoading ----
        when (Defense.decide(url, isMainFrame = false, pageUrl = initiator)) {
            Defense.Verdict.FAIL -> {
                // FAIL only happens for main frames; cancel with an empty JSON body anyway
                return WebResourceResponse("application/json", "utf-8", ByteArrayInputStream("{}".toByteArray()))
            }
            Defense.Verdict.STUB -> {
                val type = guessResourceType(url)
                val stub = Defense.stubFor(type, url)
                return WebResourceResponse(stub.mime, "utf-8", ByteArrayInputStream(stub.body))
            }
            Defense.Verdict.ALLOW -> Unit
        }

        // ---- media capture (URL-pattern path, like onBeforeRequest) ----
        if (Urls.MEDIA_RE.containsMatchIn(url) && !Urls.TS_RE.containsMatchIn(url) &&
            !Urls.isDashUrl(url) && !Urls.isRangeCapture(url) && !Urls.isAudioOnlyUrl(url)
        ) {
            host.onLinkCaptured(url, "request", initiator, null, null, null)
        }
        return null
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest?): Boolean {
        val dest = request?.url?.toString() ?: return false
        val verdict = host.decideNavigation(tabId, dest, "navigate")
        if (verdict == NavVerdict.ALLOW) return false
        // BLOCK or STRIKE: cancel the navigation
        return true
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        host.onPageStarted(tabId, url)
    }

    override fun onPageFinished(view: WebView, url: String?) {
        host.onPageFinished(tabId, view, url)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest?, error: WebResourceError?) {
        // report only the main frame failure — subresource failures are noise
        val failing = request?.url?.toString()
        if (request == null || failing == null || failing == view.url) {
            host.onReceivedError(tabId, error?.description?.toString())
        }
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest?, errorResponse: android.webkit.WebResourceResponse?) {
        // no-op — the page shows its own error UI; we only track load milestones
    }
}
