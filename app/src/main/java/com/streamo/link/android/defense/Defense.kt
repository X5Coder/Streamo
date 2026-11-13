package com.streamo.link.android.defense

import android.content.Context
import java.net.URL

/**
 * Streamo — the ad shield (port of shared/defense/defense.js).
 * NET + HEURISTIC + ALLOWLIST. Same rules, same order of evaluation.
 * The HaGeZi list is loaded from assets (same file as the Windows build).
 */
object Defense {

    enum class Verdict { ALLOW, STUB, FAIL }

    private val CORE_HOSTS = listOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com",
        "adservice.google.com", "pagead2.googlesyndication.com", "ads.yahoo.com",
        "taboola.com", "outbrain.com", "criteo.com", "criteo.net", "pubmatic.com",
        "rubiconproject.com", "moatads.com", "adsrvr.org", "bidswitch.net",
        "casalemedia.com", "popads.net", "popcash.net", "adnxs.com",
        "amazon-adsystem.com", "audtd.com"
    )

    private val HOST_PATTERNS = listOf(
        Regex("""^(?:[a-z0-9-]+\.)*amd-cdn-\d+\.[a-z0-9]+\.com$""", RegexOption.IGNORE_CASE)
    )

    private val ALLOWLIST_HOSTS = listOf(
        "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com",
        "login.live.com", "github.com", "api.twitter.com", "auth0.com", "okta.com",
        "stripe.com", "paypal.com", "pay.google.com", "apple-pay-gateway.apple.com",
        "hcaptcha.com", "challenges.cloudflare.com", "arkoselabs.com", "cloudflare.com",
        "youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com",
        "maps.google.com", "maps.googleapis.com",
        "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com",
        "cdn.jsdelivr.net", "unpkg.com", "cloudfront.net", "wikipedia.org", "wikimedia.org",
        "google.com", "gstatic.com", "googleapis.com", "googleusercontent.com"
    )

    private val ALLOWLIST_PATHS = listOf(
        "/oauth", "/authorize", "/signin", "/sso", "/login",
        "/3ds", "/acs", "/challenge", "/checkout",
        "/recaptcha", "/captcha", "/turnstile", "/__ctn"
    )

    private val AD_PATH_PATTERNS = listOf(
        Regex("""/ads?/""", RegexOption.IGNORE_CASE), Regex("""/adserver/""", RegexOption.IGNORE_CASE),
        Regex("pagead", RegexOption.IGNORE_CASE), Regex("""/banner/""", RegexOption.IGNORE_CASE),
        Regex("prebid", RegexOption.IGNORE_CASE), Regex("""/sponsor/""", RegexOption.IGNORE_CASE),
        Regex("""/popunder/""", RegexOption.IGNORE_CASE), Regex("doubleclick", RegexOption.IGNORE_CASE)
    )

    private val VAST_PATTERNS = listOf(
        Regex("vast", RegexOption.IGNORE_CASE), Regex("vpaid", RegexOption.IGNORE_CASE),
        Regex("freewheel", RegexOption.IGNORE_CASE), Regex("springserve", RegexOption.IGNORE_CASE),
        Regex("vast_tracker", RegexOption.IGNORE_CASE), Regex("""/ads/vast""", RegexOption.IGNORE_CASE)
    )

    private val AD_BRAND_PATTERNS = listOf(
        Regex("1xbet", RegexOption.IGNORE_CASE), Regex("melbet", RegexOption.IGNORE_CASE),
        Regex("mostbet", RegexOption.IGNORE_CASE), Regex("betway", RegexOption.IGNORE_CASE),
        Regex("1win", RegexOption.IGNORE_CASE)
    )

    private val AFFILIATE_PARAMS = setOf(
        "tag", "pb", "aff", "affiliate", "aff_id", "clickid", "subid", "sub_id",
        "cid", "pid", "sid", "ref", "referral", "partner", "promo", "bonus"
    )

    private val HOSTS = HashSet<String>(CORE_HOSTS)
    @Volatile private var hostsSuffix = HashSet<String>(CORE_HOSTS)
    @Volatile private var loaded = false

    /** Load the HaGeZi + custom lists from assets. Safe to call multiple times. */
    fun loadLists(context: Context) {
        if (loaded) return
        synchronized(this) {
            if (loaded) return
            for (name in listOf("hagezi.txt", "custom.txt")) {
                try {
                    context.assets.open("defense/$name").bufferedReader().use { br ->
                        br.forEachLine { line ->
                            val entry = line.substringBefore('#').trim().lowercase()
                            if (entry.isNotEmpty() && !entry.contains(' ') && entry.contains('.')) {
                                HOSTS.add(entry)
                            }
                        }
                    }
                } catch (e: Exception) {
                    // optional — the core list is enough
                }
            }
            hostsSuffix = HashSet(HOSTS)
            loaded = true
        }
    }

    fun hostsCount(): Int = HOSTS.size

    private fun hostOf(url: String): String = try {
        (URL(url).host ?: "").lowercase()
    } catch (e: Exception) { "" }

    private fun pathQueryOf(url: String): String = try {
        val u = URL(url)
        val p = u.path ?: ""
        val q = u.query?.let { "?$it" } ?: ""
        p + q
    } catch (e: Exception) { "" }

    private fun etld1(host: String): String {
        val parts = host.split('.').filter { it.isNotEmpty() }
        return if (parts.size <= 2) parts.joinToString(".") else parts.takeLast(2).joinToString(".")
    }

    private fun sameSite(url: String, pageUrl: String): Boolean {
        val h = hostOf(url); val p = hostOf(pageUrl)
        if (h.isEmpty() || p.isEmpty()) return false
        return etld1(h) == etld1(p)
    }

    private fun hasHostSuffix(host: String, entry: String): Boolean =
        host == entry || host.endsWith(".$entry")

    fun isAdHost(url: String): Boolean {
        val host = hostOf(url)
        if (host.isEmpty()) return false
        for (pattern in HOST_PATTERNS) if (pattern.containsMatchIn(host)) return true
        // O(labels) suffix check instead of looping the full list
        val labels = host.split('.')
        var suffix = labels.last()
        for (i in labels.size - 2 downTo 0) {
            suffix = "${labels[i]}.$suffix"
            if (hostsSuffix.contains(suffix)) return true
        }
        return false
    }

    fun looksLikeAdPath(url: String): Boolean {
        val h = pathQueryOf(url)
        return AD_PATH_PATTERNS.any { it.containsMatchIn(h) }
    }

    fun looksLikeVast(url: String): Boolean {
        val h = pathQueryOf(url)
        return VAST_PATTERNS.any { it.containsMatchIn(h) }
    }

    fun looksLikeAdBrand(url: String): Boolean {
        val h = pathQueryOf(url)
        return AD_BRAND_PATTERNS.any { it.containsMatchIn(h) }
    }

    fun looksLikeAffiliateRedirect(url: String, minParams: Int = 1): Boolean {
        val query = try { URL(url).query } catch (e: Exception) { null } ?: return false
        val keys = HashSet<String>()
        for (part in query.split('&')) {
            val k = part.substringBefore('=').lowercase()
            if (k.isNotEmpty()) keys.add(k)
        }
        val hits = keys.count { AFFILIATE_PARAMS.contains(it) }
        return hits >= maxOf(1, minParams)
    }

    fun isProtected(url: String): Boolean {
        val host = hostOf(url)
        if (host.isNotEmpty()) {
            for (entry in ALLOWLIST_HOSTS) if (hasHostSuffix(host, entry)) return true
        }
        val p = pathQueryOf(url).lowercase()
        return ALLOWLIST_PATHS.any { p.contains(it) }
    }

    fun isAdUrl(url: String, pageUrl: String?): Boolean {
        if (isAdHost(url)) return true
        if (looksLikeAdPath(url) || looksLikeVast(url) || looksLikeAdBrand(url)) return true
        if (!pageUrl.isNullOrEmpty() && looksLikeAffiliateRedirect(url, 1) && !sameSite(url, pageUrl)) return true
        if (pageUrl.isNullOrEmpty() && looksLikeAffiliateRedirect(url, 2)) return true
        return false
    }

    /** The final verdict on a request. */
    fun decide(url: String?, isMainFrame: Boolean, pageUrl: String?): Verdict {
        val u = url ?: return Verdict.ALLOW
        if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(u)) return Verdict.ALLOW
        if (isProtected(u)) return Verdict.ALLOW

        val hostAd = isAdHost(u)
        val adPath = looksLikeAdPath(u)
        val adVast = looksLikeVast(u)
        val adBrand = looksLikeAdBrand(u)
        val page = pageUrl ?: ""
        val affiliate = looksLikeAffiliateRedirect(u, 1) && page.isNotEmpty() && !sameSite(u, page)

        // same-site: passes unless it is an explicit ad (listed host + ad path)
        if (page.isNotEmpty() && sameSite(u, page) && !(hostAd && adPath)) {
            return if (hostAd || adPath) Verdict.STUB else Verdict.ALLOW
        }

        if (isMainFrame) {
            if (hostAd || adPath || affiliate || adVast) return Verdict.FAIL
            return Verdict.ALLOW
        }
        if (hostAd || adVast || adBrand || adPath) return Verdict.STUB
        return Verdict.ALLOW
    }

    /* ---------- stub responses (200 with an empty body) ---------- */

    private val GIF_1PX: ByteArray = android.util.Base64.decode(
        "R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
        android.util.Base64.DEFAULT
    )
    private val EMPTY_VAST: ByteArray = "<VAST version=\"3.0\"></VAST>".toByteArray()
    private val EMPTY_HTML: ByteArray = "<html></html>".toByteArray()

    data class Stub(val body: ByteArray, val mime: String)

    fun stubFor(resourceType: String?, url: String?): Stub {
        val u = url ?: ""
        if (looksLikeVast(u)) return Stub(EMPTY_VAST, "application/xml")
        when (resourceType?.lowercase()) {
            "image", "imageset" -> return Stub(GIF_1PX, "image/gif")
            "stylesheet", "font" -> return Stub(ByteArray(0), "text/css")
            "manifest", "fetch", "xhr", "xmlhttprequest", "ping" -> return Stub("{}".toByteArray(), "application/json")
            "media" -> return Stub(ByteArray(0), "video/mp4")
            "document", "subframe", "iframe" -> return Stub(EMPTY_HTML, "text/html")
        }
        val lowered = u.lowercase()
        if (lowered.contains("googletag") || lowered.contains("adsbygoogle") || lowered.contains("prebid")) {
            return Stub(ByteArray(0), "application/javascript")
        }
        return Stub(ByteArray(0), "text/plain")
    }

    /** Clean blocked page for the main frame (Streamo identity). */
    const val BLOCKED_PAGE_HTML = """
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تم منع الإعلان</title></head>
<body style="margin:0;background:#000000;color:#FFFFFF;font-family:Arial,Tahoma,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px">
<div style="font-size:44px;margin-bottom:14px">🚫</div>
<h2 style="margin:0 0 8px;font-size:21px">تم منع إعلان / تحويلة</h2>
<p style="color:#C9CDD3;font-size:13px;margin:0 0 26px;max-width:420px;line-height:1.9">هذه الصفحة وصلتك كإعلان أو تحويلة دعائية، وتم حظرها تلقائيًا بواسطة درع Streamo.</p>
<button onclick="history.length>1?history.back():(location.href='https://google.com/')" style="background:#FFFFFF;color:#000000;border:none;padding:13px 40px;border-radius:999px;font-size:15px;font-weight:bold;cursor:pointer">رجوع</button>
</body></html>"""
}
