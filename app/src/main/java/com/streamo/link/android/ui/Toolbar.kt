package com.streamo.link.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamo.link.android.state.BrowserViewModel
import kotlinx.coroutines.launch

private val MonoFont = FontFamily.Monospace

@Composable
fun StreamoToolbar(vm: BrowserViewModel) {
    val searchMode by vm.searchMode.collectAsState()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(46.dp)
            .background(StreamoColors.Bg),
    ) {
        AnimatedContent(
            targetState = searchMode,
            label = "chromeBar",
            transitionSpec = {
                (fadeIn(tween(180, easing = androidx.compose.animation.core.FastOutSlowInEasing)) +
                    slideInVertically(initialOffsetY = { -it / 4 }, animationSpec = tween(180))) togetherWith
                    (fadeOut(tween(150)) +
                        slideOutVertically(targetOffsetY = { -it / 4 }, animationSpec = tween(150)))
            },
        ) { mode ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(46.dp)
                    .padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (mode) {
                    SearchBar(vm)
                } else {
                    NormalBar(vm)
                }
            }
        }
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Color(0xFF1C1C1C)),
    )
}

/* ===================== Normal bar (called inside the toolbar Row) ===================== */

@Composable
private fun RowScope.NormalBar(vm: BrowserViewModel) {
    val badgeCount by vm.badgeCount.collectAsState()
    val badgeSeen by vm.badgeSeen.collectAsState()
    val progress by vm.progress.collectAsState()
    val progressActive by vm.progressActive.collectAsState()
    val canGoBack by vm.canGoBack.collectAsState()
    val canGoForward by vm.canGoForward.collectAsState()
    val urlText by vm.urlText.collectAsState()
    val urlEditing by vm.urlEditing.collectAsState()
    val menuOpen by vm.menuOpen.collectAsState()
    val scope = rememberCoroutineScope()
    val reloadSpin = remember { Animatable(0f) }

    BackHandler(enabled = urlEditing) { vm.setUrlEditing(false) }

    Box {
        // hamburger — toggles the popover (press again to close). Rendered inline at the screen root.
        ToolbarIconButton(
            onClick = { vm.toggleMenu() },
            contentDescription = "Menu",
            active = menuOpen,
        ) {
            Icon(StreamoIcons.Menu, contentDescription = "Menu", tint = Color.White, modifier = Modifier.size(19.dp))
        }
    }

    UrlPill(
        modifier = Modifier.weight(1f),
        urlText = urlText,
        editing = urlEditing,
        canGoBack = canGoBack,
        canGoForward = canGoForward,
        progress = progress,
        progressActive = progressActive,
        reloadSpin = reloadSpin,
        onBack = { vm.goBack() },
        onForward = { vm.goForward() },
        onReload = {
            scope.launch {
                vm.reloadActive()
                reloadSpin.snapTo(0f)
                reloadSpin.animateTo(360f, tween(800, easing = LinearEasing))
            }
        },
        onHome = { vm.home() },
        onPillClick = { vm.setUrlEditing(true) },
        onEditorCommit = { raw ->
            val target = commitUrlOrSearch(raw)
            if (target != null) vm.navigateCommitted(target)
            vm.setUrlEditing(false)
        },
        onEditorDismiss = { vm.setUrlEditing(false) },
    )

    // extracted links + badge
    Box(contentAlignment = Alignment.Center) {
        ToolbarIconButton(onClick = { vm.togglePanel(com.streamo.link.android.state.Panel.LINKS) }, contentDescription = "Extracted links") {
            Icon(StreamoIcons.ChainLink, contentDescription = "Extracted links", tint = Color.White, modifier = Modifier.size(19.dp))
        }
        if (!badgeSeen && badgeCount > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-2).dp, y = (-3).dp)
                    .size(17.dp)
                    .background(StreamoColors.Accent, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = badgeCount.coerceAtMost(99).toString(),
                    color = Color.Black,
                    fontSize = 9.5.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
            }
        }
    }
}

private fun commitUrlOrSearch(raw: String): String? {
    val s = raw.trim()
    if (s.isEmpty()) return null
    if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s)) return s
    val domainLike = Regex("^[^\\s/]+\\.[a-z]{2,}(/[^\\s]*)?$", RegexOption.IGNORE_CASE).matches(s)
    return if (domainLike) "https://$s" else "https://www.google.com/search?q=" + java.net.URLEncoder.encode(s, "UTF-8")
}

/* ===================== URL pill ===================== */

@Composable
private fun UrlPill(
    urlText: String,
    editing: Boolean,
    canGoBack: Boolean,
    canGoForward: Boolean,
    progress: Float,
    progressActive: Boolean,
    reloadSpin: Animatable<Float, *>,
    modifier: Modifier = Modifier,
    onBack: () -> Unit,
    onForward: () -> Unit,
    onReload: () -> Unit,
    onHome: () -> Unit,
    onPillClick: () -> Unit,
    onEditorCommit: (String) -> Unit,
    onEditorDismiss: () -> Unit,
) {
    var editText by remember(editing) { mutableStateOf(urlText) }
    var editField by remember(editing) {
        mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(urlText, androidx.compose.ui.text.TextRange(0, urlText.length)))
    }
    val editFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    // keep the editor in sync when entering edit mode — text preselected (like Windows urlInput.select())
    LaunchedEffect(editing, urlText) {
        if (editing) {
            editText = urlText
            editField = androidx.compose.ui.text.input.TextFieldValue(urlText, androidx.compose.ui.text.TextRange(0, urlText.length))
        }
    }
    LaunchedEffect(editing) { if (editing) editFocus.requestFocus() }

    Box(
        modifier = modifier
            .height(32.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(StreamoColors.Inset)
            .border(1.dp, if (editing) StreamoColors.Accent else StreamoColors.BorderPill, RoundedCornerShape(999.dp))
            .clickable(enabled = !editing) { onPillClick() },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 6.dp),
        ) {
            if (!editing) {
                PillNavButton(onClick = onBack, enabled = canGoBack, contentDescription = "Back") {
                    Icon(StreamoIcons.Back, contentDescription = "Back", tint = StreamoColors.TextPill, modifier = Modifier.size(15.dp))
                }
                PillNavButton(onClick = onForward, enabled = canGoForward, contentDescription = "Forward") {
                    Icon(StreamoIcons.Forward, contentDescription = "Forward", tint = StreamoColors.TextPill, modifier = Modifier.size(15.dp))
                }
                PillNavButton(onClick = onReload, enabled = true, contentDescription = "Reload") {
                    Icon(
                        StreamoIcons.Reload,
                        contentDescription = "Reload",
                        tint = StreamoColors.TextPill,
                        modifier = Modifier.size(15.dp).rotate(reloadSpin.value),
                    )
                }
                Text(
                    text = urlText,
                    color = StreamoColors.TextPill,
                    fontSize = 10.5.sp,
                    fontFamily = MonoFont,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    softWrap = false,
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 4.dp),
                )
                PillNavButton(onClick = onHome, enabled = true, contentDescription = "Home") {
                    Icon(StreamoIcons.Home, contentDescription = "Home", tint = StreamoColors.TextPill, modifier = Modifier.size(15.dp))
                }
            } else {
                androidx.compose.foundation.text.BasicTextField(
                    value = editField,
                    onValueChange = { new ->
                        editField = new
                        editText = new.text
                    },
                    singleLine = true,
                    textStyle = TextStyle(color = Color.White, fontSize = 11.sp, fontFamily = MonoFont),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(Color.White),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go, autoCorrect = false, capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None),
                    keyboardActions = KeyboardActions(onGo = { onEditorCommit(editText) }),
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp)
                        .focusRequester(editFocus)
                        .wrapContentHeight(Alignment.CenterVertically),
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.CenterStart) {
                            if (editText.isEmpty()) {
                                Text("Type a URL or search and press Enter…", color = Color(0xFF8C8C8C), fontSize = 11.sp, fontFamily = MonoFont)
                            }
                            inner()
                        }
                    },
                )
            }
        }
        // load progress line (real milestones, not an animation)
        if (progressActive) {
            val animated by animateFloatAsState(
                targetValue = progress.coerceIn(0f, 100f) / 100f,
                animationSpec = tween(160, easing = FastOutSlowInEasing),
                label = "pill-progress",
            )
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 14.dp)
                    .fillMaxWidth()
                    .height(2.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(animated)
                        .height(2.dp)
                        .background(StreamoColors.Accent, RoundedCornerShape(2.dp)),
                )
            }
        }
    }
}

/* ===================== search bar (RTL) ===================== */

@Composable
private fun RowScope.SearchBar(vm: BrowserViewModel) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current

    LaunchedEffect(Unit) { focus.requestFocus() }

    BackHandler { vm.setSearchMode(false) }

    // RTL row (like the Windows searchBar): back button on the RIGHT, search button on the LEFT, input right-aligned
    CompositionLocalProvider(
        androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl,
    ) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(46.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        ToolbarIconButton(onClick = { vm.setSearchMode(false) }, contentDescription = "Back") {
            Icon(StreamoIcons.Back, contentDescription = "Back", tint = Color.White, modifier = Modifier.size(19.dp))
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .height(32.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(StreamoColors.Inset)
                .border(1.dp, StreamoColors.BorderPill, RoundedCornerShape(999.dp))
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            TextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = {
                    Text(
                        "Enter movie or series name, then press Enter",
                        color = Color(0xFF8C8C8C),
                        fontSize = 12.sp,
                        textAlign = TextAlign.End,
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
                textStyle = TextStyle(
                    color = Color.White,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Default,
                    textAlign = TextAlign.End,
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrect = false),
                keyboardActions = KeyboardActions(onSearch = {
                    if (query.isNotBlank()) {
                        val q = java.net.URLEncoder.encode(query.trim(), "UTF-8")
                        vm.navigateCommitted("https://www.google.com/search?q=$q")
                        keyboard?.hide()
                        vm.setSearchMode(false)
                    }
                }),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = Color.White,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .padding(vertical = 2.dp),
            )
        }
        ToolbarIconButton(onClick = {
            if (query.isNotBlank()) {
                val q = java.net.URLEncoder.encode(query.trim(), "UTF-8")
                vm.navigateCommitted("https://www.google.com/search?q=$q")
                keyboard?.hide()
                vm.setSearchMode(false)
            }
        }, contentDescription = "Search") {
            Icon(StreamoIcons.Search, contentDescription = "Search", tint = Color.White, modifier = Modifier.size(19.dp))
        }
    }
    }
}

/* ===================== buttons ===================== */

@Composable
private fun ToolbarIconButton(onClick: () -> Unit, contentDescription: String, active: Boolean = false, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (active) Color(0xFF1F1F1F) else Color.Transparent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun PillNavButton(onClick: () -> Unit, enabled: Boolean, contentDescription: String, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(26.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(modifier = Modifier.matchParentSize()) // keep layout stable
        content()
        if (!enabled) {
            Box(modifier = Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(8.dp)))
        }
    }
}

@Composable
fun MenuPopover(
    onRecords: () -> Unit,
    onTabs: () -> Unit,
    modifier: Modifier = Modifier,
) {
    androidx.compose.animation.AnimatedVisibility(
        visible = true,
        enter = androidx.compose.animation.scaleIn(
            initialScale = 0.92f,
            transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f),
            animationSpec = tween(240, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        ) + androidx.compose.animation.fadeIn(tween(200)) +
            androidx.compose.animation.slideInVertically(initialOffsetY = { -it / 2 }, animationSpec = tween(240)),
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .width(168.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(StreamoColors.MenuBg)
                .border(1.dp, StreamoColors.BorderPill, RoundedCornerShape(14.dp))
                // consume taps on the popover body so they don't fall through to the webview / scrim
                .clickable(onClick = {})
                .padding(6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            MenuItem(
                label = "Records",
                icon = { Icon(StreamoIcons.Clock, contentDescription = null, tint = StreamoColors.TextPill, modifier = Modifier.size(17.dp)) },
                onClick = onRecords,
            )
            MenuItem(
                label = "Tabs",
                icon = { Icon(StreamoIcons.Tabs, contentDescription = null, tint = StreamoColors.TextPill, modifier = Modifier.size(17.dp)) },
                onClick = onTabs,
            )
        }
    }
}

@Composable
private fun MenuItem(label: String, icon: @Composable () -> Unit, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        icon()
        Text(
            text = label,
            color = Color(0xFFE3E5E8),
            fontSize = 10.5.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
