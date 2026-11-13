package com.streamo.link.android.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Streamo icons — same feather/stroke style as the Windows build. */
object StreamoIcons {

    private fun strokeIcon(
        name: String,
        viewport: Float = 24f,
        block: (ImageVector.Builder).() -> Unit,
    ): ImageVector = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = viewport, viewportHeight = viewport).apply(block).build()

    val Back: ImageVector = strokeIcon("Back") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(15f, 18f); lineTo(9f, 12f); lineTo(15f, 6f)
        }
    }

    val Forward: ImageVector = strokeIcon("Forward") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(9f, 18f); lineTo(15f, 12f); lineTo(9f, 6f)
        }
    }

    val Reload: ImageVector = strokeIcon("Reload") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(21f, 12f); arcToRelative(9f, 9f, 0f, true, true, -2.6f, -6.4f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(21f, 3f); lineTo(21f, 9f); lineTo(15f, 9f)
        }
    }

    val Home: ImageVector = strokeIcon("Home") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(3f, 11.5f); lineTo(12f, 4f); lineTo(21f, 11.5f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(6f, 10.5f); lineTo(6f, 20f); lineTo(18f, 20f); lineTo(18f, 10.5f)
        }
    }

    val ChainLink: ImageVector = strokeIcon("ChainLink") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(10f, 13f); arcToRelative(5f, 5f, 0f, false, false, 7.5f, 0.5f); lineToRelative(3f, -3f); arcToRelative(5f, 5f, 0f, false, false, -7f, -7f); lineTo(11.8f, 5.2f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(14f, 11f); arcToRelative(5f, 5f, 0f, false, false, -7.5f, -0.5f); lineToRelative(-3f, 3f); arcToRelative(5f, 5f, 0f, false, false, 7f, 7f); lineToRelative(1.7f, -1.7f)
        }
    }

    val Search: ImageVector = strokeIcon("Search") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(11f, 19f); arcToRelative(8f, 8f, 0f, true, false, 0f, -16f); arcToRelative(8f, 8f, 0f, false, false, 0f, 16f); close()
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(21f, 21f); lineTo(16.7f, 16.7f)
        }
    }

    val Menu: ImageVector = strokeIcon("Menu") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(4f, 7f); lineTo(20f, 7f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(4f, 12f); lineTo(20f, 12f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(4f, 17f); lineTo(14f, 17f)
        }
    }

    val Tabs: ImageVector = strokeIcon("Tabs") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(5f, 5f); horizontalLineTo(19f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f); verticalLineTo(17f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f); horizontalLineTo(5f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); verticalLineTo(7f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f); close()
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(8f, 5f); verticalLineTo(19f)
        }
    }

    val Close: ImageVector = strokeIcon("Close") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(17f, 7f); lineTo(7f, 17f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(7f, 7f); lineTo(17f, 17f)
        }
    }

    val Play: ImageVector = strokeIcon("Play") {
        path(fill = SolidColor(Color.Black)) {
            moveTo(9f, 7f); lineTo(17f, 12f); lineTo(9f, 17f); close()
        }
    }

    val Pause: ImageVector = strokeIcon("Pause") {
        path(fill = SolidColor(Color.Black)) { moveTo(8f, 6f); horizontalLineTo(11.3f); verticalLineTo(18f); horizontalLineTo(8f); close() }
        path(fill = SolidColor(Color.Black)) { moveTo(13.7f, 6f); horizontalLineTo(17f); verticalLineTo(18f); horizontalLineTo(13.7f); close() }
    }

    val PlayWhite: ImageVector = strokeIcon("PlayWhite") {
        path(fill = SolidColor(Color.White)) {
            moveTo(9f, 7f); lineTo(17f, 12f); lineTo(9f, 17f); close()
        }
    }

    val PauseWhite: ImageVector = strokeIcon("PauseWhite") {
        path(fill = SolidColor(Color.White)) { moveTo(8f, 6f); horizontalLineTo(11.3f); verticalLineTo(18f); horizontalLineTo(8f); close() }
        path(fill = SolidColor(Color.White)) { moveTo(13.7f, 6f); horizontalLineTo(17f); verticalLineTo(18f); horizontalLineTo(13.7f); close() }
    }

    val SkipBack: ImageVector = strokeIcon("SkipBack") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 1.9f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(5f, 12f); arcToRelative(7f, 7f, 0f, true, false, 2f, -4.9f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 1.9f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(5f, 4.4f); verticalLineToRelative(4f); horizontalLineToRelative(4f)
        }
    }

    val SkipForward: ImageVector = strokeIcon("SkipForward") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 1.9f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(19f, 12f); arcToRelative(7f, 7f, 0f, true, true, -2f, -4.9f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 1.9f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(19f, 4.4f); verticalLineToRelative(4f); horizontalLineToRelative(-4f)
        }
    }

    val Fullscreen: ImageVector = strokeIcon("Fullscreen") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(4f, 9f); lineTo(4f, 4f); lineTo(9f, 4f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(20f, 9f); lineTo(20f, 4f); lineTo(15f, 4f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(4f, 15f); lineTo(4f, 20f); lineTo(9f, 20f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(20f, 15f); lineTo(20f, 20f); lineTo(15f, 20f)
        }
    }

    val Copy: ImageVector = strokeIcon("Copy") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(9f, 9f); horizontalLineTo(19f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f); verticalLineTo(19f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f); horizontalLineTo(9f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); verticalLineTo(11f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(5f, 15f); verticalLineTo(5f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f); horizontalLineTo(15f)
        }
    }

    val OpenExternal: ImageVector = strokeIcon("OpenExternal") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(7f, 17f); lineTo(17f, 7f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(8f, 7f); lineTo(17f, 7f); lineTo(17f, 16f)
        }
    }

    val Trash: ImageVector = strokeIcon("Trash") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(3f, 6f); lineTo(21f, 6f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(8f, 6f); lineTo(8f, 4f); arcToRelative(2f, 2f, 0f, false, true, 2f, -2f); horizontalLineTo(14f); arcToRelative(2f, 2f, 0f, false, true, 2f, 2f); verticalLineTo(6f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(19f, 6f); lineTo(18f, 20f); arcToRelative(2f, 2f, 0f, false, true, -2f, 2f); horizontalLineTo(8f); arcToRelative(2f, 2f, 0f, false, true, -2f, -2f); lineTo(5f, 6f)
        }
    }

    val Clock: ImageVector = strokeIcon("Clock") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(12f, 21f); arcToRelative(9f, 9f, 0f, true, false, 0f, -18f); arcToRelative(9f, 9f, 0f, false, false, 0f, 18f); close()
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(12f, 7f); verticalLineTo(12f); lineTo(15f, 14f)
        }
    }

    val Check: ImageVector = strokeIcon("Check") {
        path(fill = null, stroke = SolidColor(StreamoColors.OkBadge), strokeLineWidth = 2.4f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(5.5f, 12.5f); lineTo(10f, 17f); lineTo(18.5f, 7f)
        }
    }

    val CheckWhite: ImageVector = strokeIcon("CheckWhite") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2.4f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(5.5f, 12.5f); lineTo(10f, 17f); lineTo(18.5f, 7f)
        }
    }

    val ClearWhite: ImageVector = strokeIcon("ClearWhite") {
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2.4f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(7f, 7f); lineTo(17f, 17f)
        }
        path(fill = null, stroke = SolidColor(Color.White), strokeLineWidth = 2.4f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(17f, 7f); lineTo(7f, 17f)
        }
    }


    /** GitHub octocat — the same mark used in the Windows credit footer. */
    val GitHub: ImageVector = strokeIcon("GitHub", viewport = 24f) {
        path(fill = SolidColor(Color(0xFF9A9A9A))) {
            moveTo(12f, 0.5f)
            arcToRelative(11.5f, 11.5f, 0f, false, false, -11.5f, 11.5f)
            arcToRelative(11.5f, 11.5f, 0f, false, false, 7.86f, 10.91f)
            curveToRelative(0.58f, 0.11f, 0.79f, -0.25f, 0.79f, -0.56f)
            curveToRelative(0f, -0.28f, -0.01f, -1.02f, -0.02f, -2f)
            curveToRelative(-3.2f, 0.7f, -3.88f, -1.54f, -3.88f, -1.54f)
            curveToRelative(-0.52f, -1.33f, -1.28f, -1.68f, -1.28f, -1.68f)
            curveToRelative(-1.04f, -0.71f, 0.08f, -0.7f, 0.08f, -0.7f)
            curveToRelative(1.15f, 0.08f, 1.76f, 1.18f, 1.76f, 1.18f)
            curveToRelative(1.03f, 1.76f, 2.69f, 1.25f, 3.35f, 0.96f)
            curveToRelative(0.1f, -0.75f, 0.4f, -1.25f, 0.72f, -1.54f)
            curveToRelative(-2.55f, -0.29f, -5.24f, -1.28f, -5.24f, -5.7f)
            curveToRelative(0f, -1.26f, 0.45f, -2.29f, 1.18f, -3.1f)
            curveToRelative(-0.12f, -0.29f, -0.51f, -1.46f, 0.11f, -3.04f)
            curveToRelative(0f, 0f, 0.97f, -0.31f, 3.17f, 1.18f)
            arcToRelative(11f, 11f, 0f, false, true, 5.8f, 0f)
            curveToRelative(2.2f, -1.49f, 3.17f, -1.18f, 3.17f, -1.18f)
            curveToRelative(0.62f, 1.58f, 0.23f, 2.75f, 0.11f, 3.04f)
            curveToRelative(0.74f, 0.81f, 1.18f, 1.84f, 1.18f, 3.1f)
            curveToRelative(0f, 4.43f, -2.7f, 5.4f, -5.26f, 5.68f)
            curveToRelative(0.41f, 0.35f, 0.78f, 1.05f, 0.78f, 2.12f)
            curveToRelative(0f, 1.53f, -0.01f, 2.76f, -0.01f, 3.14f)
            curveToRelative(0f, 0.31f, 0.21f, 0.67f, 0.8f, 0.56f)
            arcToRelative(11.5f, 11.5f, 0f, false, false, 7.36f, -10.91f)
            arcToRelative(11.5f, 11.5f, 0f, false, false, -11.5f, -11.5f)
            close()
        }
    }

    /** Globe — the live-cinema.pages.dev mark from the credit footer. */
    val Globe: ImageVector = strokeIcon("Globe") {
        path(fill = null, stroke = SolidColor(Color(0xFF9A9A9A)), strokeLineWidth = 1.8f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(12f, 21f); arcToRelative(9f, 9f, 0f, true, false, 0f, -18f); arcToRelative(9f, 9f, 0f, false, false, 0f, 18f); close()
        }
        path(fill = null, stroke = SolidColor(Color(0xFF9A9A9A)), strokeLineWidth = 1.8f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(3f, 12f); lineTo(21f, 12f)
        }
        path(fill = null, stroke = SolidColor(Color(0xFF9A9A9A)), strokeLineWidth = 1.8f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(12f, 3f); curveToRelative(2.6f, 2.6f, 4f, 5.6f, 4f, 9f); curveToRelative(0f, 3.4f, -1.4f, 6.4f, -4f, 9f)
            moveTo(12f, 3f); curveToRelative(-2.6f, 2.6f, -4f, 5.6f, -4f, 9f); curveToRelative(0f, 3.4f, 1.4f, 6.4f, 4f, 9f)
        }
    }

    /** Big empty-state search glyph */
    val SearchBig: ImageVector = strokeIcon("SearchBig") {
        path(fill = null, stroke = SolidColor(Color(0xFFC9CDD3)), strokeLineWidth = 1.6f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(11f, 19f); arcToRelative(8f, 8f, 0f, true, false, 0f, -16f); arcToRelative(8f, 8f, 0f, false, false, 0f, 16f); close()
        }
        path(fill = null, stroke = SolidColor(Color(0xFFC9CDD3)), strokeLineWidth = 1.6f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round) {
            moveTo(21f, 21f); lineTo(16.7f, 16.7f)
        }
    }

    /** Big empty-state link glyph */
    val LinkBig: ImageVector = strokeIcon("LinkBig") {
        path(fill = null, stroke = SolidColor(Color(0xFFC9CDD3)), strokeLineWidth = 1.6f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(10f, 13f); arcToRelative(5f, 5f, 0f, false, false, 7.5f, 0.5f); lineToRelative(3f, -3f); arcToRelative(5f, 5f, 0f, false, false, -7f, -7f); lineTo(11.8f, 5.2f)
        }
        path(fill = null, stroke = SolidColor(Color(0xFFC9CDD3)), strokeLineWidth = 1.6f, strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round, strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round) {
            moveTo(14f, 11f); arcToRelative(5f, 5f, 0f, false, false, -7.5f, -0.5f); lineToRelative(-3f, 3f); arcToRelative(5f, 5f, 0f, false, false, 7f, 7f); lineToRelative(1.7f, -1.7f)
        }
    }
}
