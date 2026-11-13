package com.streamo.link.android.web

import android.graphics.Color
import android.os.Message
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Chrome client: popups (window.open / target=_blank) never open as popups.
 * Same-domain (and Google→Google) destinations become a NEW TAB; everything else is dropped.
 */
class StreamoWebChromeClient(
    private val host: PopupHost,
    private val tabId: Long,
) : WebChromeClient() {

    interface PopupHost {
        /** The page URL of an opened popup was determined — route it (new tab or drop). */
        fun onPopupUrl(tabId: Long, srcPageUrl: String?, destUrl: String)
        /** Real page-load progress 0..100 from the WebView (mirrors onProgressChanged). */
        fun onProgressChanged(tabId: Long, progress: Int)
    }

    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean {
        val ctx = view.context ?: return false
        val popup = WebView(ctx)
        popup.settings.javaScriptEnabled = true
        popup.settings.domStorageEnabled = true
        popup.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        popup.setBackgroundColor(Color.BLACK)
        val sourceUrl = view.url
        popup.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest?): Boolean {
                val dest = request?.url?.toString()
                if (!dest.isNullOrBlank()) {
                    host.onPopupUrl(tabId, sourceUrl, dest)
                }
                try { v.destroy() } catch (e: Exception) {}
                return true // never let the popup render
            }
        }
        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
    }

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        host.onProgressChanged(tabId, newProgress)
    }

    override fun onReceivedTitle(view: WebView, title: String?) {
        // handled by the host via the page-finished flow; kept as a hook
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean = true

    override fun onPermissionRequest(request: android.webkit.PermissionRequest?) {
        // never grant camera/mic/location to pages
        try { request?.deny() } catch (e: Exception) {}
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: android.webkit.GeolocationPermissions.Callback?) {
        try { callback?.invoke(origin, false, false) } catch (e: Exception) {}
    }
}
