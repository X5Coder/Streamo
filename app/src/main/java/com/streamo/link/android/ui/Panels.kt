package com.streamo.link.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.scale
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.link.android.model.LinkEntry
import com.streamo.link.android.model.SearchEntry
import com.streamo.link.android.state.BrowserViewModel
import com.streamo.link.android.state.Panel
import com.streamo.link.android.state.TabUi

private val MonoFont = FontFamily.Monospace

/* ================= the links panel host (below the toolbar) ================= */

@Composable
fun LinksPanelHost(vm: BrowserViewModel, modifier: Modifier = Modifier) {
    val panel by vm.panel.collectAsState()
    val links by vm.links.collectAsState()

    Box(modifier = modifier.fillMaxSize().clipToBounds()) {
        AnimatedVisibility(
            visible = panel == Panel.LINKS,
            enter = slideInHorizontally(
                initialOffsetX = { it },
                animationSpec = tween(260, easing = androidx.compose.animation.core.FastOutSlowInEasing),
            ) + fadeIn(tween(200)),
            exit = slideOutHorizontally(
                targetOffsetX = { it },
                animationSpec = tween(240, easing = androidx.compose.animation.core.FastOutSlowInEasing),
            ) + fadeOut(tween(180)),
        ) {
            LinksPanel(vm, links, onClose = { vm.closePanel() })
        }
    }
}

/* ================= the full-screen panels overlay (Records / Tabs — above the toolbar) ================= */

@Composable
fun FullPanelsOverlay(vm: BrowserViewModel, modifier: Modifier = Modifier) {
    val panel by vm.panel.collectAsState()
    val searches by vm.searches.collectAsState()
    val tabs by vm.tabs.collectAsState()
    val ram by vm.ramInfo.collectAsState()

    Box(modifier = modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = panel == Panel.SEARCH,
            enter = fadeIn(animationSpec = tween(220)),
            exit = fadeOut(animationSpec = tween(200)),
        ) {
            SearchPanel(vm, searches, onClose = { vm.closePanel() }, fullScreen = true)
        }
        AnimatedVisibility(
            visible = panel == Panel.TABS,
            enter = fadeIn(animationSpec = tween(220)),
            exit = fadeOut(animationSpec = tween(200)),
        ) {
            TabsPanel(vm, tabs, ram, onClose = { vm.closePanel() }, fullScreen = true)
        }
    }
}

/* ================= scrim ================= */

@Composable
fun PanelScrim(visible: Boolean, onClick: () -> Unit) {
    if (!visible) return
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.55f))
            .clickable(onClick = onClick),
    )
}

/* ================= shared bits ================= */

@Composable
private fun PanelHeader(
    icon: @Composable () -> Unit,
    title: String,
    count: Int,
    onClose: () -> Unit,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .background(StreamoColors.Panel)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier.size(32.dp).background(StreamoColors.Bg, RoundedCornerShape(9.dp)),
                contentAlignment = Alignment.Center,
            ) { icon() }
            Text(
                text = title,
                color = StreamoColors.Text,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.5.sp,
                modifier = Modifier.padding(start = 10.dp),
            )
            Box(modifier = Modifier.weight(1f)) // push count + close to the far end (like margin-inline-start:auto)
            Box(
                modifier = Modifier
                    .padding(start = 10.dp)
                    .defaultMinSize(minWidth = 26.dp)
                    .height(22.dp)
                    .background(StreamoColors.Card2, CircleShape)
                    .padding(horizontal = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(count.toString(), color = StreamoColors.Text, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
            Box(
                modifier = Modifier
                    .padding(start = 8.dp)
                    .size(30.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Icon(StreamoIcons.Close, contentDescription = "Close", tint = StreamoColors.Muted, modifier = Modifier.size(16.dp))
            }
        }
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(StreamoColors.Border))
    }
}

@Composable
private fun VersionFooter() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(28.dp)
            .background(StreamoColors.Panel)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text("STREAMO", color = StreamoColors.Dim, fontSize = 7.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
        Text("  •  ", color = androidx.compose.ui.graphics.Color(0xFF2E2E2E), fontSize = 9.sp)
        Text("v2.0.0", color = androidx.compose.ui.graphics.Color(0xFFC9CDD3), fontSize = 7.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.2.sp)
    }
}

@Composable
private fun CreditFooter(vm: BrowserViewModel) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 14.dp, bottom = 16.dp, start = 10.dp, end = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(StreamoColors.Border))
        Box(modifier = Modifier.height(8.dp))
        Text(
            "Streamo is an open-source project developed by Kimo",
            color = StreamoColors.Muted,
            fontSize = 7.5.sp,
            letterSpacing = 0.2.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                modifier = Modifier.size(28.dp).clip(CircleShape).clickable {
                    vm.openExternal("https://github.com/X5Coder/Streamo")
                },
                contentAlignment = Alignment.Center,
            ) { Icon(StreamoIcons.GitHub, contentDescription = "GitHub", modifier = Modifier.size(14.dp)) }
            Box(
                modifier = Modifier.size(28.dp).clip(CircleShape).clickable {
                    vm.openExternal("https://live-cinema.pages.dev/")
                },
                contentAlignment = Alignment.Center,
            ) { Icon(StreamoIcons.Globe, contentDescription = "Streamo website", modifier = Modifier.size(14.dp)) }
        }
    }
}

@Composable
private fun PanelSurface(modifier: Modifier = Modifier, fullScreen: Boolean = false, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(StreamoColors.Panel)
            .then(if (fullScreen) Modifier.statusBarsPadding() else Modifier)
            .navigationBarsPadding(),
        content = content,
    )
}

/* ================= Extracted Links panel ================= */

/** Card entrance — mirrors Windows cardIn (translateY -9px, scale .97, staggered). */
@Composable
private fun CardEntrance(index: Int, content: @Composable () -> Unit) {
    val delay = minOf(index, 13) * 40L
    var shown by remember { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(delay)
        shown = true
    }
    val alpha by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(340, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        label = "card-in-alpha",
    )
    val offsetY by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (shown) 0f else -9f,
        animationSpec = tween(340, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        label = "card-in-offset",
    )
    val scale by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (shown) 1f else 0.97f,
        animationSpec = tween(340, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        label = "card-in-scale",
    )
    Box(
        modifier = Modifier
            .alpha(alpha)
            .offset(y = offsetY.dp)
            .scale(scale),
    ) { content() }
}

@Composable
private fun LinksPanel(vm: BrowserViewModel, links: List<LinkEntry>, onClose: () -> Unit) {
    PanelSurface(modifier = Modifier.fillMaxSize(), fullScreen = false) {
        PanelHeader(
            icon = { Icon(StreamoIcons.ChainLink, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp)) },
            title = "Extracted Links",
            count = links.size,
            onClose = onClose,
        )
        // clear-all with two-step confirm
        ClearAllButton(label = "Clear all", onConfirm = { vm.clearAllLinks() })

        LazyColumn(
            state = rememberLazyListState(),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (links.isEmpty()) {
                item { EmptyState(StreamoIcons.LinkBig, "No extracted links yet",
                    "Videos you play get captured here automatically — with size, type and a live test result.") }
            } else {
                itemsIndexed(links, key = { _, it -> it.id }) { index, item -> CardEntrance(index) { LinkCard(vm, item) } }
            }
            item { CreditFooter(vm) }
        }
        VersionFooter()
    }
}

@Composable
private fun LinkCard(vm: BrowserViewModel, item: LinkEntry) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(StreamoColors.Card)
            .border(1.dp, StreamoColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        // status + meta
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(item)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(text = typeLabel(item.type), color = StreamoColors.Muted, fontSize = 8.sp, fontWeight = FontWeight.SemiBold)
                vm.store.formatBytes(item.size)?.let { Text(" · $it", color = StreamoColors.Muted, fontSize = 8.sp) }
                item.httpStatus?.let { Text(" · HTTP $it", color = StreamoColors.Muted, fontSize = 8.sp) }
                vm.store.formatDuration(item.duration)?.let { Text(" · $it", color = StreamoColors.Muted, fontSize = 8.sp) }
            }
        }
        // url block
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(StreamoColors.CardDeep)
                .border(1.dp, StreamoColors.BorderSoft, RoundedCornerShape(8.dp))
                .padding(start = 9.dp, end = 11.dp, top = 7.dp, bottom = 7.dp),
        ) {
            Text(
                text = item.finalUrl ?: item.url,
                color = StreamoColors.TextSoft,
                fontSize = 8.sp,
                fontFamily = MonoFont,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                softWrap = false,
            )
        }
        // time row
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CaptureTime(vm, item.ts)
            ExpiryChip(vm, item)
        }
        // actions
        if (item.status == "ok") {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                CardActionButton(
                    label = "Open",
                    icon = { Icon(StreamoIcons.OpenExternal, contentDescription = null, tint = StreamoColors.Text, modifier = Modifier.size(13.dp)) },
                    onClick = { vm.openExternal(item.finalUrl ?: item.url) },
                    modifier = Modifier.weight(1f),
                )
                CardActionButton(
                    label = "Player",
                    icon = { Icon(StreamoIcons.PlayWhite, contentDescription = null, tint = StreamoColors.Text, modifier = Modifier.size(13.dp)) },
                    onClick = { vm.openPlayer(item.finalUrl ?: item.url, item.pageUrl) },
                    modifier = Modifier.weight(1f),
                )
                CardActionButton(
                    label = "Copy",
                    icon = null,
                    onClick = { vm.copyToClipboard(item.finalUrl ?: item.url) },
                    modifier = Modifier.weight(1f),
                )
                CardActionButton(
                    label = "Renew",
                    icon = { Icon(StreamoIcons.Reload, contentDescription = null, tint = StreamoColors.Text, modifier = Modifier.size(13.dp)) },
                    onClick = { vm.renewLink(item.pageUrl, item) },
                    modifier = Modifier.weight(1f),
                )
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                CardActionButton(
                    label = "Renew",
                    icon = { Icon(StreamoIcons.Reload, contentDescription = null, tint = StreamoColors.Text, modifier = Modifier.size(13.dp)) },
                    onClick = { vm.renewLink(item.pageUrl, item) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun StatusChip(item: LinkEntry) {
    when (item.status) {
        "testing" -> {
            val pulse = rememberInfiniteTransition(label = "dot")
            val dotAlpha by pulse.animateFloat(
                initialValue = 0.35f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(550, easing = LinearEasing), RepeatMode.Reverse),
                label = "dot-alpha",
            )
            Row(
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(StreamoColors.GoldBg).padding(horizontal = 9.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Box(modifier = Modifier.size(6.dp).background(StreamoColors.Gold, CircleShape).alpha(dotAlpha))
                Text("Testing…", color = StreamoColors.Gold, fontSize = 7.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.05.sp)
            }
        }
        "ok" -> Row(
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(StreamoColors.OkBg).padding(horizontal = 9.dp, vertical = 3.dp),
        ) { Text("✓ Working", color = StreamoColors.OkText, fontSize = 7.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.05.sp) }
        else -> Row(
            modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(StreamoColors.FailBg).padding(horizontal = 9.dp, vertical = 3.dp),
        ) { Text("✗ Failed", color = StreamoColors.Fail, fontSize = 7.5.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.05.sp) }
    }
}

private fun typeLabel(t: String?): String {
    if (t.isNullOrBlank()) return "Link"
    val map = mapOf("mp4" to "MP4", "webm" to "WebM", "mkv" to "MKV", "mov" to "MOV", "flv" to "FLV", "mp3" to "MP3", "hls" to "HLS", "dash" to "DASH", "audio" to "Audio", "unknown" to "Link", "avi" to "AVI", "ogv" to "OGG", "ogg" to "OGG")
    return map[t.lowercase()] ?: t.uppercase()
}

@Composable
private fun CaptureTime(vm: BrowserViewModel, ts: Long) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(StreamoIcons.Clock, contentDescription = null, tint = StreamoColors.Muted, modifier = Modifier.size(10.dp))
        Text(vm.store.formatCaptureTime(ts), color = StreamoColors.Muted, fontSize = 8.sp)
    }
}

@Composable
private fun ExpiryChip(vm: BrowserViewModel, item: LinkEntry) {
    if (item.status != "ok") return
    val expiry = vm.store.parseExpiry(item.url) ?: return
    val expired = expiry.expired
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(StreamoIcons.Clock, contentDescription = null, tint = if (expired) StreamoColors.Fail else StreamoColors.Gold, modifier = Modifier.size(10.dp))
        Text(
            vm.store.formatExpiry(expiry.remainingSeconds),
            color = if (expired) StreamoColors.Fail else StreamoColors.Gold,
            fontSize = 8.sp,
        )
    }
}

@Composable
private fun CardActionButton(
    label: String,
    icon: (@Composable () -> Unit)?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(StreamoColors.Card2)
            .border(1.dp, StreamoColors.Border, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) icon()
        if (icon != null) Box(Modifier.width(5.dp))
        Text(label, color = StreamoColors.Text, fontSize = 8.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun EmptyState(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, desc: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 26.dp, bottom = 18.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(StreamoColors.Card)
            .border(1.dp, StreamoColors.Border, RoundedCornerShape(20.dp))
            .padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(52.dp).alpha(0.5f))
        Box(Modifier.height(16.dp))
        Text(title, color = StreamoColors.Text, fontSize = 15.5.sp, fontWeight = FontWeight.ExtraBold)
        Box(Modifier.height(8.dp))
        Text(
            desc,
            color = StreamoColors.Muted,
            fontSize = 9.sp,
            lineHeight = 17.sp,
        )
    }
}

@Composable
private fun ClearAllButton(label: String, onConfirm: () -> Unit) {
    var armed by remember { mutableStateOf(false) }
    val timerKey = androidx.compose.runtime.rememberUpdatedState(armed)
    androidx.compose.runtime.LaunchedEffect(armed) {
        if (armed) {
            kotlinx.coroutines.delay(3000)
            armed = false
        }
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(StreamoColors.Panel)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(8.dp))
                .background(if (armed) StreamoColors.FailBg else StreamoColors.Card)
                .border(1.dp, if (armed) StreamoColors.Fail else StreamoColors.Border, RoundedCornerShape(8.dp))
                .clickable {
                    if (armed) {
                        armed = false
                        onConfirm()
                    } else {
                        armed = true
                    }
                }
                .padding(vertical = 6.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                if (armed) "Confirm? Click again" else label,
                color = if (armed) StreamoColors.Fail else StreamoColors.Text,
                fontSize = 8.5.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

/* ================= Search History panel ================= */

@Composable
private fun SearchPanel(vm: BrowserViewModel, searches: List<SearchEntry>, onClose: () -> Unit, fullScreen: Boolean = false) {
    PanelSurface(modifier = Modifier.fillMaxSize(), fullScreen = fullScreen) {
        PanelHeader(
            icon = { Icon(StreamoIcons.Search, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp)) },
            title = "Search History",
            count = searches.size,
            onClose = onClose,
        )
        ClearAllButton(label = "Clear all", onConfirm = { vm.clearAllSearches() })

        LazyColumn(
            state = rememberLazyListState(),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (searches.isEmpty()) {
                item { EmptyState(StreamoIcons.SearchBig, "No searches yet",
                    "Your searches and the sources behind captured links will appear here.") }
            } else {
                itemsIndexed(searches, key = { _, it -> it.id }) { index, item -> CardEntrance(index) { SearchCard(vm, item) } }
            }
            item { CreditFooter(vm) }
        }
        VersionFooter()
    }
}

@Composable
private fun SearchCard(vm: BrowserViewModel, item: SearchEntry) {
    val dismissState = androidx.compose.material3.rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value != SwipeToDismissBoxValue.Settled) {
                vm.removeSearch(item.id)
                true
            } else false
        },
        positionalThreshold = { totalDistance -> totalDistance * 0.45f },
    )
    SwipeToDismissBox(
        state = dismissState,
        modifier = Modifier.fillMaxWidth(),
        backgroundContent = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(12.dp))
                    .background(StreamoColors.FailBg),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(StreamoIcons.Trash, contentDescription = "Delete", tint = StreamoColors.Fail, modifier = Modifier.padding(end = 14.dp).size(20.dp))
            }
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(StreamoColors.Card)
                .border(1.dp, StreamoColors.Border, RoundedCornerShape(12.dp))
                .clickable {
                    val url = item.url.ifBlank { "https://www.google.com/search?q=" + java.net.URLEncoder.encode(item.q, "UTF-8") }
                    vm.createTab(url)
                    vm.closePanel()
                }
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                text = shortQuery(item.q),
                color = StreamoColors.Text,
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                lineHeight = 16.sp,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.engine.isNotBlank()) {
                    Box(
                        modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(StreamoColors.Card2).padding(horizontal = 7.dp, vertical = 2.dp),
                    ) {
                        Text(item.engine.uppercase(), color = StreamoColors.Text, fontSize = 7.5.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.04.sp)
                    }
                }
                Text(
                    "${vm.store.timeAgo(item.ts)} · ${vm.store.formatTime(item.ts)}",
                    color = StreamoColors.Muted,
                    fontSize = 8.sp,
                )
            }
        }
    }
}

private fun shortQuery(q: String): String {
    if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(q)) {
        try {
            val u = java.net.URI(q)
            val host = (u.host ?: "").removePrefix("www.")
            val path = (u.path ?: "/").removeSuffix("/")
            val s = host + if (path == "/" || path.isEmpty()) "" else path
            return if (s.length > 64) s.take(64) + "…" else s
        } catch (e: Exception) {}
    }
    return if (q.length > 90) q.take(90) + "…" else q
}

/* ================= Tabs panel ================= */

@Composable
private fun TabsPanel(vm: BrowserViewModel, tabs: List<TabUi>, ram: com.streamo.link.android.state.RamInfo, onClose: () -> Unit, fullScreen: Boolean = false) {
    PanelSurface(modifier = Modifier.fillMaxSize(), fullScreen = fullScreen) {
        PanelHeader(
            icon = { Icon(StreamoIcons.Tabs, contentDescription = null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp)) },
            title = "Tabs",
            count = tabs.size,
            onClose = onClose,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(StreamoColors.Panel)
                .padding(horizontal = 12.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .background(androidx.compose.ui.graphics.Color.White)
                    .clickable { vm.createTab("https://www.google.com/"); vm.closePanel() }
                    .padding(vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("+ New Tab", color = androidx.compose.ui.graphics.Color.Black, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold)
            }
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, StreamoColors.Border, RoundedCornerShape(8.dp))
                    .clickable { vm.closeAllTabs() }
                    .padding(horizontal = 14.dp, vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Close all", color = StreamoColors.Text, fontSize = 8.5.sp, fontWeight = FontWeight.Bold)
            }
        }
        // memory status (approximate on Android)
        val ramColor = when (ram.level) {
            "critical" -> androidx.compose.ui.graphics.Color(0xFFF87171)
            "warn" -> androidx.compose.ui.graphics.Color(0xFFE0B45C)
            else -> androidx.compose.ui.graphics.Color(0xFF7B7B7B)
        }
        Text(
            text = ram.text,
            color = ramColor,
            fontSize = 8.sp,
            fontFamily = MonoFont,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.03.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
        )
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(tabs, key = { it.id }) { tab -> TabItemRow(vm, tab) }
        }
        VersionFooter()
    }
}

@Composable
private fun TabItemRow(vm: BrowserViewModel, tab: TabUi) {
    val initial = (runCatching { java.net.URI(tab.url).host ?: "T" }.getOrDefault("T"))
        .removePrefix("www.").firstOrNull()?.uppercaseChar()?.toString() ?: "T"
    val borderColor = if (tab.isActive) Color.White else StreamoColors.Border
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (tab.isActive) Color(0xFF141414) else StreamoColors.Card)
            .border(1.dp, borderColor, RoundedCornerShape(12.dp))
            .clickable { vm.activateTab(tab.id); vm.closePanel() }
            .padding(9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier.size(32.dp).background(StreamoColors.Card2, RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(initial, color = StreamoColors.Text, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = tab.title.ifBlank { tab.url },
                color = if (tab.sleeping) Color(0xFF9A9A9A) else StreamoColors.Text,
                fontSize = 9.5.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (tab.sleeping) "${tab.url}  · sleeping" else tab.url,
                color = StreamoColors.Muted,
                fontSize = 7.5.sp,
                fontFamily = MonoFont,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                softWrap = false,
            )
        }
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(androidx.compose.ui.graphics.Color.Transparent)
                .clickable { vm.closeTab(tab.id) },
            contentAlignment = Alignment.Center,
        ) {
            Icon(StreamoIcons.Close, contentDescription = "Close tab", tint = StreamoColors.Muted, modifier = Modifier.size(14.dp))
        }
    }
}

