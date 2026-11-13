package com.streamo.link.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.streamo.link.android.R

/** Streamo — pure black, white accent, Sora (Latin) + Cairo (Arabic). */
object StreamoColors {
    val Bg = Color(0xFF000000)
    val Panel = Color(0xFF050505)
    val Card = Color(0xFF101010)
    val Card2 = Color(0xFF171717)
    val CardDeep = Color(0xFF0E0E0E)
    val Border = Color(0xFF202020)
    val BorderSoft = Color(0xFF232323)
    val BorderPill = Color(0xFF242424)
    val BorderHover = Color(0xFF3A3A3A)
    val Text = Color(0xFFEDEDED)
    val TextSoft = Color(0xFFD6D6D6)
    val TextPill = Color(0xFFC9CDD3)
    val Muted = Color(0xFF8C8C8C)
    val Dim = Color(0xFF5E5E5E)
    val Accent = Color(0xFFFFFFFF)
    val AccentSoft = Color(0xFFCFCFCF)
    val OkBg = Color(0xFF101B13)
    val OkText = Color(0xFF7EE0A3)
    val OkRing = Color(0xFF123B22)
    val FailBg = Color(0xFF1F1213)
    val Fail = Color(0xFFFF8A80)
    val FailRing = Color(0xFF3B1315)
    val GoldBg = Color(0xFF1C1608)
    val Gold = Color(0xFFE3C766)
    val Inset = Color(0xFF141414)
    val InsetHover = Color(0xFF1A1A1A)
    val MenuBg = Color(0xFF141414)
    val MenuHover = Color(0xFF1F1F1F)
    val OkBadge = Color(0xFF4ADE80)
    val FailBadge = Color(0xFFF87171)
}

val StreamoFontFamily = FontFamily(
    Font(R.font.sora_variable, FontWeight.Normal),
    Font(R.font.sora_variable, FontWeight.Medium),
    Font(R.font.sora_variable, FontWeight.Bold),
    Font(R.font.sora_variable, FontWeight.ExtraBold),
    Font(R.font.cairo_variable, FontWeight.Normal),
    Font(R.font.cairo_variable, FontWeight.Medium),
    Font(R.font.cairo_variable, FontWeight.Bold),
    Font(R.font.cairo_variable, FontWeight.ExtraBold),
)

private val StreamoTypography = Typography(
    bodyLarge = TextStyle(fontFamily = StreamoFontFamily, fontSize = 12.sp, color = StreamoColors.Text),
    bodyMedium = TextStyle(fontFamily = StreamoFontFamily, fontSize = 11.sp, color = StreamoColors.Text),
    bodySmall = TextStyle(fontFamily = StreamoFontFamily, fontSize = 10.sp, color = StreamoColors.Text),
    titleLarge = TextStyle(fontFamily = StreamoFontFamily, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = StreamoColors.Text),
    titleMedium = TextStyle(fontFamily = StreamoFontFamily, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold, color = StreamoColors.Text),
    titleSmall = TextStyle(fontFamily = StreamoFontFamily, fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold, color = StreamoColors.Text),
    labelLarge = TextStyle(fontFamily = StreamoFontFamily, fontSize = 8.5.sp, fontWeight = FontWeight.Bold, color = StreamoColors.Text),
    labelMedium = TextStyle(fontFamily = StreamoFontFamily, fontSize = 8.sp, fontWeight = FontWeight.SemiBold, color = StreamoColors.Text),
    labelSmall = TextStyle(fontFamily = StreamoFontFamily, fontSize = 7.5.sp, fontWeight = FontWeight.Bold, color = StreamoColors.Text),
)

private val StreamoDark = darkColorScheme(
    primary = StreamoColors.Accent,
    onPrimary = StreamoColors.Bg,
    background = StreamoColors.Bg,
    onBackground = StreamoColors.Text,
    surface = StreamoColors.Panel,
    onSurface = StreamoColors.Text,
    surfaceVariant = StreamoColors.Card2,
    onSurfaceVariant = StreamoColors.Muted,
    outline = StreamoColors.Border,
)

@Composable
fun StreamoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = StreamoDark,
        typography = StreamoTypography,
        content = content,
    )
}
