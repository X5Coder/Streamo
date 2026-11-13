package com.streamo.link.android.search

import java.net.URI

/**
 * Streamo — search engines detection (port of shared/searchEngines.js).
 */
object StreamoSearch {
    data class Hit(val q: String, val engine: String)

    private data class Engine(val host: String, val path: String, val param: String, val name: String)

    private val ENGINES = listOf(
        Engine("google.", "/search", "q", "Google"),
        Engine("bing.com", "/search", "q", "Bing"),
        Engine("duckduckgo.com", "/", "q", "DuckDuckGo"),
        Engine("search.yahoo.com", "/search", "p", "Yahoo"),
        Engine("yandex.", "/search", "text", "Yandex"),
        Engine("search.brave.com", "/search", "q", "Brave"),
        Engine("search.marginalia.nu", "/search", "query", "Marginalia"),
        Engine("qwant.com", "/", "q", "Qwant"),
        Engine("youtube.com", "/results", "search_query", "YouTube"),
    )

    fun extract(url: String?): Hit? {
        if (url.isNullOrBlank()) return null
        return try {
            val u = URI(url)
            val host = (u.host ?: "").lowercase()
            val path = (u.path ?: "/").lowercase()
            for (e in ENGINES) {
                val hostMatch = host.contains(e.host) || host.endsWith(e.host)
                if (!hostMatch) continue
                if (!path.startsWith(e.path) && e.path != "/") continue
                if (e.path == "/" && path != "/") continue
                val q = parseQueryParam(u.rawQuery, e.param)?.trim()
                if (!q.isNullOrEmpty()) return Hit(q, e.name)
            }
            null
        } catch (ex: Exception) {
            null
        }
    }

    private fun parseQueryParam(rawQuery: String?, name: String): String? {
        if (rawQuery.isNullOrEmpty()) return null
        for (part in rawQuery.split('&')) {
            val eq = part.indexOf('=')
            if (eq <= 0) continue
            if (!part.substring(0, eq).equals(name, ignoreCase = true)) continue
            return try {
                java.net.URLDecoder.decode(part.substring(eq + 1), "UTF-8")
            } catch (e: Exception) {
                part.substring(eq + 1)
            }
        }
        return null
    }
}
