package com.streamo.link.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.streamo.link.android.state.BrowserViewModel
import com.streamo.link.android.state.Panel

/**
 * Streamo — the browser shell: toolbar on top, webviews below,
 * overlays: scrim, panels, notifications, toast, menu popover, player (full-screen).
 *
 * Layout parity with the Windows build:
 *  - Links panel  → regular side panel BELOW the toolbar (panelRight)
 *  - Records/Tabs → full-screen panels OVER the toolbar (panelFull)
 *  - Player       → full-screen overlay with fade-in
 */
@Composable
fun BrowserScreen(viewModel: BrowserViewModel) {
    val activeId by viewModel.activeId.collectAsState()
    val panel by viewModel.panel.collectAsState()
    val menuOpen by viewModel.menuOpen.collectAsState()
    val toast by viewModel.toast.collectAsState()
    val player by viewModel.player.collectAsState()

    // toast auto-dismiss (1.8s)
    LaunchedEffect(toast?.ts) {
        if (toast != null) {
            kotlinx.coroutines.delay(1_800)
            viewModel.clearToast()
        }
    }

    var lastBackAt by remember { mutableStateOf(0L) }
    val activity = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity

    BackHandler(enabled = true) {
        when {
            player != null -> viewModel.closePlayer()
            panel != null -> viewModel.closePanel()
            menuOpen -> viewModel.closeMenu()
            viewModel.goBack() -> Unit
            !viewModel.isAtHome() -> viewModel.goHome()
            else -> {
                val now = System.currentTimeMillis()
                if (now - lastBackAt < 2000L) {
                    activity?.finish()
                } else {
                    lastBackAt = now
                    viewModel.toast("Press again to exit")
                }
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(StreamoColors.Bg)) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
            StreamoToolbar(viewModel)

            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                // the ACTIVE tab's WebView — hidden tabs keep their instance alive but detached
                androidx.compose.runtime.key(activeId) {
                    activeId?.let { id ->
                        AndroidView(
                            factory = { ctx -> viewModel.acquireWebView(id, ctx) },
                            update = { wv ->
                                if (wv.visibility != android.view.View.VISIBLE) wv.visibility = android.view.View.VISIBLE
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }

                // tap-catcher scrim for panels / menu (below the panels)
                PanelScrim(visible = panel != null || menuOpen, onClick = {
                    viewModel.closePanel()
                    viewModel.closeMenu()
                })

                // LINKS panel — below the toolbar (panelRight parity)
                LinksPanelHost(viewModel)

                // menu popover (records / tabs)
                if (menuOpen) {
                    MenuPopover(
                        expanded = true,
                        onDismiss = { viewModel.closeMenu() },
                        onRecords = { viewModel.closeMenu(); viewModel.togglePanel(Panel.SEARCH) },
                        onTabs = { viewModel.closeMenu(); viewModel.togglePanel(Panel.TABS) },
                    )
                }

                // mini capture cards — top end
                NotifStack(
                    vm = viewModel,
                    onOpenLinksPanel = { viewModel.togglePanel(Panel.LINKS) },
                    modifier = Modifier.align(Alignment.TopEnd),
                )

                // toast — bottom center pill
                Column(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp),
                    horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                ) {
                    AnimatedVisibility(
                        visible = toast != null,
                        enter = fadeIn() + slideInVertically(initialOffsetY = { it / 2 }),
                        exit = fadeOut() + slideOutVertically(targetOffsetY = { it / 2 }),
                    ) {
                        toast?.let { t ->
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(StreamoColors.Panel)
                                    .padding(horizontal = 18.dp, vertical = 8.dp),
                            ) {
                                Text(t.text, color = StreamoColors.Text, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }

        // RECORDS + TABS — full-screen overlays ABOVE the toolbar (panelFull parity)
        FullPanelsOverlay(viewModel)

        // internal player — full-screen overlay with Windows-style fade-in
        AnimatedVisibility(
            visible = player != null,
            enter = fadeIn(animationSpec = androidx.compose.animation.core.tween(180)),
            exit = fadeOut(animationSpec = androidx.compose.animation.core.tween(150)),
        ) {
            player?.let { p ->
                StreamoPlayerScreen(p, onClose = viewModel::closePlayer)
            }
        }
    }
}
