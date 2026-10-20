package com.adddots.optionbuilder.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Expiry
import com.adddots.optionbuilder.data.Side
import com.adddots.optionbuilder.data.SymbolInfo
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular

val CardShape = RoundedCornerShape(10.dp)

/** Standard page body: vertical scroll, 16dp gutters, 12dp between cards. */
@Composable
fun ScreenColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun ObCard(modifier: Modifier = Modifier, padding: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(CardShape)
            .background(Ob.colors.card)
            .border(1.dp, Ob.colors.border, CardShape)
            .then(if (padding) Modifier.padding(14.dp) else Modifier),
        content = content,
    )
}

@Composable
fun CardHeader(title: String, subtitle: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(start = 14.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Ob.colors.textPrimary)
            if (subtitle != null) Text(subtitle, fontSize = 11.sp, color = Ob.colors.textMuted)
        }
        actions()
    }
    HorizontalDivider(color = Ob.colors.border)
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = Ob.colors.textMuted) {
    Text(text.uppercase(), modifier = modifier, fontSize = 10.sp, letterSpacing = 1.sp, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = Ob.colors.textPrimary, hint: String? = null, big: Boolean = false) {
    Column(modifier) {
        Eyebrow(label)
        Text(
            value,
            style = Tabular,
            fontSize = if (big) 20.sp else 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = valueColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (hint != null) Text(hint, fontSize = 10.sp, color = Ob.colors.textMuted)
    }
}

/** The 2-up summary tiles that open the Drafts, Positions and Portfolio pages. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = Ob.colors.textPrimary, hint: String? = null) {
    ObCard(modifier) {
        Stat(label, value, Modifier.padding(horizontal = 14.dp, vertical = 12.dp), valueColor, hint, big = true)
    }
}

/** Lays [items] out [columns] to a row, each cell taking an equal share of the width. */
@Composable
fun Grid(items: List<@Composable (Modifier) -> Unit>, columns: Int = 2, gap: Int = 12) {
    Column(verticalArrangement = Arrangement.spacedBy(gap.dp)) {
        items.chunked(columns).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap.dp)) {
                row.forEach { cell -> cell(Modifier.weight(1f)) }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

enum class Tone { Info, Warning, Critical }

@Composable
fun Notice(text: String, tone: Tone = Tone.Warning, action: (@Composable () -> Unit)? = null) {
    val (fg, bg, icon) = when (tone) {
        Tone.Info -> Triple(Ob.colors.blue, Ob.colors.sunken, Icons.Outlined.Info)
        Tone.Warning -> Triple(Ob.colors.warning, Ob.colors.warningFill, Icons.Outlined.WarningAmber)
        Tone.Critical -> Triple(Ob.colors.critical, Ob.colors.criticalFill, Icons.Outlined.ErrorOutline)
    }
    Row(
        Modifier.fillMaxWidth().clip(CardShape).background(bg).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(18.dp))
        Text(text, Modifier.weight(1f), fontSize = 12.sp, color = Ob.colors.textPrimary)
        action?.invoke()
    }
}

@Composable
fun SidePill(side: Side, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val buy = side == Side.BUY
    Box(
        modifier
            .clip(RoundedCornerShape(5.dp))
            .background(if (buy) Ob.colors.goodFill else Ob.colors.criticalFill)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .heightIn(min = if (onClick != null) 36.dp else 0.dp)
            .width(48.dp)
            .padding(vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(side.name, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (buy) Ob.colors.goodText else Ob.colors.critical)
    }
}

@Composable
fun Pill(text: String, fg: Color, bg: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 8.dp, vertical = 2.dp),
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        color = fg,
        maxLines = 1,
    )
}

@Composable
fun StatusPill(closed: Boolean) =
    if (closed) Pill("Closed", Ob.colors.textMuted, Ob.colors.sunken) else Pill("Open", Ob.colors.goodText, Ob.colors.goodFill)

@Composable
fun ObButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    danger: Boolean = false,
    enabled: Boolean = true,
) {
    val bg = if (primary) Ob.colors.accent else Color.Transparent
    val fg = when {
        primary -> Ob.colors.accentText
        danger -> Ob.colors.critical
        else -> Ob.colors.textPrimary
    }
    Row(
        modifier
            .alpha(if (enabled) 1f else 0.45f)
            .clip(RoundedCornerShape(7.dp))
            .background(bg)
            .border(1.dp, if (primary) bg else Ob.colors.borderStrong, RoundedCornerShape(7.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .heightIn(min = 40.dp)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        if (icon != null) Icon(icon, null, tint = fg, modifier = Modifier.size(16.dp))
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = fg, maxLines = 1)
    }
}

/** A row of mutually exclusive options, like the web's segmented toggles. */
@Composable
fun <T> Segmented(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Ob.colors.sunken)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { o ->
            val on = o == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (on) Ob.colors.raised else Color.Transparent)
                    .then(if (on) Modifier.border(1.dp, Ob.colors.border, RoundedCornerShape(6.dp)) else Modifier)
                    .clickable { onSelect(o) }
                    .heightIn(min = 32.dp)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label(o), fontSize = 12.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = if (on) Ob.colors.textPrimary else Ob.colors.textSecondary)
            }
        }
    }
}

/** Scrollable chips; used for intervals, periods and expiries. */
@Composable
fun <T> ChipRow(options: List<T>, isSelected: (T) -> Boolean, label: (T) -> String, onClick: (T) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        options.forEach { o ->
            val on = isSelected(o)
            Box(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (on) Ob.colors.accent else Color.Transparent)
                    .border(1.dp, if (on) Ob.colors.accent else Ob.colors.borderStrong, RoundedCornerShape(50))
                    .clickable { onClick(o) }
                    .heightIn(min = 32.dp)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label(o), fontSize = 12.sp, color = if (on) Ob.colors.accentText else Ob.colors.textPrimary, maxLines = 1)
            }
        }
    }
}

/** A select-style button that opens a menu, standing in for the web's `<select>`. */
@Composable
fun <T> Picker(
    value: String,
    options: List<T>,
    optionLabel: (T) -> String,
    onPick: (T) -> Unit,
    modifier: Modifier = Modifier,
    optionDetail: ((T) -> String?)? = null,
    bold: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(7.dp))
                .border(1.dp, Ob.colors.borderStrong, RoundedCornerShape(7.dp))
                .clickable { open = true }
                .heightIn(min = 40.dp)
                .padding(start = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(value, Modifier.weight(1f, fill = false), fontSize = 13.sp, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal, color = Ob.colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Filled.ArrowDropDown, null, tint = Ob.colors.textSecondary)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Ob.colors.raised) {
            options.forEach { o ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(optionLabel(o), fontSize = 13.sp, color = Ob.colors.textPrimary)
                            optionDetail?.invoke(o)?.let { Text(it, fontSize = 11.sp, color = Ob.colors.textMuted) }
                        }
                    },
                    onClick = { open = false; onPick(o) },
                )
            }
        }
    }
}

@Composable
fun LiveDot(color: Color = Ob.colors.good) {
    val t = rememberInfiniteTransition(label = "live")
    val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "alpha")
    Box(Modifier.size(7.dp).alpha(a).clip(CircleShape).background(color))
}

@Composable
fun LiveLabel(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        LiveDot()
        Text(text, fontSize = 11.sp, color = Ob.colors.textMuted)
    }
}

@Composable
fun EmptyState(title: String, body: String? = null, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center, color = Ob.colors.textPrimary)
        if (body != null) Text(body, fontSize = 13.sp, textAlign = TextAlign.Center, color = Ob.colors.textMuted)
        if (action != null) { Spacer(Modifier.size(4.dp)); action() }
    }
}

/** Label on the left, value on the right; the building block of row-cards. */
@Composable
fun KeyValue(key: String, value: String, valueColor: Color = Ob.colors.textPrimary, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(key, fontSize = 12.sp, color = Ob.colors.textMuted)
        Text(value, style = Tabular, fontSize = 13.sp, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal, color = valueColor)
    }
}

/** Symbol / expiry selectors and the live spot, shared by Builder, Chain, OI and Report. */
@Composable
fun MarketBar(
    symbol: SymbolInfo,
    symbols: List<SymbolInfo>,
    onSymbol: (SymbolInfo) -> Unit,
    expiry: Expiry?,
    expiries: List<Expiry>,
    onExpiry: (Expiry) -> Unit,
    updatedSecondsAgo: Int = 3,
) {
    val change = symbol.spot - symbol.previousClose
    val changePct = change / symbol.previousClose * 100
    val up = change >= 0
    ObCard(padding = true) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Picker(
                value = symbol.symbol,
                options = symbols,
                optionLabel = { it.symbol },
                optionDetail = { (if (it.isIndex) "Index · " else "Stock · ") + it.label },
                onPick = onSymbol,
                modifier = Modifier.weight(3f),
                bold = true,
            )
            if (expiry != null) {
                Picker(
                    value = "${expiry.label} · ${expiry.daysToExpiry}d",
                    options = expiries,
                    optionLabel = { "${it.label} · ${it.daysToExpiry}d" },
                    onPick = onExpiry,
                    modifier = Modifier.weight(2f),
                )
            }
        }
        Spacer(Modifier.size(10.dp))
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(num(symbol.spot), style = Tabular, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
            Text(
                "${signed(change, 2)} (${pct(changePct)})",
                Modifier.padding(bottom = 2.dp),
                style = Tabular,
                fontSize = 13.sp,
                color = if (up) Ob.colors.goodText else Ob.colors.critical,
            )
            Spacer(Modifier.weight(1f))
            Text("Updated ${updatedSecondsAgo}s ago", Modifier.padding(bottom = 3.dp), fontSize = 11.sp, color = Ob.colors.textMuted)
        }
    }
}
