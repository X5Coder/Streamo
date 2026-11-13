package com.streamo.link.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.streamo.link.android.state.PlayerRequest

private const val DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

/** The internal player — full-screen, custom Compose controls. */
@Composable
fun StreamoPlayerScreen(request: PlayerRequest, onClose: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val url = request.url
    val pageUrl = request.pageUrl

    var retryTick by remember { mutableStateOf(0) }
    var showFlash by remember { mutableStateOf(false) }
    var flashKind by remember { mutableStateOf("play") }

    // ---- ExoPlayer (HLS/DASH/MP4 + custom Referer, like the Windows loopback proxy) ----
    val exoPlayer = remember(url, pageUrl, retryTick) {
        val requestProps = LinkedHashMap<String, String>()
        try {
            pageUrl?.let { p ->
                val u = java.net.URL(p)
                val origin = u.protocol + "://" + u.host + (if (u.port > 0) ":${u.port}" else "") + "/"
                requestProps["Referer"] = origin
            }
        } catch (e: Exception) { }
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(DESKTOP_UA)
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(10_000)
            .setDefaultRequestProperties(requestProps)
        val mediaSourceFactory = DefaultMediaSourceFactory(httpFactory)
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(mediaSourceFactory)
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(url))
                playWhenReady = true
                prepare()
            }
    }

    DisposableEffect(exoPlayer) {
        onDispose {
            try { exoPlayer.release() } catch (e: Exception) {}
        }
    }

    // ---- playback state polling ----
    var positionMs by remember { mutableStateOf(0L) }
    var durationMs by remember { mutableStateOf(0L) }
    var bufferedMs by remember { mutableStateOf(0L) }
    var isPlaying by remember { mutableStateOf(false) }
    var playerState by remember { mutableStateOf(Player.STATE_IDLE) }
    var controlsVisible by remember { mutableStateOf(true) }
    var showError by remember { mutableStateOf(false) }
    var openedAt by remember { mutableStateOf(System.currentTimeMillis()) }

    LaunchedEffect(exoPlayer) {
        while (true) {
            try {
                positionMs = exoPlayer.currentPosition
                durationMs = exoPlayer.duration.coerceAtLeast(0L)
                bufferedMs = exoPlayer.bufferedPosition
                isPlaying = exoPlayer.isPlaying
                playerState = exoPlayer.playbackState
                // watchdog: nothing moves for 45s, or absolute 2-minute ceiling, while never playing
                val stalled = !isPlaying && positionMs <= 0L && playerState != Player.STATE_READY
                if (showError.not() && System.currentTimeMillis() - openedAt > 45_000L && stalled) {
                    showError = true
                }
                if (showError.not() && System.currentTimeMillis() - openedAt > 120_000L && positionMs <= 0L && !isPlaying) {
                    showError = true
                }
            } catch (e: Exception) {}
            kotlinx.coroutines.delay(250)
        }
    }

    // auto-hide controls while playing
    LaunchedEffect(controlsVisible, isPlaying) {
        if (controlsVisible && isPlaying) {
            kotlinx.coroutines.delay(3_800)
            controlsVisible = false
        }
    }
    // flash icon fade
    LaunchedEffect(showFlash) {
        if (showFlash) {
            kotlinx.coroutines.delay(430)
            showFlash = false
        }
    }

    fun togglePlayPause() {
        if (exoPlayer.isPlaying) {
            exoPlayer.pause(); flashKind = "pause"
        } else {
            exoPlayer.play(); flashKind = "play"
        }
        showFlash = true
        controlsVisible = true
    }

    fun seekDelta(deltaMs: Long) {
        val dur = exoPlayer.duration
        val target = (exoPlayer.currentPosition + deltaMs).coerceIn(0L, if (dur > 0) dur else Long.MAX_VALUE)
        exoPlayer.seekTo(target)
        controlsVisible = true
    }

    // ---- UI ----
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShutterBackgroundColor(android.graphics.Color.BLACK)
                }
            },
            update = { view -> view.player = exoPlayer },
            modifier = Modifier.fillMaxSize(),
        )

        // tap layer: center tap toggles play, side taps toggle controls, double-tap fullscreen
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = {
                            toggleFullscreen(activity, !isImmersive(activity))
                        },
                        onTap = { offset ->
                            val w = size.width.toFloat().coerceAtLeast(1f)
                            val x = offset.x / w
                            val y = offset.y / size.height.toFloat().coerceAtLeast(1f)
                            val isCenter = x in 0.32f..0.68f && y in 0.24f..0.76f
                            if (isCenter) {
                                togglePlayPause()
                            } else if (controlsVisible) {
                                controlsVisible = false
                            } else {
                                controlsVisible = true
                            }
                        },
                    )
                },
        )

        // top controls (close + title) — respect the status bar / camera cutout like the Windows desktop player
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .height(96.dp)
                .background(Brush.verticalGradient(listOf(Color(0x9E000000), Color.Transparent))),
        ) {
            if (controlsVisible) {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .height(62.dp)
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0x991E1E1E))
                            .clickable { onClose() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(StreamoIcons.Close, contentDescription = "Close player", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    Text(
                        text = url,
                        color = Color.White.copy(alpha = 0.95f),
                        fontSize = 11.5.sp,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        maxLines = 1,
                        softWrap = false,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // center flash (play/pause bump)
        if (showFlash) {
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(92.dp)
                    .clip(CircleShape)
                    .background(Color(0xB8121212))
                    .border(1.dp, Color(0x24FFFFFF), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (flashKind == "play") StreamoIcons.PlayWhite else StreamoIcons.PauseWhite,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(76.dp),
                )
            }
        }

        // bottom controls — keep clear of the gesture bar / nav buttons
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))),
        ) {
            if (controlsVisible) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    // seek bar
                    SeekBar(
                        positionMs = positionMs,
                        durationMs = durationMs,
                        onSeek = { ms -> exoPlayer.seekTo(ms) },
                        onInteraction = { controlsVisible = true },
                    )
                    // controls row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        PlayerIconButton(onClick = { seekDelta(-10_000L) }, contentDescription = "Back 10 seconds") {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(StreamoIcons.SkipBack, contentDescription = "Back 10 seconds", tint = Color.White, modifier = Modifier.size(21.dp))
                                Text("10", color = Color.White, fontSize = 6.5.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold)
                            }
                        }
                        // play/pause — white circle, black glyph
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(Color.White)
                                .clickable { togglePlayPause() },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                if (isPlaying) StreamoIcons.Pause else StreamoIcons.Play,
                                contentDescription = "Play or pause",
                                tint = Color.Black,
                                modifier = Modifier.size(17.dp),
                            )
                        }
                        PlayerIconButton(onClick = { seekDelta(+10_000L) }, contentDescription = "Forward 10 seconds") {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(StreamoIcons.SkipForward, contentDescription = "Forward 10 seconds", tint = Color.White, modifier = Modifier.size(21.dp))
                                Text("10", color = Color.White, fontSize = 6.5.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold)
                            }
                        }
                        Text(
                            text = fmtTime(positionMs) + " / " + fmtTime(durationMs),
                            color = Color(0xFFF1F1F1),
                            fontSize = 9.sp,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            maxLines = 1,
                            modifier = Modifier.padding(start = 2.dp, end = 6.dp),
                        )
                        Box(modifier = Modifier.weight(1f))
                        PlayerIconButton(onClick = { toggleFullscreen(activity, !isImmersive(activity)) }, contentDescription = "Fullscreen") {
                            Icon(StreamoIcons.Fullscreen, contentDescription = "Fullscreen", tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }

        // loading overlay
        if (playerState != Player.STATE_READY && !showError) {
            Box(
                modifier = Modifier.fillMaxSize().background(Color(0x6B000000)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    androidx.compose.material3.CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 3.dp,
                        modifier = Modifier.size(58.dp),
                    )
                    Text(
                        text = "Loading…",
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold,
                        letterSpacing = 0.5.sp,
                    )
                    Text(
                        text = "BUFFERING THE STREAM",
                        color = Color(0xFF7B7B7B),
                        fontSize = 8.sp,
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                        letterSpacing = 1.8.sp,
                    )
                }
            }
        }

        // error overlay
        if (showError) {
            Box(
                modifier = Modifier.fillMaxSize().background(Color(0xFF050505)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Unable to load this video", color = Color.White, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold)
                    Text("The link may be expired or unsupported.", color = Color(0xFF8C8C8C), fontSize = 9.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(Color.White)
                                .clickable { showError = false; openedAt = System.currentTimeMillis(); retryTick += 1 }
                                .padding(horizontal = 30.dp, vertical = 9.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("Retry", color = Color.Black, fontSize = 10.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .border(1.dp, Color(0x38FFFFFF), RoundedCornerShape(999.dp))
                                .clickable { onClose() }
                                .padding(horizontal = 26.dp, vertical = 9.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("Close player", color = Color.White, fontSize = 10.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

/* ---------- seek bar ---------- */

@Composable
private fun SeekBar(
    positionMs: Long,
    durationMs: Long,
    onSeek: (Long) -> Unit,
    onInteraction: () -> Unit,
) {
    val dur = durationMs.coerceAtLeast(1L)
    val fraction = (positionMs.toFloat() / dur.toFloat()).coerceIn(0f, 1f)
    var dragFraction by remember { mutableStateOf<Float?>(null) }
    var trackWidth by remember { mutableStateOf(1f) }
    val shown = (dragFraction ?: fraction).coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(22.dp)
            .onGloballyPositioned { trackWidth = it.size.width.toFloat().coerceAtLeast(1f) }
            .pointerInput(durationMs) {
                detectTapGestures(onTap = { offset ->
                    val f = (offset.x / trackWidth).coerceIn(0f, 1f)
                    dragFraction = f
                    onSeek((f * durationMs).toLong())
                    onInteraction()
                })
            }
            .pointerInput(durationMs) {
                detectHorizontalDragGestures(
                    onDragStart = { offset ->
                        dragFraction = (offset.x / trackWidth).coerceIn(0f, 1f)
                        onInteraction()
                    },
                    onHorizontalDrag = { change, _ ->
                        dragFraction = (change.position.x / trackWidth).coerceIn(0f, 1f)
                    },
                    onDragEnd = {
                        dragFraction?.let { f -> onSeek((f * durationMs).toLong()) }
                        dragFraction = null
                        onInteraction()
                    },
                    onDragCancel = { dragFraction = null },
                )
            },
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .fillMaxWidth()
                .height(4.dp)
                .background(Color(0x38FFFFFF), RoundedCornerShape(3.dp)),
        )
        // fill
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .fillMaxWidth(shown)
                .height(4.dp)
                .background(Color.White, RoundedCornerShape(3.dp)),
        )
        // thumb
        Box(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .padding(start = ((trackWidth * shown) - 6.5f).coerceAtLeast(0f).dp)
                .size(13.dp)
                .clip(CircleShape)
                .background(Color.White),
        )
        // time tooltip while dragging (like the Windows seek tooltip)
        if (dragFraction != null) {
            val secs = (shown * durationMs.toFloat() / 1000f).toLong().coerceAtLeast(0L)
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(top = 0.dp)
                    .offset(x = ((trackWidth * shown) - 32f).coerceIn(0f, (trackWidth - 64f).coerceAtLeast(0f)).dp, y = (-24).dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color(0xED18181B))
                    .border(1.dp, Color(0x1FFFFFFF), RoundedCornerShape(6.dp))
                    .padding(horizontal = 9.dp, vertical = 3.dp),
            ) {
                Text(
                    text = fmtTime(secs * 1000L),
                    color = Color(0xFFF1F1F1),
                    fontSize = 8.5.sp,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    maxLines = 1,
                )
            }
        }
    }
}

/* ---------- small bits ---------- */

@Composable
private fun PlayerIconButton(onClick: () -> Unit, contentDescription: String, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

private fun isImmersive(activity: ComponentActivity?): Boolean {
    return activity?.requestedOrientation == android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
}

private fun toggleFullscreen(activity: ComponentActivity?, toFullscreen: Boolean) {
    if (activity == null) return
    if (toFullscreen) {
        activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        WindowInsetsControllerCompat(activity.window, activity.window.decorView).let {
            it.hide(WindowInsetsCompat.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    } else {
        activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        WindowCompat.setDecorFitsSystemWindows(activity.window, true)
        WindowInsetsControllerCompat(activity.window, activity.window.decorView).show(WindowInsetsCompat.Type.systemBars())
    }
}

private fun fmtTime(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
