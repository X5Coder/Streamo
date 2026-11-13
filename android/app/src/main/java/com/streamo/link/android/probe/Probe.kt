package com.streamo.link.android.probe

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Streamo — HTTP Range probe (port of windows/probe.js).
 * Multi-step verification so only genuinely playable links come back ok:
 *   1. Range GET with redirect chain (up to 5 hops) -> status / Content-Type / magic bytes
 *   2. Content-Disposition: attachment -> DOWNLOAD (never offered as playable)
 *   3. .mpd / DASH -> DASH_BLOCKED
 *   4. ?bytes=... partial captures -> RANGE_CAPTURE
 *   5. HLS: manifest parsed, variant + first segment fetched and sniffed
 */
object Probe {

    private const val TEST_TIMEOUT_MS = 10_000
    private const val MAX_REDIRECTS = 5
    private const val MANIFEST_READ_BYTES = 65536
    private const val SEGMENT_PROBE_BYTES = 8192

    private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    private val RANGE_CAPTURE_RE = Regex("""[?&]bytes=\d+-\d*""", RegexOption.IGNORE_CASE)
    private val DASH_URL_RE = Regex("""\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE)
    private val ATTACHMENT_RE = Regex("attachment", RegexOption.IGNORE_CASE)
    private val MEDIA_EXT_RE = Regex("""\.(mp4|webm|ogv|ogg|mkv|mov|avi|flv|mp3|m4a|wav|aac|opus|flac|m3u8|mpd|ts)(\?|#|$)""", RegexOption.IGNORE_CASE)

    data class ProbeResult(
        val url: String,
        val status: String,
        val type: String = "unknown",
        val duration: Long? = null,
        val size: Long? = null,
        val httpStatus: Int? = null,
        val contentType: String? = null,
        val via: String? = "http",
        val finalUrl: String? = null,
        val error: String? = null,
        val testedInMs: Long = 0,
        val isMaster: Boolean? = null,
    )

    private data class FetchOutcome(
        val httpStatus: Int = 0,
        val contentType: String? = null,
        val contentDisposition: String? = null,
        val size: Long? = null,
        val bytes: ByteArray = ByteArray(0),
        val finalUrl: String? = null,
        val error: String? = null,
    )

    /* ---------- sniffing helpers ---------- */

    private fun sniffMagic(bytes: ByteArray?): String? {
        if (bytes == null || bytes.size < 12) return null
        val head = String(bytes, 0, minOf(bytes.size, 16), Charsets.ISO_8859_1).lowercase()
        if (head.contains("ftyp") || String(bytes, 4, 4, Charsets.ISO_8859_1) == "ftyp") return "mp4"
        if (bytes[0] == 0x1A.toByte() && bytes[1] == 0x45.toByte() && bytes[2] == 0xDF.toByte() && bytes[3] == 0xA3.toByte()) return "webm"
        if (head.contains("oggs")) return "ogg"
        if (head.startsWith("flv")) return "flv"
        if (head.contains("#extm3u")) return "hls"
        if (head.contains("<mpd")) return "dash"
        if (bytes.size >= 3 && String(bytes, 0, 3, Charsets.ISO_8859_1) == "ID3") return "audio"
        if (bytes[0] == 0xFF.toByte() && (bytes[1].toInt() and 0xE0) == 0xE0) return "audio"
        if (head.startsWith("riff") && head.contains("wave")) return "wav"
        if (String(bytes, 0, 4, Charsets.ISO_8859_1) == "fLaC") return "audio"
        return null
    }

    private fun sniffSegment(bytes: ByteArray?, contentType: String?): String? {
        val ct = (contentType ?: "").lowercase()
        if (ct.startsWith("image/")) return "image"
        if (bytes == null || bytes.isEmpty()) return null
        fun matches(vararg arr: Int): Boolean = arr.indices.all { i -> i < bytes.size && bytes[i].toInt() == arr[i] }
        if (bytes.size >= 4 && matches(0x89, 0x50, 0x4E, 0x47)) return "image"
        if (bytes.size >= 3 && matches(0xFF, 0xD8, 0xFF)) return "image"
        if (bytes.size >= 4 && matches(0x47, 0x49, 0x46, 0x38)) return "image"
        if (bytes.size >= 12) {
            val head = String(bytes, 0, 12, Charsets.ISO_8859_1).lowercase()
            if (head.startsWith("riff") && head.contains("webp")) return "image"
        }
        if (bytes[0] == 0x47.toByte()) return "ts"
        val head12 = String(bytes, 0, minOf(bytes.size, 12), Charsets.ISO_8859_1).lowercase()
        if (head12.contains("ftyp")) return "fmp4"
        if (head12.contains("oggs")) return "other"
        if (head12.contains("#extm3u")) return "other"
        return null
    }

    private fun looksLikeHtml(bytes: ByteArray?): Boolean {
        if (bytes == null || bytes.isEmpty()) return false
        val head = String(bytes, 0, minOf(bytes.size, 512), Charsets.ISO_8859_1).lowercase()
        return head.contains("<html") || head.contains("<!doctype") || head.contains("<body")
    }

    private fun typeFromUrl(url: String?): String {
        val u = url ?: return "unknown"
        val m = MEDIA_EXT_RE.find(u) ?: return "unknown"
        val ext = m.groupValues[1].lowercase()
        return when (ext) {
            "m3u8" -> "hls"
            "mpd" -> "dash"
            in setOf("mp3", "m4a", "wav", "aac", "opus", "flac") -> "audio"
            else -> ext
        }
    }

    private fun isMediaExt(url: String?): Boolean = MEDIA_EXT_RE.containsMatchIn(url ?: "")

    private fun isManifestType(ct: String?, url: String?): Boolean {
        val c = (ct ?: "").lowercase()
        return c.contains("mpegurl") || c.contains("dash+xml") ||
            Regex("""\.m3u8(\?|#|$)|\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(url ?: "")
    }

    private fun isMediaMime(ct: String?): Boolean {
        val c = (ct ?: "").lowercase()
        return c.startsWith("video/") || c.startsWith("audio/") ||
            c.contains("mpegurl") || c.contains("dash+xml") ||
            c == "application/octet-stream" || c == "binary/octet-stream" || c == "application/binary"
    }

    /* ---------- HTTP plumbing (manual redirect chain, like fetchOnce) ---------- */

    private fun buildHeaders(referer: String?, rangeBytes: Int): Map<String, String> {
        val headers = linkedMapOf(
            "Range" to "bytes=0-${rangeBytes - 1}",
            "User-Agent" to UA,
            "Accept" to "*/*"
        )
        if (!referer.isNullOrBlank()) headers["Referer"] = referer
        return headers
    }

    private suspend fun fetchOnce(startUrl: String, referer: String?, readBytes: Int): FetchOutcome = withContext(Dispatchers.IO) {
        var hops = 0
        var currentUrl = startUrl
        while (true) {
            val u = try { URL(currentUrl) } catch (e: Exception) { return@withContext FetchOutcome(error = "BAD_URL") }
            if (u.protocol != "http" && u.protocol != "https") return@withContext FetchOutcome(error = "UNSUPPORTED")
            var conn: HttpURLConnection? = null
            try {
                conn = (u.openConnection() as? HttpURLConnection) ?: return@withContext FetchOutcome(error = "EXCEPTION")
                conn.instanceFollowRedirects = false
                conn.connectTimeout = TEST_TIMEOUT_MS
                conn.readTimeout = TEST_TIMEOUT_MS
                conn.requestMethod = "GET"
                for ((k, v) in buildHeaders(referer, readBytes)) conn.setRequestProperty(k, v)

                val status = conn.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    val location = conn.getHeaderField("Location")
                    conn.disconnect()
                    if (location.isNullOrEmpty()) return@withContext FetchOutcome(error = "BAD_REDIRECT", httpStatus = status)
                    if (hops >= MAX_REDIRECTS) return@withContext FetchOutcome(error = "TOO_MANY_REDIRECTS", httpStatus = status)
                    hops += 1
                    val next = try { URL(URL(currentUrl), location).toExternalForm() } catch (e: Exception) {
                        return@withContext FetchOutcome(error = "BAD_REDIRECT", httpStatus = status)
                    }
                    if (DASH_URL_RE.containsMatchIn(next)) return@withContext FetchOutcome(error = "DASH_BLOCKED", httpStatus = status, finalUrl = next)
                    if (RANGE_CAPTURE_RE.containsMatchIn(next)) return@withContext FetchOutcome(error = "RANGE_CAPTURE", httpStatus = status, finalUrl = next)
                    currentUrl = next
                    continue
                }

                val ct = conn.getHeaderField("Content-Type")?.lowercase()
                val disposition = conn.getHeaderField("Content-Disposition")
                var size: Long? = null
                val contentRange = conn.getHeaderField("Content-Range")
                if (contentRange != null) {
                    val m = Regex("""/(\d+)\s*$""").find(contentRange)
                    if (m != null) size = m.groupValues[1].toLongOrNull()
                }
                if (size == null && status != 206) {
                    size = conn.getHeaderField("Content-Length")?.toLongOrNull()
                }

                val bytes = try {
                    val stream = try { conn.inputStream } catch (e: Exception) { conn.errorStream }
                    stream?.use { s ->
                        val out = java.io.ByteArrayOutputStream()
                        val buf = ByteArray(8192)
                        var total = 0
                        while (total < readBytes + 8192) {
                            val n = try { s.read(buf) } catch (e: Exception) { break }
                            if (n < 0) break
                            out.write(buf, 0, n)
                            total += n
                        }
                        out.toByteArray()
                    } ?: ByteArray(0)
                } catch (e: Exception) {
                    ByteArray(0)
                }

                return@withContext FetchOutcome(
                    httpStatus = status,
                    contentType = ct,
                    contentDisposition = disposition,
                    size = size,
                    bytes = bytes,
                    finalUrl = currentUrl,
                )
            } catch (e: java.net.SocketTimeoutException) {
                return@withContext FetchOutcome(error = "TIMEOUT")
            } catch (e: java.io.IOException) {
                return@withContext FetchOutcome(error = if (e is javax.net.ssl.SSLException) "NETWORK" else "NETWORK")
            } finally {
                try { conn?.disconnect() } catch (e: Exception) {}
            }
        }
        @Suppress("UNREACHABLE_CODE")
        FetchOutcome(error = "EXCEPTION")
    }

    private fun firstVariantUri(text: String): String? {
        val lines = text.split(Regex("\r?\n"))
        for (i in lines.indices) {
            val line = lines[i].trim()
            if (!Regex("^#EXT-X-STREAM-INF", RegexOption.IGNORE_CASE).containsMatchIn(line)) continue
            for (j in i + 1 until lines.size) {
                val v = lines[j].trim()
                if (v.isEmpty()) continue
                if (v.startsWith("#")) continue
                return v
            }
        }
        return null
    }

    private fun firstSegmentUri(text: String): String? {
        for (raw in text.split(Regex("\r?\n"))) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("#")) continue
            return line
        }
        return null
    }

    private data class HlsVerdict(val ok: Boolean, val error: String? = null, val isMaster: Boolean? = null)

    private suspend fun validateHls(manifestUrl: String, referer: String?, prefetched: FetchOutcome?): HlsVerdict {
        // Do the work inline (suspend)
        val initial: FetchOutcome = if (prefetched != null && prefetched.bytes.isNotEmpty()) prefetched
            else fetchOnce(manifestUrl, referer, MANIFEST_READ_BYTES).let { r ->
                if (r.error != null) {
                    return HlsVerdict(false, if (r.error == "TIMEOUT") "HLS_MANIFEST" else r.error)
                }
                if (r.contentDisposition != null && ATTACHMENT_RE.containsMatchIn(r.contentDisposition)) {
                    return HlsVerdict(false, "DOWNLOAD")
                }
                if (r.httpStatus < 200 || r.httpStatus >= 300) return HlsVerdict(false, "HTTP_${r.httpStatus}")
                r
            }

        val bytes = initial.bytes
        val finalUrl = initial.finalUrl ?: manifestUrl
        if (bytes.isEmpty()) return HlsVerdict(false, "HLS_MANIFEST")
        if (looksLikeHtml(bytes)) return HlsVerdict(false, "HLS_HTML")
        val text = String(bytes, Charsets.UTF_8)
        if (!text.contains("#EXTM3U")) return HlsVerdict(false, "HLS_NO_TAG")

        return if (Regex("#EXT-X-STREAM-INF", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            val variant = firstVariantUri(text) ?: return HlsVerdict(false, "HLS_NO_VARIANT", isMaster = true)
            val variantUrl = resolve(finalUrl, variant) ?: return HlsVerdict(false, "HLS_BAD_VARIANT", isMaster = true)
            val r2 = fetchOnce(variantUrl, referer, MANIFEST_READ_BYTES)
            if (r2.error != null) return HlsVerdict(false, "HLS_VARIANT", isMaster = true)
            if (r2.contentDisposition != null && ATTACHMENT_RE.containsMatchIn(r2.contentDisposition)) return HlsVerdict(false, "DOWNLOAD", isMaster = true)
            if (r2.httpStatus < 200 || r2.httpStatus >= 300) return HlsVerdict(false, "HTTP_${r2.httpStatus}", isMaster = true)
            if (looksLikeHtml(r2.bytes)) return HlsVerdict(false, "HLS_VARIANT_HTML", isMaster = true)
            val text2 = String(r2.bytes, Charsets.UTF_8)
            if (!text2.contains("#EXTM3U")) return HlsVerdict(false, "HLS_VARIANT_NO_TAG", isMaster = true)
            probeSegment(text2, r2.finalUrl ?: variantUrl, referer, isMaster = true)
        } else {
            if (!Regex("#EXTINF|#EXT-X-TARGETDURATION", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
                return HlsVerdict(false, "HLS_EMPTY_PLAYLIST", isMaster = false)
            }
            probeSegment(text, finalUrl, referer, isMaster = false)
        }
    }

    private fun resolve(base: String, rel: String): String? = try {
        URL(URL(base), rel).toExternalForm()
    } catch (e: Exception) {
        try { URL(rel).toExternalForm() } catch (e2: Exception) { null }
    }

    private suspend fun probeSegment(playlistText: String, mediaUrl: String, referer: String?, isMaster: Boolean): HlsVerdict {
        val seg = firstSegmentUri(playlistText) ?: return HlsVerdict(false, "HLS_EMPTY_PLAYLIST", isMaster)
        val segUrl = resolve(mediaUrl, seg) ?: return HlsVerdict(false, "HLS_BAD_SEGMENT", isMaster)
        val r3 = fetchOnce(segUrl, referer, SEGMENT_PROBE_BYTES)
        if (r3.error != null) return HlsVerdict(false, "HLS_SEGMENT", isMaster)
        if (r3.contentDisposition != null && ATTACHMENT_RE.containsMatchIn(r3.contentDisposition)) return HlsVerdict(false, "DOWNLOAD", isMaster)
        if (r3.httpStatus < 200 || r3.httpStatus >= 300) return HlsVerdict(false, "HLS_SEGMENT_HTTP", isMaster)
        if (looksLikeHtml(r3.bytes)) return HlsVerdict(false, "HLS_SEGMENT_HTML", isMaster)
        val kind = sniffSegment(r3.bytes, r3.contentType)
        if (kind == "image") return HlsVerdict(false, "HLS_IMAGE_SEGMENT", isMaster)
        if (kind == null) return HlsVerdict(false, "HLS_SEGMENT_NOT_MEDIA", isMaster)
        return HlsVerdict(true, null, isMaster)
    }

    /* ---------- the public API ---------- */

    suspend fun probeLink(url: String, pageUrl: String?): ProbeResult {
        val t0 = System.currentTimeMillis()
        val out = ProbeResult(url = url, status = "fail", type = typeFromUrl(url), via = "http")

        fun finish(patch: ProbeResult.() -> ProbeResult): ProbeResult {
            val r = out.patch()
            return r.copy(testedInMs = System.currentTimeMillis() - t0)
        }

        if (RANGE_CAPTURE_RE.containsMatchIn(url)) return finish { copy(error = "RANGE_CAPTURE") }
        if (DASH_URL_RE.containsMatchIn(url)) return finish { copy(type = "dash", error = "DASH_BLOCKED") }

        var referer = ""
        if (!pageUrl.isNullOrBlank() && Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(pageUrl)) {
            try {
                val u = URL(pageUrl)
                referer = (u.protocol + "://" + u.host).let { base ->
                    if (u.port > 0 && u.port != 80 && u.port != 443) "$base:${u.port}" else base
                } + "/"
            } catch (e: Exception) { referer = "" }
        }

        val r = fetchOnce(url, referer.ifBlank { null }, MANIFEST_READ_BYTES)
        if (r.error != null) {
            return when (r.error) {
                "DASH_BLOCKED" -> finish { copy(type = "dash", error = "DASH_BLOCKED", httpStatus = r.httpStatus.takeIf { it > 0 }, finalUrl = r.finalUrl) }
                "RANGE_CAPTURE" -> finish { copy(error = "RANGE_CAPTURE", httpStatus = r.httpStatus.takeIf { it > 0 }, finalUrl = r.finalUrl) }
                "TIMEOUT" -> finish { copy(error = "NETWORK") }
                else -> finish { copy(error = r.error, httpStatus = r.httpStatus.takeIf { it > 0 }, finalUrl = r.finalUrl) }
            }
        }

        val status = r.httpStatus
        val ct = r.contentType
        val size = r.size
        val finalUrl = r.finalUrl?.takeIf { it != url }
        val okRange = status in 200..299

        if (r.contentDisposition != null && ATTACHMENT_RE.containsMatchIn(r.contentDisposition)) {
            return finish { copy(httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = "DOWNLOAD") }
        }

        val magic = sniffMagic(r.bytes)
        val treatAsHls = magic == "hls" || isManifestType(ct, r.finalUrl ?: url)

        if (!okRange) {
            return finish { copy(httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = "HTTP_$status") }
        }

        if (treatAsHls) {
            val fin = r.finalUrl ?: url
            if (Regex("""\.mpd(\?|#|$)""", RegexOption.IGNORE_CASE).containsMatchIn(fin) || (ct ?: "").contains("dash+xml")) {
                return finish { copy(type = "dash", httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = "DASH_BLOCKED") }
            }
            val v = validateHls(fin, referer.ifBlank { null }, r)
            return if (v.ok) {
                finish { copy(status = "ok", type = "hls", httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, isMaster = v.isMaster) }
            } else {
                finish { copy(type = "hls", httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = v.error ?: "HLS_INVALID", isMaster = v.isMaster) }
            }
        }

        if (magic != null) {
            return finish { copy(status = "ok", type = magic, httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl) }
        }
        if (isMediaMime(ct)) {
            var t = typeFromUrl(r.finalUrl ?: url)
            if (t == "unknown") t = if ((ct ?: "").startsWith("audio/")) "audio" else "mp4"
            if (t == "dash") return finish { copy(type = "dash", httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = "DASH_BLOCKED") }
            return finish { copy(status = "ok", type = t, httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl) }
        }
        if (looksLikeHtml(r.bytes)) {
            return finish { copy(httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = "NOT_MEDIA") }
        }
        if (isMediaExt(r.finalUrl ?: url) && Regex("^(video/|audio/|application/octet-stream|binary/octet-stream|application/binary)", RegexOption.IGNORE_CASE).containsMatchIn(ct ?: "application/octet-stream")) {
            return finish { copy(status = "ok", type = typeFromUrl(r.finalUrl ?: url), httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl) }
        }
        return finish { copy(httpStatus = status, contentType = ct, size = size, finalUrl = finalUrl, error = "NOT_MEDIA") }
    }
}
