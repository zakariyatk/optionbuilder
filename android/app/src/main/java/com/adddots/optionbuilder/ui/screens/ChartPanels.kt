package com.adddots.optionbuilder.ui.screens

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowRightAlt
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.automirrored.outlined.TrendingDown
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Adjust
import androidx.compose.material.icons.outlined.ChangeHistory
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CropSquare
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteSweep
import androidx.compose.material.icons.outlined.FastRewind
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.FullscreenExit
import androidx.compose.material.icons.outlined.HorizontalRule
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.NorthEast
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.ScreenRotation
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.Straighten
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.VerticalAlignCenter
import androidx.compose.material.icons.outlined.ViewStream
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.chart.ActiveIndicator
import com.adddots.optionbuilder.ui.chart.AlertCondition
import com.adddots.optionbuilder.ui.chart.COMPARE_COLORS
import com.adddots.optionbuilder.ui.chart.ChartStore
import com.adddots.optionbuilder.ui.chart.ChartStyle
import com.adddots.optionbuilder.ui.chart.ChartZone
import com.adddots.optionbuilder.ui.chart.DrawTool
import com.adddots.optionbuilder.ui.chart.INDICATORS
import com.adddots.optionbuilder.ui.chart.IndicatorGroup
import com.adddots.optionbuilder.ui.chart.MAX_COMPARE
import com.adddots.optionbuilder.ui.chart.MAX_SUB_PANES
import com.adddots.optionbuilder.ui.chart.Magnet
import com.adddots.optionbuilder.ui.chart.PriceAlert
import com.adddots.optionbuilder.ui.components.FormField
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.Segmented
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.pct
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular
import java.io.File
import java.io.FileOutputStream

/** Saves a chart snapshot to Pictures/AddStock; returns a message, or null if it failed. */
fun saveSnapshot(context: Context, bmp: Bitmap, name: String): String? = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "$name.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AddStock")
        }
        val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        context.contentResolver.openOutputStream(uri)?.use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } ?: return null
        "Snapshot saved to Pictures/AddStock"
    } else {
        // Android 8–9: the app's own Pictures folder needs no storage permission.
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: return null
        FileOutputStream(File(dir, "$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        "Snapshot saved to the app's Pictures folder"
    }
}.getOrNull()

private val DrawTool.icon: ImageVector
    get() = when (this) {
        DrawTool.Segment -> Icons.Outlined.Straighten
        DrawTool.Ray -> Icons.Outlined.NorthEast
        DrawTool.HLine -> Icons.Outlined.HorizontalRule
        DrawTool.HRay -> Icons.AutoMirrored.Outlined.ArrowRightAlt
        DrawTool.VLine -> Icons.Outlined.VerticalAlignCenter
        DrawTool.Channel -> Icons.Outlined.ViewStream
        DrawTool.FibRetracement, DrawTool.FibExtension -> Icons.Outlined.Layers
        DrawTool.Rect -> Icons.Outlined.CropSquare
        DrawTool.Circle -> Icons.Outlined.RadioButtonUnchecked
        DrawTool.Triangle -> Icons.Outlined.ChangeHistory
        DrawTool.Arrow -> Icons.AutoMirrored.Outlined.ShowChart
        DrawTool.LongPosition -> Icons.AutoMirrored.Outlined.TrendingUp
        DrawTool.ShortPosition -> Icons.AutoMirrored.Outlined.TrendingDown
    }

/**
 * DrawingBar.tsx: finger-sized drawing tools over the bottom of the chart. Pick
 * a tool, tap its points on the chart; tap a drawing to select it and drag its
 * points to adjust them. Magnet snaps points to the bar's prices.
 */
@Composable
internal fun DrawingBar(
    tool: DrawTool?, onTool: (DrawTool) -> Unit,
    magnet: Magnet, onMagnet: () -> Unit,
    keepDrawing: Boolean, onKeepDrawing: () -> Unit,
    locked: Boolean, onLock: () -> Unit,
    hidden: Boolean, onHide: () -> Unit,
    canDelete: Boolean, onDelete: () -> Unit,
    count: Int, onClearAll: () -> Unit,
    onClose: () -> Unit,
) {
    val c = Ob.colors
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(c.raised)) {
        HorizontalDivider(color = c.border)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = 4.dp)) {
            DrawTool.entries.forEach { t ->
                val on = t == tool
                Column(
                    Modifier.width(66.dp).clip(RoundedCornerShape(8.dp)).background(if (on) c.blue.copy(alpha = 0.16f) else Color.Transparent)
                        .clickable { onTool(t) }.padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    when (t) {
                        DrawTool.FibRetracement -> Text("Fib", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (on) c.blue else c.textPrimary, modifier = Modifier.height(20.dp))
                        DrawTool.FibExtension -> Text("FibX", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (on) c.blue else c.textPrimary, modifier = Modifier.height(20.dp))
                        else -> Icon(t.icon, null, Modifier.size(20.dp), tint = if (on) c.blue else c.textPrimary)
                    }
                    Text(t.label, fontSize = 9.sp, color = if (on) c.blue else c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp).padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            SmallTool(Icons.Outlined.Adjust, magnet.label, magnet != Magnet.Off, onMagnet)
            SmallTool(Icons.Outlined.Repeat, "Keep drawing", keepDrawing, onKeepDrawing)
            SmallTool(if (locked) Icons.Outlined.Lock else Icons.Outlined.LockOpen, if (locked) "Unlock" else "Lock", locked, onLock)
            SmallTool(if (hidden) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (hidden) "Show" else "Hide", hidden, onHide)
            SmallTool(Icons.Outlined.Delete, "Delete", false, onDelete, enabled = canDelete)
            SmallTool(Icons.Outlined.DeleteSweep, "Clear all", false, { confirm = true }, enabled = count > 0)
            Spacer(Modifier.weight(1f))
            SmallTool(Icons.Outlined.Close, "Done", false, onClose)
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Remove all drawings?") },
            text = { Text("All $count drawings on this symbol will be removed.") },
            confirmButton = { TextButton({ confirm = false; onClearAll() }) { Text("Remove all", color = c.critical) } },
            dismissButton = { TextButton({ confirm = false }) { Text("Cancel") } },
            containerColor = c.raised,
        )
    }
}

@Composable
private fun SmallTool(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit, enabled: Boolean = true) {
    val c = Ob.colors
    Column(
        Modifier.widthIn(min = 52.dp).alpha(if (enabled) 1f else 0.35f).clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, Modifier.size(18.dp), tint = if (active) c.blue else c.textPrimary)
        Text(label, fontSize = 9.sp, color = if (active) c.blue else c.textSecondary, maxLines = 1)
    }
}

/** ReplayBar.tsx: play / pause, step a bar, speed, exit. */
@Composable
internal fun ReplayBar(r: Replay.On, at: String, onChange: (Replay) -> Unit, onStep: () -> Unit, onExit: () -> Unit) {
    val c = Ob.colors
    Column(Modifier.fillMaxWidth().background(c.raised)) {
        HorizontalDivider(color = c.border)
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(Icons.Outlined.FastRewind, null, Modifier.size(18.dp), tint = c.blue)
            Column(Modifier.weight(1f)) {
                Text("Bar replay", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                Text(at, fontSize = 10.sp, color = c.textMuted, maxLines = 1)
            }
            SmallTool(if (r.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (r.playing) "Pause" else "Play", r.playing, { onChange(r.copy(playing = !r.playing)) })
            SmallTool(Icons.Outlined.SkipNext, "Step", false, onStep)
            Text(
                "${r.speed}×",
                Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, c.borderStrong, RoundedCornerShape(6.dp))
                    .clickable { onChange(r.copy(speed = when (r.speed) { 1 -> 2; 2 -> 5; 5 -> 10; else -> 1 })) }.padding(horizontal = 8.dp, vertical = 6.dp),
                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary,
            )
            SmallTool(Icons.Outlined.Close, "Exit", false, onExit)
        }
    }
}

@Composable
private fun SheetTitle(text: String) =
    Text(text, Modifier.padding(horizontal = 20.dp).padding(bottom = 8.dp), fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)

@Composable
private fun SheetRow(icon: ImageVector?, label: String, detail: String? = null, active: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    val c = Ob.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 50.dp).alpha(if (enabled) 1f else 0.4f).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(20.dp), tint = if (active) c.blue else c.textSecondary)
        Text(label, Modifier.weight(1f), fontSize = 14.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal, color = if (active) c.blue else c.textPrimary)
        if (detail != null) Text(detail, fontSize = 12.sp, color = c.textMuted)
        if (active) Icon(Icons.Outlined.Check, null, Modifier.size(18.dp), tint = c.blue)
    }
}

@Composable
private fun Note(text: String) = Text(text, Modifier.padding(horizontal = 20.dp, vertical = 6.dp), fontSize = 11.sp, color = Ob.colors.textMuted, lineHeight = 15.sp)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Sheet(onClose: () -> Unit, tall: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, containerColor = Ob.colors.raised, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = tall)) {
        Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(bottom = 16.dp), content = content)
    }
}

/** Every sheet the phone chart opens. */
@Composable
internal fun ChartSheets(
    sheet: ChartSheetId?,
    onSheet: (ChartSheetId?) -> Unit,
    state: AppState,
    store: ChartStore,
    sym: ChartSymbol,
    lastPrice: Double,
    replay: Replay,
    onReplay: () -> Unit,
    onSnapshot: () -> Unit,
    full: Boolean,
    onFull: () -> Unit,
    landscape: Boolean,
    onRotate: () -> Unit,
    onPick: (String) -> Unit,
    onCompare: (String) -> Unit,
    onBuild: () -> Unit,
    onIndicators: (List<ActiveIndicator>) -> Unit,
) {
    val c = Ob.colors
    val close = { onSheet(null) }
    val prefs = store.prefs(sym.symbol)
    when (sheet) {
        null -> Unit
        ChartSheetId.Type -> Sheet(close) {
            SheetTitle("Chart type")
            ChartStyle.entries.forEach { t ->
                SheetRow(t.icon, t.label, active = t == prefs.style) { store.setPrefs(sym.symbol) { it.copy(style = t) }; close() }
            }
            Note("Remembered for ${sym.display}.")
        }
        ChartSheetId.Indicators -> Sheet(close, tall = true) { IndicatorSheet(store.indicators.toList(), onIndicators) }
        ChartSheetId.Alerts -> Sheet(close) { AlertSheet(store, sym, lastPrice) }
        ChartSheetId.Compare -> Sheet(close) {
            SheetTitle("Compare")
            Note("Lines start level with ${sym.display} at the left edge of the chart; the price scale shows % change. Up to $MAX_COMPARE.")
            prefs.compare.forEachIndexed { i, s ->
                val o = chartSymbol(s)
                Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(COMPARE_COLORS[i % COMPARE_COLORS.size]))
                    Text(o.display, Modifier.padding(start = 12.dp), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
                    Text(o.name, Modifier.padding(start = 6.dp).weight(1f), fontSize = 12.sp, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Box(Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).clickable { store.removeCompare(sym.symbol, s) }, contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Close, "Stop comparing ${o.display}", Modifier.size(18.dp), tint = c.textSecondary)
                    }
                }
            }
            if (prefs.compare.size < MAX_COMPARE) SheetRow(Icons.Outlined.Add, "Add symbol") { onSheet(ChartSheetId.CompareSearch) }
        }
        ChartSheetId.Watchlist -> Sheet(close, tall = true) {
            SheetTitle("Watchlist")
            CHART_SYMBOLS.forEach { w ->
                Row(
                    Modifier.fillMaxWidth().background(if (w.symbol == sym.symbol) c.sunken else Color.Transparent)
                        .clickable { onPick(w.symbol); close() }.heightIn(min = 52.dp).padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(w.display, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                        Text(w.name, fontSize = 11.sp, color = c.textMuted, maxLines = 1)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(num(w.last, 2), style = Tabular, fontSize = 14.sp, color = c.textPrimary)
                        Text(pct(w.changePct), style = Tabular, fontSize = 12.sp, color = if (w.changePct >= 0) c.goodText else c.critical)
                    }
                }
            }
        }
        ChartSheetId.More -> Sheet(close) {
            SheetTitle("Chart")
            SheetRow(prefs.style.icon, "Chart type", detail = prefs.style.label) { onSheet(ChartSheetId.Type) }
            SheetRow(Icons.Outlined.FastRewind, if (replay == Replay.Off) "Bar replay" else "Exit bar replay") { close(); onReplay() }
            SheetRow(Icons.Outlined.PhotoCamera, "Snapshot") { close(); onSnapshot() }
            SheetRow(Icons.Outlined.Public, "Timezone", detail = store.settings.zone.label) { onSheet(ChartSheetId.Settings) }
            SheetRow(Icons.Outlined.Settings, "Chart settings") { onSheet(ChartSheetId.Settings) }
            SheetRow(if (full) Icons.Outlined.FullscreenExit else Icons.Outlined.Fullscreen, if (full) "Exit full screen" else "Full screen") { close(); onFull() }
            SheetRow(Icons.Outlined.ScreenRotation, if (landscape) "Portrait" else "Landscape") { close(); onRotate() }
            if (!sym.us) SheetRow(Icons.Outlined.Layers, "Build strategy on ${sym.display}") { close(); onBuild() }
            Note("Pinch to zoom · drag to scroll · press and hold for the crosshair, then slide to read any bar · tap to hide it.")
        }
        ChartSheetId.Settings -> Sheet(close) {
            SheetTitle("Chart settings")
            val s = store.settings
            SettingSwitch("Grid lines", s.grid) { store.updateSettings(s.copy(grid = it)) }
            SettingSwitch("Last price line", s.lastPriceLine) { store.updateSettings(s.copy(lastPriceLine = it)) }
            SettingSwitch("Crosshair price and time labels", s.crosshairLabels) { store.updateSettings(s.copy(crosshairLabels = it)) }
            Text("Timezone", Modifier.padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 4.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted)
            ChartZone.entries.forEach { z -> SheetRow(null, z.label, active = z == s.zone) { store.updateSettings(s.copy(zone = z)) } }
        }
        ChartSheetId.Search, ChartSheetId.CompareSearch -> Sheet(close, tall = true) {
            val comparing = sheet == ChartSheetId.CompareSearch
            var q by remember { mutableStateOf("") }
            SheetTitle(if (comparing) "Compare with ${sym.display}" else "Symbol search")
            Box(Modifier.padding(horizontal = 20.dp)) { FormField("Search NSE, BSE or US symbols", q, { q = it }) }
            val exclude = if (comparing) prefs.compare + sym.symbol else emptyList()
            val recent = store.recent.filter { r -> r !in exclude && CHART_SYMBOLS.any { it.symbol == r } }
            if (q.isBlank() && recent.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    recent.forEach { r ->
                        Text(
                            chartSymbol(r).display,
                            Modifier.clip(CircleShape).border(1.dp, c.borderStrong, CircleShape)
                                .clickable { if (comparing) onCompare(r) else onPick(r); close() }.padding(horizontal = 12.dp, vertical = 6.dp),
                            fontSize = 12.sp, color = c.textPrimary,
                        )
                    }
                }
            }
            val qq = q.trim()
            CHART_SYMBOLS.filter { it.symbol !in exclude && (qq.isEmpty() || it.symbol.contains(qq, true) || it.name.contains(qq, true)) }.forEach { w ->
                Row(
                    Modifier.fillMaxWidth().clickable { if (comparing) onCompare(w.symbol) else onPick(w.symbol); close() }.heightIn(min = 50.dp).padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Search, null, Modifier.size(16.dp), tint = c.textMuted)
                    Column(Modifier.padding(start = 12.dp).weight(1f)) {
                        Text(w.display, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.textPrimary)
                        Text(w.name, fontSize = 11.sp, color = c.textMuted)
                    }
                    Text(w.market, fontSize = 11.sp, color = c.textMuted)
                }
            }
        }
    }
}

@Composable
private fun SettingSwitch(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!on) }.padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 14.sp, color = Ob.colors.textPrimary)
        Switch(on, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Ob.colors.accent, checkedThumbColor = Ob.colors.accentText))
    }
}

/**
 * IndicatorSheet.tsx: what's on the chart at the top (settings, hide,
 * remove), then every indicator to add, searchable and grouped.
 */
@Composable
private fun IndicatorSheet(active: List<ActiveIndicator>, onChange: (List<ActiveIndicator>) -> Unit) {
    val c = Ob.colors
    var q by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    SheetTitle("Indicators")
    Box(Modifier.padding(horizontal = 20.dp)) { FormField("Search indicators", q, { q = it }) }
    if (active.isNotEmpty()) {
        Text("On the chart", Modifier.padding(horizontal = 20.dp).padding(top = 14.dp, bottom = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted)
        active.forEach { a ->
            Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${a.name} ${a.params.joinToString(" ") { if (it == Math.floor(it)) it.toLong().toString() else it.toString() }}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (a.visible) c.textPrimary else c.textMuted)
                    Text(a.def.title, fontSize = 11.sp, color = c.textMuted)
                }
                if (a.def.defaults.isNotEmpty()) IconTap(Icons.Outlined.Tune, "Settings for ${a.name}", editing == a.name) { editing = if (editing == a.name) null else a.name }
                IconTap(if (a.visible) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff, if (a.visible) "Hide ${a.name}" else "Show ${a.name}", false) {
                    onChange(active.map { if (it.name == a.name) it.copy(visible = !it.visible) else it })
                }
                IconTap(Icons.Outlined.Close, "Remove ${a.name}", false) {
                    onChange(active.filter { it.name != a.name }); if (editing == a.name) editing = null
                }
            }
            if (editing == a.name) IndicatorSettings(a, onApply = { params -> onChange(active.map { if (it.name == a.name) it.copy(params = params) else it }); editing = null })
        }
    }
    if (note.isNotEmpty()) Text(note, Modifier.padding(horizontal = 20.dp, vertical = 8.dp), fontSize = 12.sp, color = c.warning)
    val qq = q.trim()
    IndicatorGroup.entries.forEach { g ->
        val list = INDICATORS.filter { it.group == g && (qq.isEmpty() || it.name.contains(qq, true) || it.title.contains(qq, true)) }
        if (list.isEmpty()) return@forEach
        Text(g.name, Modifier.padding(horizontal = 20.dp).padding(top = 14.dp, bottom = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted)
        list.forEach { def ->
            val on = active.any { it.name == def.name }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = !on) {
                    note = ""
                    if (!def.overlay && active.count { !it.def.overlay } >= MAX_SUB_PANES) {
                        note = "Up to $MAX_SUB_PANES indicator panes fit on a phone — remove one first."
                    } else onChange(active + ActiveIndicator(def.name, def.defaults))
                }.padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(def.title, fontSize = 14.sp, color = c.textPrimary)
                    Text(def.name + if (def.overlay) " · on the price chart" else " · own pane", fontSize = 11.sp, color = c.textMuted)
                }
                Icon(if (on) Icons.Outlined.Check else Icons.Outlined.Add, null, Modifier.size(20.dp), tint = if (on) c.blue else c.textSecondary)
            }
        }
    }
}

@Composable
private fun IndicatorSettings(a: ActiveIndicator, onApply: (List<Double>) -> Unit) {
    val def = a.def
    val texts = remember(a) { mutableStateOf(a.params.ifEmpty { def.defaults }.map { if (it == Math.floor(it)) it.toLong().toString() else it.toString() }) }
    var error by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 8.dp).clip(RoundedCornerShape(10.dp)).background(Ob.colors.sunken).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        texts.value.forEachIndexed { i, t ->
            FormField(def.paramLabel(i), t, { v -> texts.value = texts.value.toMutableList().also { it[i] = v } }, number = true)
        }
        if (error) Text("Each setting needs a number above 0.", fontSize = 11.sp, color = Ob.colors.critical)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ObButton("Reset", { texts.value = def.defaults.map { if (it == Math.floor(it)) it.toLong().toString() else it.toString() } }, Modifier.weight(1f))
            ObButton("Apply", {
                val parsed = texts.value.mapIndexed { i, t -> t.trim().toDoubleOrNull()?.takeIf { it > 0 }?.let { if (def.integer(i)) Math.round(it).toDouble() else it } }
                if (parsed.any { it == null }) error = true else onApply(parsed.filterNotNull())
            }, Modifier.weight(1f), primary = true)
        }
    }
}

@Composable
private fun IconTap(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, Modifier.size(19.dp), tint = if (active) Ob.colors.blue else Ob.colors.textSecondary)
    }
}

/** AlertSheet.tsx: price alerts for this symbol, drawn as lines on the chart. */
@Composable
private fun AlertSheet(store: ChartStore, sym: ChartSymbol, last: Double) {
    val c = Ob.colors
    var condition by remember { mutableStateOf(AlertCondition.CrossingUp) }
    var price by remember { mutableStateOf(num(last, 2).replace(",", "")) }
    val alerts = store.alerts(sym.symbol)
    SheetTitle("Price alerts · ${sym.display}")
    Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Segmented(AlertCondition.entries, condition, { it.label }, { condition = it })
        FormField("Price", price, { price = it }, number = true)
        Text("Last price ${num(last, 2)}", fontSize = 11.sp, color = c.textMuted)
        ObButton("Create alert", {
            price.trim().toDoubleOrNull()?.takeIf { it > 0 }?.let { p ->
                store.setAlerts(sym.symbol, alerts + PriceAlert(store.newId(), condition, p))
            }
        }, Modifier.fillMaxWidth(), primary = true, enabled = price.trim().toDoubleOrNull()?.let { it > 0 } == true)
    }
    if (alerts.isNotEmpty()) {
        Text("Alerts", Modifier.padding(horizontal = 20.dp).padding(top = 16.dp, bottom = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.textMuted)
        alerts.forEach { a ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${a.condition.label} ", fontSize = 14.sp, color = c.textSecondary)
                Text(num(a.price, 2), Modifier.weight(1f), style = Tabular, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                IconTap(Icons.Outlined.Delete, "Delete alert", false) { store.setAlerts(sym.symbol, alerts.filter { it.id != a.id }) }
            }
        }
    }
    Note("Alerts show as lines on the chart and are kept on this phone.")
}
