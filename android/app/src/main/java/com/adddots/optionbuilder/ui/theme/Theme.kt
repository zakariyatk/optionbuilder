package com.adddots.optionbuilder.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The web app's design tokens (frontend/src/styles/index.css), one-to-one.
 * Screens only reference these, so light and dark are just two value sets.
 */
@Immutable
data class ObColors(
    val page: Color,
    val card: Color,
    val raised: Color,
    val sunken: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val border: Color,
    val borderStrong: Color,
    val gridline: Color,
    val baseline: Color,
    val blue: Color,
    val violet: Color,
    val good: Color,
    val goodText: Color,
    val critical: Color,
    val warning: Color,
    val goodFill: Color,
    val criticalFill: Color,
    val warningFill: Color,
    val itmFill: Color,
    val accent: Color,
    val accentText: Color,
)

val LightObColors = ObColors(
    page = Color(0xFFF9F9F7),
    card = Color(0xFFFCFCFB),
    raised = Color(0xFFFFFFFF),
    sunken = Color(0xFFF1F1EE),
    textPrimary = Color(0xFF0B0B0B),
    textSecondary = Color(0xFF52514E),
    textMuted = Color(0xFF6F6D68),
    border = Color(0x1A0B0B0B),
    borderStrong = Color(0x330B0B0B),
    gridline = Color(0xFFE1E0D9),
    baseline = Color(0xFFC3C2B7),
    blue = Color(0xFF2A78D6),
    violet = Color(0xFF4A3AA7),
    good = Color(0xFF0CA30C),
    goodText = Color(0xFF006300),
    critical = Color(0xFFC42F2F),
    warning = Color(0xFF9A6700),
    goodFill = Color(0x1F0CA30C),
    criticalFill = Color(0x1FD03B3B),
    warningFill = Color(0x1FFAB219),
    itmFill = Color(0x1AEDA100),
    accent = Color(0xFF0B0B0B),
    accentText = Color(0xFFFFFFFF),
)

val DarkObColors = ObColors(
    page = Color(0xFF050505),
    card = Color(0xFF0D0D0D),
    raised = Color(0xFF141414),
    sunken = Color(0xFF090909),
    textPrimary = Color(0xFFFFFFFF),
    textSecondary = Color(0xFFCFCFCF),
    textMuted = Color(0xFF8D8D8D),
    border = Color(0x1FFFFFFF),
    borderStrong = Color(0x3DFFFFFF),
    gridline = Color(0xFF1F1F1F),
    baseline = Color(0xFF3A3A3A),
    blue = Color(0xFF5B8FD9),
    violet = Color(0xFF9A90E0),
    good = Color(0xFF0CA30C),
    goodText = Color(0xFF2FBF2F),
    critical = Color(0xFFE66767),
    warning = Color(0xFFE0A12B),
    goodFill = Color(0x290CA30C),
    criticalFill = Color(0x29E66767),
    warningFill = Color(0x24E0A12B),
    itmFill = Color(0x24EDA100),
    accent = Color(0xFFFFFFFF),
    accentText = Color(0xFF050505),
)

val LocalObColors = staticCompositionLocalOf { LightObColors }

object Ob {
    val colors: ObColors
        @Composable get() = LocalObColors.current
}

/** Tabular figures so columns of prices line up, like the web's `.tabular`. */
val Tabular = TextStyle(fontFeatureSettings = "tnum")

private val ObTypography = Typography().let { t ->
    t.copy(
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.Bold, fontSize = 20.sp),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
        titleSmall = t.titleSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 13.sp),
        bodyMedium = t.bodyMedium.copy(fontSize = 14.sp),
        bodySmall = t.bodySmall.copy(fontSize = 12.sp),
        labelSmall = t.labelSmall.copy(fontSize = 10.sp, letterSpacing = 0.8.sp),
    )
}

val MonoFamily = FontFamily.Monospace

@Composable
fun OptionBuilderTheme(dark: Boolean, content: @Composable () -> Unit) {
    val ob = if (dark) DarkObColors else LightObColors
    val scheme = if (dark) {
        darkColorScheme(
            primary = ob.accent,
            onPrimary = ob.accentText,
            secondary = ob.blue,
            background = ob.page,
            onBackground = ob.textPrimary,
            surface = ob.card,
            onSurface = ob.textPrimary,
            surfaceVariant = ob.sunken,
            onSurfaceVariant = ob.textSecondary,
            surfaceContainer = ob.raised,
            surfaceContainerHigh = ob.raised,
            surfaceContainerLow = ob.card,
            outline = ob.borderStrong,
            outlineVariant = ob.border,
            error = ob.critical,
            secondaryContainer = ob.sunken,
            onSecondaryContainer = ob.textPrimary,
        )
    } else {
        lightColorScheme(
            primary = ob.accent,
            onPrimary = ob.accentText,
            secondary = ob.blue,
            background = ob.page,
            onBackground = ob.textPrimary,
            surface = ob.card,
            onSurface = ob.textPrimary,
            surfaceVariant = ob.sunken,
            onSurfaceVariant = ob.textSecondary,
            surfaceContainer = ob.raised,
            surfaceContainerHigh = ob.raised,
            surfaceContainerLow = ob.card,
            outline = ob.borderStrong,
            outlineVariant = ob.border,
            error = ob.critical,
            secondaryContainer = ob.sunken,
            onSecondaryContainer = ob.textPrimary,
        )
    }
    CompositionLocalProvider(LocalObColors provides ob) {
        MaterialTheme(colorScheme = scheme, typography = ObTypography, content = content)
    }
}
