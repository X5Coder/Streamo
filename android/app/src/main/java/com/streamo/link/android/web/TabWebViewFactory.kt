package com.streamo.link.android.web

import android.content.Context
import android.graphics.Color
import android.webkit.WebSettings
import android.webkit.WebView

/**
 * Factory for tab WebViews — mirrors makeWebview() in chrome.js.
 * Desktop Chrome UA (the Windows build is a desktop browser), JS on, DOM storage on,
 * cookies persisted, mixed content compatible, no zoom controls.
 */
object TabWebViewFactory {

    fun create(
        context: Context,
        tabId: Long,
        webHost: StreamoWebViewClient.StreamoWebHost,
        popupHost: StreamoWebChromeClient.PopupHost,
        bridgeListener: StreamoJsBridge.StreamoJsBridgeListener,
        initialUrl: String,
    ): WebView {
        val wv = WebView(context)
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            loadWithOverviewMode = true
            useWideViewPort = true
            // userAgentString left as the platform default (mobile Chrome) — sites serve the phone layout
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            mediaPlaybackRequiresUserGesture = true
            safeBrowsingEnabled = false
            textZoom = 100
        }
        wv.setBackgroundColor(Color.BLACK)
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        wv.webViewClient = StreamoWebViewClient(webHost, tabId)
        wv.webChromeClient = StreamoWebChromeClient(popupHost, tabId)
        wv.addJavascriptInterface(StreamoJsBridge(tabId, bridgeListener), "__streamoHook")
        return wv
    }
}
