package com.streamo.link.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.link.android.state.BrowserViewModel
import com.streamo.link.android.state.Notif

/** Mini capture cards — top-end stack, mirrors the Windows build. */
@Composable
fun NotifStack(
    vm: BrowserViewModel,
    onOpenLinksPanel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val notifications by vm.notifications.collectAsState()

    Column(
        modifier = modifier
            .width(280.dp)
            .padding(top = 8.dp, end = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // auto-dismiss: 10s ok / 5s failed (render each card with its own timer)
        notifications.take(5).forEach { notif ->
            AnimatedVisibility(
                visible = true,
                enter = slideInHorizontally(
                    initialOffsetX = { it * 2 },
                    animationSpec = tween(280, easing = FastOutSlowInEasing),
                ) + fadeIn(tween(260)),
            ) {
                NotifCard(
                    key = notif.id,
                    notif = notif,
                    onClick = {
                        if (notif.state == Notif.NotifState.FAILED) {
                            vm.dismissNotif(notif.id)
                        } else {
                            onOpenLinksPanel()
                            notifications.forEach { vm.dismissNotif(it.id) }
                        }
                    },
                    onExpire = { vm.dismissNotif(notif.id) },
                )
            }
        }
    }
}

@Composable
private fun NotifCard(
    key: String,
    notif: Notif,
    onClick: () -> Unit,
    onExpire: () -> Unit,
) {
    // settled cards fade out after 10s (ok) / 5s (fail); pending cards keep waiting for the probe
    LaunchedEffect(key, notif.state) {
        if (notif.state == Notif.NotifState.TESTING) return@LaunchedEffect
        kotlinx.coroutines.delay(if (notif.state == Notif.NotifState.OK) 10_000L else 5_000L)
        onExpire()
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(StreamoColors.Panel)
            .border(1.dp, StreamoColors.Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            modifier = Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(StreamoColors.Card2),
            contentAlignment = Alignment.Center,
        ) {
            Icon(StreamoIcons.ChainLink, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = when (notif.state) {
                    Notif.NotifState.TESTING -> notif.host
                    Notif.NotifState.OK -> "Link captured"
                    Notif.NotifState.FAILED -> "Link failed"
                },
                color = StreamoColors.Text,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = notif.url,
                color = StreamoColors.Muted,
                fontSize = 7.5.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                softWrap = false,
            )
        }
        Box(
            modifier = Modifier.size(30.dp),
            contentAlignment = Alignment.Center,
        ) {
            when (notif.state) {
                Notif.NotifState.TESTING -> CircularProgressIndicator(
                    color = StreamoColors.AccentSoft,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(15.dp),
                )
                Notif.NotifState.OK -> Box(
                    modifier = Modifier.size(26.dp).clip(CircleShape).background(StreamoColors.OkRing).border(1.dp, Color(0x594ADE80), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(StreamoIcons.Check, contentDescription = "Captured", modifier = Modifier.size(16.dp))
                }
                Notif.NotifState.FAILED -> Box(
                    modifier = Modifier.size(26.dp).clip(CircleShape).background(StreamoColors.FailRing).border(1.dp, Color(0x59F87171), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(StreamoIcons.FailX, contentDescription = "Failed", modifier = Modifier.size(15.dp))
                }
            }
        }
    }
}
