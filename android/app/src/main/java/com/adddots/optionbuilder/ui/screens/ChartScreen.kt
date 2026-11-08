package com.adddots.optionbuilder.ui.screens

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.AreaChart
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CandlestickChart
import androidx.compose.material.icons.automirrored.outlined.CompareArrows
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.FullscreenExit
import androidx.compose.material.icons.outlined.Functions
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowRight
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.ScreenRotation
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.adddots.optionbuilder.data.Candle
import com.adddots.optionbuilder.data.Page
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.chart.ActiveIndicator
import com.adddots.optionbuilder.ui.chart.COMPARE_COLORS
import com.adddots.optionbuilder.ui.chart.ChartGestures
import com.adddots.optionbuilder.ui.chart.ChartStore
import com.adddots.optionbuilder.ui.chart.ChartStyle
import com.adddots.optionbuilder.ui.chart.ChartViewport
import com.adddots.optionbuilder.ui.chart.CompareSeries
import com.adddots.optionbuilder.ui.chart.DrawTool
import com.adddots.optionbuilder.ui.chart.Drawing
import com.adddots.optionbuilder.ui.chart.Interval
import com.adddots.optionbuilder.ui.chart.ProChart
import com.adddots.optionbuilder.ui.chart.Pt
import com.adddots.optionbuilder.ui.chart.barTimes
import com.adddots.optionbuilder.ui.chart.hitDistance
import com.adddots.optionbuilder.ui.chart.readoutIndex
import com.adddots.optionbuilder.ui.chart.snap
import com.adddots.optionbuilder.ui.chart.timeLabel
import com.adddots.optionbuilder.ui.chart.timeOfIndex
import com.adddots.optionbuilder.ui.components.compact
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.roundToInt

/** A symbol the chart can show (sample data until the app talks to the API). */
data class ChartSymbol(val symbol: String, val name: String, val last: Double, val changePct: Double) {
    val us get() = symbol.startsWith("US:")
    val display get() = symbol.removePrefix("US:")
    val market get() = if (us) "NASDAQ" else if (symbol == "SENSEX") "BSE" else "NSE"
}

private val NAMES = mapOf("SENSEX" to "BSE Sensex", "US:AAPL" to "Apple")

val CHART_SYMBOLS: List<ChartSymbol> = run {
    val fromWatch = SampleData.watchlist.map { w ->
        ChartSymbol(w.symbol, SampleData.symbols.firstOrNull { it.symbol == w.symbol }?.label ?: NAMES[w.symbol] ?: w.symbol, w.last, w.changePct)
    }
    val extra = SampleData.symbols.filter { s -> fromWatch.none { it.symbol == s.symbol } }
        .map { ChartSymbol(it.symbol, it.label, it.spot, (it.spot / it.previousClose - 1) * 100) }
    fromWatch + extra
}

fun chartSymbol(s: String) = CHART_SYMBOLS.firstOrNull { it.symbol == s } ?: CHART_SYMBOLS.first()

private const val BAR_COUNT = 320

/** Sample bars for a symbol and interval, ending at its last price. */
fun sampleBars(sym: ChartSymbol, interval: Interval): List<Candle> {
    val raw = SampleData.candles((sym.symbol + interval.text).hashCode().toLong(), BAR_COUNT, sym.last)
    val k = sym.last / raw.last().close
    return raw.map { Candle(it.open * k, it.high * k, it.low * k, it.close * k, it.volume) }
}

internal enum class ChartSheetId { Type, Indicators, Alerts, Compare, Watchlist, More, Settings, Search, CompareSearch }

/** Bar replay: picking the start bar, or replaying up to `end` (exclusive). */
internal sealed interface Replay {
    data object Off : Replay
    data object Picking : Replay
    data class On(val end: Int, val playing: Boolean = false, val speed: Int = 1) : Replay
}

internal val ChartStyle.icon: ImageVector
    get() = when (this) {
        ChartStyle.Candles, ChartStyle.Hollow, ChartStyle.HeikinAshi -> Icons.Outlined.CandlestickChart
        ChartStyle.Bars -> Icons.Outlined.BarChart
        ChartStyle.Line -> Icons.AutoMirrored.Outlined.ShowChart
        ChartStyle.Area -> Icons.Outlined.AreaChart
    }

/**
 * The phone chart (MobileChart.tsx), built for thumbs: quote header, interval
 * strip, the crosshair readout, a full-bleed chart (pinch to zoom, drag to
 * scroll, press and hold for the crosshair) and a bottom bar for the
 * watchlist, indicators, drawing, alerts and compare. Full screen hides the
 * app around it and can turn the phone to landscape. Interval, chart type and
 * compared symbols are remembered per symbol.
 */
@Composable
fun ChartScreen(state: AppState) {
    val context = LocalContext.current
    val store = remember { ChartStore.get(context) }
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    var symbol by remember { mutableStateOf(state.chartSymbol) }
    val sym = chartSymbol(symbol)
    val prefs = store.prefs(symbol)
    val all = remember(symbol, prefs.interval) { sampleBars(sym, prefs.interval) }
    val times = remember(symbol, prefs.interval) { barTimes(all.size, prefs.interval, sym.us) }

    var sheet by remember { mutableStateOf<ChartSheetId?>(null) }
    var drawingMode by remember { mutableStateOf(false) }
    var tool by remember { mutableStateOf<DrawTool?>(null) }
    var pending by remember { mutableStateOf<List<Pt>>(emptyList()) }
    var selected by remember { mutableStateOf<Long?>(null) }
    var locked by remember { mutableStateOf(false) }
    var hidden by remember { mutableStateOf(false) }
    var replay by remember(symbol, prefs.interval) { mutableStateOf<Replay>(Replay.Off) }
    var toast by remember { mutableStateOf("") }
    val viewport = remember(symbol, prefs.interval) { ChartViewport() }
    var drawings by remember(symbol) { mutableStateOf(store.drawings(symbol)) }
    var grab by remember { mutableStateOf<Pair<Long, Int>?>(null) }
    val full = state.chartFullScreen

    fun notify(msg: String) { toast = msg }
    LaunchedEffect(toast) { if (toast.isNotEmpty()) { delay(1800); toast = "" } }

    val bars = when (val r = replay) { is Replay.On -> all.take(r.end); else -> all }
    viewport.times = if (bars.size == times.size) times else times.copyOf(bars.size)
    viewport.interval = prefs.interval

    val compare = remember(symbol, prefs.interval, prefs.compare) {
        prefs.compare.mapIndexed { i, s -> CompareSeries(s, COMPARE_COLORS[i % COMPARE_COLORS.size], sampleBars(chartSymbol(s), prefs.interval).map { it.close }.toDoubleArray()) }
    }
    val alerts = store.alerts(symbol)

    // ---- full screen and orientation ----
    val view = LocalView.current
    val activity = context as? Activity
    DisposableEffect(full) {
        val window = activity?.window
        if (window != null) {
            val ctl = WindowCompat.getInsetsController(window, view)
            if (full) {
                ctl.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                ctl.hide(WindowInsetsCompat.Type.systemBars())
            } else ctl.show(WindowInsetsCompat.Type.systemBars())
        }
        onDispose { }
    }
    DisposableEffect(Unit) {
        onDispose {
            state.chartFullScreen = false
            activity?.window?.let { WindowCompat.getInsetsController(it, view).show(WindowInsetsCompat.Type.systemBars()) }
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }
    fun exitFull() {
        state.chartFullScreen = false
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    fun rotate() {
        state.chartFullScreen = true
        activity?.requestedOrientation = if (landscape) ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    BackHandler(enabled = full || drawingMode || replay != Replay.Off) {
        when {
            replay != Replay.Off -> replay = Replay.Off
            drawingMode -> { drawingMode = false; tool = null; pending = emptyList() }
            else -> exitFull()
        }
    }

    // ---- replay playback ----
    LaunchedEffect(replay) {
        val r = replay as? Replay.On ?: return@LaunchedEffect
        if (!r.playing) return@LaunchedEffect
        delay(1000L / r.speed)
        replay = if (r.end >= all.size) Replay.Off.also { notify("Replay reached the latest bar") } else r.copy(end = r.end + 1)
    }

    // ---- drawing ----
    fun saveDrawings(list: List<Drawing>) { drawings = list; store.setDrawings(symbol, list) }
    fun placePoint(p: Offset) {
        val t = tool ?: return
        val idx = viewport.indexAt(p.x)
        val price = snap(store.magnet, bars, viewport, idx, p.y, with(density) { 14.dp.toPx() })
        val pt = Pt(timeOfIndex(viewport.times, idx, prefs.interval), price)
        val pts = pending + pt
        if (pts.size < t.taps) { pending = pts; return }
        val points = when (t) {
            DrawTool.LongPosition, DrawTool.ShortPosition -> {
                // A box the width of a quarter screen; target two average bar ranges away, stop one.
                val recent = bars.takeLast(20)
                val range = recent.map { it.high - it.low }.average() * 1.5
                val sign = if (t == DrawTool.LongPosition) 1 else -1
                val endT = timeOfIndex(viewport.times, idx + max(8f, viewport.visible * 0.25f), prefs.interval)
                listOf(pt, Pt(endT, price + sign * 2 * range), Pt(endT, price - sign * range))
            }
            else -> pts
        }
        val d = Drawing(store.newId(), t, points)
        saveDrawings(drawings + d)
        pending = emptyList()
        selected = d.id
        if (!store.keepDrawing) tool = null
    }

    val onTap = rememberUpdatedState { p: Offset ->
        when {
            viewport.crosshair != null -> viewport.crosshair = null
            replay == Replay.Picking -> {
                val i = viewport.indexAt(p.x).roundToInt().coerceIn(20, all.size - 1)
                replay = Replay.On(i + 1)
                viewport.right = 0f
                notify("Replay from ${timeLabel(times[i], prefs.interval, ZoneId.of(store.settings.zone.id), short = false)}")
            }
            drawingMode && tool != null -> placePoint(p)
            else -> {
                val reach = with(density) { 18.dp.toPx() }
                selected = if (hidden) null else drawings.map { it to hitDistance(it, viewport, p) }.filter { it.second <= reach }.minByOrNull { it.second }?.first?.id
            }
        }
    }
    val onGrab = rememberUpdatedState { p: Offset ->
        val d = drawings.firstOrNull { it.id == selected }
        if (!drawingMode || locked || hidden || d == null) false
        else {
            val reach = with(density) { 24.dp.toPx() }
            val i = d.points.indices.minByOrNull { (viewport.pointAt(d.points[it]) - p).getDistance() }
            if (i != null && (viewport.pointAt(d.points[i]) - p).getDistance() <= reach) { grab = d.id to i; true } else false
        }
    }
    val onGrabMove = rememberUpdatedState { p: Offset ->
        grab?.let { (id, i) ->
            val idx = viewport.indexAt(p.x)
            val pt = Pt(timeOfIndex(viewport.times, idx, prefs.interval), snap(store.magnet, bars, viewport, idx, p.y, with(density) { 14.dp.toPx() }))
            drawings = drawings.map { d -> if (d.id == id) d.copy(points = d.points.toMutableList().also { it[i] = pt }) else d }
        }
        Unit
    }
    val onGrabEnd = rememberUpdatedState {
        // A dragged point is saved once the finger lifts.
        if (grab != null) store.setDrawings(symbol, drawings)
        grab = null
    }
    val gestures = remember {
        ChartGestures(
            onTap = { onTap.value(it) },
            onGrab = { onGrab.value(it) },
            onGrabMove = { onGrabMove.value(it) },
            onGrabEnd = { onGrabEnd.value() },
        )
    }

    // ---- snapshot ----
    val layer = rememberGraphicsLayer()
    fun snapshot() {
        scope.launch {
            val bmp = layer.toImageBitmap().asAndroidBitmap()
            notify(saveSnapshot(context, bmp, "AddStock-${sym.display}-${System.currentTimeMillis()}") ?: "Couldn't save the snapshot")
        }
    }

    fun pickSymbol(s: String) {
        store.touch(s)
        symbol = s
        state.chartSymbol = s
        selected = null; pending = emptyList()
    }

    // ---- layout ----
    val c = Ob.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(c.card)
            .then(if (full) Modifier.safeDrawingPadding() else Modifier),
    ) {
        val idx = readoutIndex(viewport, bars.size)
        val quote = all.last().close
        val prev = quote / (1 + sym.changePct / 100)
        val chg = quote - prev

        val symbolButton: @Composable () -> Unit = {
            Row(
                Modifier.clip(RoundedCornerShape(8.dp)).clickable { sheet = ChartSheetId.Search }.padding(end = 4.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(sym.display, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.textPrimary)
                        Icon(Icons.Outlined.ExpandMore, "Search symbols", Modifier.size(18.dp), tint = c.textMuted)
                    }
                    if (!landscape) Text("${sym.name} · ${sym.market}", fontSize = 11.sp, color = c.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        val priceBlock: @Composable () -> Unit = {
            Column(horizontalAlignment = Alignment.End) {
                Text(num(quote, 2), style = Tabular, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                Text(
                    "${if (chg > 0) "+" else ""}${num(chg, 2)} (${if (sym.changePct > 0) "+" else ""}${num(sym.changePct, 2)}%)",
                    style = Tabular, fontSize = 11.sp,
                    color = if (chg > 0) c.goodText else if (chg < 0) c.critical else c.textSecondary,
                )
            }
        }
        val tfStrip: @Composable RowScope.() -> Unit = {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                Interval.entries.forEach { iv ->
                    val on = iv == prefs.interval
                    Box(
                        Modifier
                            .height(32.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (on) c.blue.copy(alpha = 0.18f) else Color.Transparent)
                            .clickable { store.setPrefs(symbol) { it.copy(interval = iv) } }
                            .padding(horizontal = 9.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(iv.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (on) c.blue else c.textSecondary) }
                }
            }
        }
        val typeButton: @Composable () -> Unit = { IconBtn(prefs.style.icon, "Chart type: ${prefs.style.label}") { sheet = ChartSheetId.Type } }
        val fullButton: @Composable () -> Unit = {
            IconBtn(if (full) Icons.Outlined.FullscreenExit else Icons.Outlined.Fullscreen, if (full) "Exit full screen" else "Full screen") {
                if (full) exitFull() else state.chartFullScreen = true
            }
        }

        if (landscape) {
            Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                symbolButton()
                tfStrip()
                typeButton()
                priceBlock()
                IconBtn(Icons.Outlined.ScreenRotation, "Rotate") { rotate() }
                fullButton()
            }
            HorizontalDivider(color = c.border)
        } else {
            Row(Modifier.fillMaxWidth().height(50.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { symbolButton() }
                priceBlock()
            }
            HorizontalDivider(color = c.border)
            Row(Modifier.fillMaxWidth().height(40.dp).padding(start = 6.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                tfStrip()
                Box(Modifier.padding(horizontal = 2.dp).width(1.dp).height(20.dp).background(c.borderStrong))
                typeButton()
                if (full) IconBtn(Icons.Outlined.ScreenRotation, "Rotate to landscape") { rotate() }
                fullButton()
            }
            HorizontalDivider(color = c.border)
        }

        // Readout: the crosshair bar, or the latest.
        Row(Modifier.fillMaxWidth().height(36.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Readout(bars, idx, viewport.times, prefs.interval, ZoneId.of(store.settings.zone.id), Modifier.weight(1f))
            if (prefs.compare.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    prefs.compare.forEachIndexed { i, s ->
                        Row(
                            Modifier.height(24.dp).clip(CircleShape).border(1.dp, c.border, CircleShape).clickable { sheet = ChartSheetId.Compare }.padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Box(Modifier.size(8.dp).clip(CircleShape).background(COMPARE_COLORS[i % COMPARE_COLORS.size]))
                            Text(chartSymbol(s).display, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                        }
                    }
                }
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            ProChart(
                bars = bars,
                style = prefs.style,
                indicators = store.indicators,
                compare = compare,
                drawings = drawings,
                selected = if (drawingMode || selected != null) selected else null,
                pending = pending,
                pendingTool = tool,
                drawingsHidden = hidden,
                alerts = alerts,
                settings = store.settings,
                viewport = viewport,
                gestures = gestures,
                subPaneHeight = if (landscape) 52.dp else 84.dp,
                modifier = Modifier
                    .fillMaxSize()
                    .drawWithContent {
                        layer.record { this@drawWithContent.drawContent() }
                        drawLayer(layer)
                    },
            )
            if (viewport.right > 1f) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(end = 72.dp, bottom = 40.dp).size(36.dp).clip(CircleShape)
                        .background(c.raised).border(1.dp, c.borderStrong, CircleShape).clickable { viewport.right = 0f },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.KeyboardDoubleArrowRight, "Go to the latest bar", Modifier.size(18.dp), tint = c.textPrimary) }
            }
            val hint = when {
                replay == Replay.Picking -> "Tap a bar to start the replay from"
                drawingMode && tool != null -> "${tool!!.label}: tap ${tool!!.taps - pending.size} more point${if (tool!!.taps - pending.size == 1) "" else "s"} on the chart"
                else -> null
            }
            (toast.takeIf { it.isNotEmpty() } ?: hint)?.let { msg ->
                Box(Modifier.align(Alignment.TopCenter).padding(top = 10.dp, start = 24.dp, end = 24.dp)) {
                    Text(
                        msg,
                        Modifier.clip(CircleShape).background(c.raised).border(1.dp, c.borderStrong, CircleShape).padding(horizontal = 14.dp, vertical = 7.dp),
                        fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.textPrimary,
                    )
                }
            }
        }

        (replay as? Replay.On)?.let { r ->
            ReplayBar(
                r, viewport.times.getOrNull(r.end - 1)?.let { timeLabel(it, prefs.interval, ZoneId.of(store.settings.zone.id), short = false) } ?: "",
                onChange = { replay = it },
                onStep = { replay = if (r.end >= all.size) Replay.Off.also { notify("Replay reached the latest bar") } else r.copy(end = r.end + 1, playing = false) },
                onExit = { replay = Replay.Off },
            )
        }
        if (drawingMode) {
            DrawingBar(
                tool = tool,
                onTool = { t -> tool = if (tool == t) null else t; pending = emptyList() },
                magnet = store.magnet, onMagnet = { store.updateMagnet(store.magnet.next()); notify(store.magnet.label) },
                keepDrawing = store.keepDrawing, onKeepDrawing = { store.updateKeepDrawing(!store.keepDrawing); notify(if (store.keepDrawing) "Keep drawing on" else "Keep drawing off") },
                locked = locked, onLock = { locked = !locked; notify(if (locked) "Drawings locked" else "Drawings unlocked") },
                hidden = hidden, onHide = { hidden = !hidden; if (hidden) selected = null },
                canDelete = selected != null, onDelete = { saveDrawings(drawings.filter { it.id != selected }); selected = null },
                count = drawings.size, onClearAll = { saveDrawings(emptyList()); selected = null; notify("All drawings removed") },
                onClose = { drawingMode = false; tool = null; pending = emptyList(); selected = null },
            )
        }

        HorizontalDivider(color = c.border)
        Row(Modifier.fillMaxWidth().height(if (landscape) 48.dp else 58.dp).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            BarButton(Icons.AutoMirrored.Outlined.List, "Watchlist") { sheet = ChartSheetId.Watchlist }
            BarButton(Icons.Outlined.Functions, "Indicators") { sheet = ChartSheetId.Indicators }
            BarButton(Icons.Outlined.Draw, "Draw", active = drawingMode) {
                drawingMode = !drawingMode
                if (!drawingMode) { tool = null; pending = emptyList(); selected = null }
            }
            BarButton(Icons.Outlined.NotificationsNone, "Alert") { sheet = ChartSheetId.Alerts }
            BarButton(Icons.AutoMirrored.Outlined.CompareArrows, "Compare", active = prefs.compare.isNotEmpty()) { sheet = ChartSheetId.Compare }
            BarButton(Icons.Outlined.MoreHoriz, "More") { sheet = ChartSheetId.More }
        }
    }

    ChartSheets(
        sheet = sheet,
        onSheet = { sheet = it },
        state = state,
        store = store,
        sym = sym,
        lastPrice = all.last().close,
        replay = replay,
        onReplay = {
            when (replay) {
                Replay.Off -> { replay = Replay.Picking; notify("Tap a bar to start the replay from") }
                else -> replay = Replay.Off
            }
        },
        onSnapshot = { snapshot() },
        full = full,
        onFull = { if (full) exitFull() else state.chartFullScreen = true },
        landscape = landscape,
        onRotate = { rotate() },
        onPick = { pickSymbol(it) },
        onCompare = { s -> store.addCompare(symbol, s); notify("Comparing with ${chartSymbol(s).display}") },
        onBuild = {
            SampleData.symbols.firstOrNull { it.symbol == symbol }?.let { state.selectSymbol(it) }
            exitFull()
            state.navigate(Page.Builder)
        },
        onIndicators = { list: List<ActiveIndicator> -> store.setIndicators(list) },
    )
}

@Composable
private fun IconBtn(icon: ImageVector, label: String, active: Boolean = false, onClick: () -> Unit) {
    Box(Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, Modifier.size(20.dp), tint = if (active) Ob.colors.blue else Ob.colors.textPrimary)
    }
}

@Composable
private fun RowScope.BarButton(icon: ImageVector, label: String, active: Boolean = false, onClick: () -> Unit) {
    Column(
        Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        val col = if (active) Ob.colors.blue else Ob.colors.textSecondary
        Icon(icon, null, Modifier.size(21.dp), tint = col)
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 10.sp, fontWeight = FontWeight.Medium, color = col, maxLines = 1)
    }
}

/** Readout.tsx: the bar under the crosshair (or the latest): time, OHLC, change and volume. */
@Composable
private fun Readout(bars: List<Candle>, i: Int, times: LongArray, interval: Interval, zone: ZoneId, modifier: Modifier) {
    val c = Ob.colors
    val k = bars.getOrNull(i) ?: return
    val prev = bars.getOrNull(i - 1)?.close ?: k.open
    val chg = k.close - prev
    val col = if (chg >= 0) c.goodText else c.critical
    Row(modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        times.getOrNull(i)?.let { Text(timeLabel(it, interval, zone, short = false), fontSize = 11.sp, color = c.textMuted) }
        listOf("O" to k.open, "H" to k.high, "L" to k.low, "C" to k.close).forEach { (l, v) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("$l ", fontSize = 11.sp, color = c.textMuted)
                Text(num(v, 2), style = Tabular, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = col)
            }
        }
        Text("${if (chg >= 0) "+" else ""}${num(chg, 2)} (${if (chg >= 0) "+" else ""}${num(chg / prev * 100, 2)}%)", style = Tabular, fontSize = 11.sp, color = col)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Vol ", fontSize = 11.sp, color = c.textMuted)
            Text(compact(k.volume), style = Tabular, fontSize = 11.sp, color = c.textPrimary)
        }
    }
}
