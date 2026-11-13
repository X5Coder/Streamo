package com.streamo.link.android.model

import kotlinx.serialization.Serializable

@Serializable
data class LinkEntry(
    val id: String,
    val url: String,
    val type: String = "unknown",
    val size: Long? = null,
    val httpStatus: Int? = null,
    val contentType: String? = null,
    val duration: Long? = null,
    val status: String = "testing", // testing | ok | fail
    val error: String? = null,
    val via: String? = null,
    val finalUrl: String? = null,
    val pageUrl: String = "",
    val ts: Long = 0L,
    val testedAt: Long? = null,
    val isMaster: Boolean = false,
    val probeV: Int = 2,
)

@Serializable
data class SearchEntry(
    val id: String,
    val q: String,
    val url: String = "",
    val engine: String = "",
    val ts: Long,
)

@Serializable
data class SessionEntry(
    val url: String,
    val title: String = "",
)

@Serializable
data class SessionState(
    val urls: List<SessionEntry>,
    val activeIndex: Int = 0,
    val ts: Long = 0L,
)
