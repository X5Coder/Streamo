package com.streamo.link.android.data

import android.content.Context
import com.streamo.link.android.model.LinkEntry
import com.streamo.link.android.model.SearchEntry
import com.streamo.link.android.model.SessionEntry
import com.streamo.link.android.model.SessionState
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Streamo — the shared store (port of shared/store.js).
 * Source of truth: SharedPreferences with the SAME keys as the Windows build:
 *   streamo.links.v1 / streamo.search.v1 / streamo.tabs.v1 / streamo.links.firstBadge
 */
class StreamoStore(context: Context) {

    private val prefs = context.getSharedPreferences("streamo_store", Context.MODE_PRIVATE)

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    companion object {
        const val LINKS_KEY = "streamo.links.v1"
        const val SEARCH_KEY = "streamo.search.v1"
        const val SESSION_KEY = "streamo.tabs.v1"
        const val BADGE_KEY = "streamo.links.firstBadge"
        const val CRASH_FLAG_KEY = "streamo.crash.flag"

        const val MAX_LINKS = 300
        const val MAX_SEARCH = 200
    }

    private fun readLinks(): MutableList<LinkEntry> = readList(LINKS_KEY)
    private fun writeLinks(list: List<LinkEntry>) = writeList(LINKS_KEY, list)

    private inline fun <reified T> readList(key: String): MutableList<T> {
        val raw = prefs.getString(key, null) ?: return mutableListOf()
        return try {
            json.decodeFromString<List<T>>(raw).toMutableList()
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    private inline fun <reified T> writeList(key: String, list: List<T>) {
        try {
            prefs.edit().putString(key, json.encodeToString(list)).apply()
        } catch (e: Exception) {
            android.util.Log.e("StreamoStore", "failed to persist $key", e)
        }
    }

    private fun now(): Long = System.currentTimeMillis()

    private fun uid(prefix: String): String =
        prefix + java.lang.Long.toString(now(), 36) + java.lang.Integer.toString((Math.random() * 1e6).toInt(), 36)

    /* ---------- one-time cleanup (boot) ---------- */

    fun sanitizeLinks() {
        val links = readList<LinkEntry>(LINKS_KEY)
        if (links.isEmpty()) return
        val seen = HashSet<String>()
        val out = mutableListOf<LinkEntry>()
        for (item in links) {
            if (item.status == "fail") continue
            val url = item.url
            if (UrlsCompat.DASH.containsMatchIn(url)) continue
            if (UrlsCompat.RANGE_CAPTURE.containsMatchIn(url)) continue
            if (item.type == "dash") continue
            if (item.type == "audio") continue
            if (UrlsCompat.AUDIO_EXT.containsMatchIn(url)) continue
            val key = linkDedupeKey(item.url)
            if (seen.contains(key)) {
                val ix = out.indexOfFirst { linkDedupeKey(it.url) == key }
                if (ix >= 0) {
                    val challenger = item
                    val winner = if (scoreMovieEntry(challenger) > scoreMovieEntry(out[ix])) challenger else out[ix]
                    val loser = if (winner === challenger) out[ix] else challenger
                    var merged = winner.copy()
                    if (merged.pageUrl.isBlank() && loser.pageUrl.isNotBlank()) merged = merged.copy(pageUrl = loser.pageUrl)
                    val isMaster = Regex("""master\.m3u8(\?|#|$)|\.urlset/""", RegexOption.IGNORE_CASE).containsMatchIn(merged.url) || merged.isMaster
                    out[ix] = merged.copy(isMaster = isMaster)
                }
                continue
            }
            seen.add(key)
            out.add(item)
        }
        if (out.size != links.size) writeList(LINKS_KEY, out)
    }

    fun sanitizeSearchLog() {
        val items = readList<SearchEntry>(SEARCH_KEY)
        if (items.isEmpty()) return
        var changed = false
        val out = items.map { it ->
            val q = it.q.trim()
            if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(q)) return@map it
            var cleanQ = ""
            var cleanEngine = it.engine
            try {
                val u = java.net.URI(q)
                val host = (u.host ?: "").lowercase().removePrefix("www.")
                val hit = ENGINE_PARAMS.firstOrNull { e ->
                    host.contains(e.first) || host.endsWith(".${e.first}")
                }
                if (hit != null) {
                    val v = parseQueryParam(u.rawQuery, hit.second)
                    if (!v.isNullOrBlank()) { cleanQ = v.trim(); cleanEngine = hit.third }
                }
                if (cleanQ.isEmpty()) cleanQ = host
            } catch (e: Exception) {
                cleanQ = q.substringBefore('?').replace(Regex("^https?://", RegexOption.IGNORE_CASE), "").removePrefix("www.").removeSuffix("/")
            }
            if (cleanQ.isNotEmpty() && cleanQ != q) {
                changed = true
                it.copy(q = cleanQ, engine = cleanEngine)
            } else it
        }
        if (changed) writeList(SEARCH_KEY, out)
    }

    private fun parseQueryParam(rawQuery: String?, name: String): String? {
        if (rawQuery.isNullOrEmpty()) return null
        for (part in rawQuery.split('&')) {
            val eq = part.indexOf('=')
            if (eq <= 0) continue
            val k = part.substring(0, eq)
            if (!k.equals(name, ignoreCase = true)) continue
            return try {
                java.net.URLDecoder.decode(part.substring(eq + 1), "UTF-8")
            } catch (e: Exception) {
                part.substring(eq + 1)
            }
        }
        return null
    }

    private val ENGINE_PARAMS = listOf(
        Triple("google.", "q", "Google"),
        Triple("bing.com", "q", "Bing"),
        Triple("duckduckgo.com", "q", "DuckDuckGo"),
        Triple("search.yahoo.com", "p", "Yahoo"),
        Triple("yandex.", "text", "Yandex"),
        Triple("search.brave.com", "q", "Brave"),
        Triple("search.marginalia.nu", "query", "Marginalia"),
        Triple("qwant.com", "q", "Qwant"),
        Triple("youtube.com", "search_query", "YouTube"),
    )

    /* ---------- links ---------- */

    fun getLinks(): List<LinkEntry> = readLinks()

    /**
     * Smart dedupe key. HLS playlists that differ only by signature/quality segment
     * collapse to the same movie; .ts uses full path.
     */
    fun linkDedupeKey(url: String?): String {
        val u = url ?: ""
        return try {
            val uri = java.net.URI(u)
            val scheme = (uri.scheme ?: "http").lowercase()
            val host = (uri.host ?: "").lowercase()
            val path = (uri.path ?: "").lowercase()
            if (Regex("""\.m3u8$""", RegexOption.IGNORE_CASE).containsMatchIn(path)) {
                val segs = path.split('/').filter { it.isNotEmpty() }.toMutableList()
                if (segs.size > 1) segs.removeAt(segs.size - 1) // drop the playlist filename
                val kept = mutableListOf<String>()
                for (s in segs) {
                    if (Regex("""^\d{9,}$""").matches(s)) continue // signature/timestamp segment
                    val ix = s.indexOf('_')
                    kept.add(if (ix > 0) s.substring(0, ix) else s)
                }
                "$scheme://$host/${kept.joinToString("/")}"
            } else if (Regex("""\.ts$""", RegexOption.IGNORE_CASE).containsMatchIn(path)) {
                "$scheme://$host$path"
            } else {
                u
            }
        } catch (e: Exception) {
            u
        }
    }

    fun scoreMovieEntry(item: LinkEntry): Int {
        val url = item.url
        var s = 0
        if (item.isMaster) s += 100
        else if (Regex("""master\.m3u8(\?|#|$)|\.urlset/""", RegexOption.IGNORE_CASE).containsMatchIn(url)) s += 50
        else if (Regex("""index|playlist|media|chunklist|video""", RegexOption.IGNORE_CASE).containsMatchIn(url)) s -= 1
        return s
    }

    data class AddLinkResult(val entry: LinkEntry?, val added: Boolean, val merged: Boolean)

    fun addLink(url: String, pageUrl: String?, isMaster: Boolean = false): AddLinkResult {
        val rawUrl = url
        if (UrlsCompat.DASH.containsMatchIn(rawUrl) || UrlsCompat.RANGE_CAPTURE.containsMatchIn(rawUrl)) {
            return AddLinkResult(null, added = false, merged = false)
        }
        val links = readLinks()
        val t = now()
        val key = linkDedupeKey(url)
        val master = isMaster || Regex("""master\.m3u8(\?|#|$)|\.urlset/""", RegexOption.IGNORE_CASE).containsMatchIn(rawUrl)
        for (i in links.indices) {
            if (linkDedupeKey(links[i].url) != key) continue
            val existing = links[i]
            val incomingScore = scoreMovieEntry(LinkEntry(id = "", url = url, ts = t, isMaster = master))
            val existingScore = scoreMovieEntry(existing)
            var copy = existing
            var upgraded = false
            if (incomingScore > existingScore) {
                copy = copy.copy(url = url, type = if (master) "hls" else guessType(url), isMaster = master)
                upgraded = true
            } else if (master && !copy.isMaster) {
                copy = copy.copy(isMaster = true)
                upgraded = true
            }
            if (!pageUrl.isNullOrBlank() && copy.pageUrl.isBlank()) {
                copy = copy.copy(pageUrl = pageUrl)
                upgraded = true
            }
            if (upgraded) {
                links[i] = copy
                writeLinks(links)
                return AddLinkResult(copy, added = false, merged = true)
            }
            return AddLinkResult(copy, added = false, merged = true)
        }

        val entry = LinkEntry(
            id = uid("l"),
            url = url,
            type = guessType(url),
            status = "testing",
            pageUrl = pageUrl ?: "",
            ts = t,
            isMaster = master,
        )
        val out = (listOf(entry) + links).take(MAX_LINKS)
        writeLinks(out)
        return AddLinkResult(entry, added = true, merged = false)
    }

    fun updateLinkFields(id: String, status: String?, type: String?, size: Long?, httpStatus: Int?, contentType: String?, duration: Long?, via: String?, finalUrl: String?, error: String?, isMaster: Boolean?): LinkEntry? {
        val links = readLinks()
        val i = links.indexOfFirst { it.id == id }
        if (i < 0) return null
        var e = links[i]
        if (status != null) e = e.copy(status = status)
        if (type != null) e = e.copy(type = type)
        if (size !== null) e = e.copy(size = size)
        if (httpStatus !== null) e = e.copy(httpStatus = httpStatus)
        if (contentType != null) e = e.copy(contentType = contentType)
        if (duration !== null) e = e.copy(duration = duration)
        if (via != null) e = e.copy(via = via)
        if (finalUrl != null) e = e.copy(finalUrl = finalUrl)
        if (error !== null) e = e.copy(error = error)
        if (isMaster != null) e = e.copy(isMaster = isMaster)
        e = e.copy(testedAt = now(), probeV = 2)
        links[i] = e
        writeLinks(links)
        return e
    }

    fun removeLinkByUrl(url: String) {
        val key = linkDedupeKey(url)
        writeLinks(readLinks().filter { linkDedupeKey(it.url) != key })
    }

    fun clearLinks() = writeLinks(emptyList())
    fun deleteFailed() = writeLinks(readLinks().filter { it.status != "fail" })

    fun findLinkByUrl(url: String): LinkEntry? {
        val links = readLinks()
        return links.firstOrNull { it.url == url && it.status == "testing" } ?: links.firstOrNull { it.url == url }
    }

    /* ---------- search ---------- */

    fun getSearch(): List<SearchEntry> = readList(SEARCH_KEY)

    fun addSearch(q: String, url: String?, engine: String?): SearchEntry? {
        val query = q.trim()
        if (query.isEmpty()) return null
        val items = readList<SearchEntry>(SEARCH_KEY)
        if (items.isNotEmpty() && items[0].q == query && items[0].engine == (engine ?: "")) {
            return items[0] // consecutive duplicate — silently rejected
        }
        val entry = SearchEntry(id = uid("s"), q = query, url = url ?: "", engine = engine ?: "", ts = now())
        writeList(SEARCH_KEY, (listOf(entry) + items).take(MAX_SEARCH))
        return entry
    }

    fun removeSearch(id: String) = writeList(SEARCH_KEY, readList<SearchEntry>(SEARCH_KEY).filter { it.id != id })
    fun clearSearch() = writeList(SEARCH_KEY, emptyList<SearchEntry>())

    /* ---------- session ---------- */

    fun saveSession(state: SessionState) {
        try {
            prefs.edit().putString(SESSION_KEY, json.encodeToString(state)).apply()
        } catch (e: Exception) { }
    }

    fun readSession(): SessionState? {
        val raw = prefs.getString(SESSION_KEY, null) ?: return null
        return try {
            val s = json.decodeFromString<SessionState>(raw)
            val urls = s.urls.filter { Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it.url) }.take(30)
            if (urls.isEmpty()) return null
            s.copy(urls = urls, activeIndex = s.activeIndex.coerceIn(0, urls.size - 1))
        } catch (e: Exception) {
            null
        }
    }

    /* ---------- misc flags ---------- */

    fun badgeSeen(): Boolean = prefs.getString(BADGE_KEY, null) == "seen"
    fun markBadgeSeen() = prefs.edit().putString(BADGE_KEY, "seen").apply()

    fun writeCrashFlag() = prefs.edit().putLong(CRASH_FLAG_KEY, now()).apply()

    /** Returns true exactly once, only for a recent crash (< 10 min). */
    fun consumeCrashFlag(): Boolean {
        val ts = prefs.getLong(CRASH_FLAG_KEY, 0L)
        if (ts <= 0L) return false
        prefs.edit().remove(CRASH_FLAG_KEY).apply()
        return (now() - ts) < 10 * 60 * 1000L
    }

    /* ---------- helpers ---------- */

    fun guessType(url: String?): String = com.streamo.link.android.util.Urls.guessType(url)

    fun parseExpiry(url: String?): Expiry? {
        try {
            val u = java.net.URI(url ?: return null)
            val params = parseQueryParams(u.rawQuery)
            params["exp"]?.takeIf { it.all(Char::isDigit) }?.let { exp ->
                val expS = normUnixSeconds(exp) ?: return null
                return expiryFromExpiresAt(expS * 1000L)
            }
            val s = params["s"]?.takeIf { it.all(Char::isDigit) }?.let { normUnixSeconds(it) }
            val e = params["e"]?.takeIf { it.all(Char::isDigit) }?.let { normUnixSeconds(it) }
            if (s != null && e != null) {
                return if (e > 1_000_000_000L) expiryFromExpiresAt(e * 1000L)
                else expiryFromExpiresAt((s + e) * 1000L)
            }
            return null
        } catch (ex: Exception) {
            return null
        }
    }

    private fun parseQueryParams(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrEmpty()) return emptyMap()
        val out = linkedMapOf<String, String>()
        for (part in rawQuery.split('&')) {
            val eq = part.indexOf('=')
            if (eq <= 0) continue
            try {
                out[part.substring(0, eq)] = java.net.URLDecoder.decode(part.substring(eq + 1), "UTF-8")
            } catch (e: Exception) {
                out[part.substring(0, eq)] = part.substring(eq + 1)
            }
        }
        return out
    }

    private fun normUnixSeconds(v: String): Long? {
        val n = v.toLongOrNull() ?: return null
        if (n > 10_000_000_000_000L) return n / 1000L
        if (n > 100_000_000_000L) return n / 1000L
        return n
    }

    data class Expiry(val expiresAt: Long, val remainingSeconds: Long, val expired: Boolean)

    private fun expiryFromExpiresAt(expiresAtMs: Long): Expiry {
        val remaining = (expiresAtMs - now()) / 1000L
        return Expiry(expiresAtMs, remaining, remaining <= 0)
    }

    fun formatBytes(bytes: Long?): String? {
        if (bytes == null) return null
        val units = arrayOf("B", "KB", "MB", "GB")
        var i = 0
        var n = bytes.toDouble()
        while (n >= 1024 && i < units.size - 1) { n /= 1024.0; i++ }
        return if (i == 0) "$n ${units[i]}" else "%.${if (n >= 100) 0 else if (n >= 10) 1 else 2}f %s".format(n, units[i])
    }

    fun formatDuration(sec: Long?): String? {
        if (sec == null || sec < 0) return null
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return if (h > 0) "$h:${pad2(m)}:${pad2(s)}" else "$m:${pad2(s)}"
    }

    private fun pad2(n: Long): String = if (n < 10) "0$n" else "$n"

    fun formatExpiry(remainingSeconds: Long): String {
        if (remainingSeconds <= 0) return "Link expired"
        val h = remainingSeconds / 3600
        val m = (remainingSeconds % 3600) / 60
        val s = remainingSeconds % 60
        return when {
            h > 0 -> "Expires in ${h}h ${m}m"
            m > 0 -> "Expires in ${m}m ${s}s"
            else -> "Expires in ${s}s"
        }
    }

    fun timeAgo(ts: Long): String {
        val diff = ((now() - ts) / 1000L).coerceAtLeast(0L)
        return when {
            diff < 60 -> "now"
            diff < 3600 -> "${diff / 60}m ago"
            diff < 86400 -> "${diff / 3600}h ago"
            else -> "${diff / 86400}d ago"
        }
    }

    fun formatCaptureTime(ts: Long): String {
        return try {
            val d = java.util.Date(ts)
            val target = java.util.Calendar.getInstance().apply { time = d }
            val nowCal = java.util.Calendar.getInstance()
            val sameDay = target.get(java.util.Calendar.YEAR) == nowCal.get(java.util.Calendar.YEAR) &&
                target.get(java.util.Calendar.DAY_OF_YEAR) == nowCal.get(java.util.Calendar.DAY_OF_YEAR)
            val yesterday = (nowCal.timeInMillis - target.timeInMillis) in dayMs until 2 * dayMs
            val label = when {
                sameDay -> "Today"
                yesterday -> "Yesterday"
                else -> java.text.SimpleDateFormat("MMM d", java.util.Locale.US).format(d)
            }
            val time = java.text.SimpleDateFormat("h:mm a", java.util.Locale.US).format(d)
            "$label, $time"
        } catch (e: Exception) {
            java.text.SimpleDateFormat("MMM d, h:mm a", java.util.Locale.US).format(java.util.Date(ts))
        }
    }

    private val dayMs = 24L * 3600 * 1000

    fun formatTime(ts: Long): String =
        try {
            java.text.SimpleDateFormat("h:mm a, MMM d", java.util.Locale.US).format(java.util.Date(ts))
        } catch (e: Exception) {
            ts.toString()
        }

    object UrlsCompat {
        val DASH = Regex("""\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE)
        val RANGE_CAPTURE = Regex("""[?&]bytes=\d+-\d*""", RegexOption.IGNORE_CASE)
        val AUDIO_EXT = Regex("""\.(mp3|m4a|aac|wav|opus|flac)(\?|#|$)""", RegexOption.IGNORE_CASE)
    }
}
