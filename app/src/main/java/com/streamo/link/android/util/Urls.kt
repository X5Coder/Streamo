package com.streamo.link.android.util

import java.net.URI
import java.net.URL

object Urls {
    fun isHttp(u: String?): Boolean = u?.let { Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(it) } == true

    fun hostOf(u: String?): String {
        if (u.isNullOrBlank()) return ""
        return try {
            (URI(u).host ?: "").lowercase()
        } catch (e: Exception) {
            try { URL(u).host.lowercase() } catch (e2: Exception) { "" }
        }
    }

    fun etld1(host: String?): String {
        val parts = (host ?: "").split('.').filter { it.isNotEmpty() }
        return if (parts.size <= 2) parts.joinToString(".") else parts.takeLast(2).joinToString(".")
    }

    fun isGoogleHost(host: String?): Boolean =
        Regex("(^|\\.)google\\.[a-z.]{2,7}\$", RegexOption.IGNORE_CASE).matches(host ?: "")

    fun shortHost(url: String?): String = hostOf(url).removePrefix("www.").ifBlank { "link" }

    fun truncate(s: String?, n: Int): String {
        val str = s ?: ""
        return if (str.length > n) str.take(n - 1) + "..." else str
    }

    fun guessType(url: String?): String {
        val m = Regex("""\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$)""", RegexOption.IGNORE_CASE).find(url ?: "")
        if (m == null) return "unknown"
        val ext = m.groupValues[1].lowercase()
        return when (ext) {
            "m3u8" -> "hls"
            "mpd" -> "dash"
            in setOf("mp3", "m4a", "wav", "aac", "opus", "flac") -> "audio"
            else -> ext
        }
    }

    val MEDIA_RE = Regex("""\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8)([?#].*)?$""", RegexOption.IGNORE_CASE)
    val TS_RE = Regex("""\.ts([?#].*)?$""", RegexOption.IGNORE_CASE)
    val MPD_RE = Regex("""\.mpd([?#].*)?$""", RegexOption.IGNORE_CASE)
    val RANGE_CAPTURE_RE = Regex("""[?&]bytes=\d+-\d*""", RegexOption.IGNORE_CASE)
    val MEDIA_MIME_RE = Regex("^(video/|audio/|application/(vnd\\.apple\\.)?(mpegurl|x-mpegurl|mpegurl))", RegexOption.IGNORE_CASE)
    val AUDIO_URL_RE = Regex("""(^|[/_-])(audio|aac|m4a|mp4a)([/_.-]|\?|#|$)""", RegexOption.IGNORE_CASE)
    val AUDIO_EXT_RE = Regex("""\.(mp3|m4a|aac|wav|opus|flac)(\?|#|$)""", RegexOption.IGNORE_CASE)

    fun isDashUrl(url: String?): Boolean = MPD_RE.containsMatchIn(url ?: "")
    fun isRangeCapture(url: String?): Boolean = RANGE_CAPTURE_RE.containsMatchIn(url ?: "")

    fun isAudioOnlyUrl(url: String?): Boolean {
        val u = url ?: ""
        if (Regex("""\.(m3u8|mpd)(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(u)) return false
        return AUDIO_EXT_RE.containsMatchIn(u) || AUDIO_URL_RE.containsMatchIn(u)
    }

    fun resolveRelative(base: String?, rel: String?): String? {
        if (rel.isNullOrBlank()) return null
        if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(rel)) return rel
        if (base.isNullOrBlank()) return null
        return try {
            URL(URL(base), rel).toExternalForm()
        } catch (e: Exception) {
            try { URL(rel).toExternalForm() } catch (e2: Exception) { null }
        }
    }
}
