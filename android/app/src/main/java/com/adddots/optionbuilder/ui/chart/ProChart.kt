package com.adddots.optionbuilder.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Candle
import com.adddots.optionbuilder.ui.components.compact
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.theme.Ob
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Series colours for indicator lines (the web chart's palette). */
val LINE_COLORS = listOf(Color(0xFFFF9600), Color(0xFF935EBD), Color(0xFF2196F3), Color(0xFFE11D74), Color(0xFF01C5C4))
val COMPARE_COLORS = listOf(Color(0xFFF59E0B), Color(0xFFE11D74), Color(0xFF14B8A6))
private val DRAW_COLOR = Color(0xFF2962FF)
private val ALERT_COLOR = Color(0xFFF59E0B)
private val FIB_LEVELS = listOf(0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0)
private val FIB_EXT_LEVELS = listOf(0.0, 0.618, 1.0, 1.618, 2.618)
private val dash = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))

class CompareSeries(val symbol: String, val color: Color, val closes: DoubleArray)

/**
 * The chart's viewport and the geometry of its last frame: how many bars fit,
 * how far it is scrolled back, and how to turn a bar / price into a pixel and
 * back. Gestures and the screen's drawing tools read it.
 */
class ChartViewport {
    var visible by mutableFloatStateOf(70f)
    /** Bars scrolled back from the latest; negative leaves space on the right. */
    var right by mutableFloatStateOf(0f)
    /** The crosshair, while it shows. */
    var crosshair by mutableStateOf<Offset?>(null)

    // The last frame, for converting touches.
    var n = 0
    var plotW = 1f
    var mainTop = 0f
    var mainBottom = 1f
    var yMin = 0.0
    var yMax = 1.0
    /** Percent mode (compare): prices are shown as % from this base. */
    var percentBase: Double? = null
    var times = LongArray(0)
    var interval = Interval.M15

    val barW get() = plotW / visible
    fun xOf(i: Float) = plotW - ((n - 1 - i) - right + 0.5f) * barW
    fun indexAt(x: Float) = n - 1 - right - ((plotW - x) / barW - 0.5f)
    fun toAxis(price: Double) = percentBase?.let { (price / it - 1) * 100 } ?: price
    fun fromAxis(v: Double) = percentBase?.let { it * (1 + v / 100) } ?: v
    fun yOf(price: Double) = (mainBottom - (toAxis(price) - yMin) / (yMax - yMin) * (mainBottom - mainTop)).toFloat()
    fun priceAt(y: Float) = fromAxis(yMin + (mainBottom - y) / (mainBottom - mainTop) * (yMax - yMin))
    fun xOfTime(t: Long) = xOf(indexOfTime(times, t, interval))
    fun pointAt(p: Pt) = Offset(xOfTime(p.time), yOf(p.price))

    fun clamp() {
        visible = visible.coerceIn(12f, max(12f, min(400f, n * 1.2f)))
        right = right.coerceIn(-visible * 0.4f, max(0f, n - 8f))
    }
}

/** Callbacks from the chart's gestures to the screen. */
class ChartGestures(
    val onTap: (Offset) -> Unit,
    /** A finger went down: return true to take the gesture (dragging a drawing point). */
    val onGrab: (Offset) -> Boolean = { false },
    val onGrabMove: (Offset) -> Unit = {},
    val onGrabEnd: () -> Unit = {},
)

@Composable
fun ProChart(
    bars: List<Candle>,
    style: ChartStyle,
    indicators: List<ActiveIndicator>,
    compare: List<CompareSeries>,
    drawings: List<Drawing>,
    selected: Long?,
    pending: List<Pt>,
    pendingTool: DrawTool?,
    drawingsHidden: Boolean,
    alerts: List<PriceAlert>,
    settings: ChartSettings,
    viewport: ChartViewport,
    gestures: ChartGestures,
    subPaneHeight: Dp,
    modifier: Modifier = Modifier,
) {
    val c = Ob.colors
    val tm = rememberTextMeasurer()
    val shown = remember(bars, style) { if (style == ChartStyle.HeikinAshi) heikinAshi(bars) else bars }
    val outputs = remember(bars, indicators.toList()) { indicators.filter { it.visible }.map { it to computeIndicator(it, bars) } }
    val zone = remember(settings.zone) { ZoneId.of(settings.zone.id) }

    Canvas(
        modifier.pointerInput(gestures) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                val start = down.position
                if (gestures.onGrab(start)) {
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!ch.pressed) break
                        if (ch.positionChanged()) { gestures.onGrabMove(ch.position); ch.consume() }
                    }
                    gestures.onGrabEnd()
                    return@awaitEachGesture
                }
                var multi = false
                var panning = false
                var tapUp: Offset? = null
                if (viewport.crosshair != null) {
                    // Crosshair already up: a drag slides it rather than scrolling; a tap hides it.
                    var moved = false
                    while (true) {
                        val ev = awaitPointerEvent()
                        if (ev.changes.count { it.pressed } > 1) { multi = true; break }
                        val ch = ev.changes.first()
                        if (!ch.pressed) { if (!moved) gestures.onTap(ch.position); return@awaitEachGesture }
                        if ((ch.position - start).getDistance() > viewConfiguration.touchSlop) moved = true
                        if (moved) { viewport.crosshair = ch.position; ch.consume() }
                    }
                } else {
                    withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                        while (true) {
                            val ev = awaitPointerEvent()
                            if (ev.changes.count { it.pressed } > 1) { multi = true; break }
                            val ch = ev.changes.first()
                            if (!ch.pressed) { tapUp = ch.position; break }
                            if ((ch.position - start).getDistance() > viewConfiguration.touchSlop) { panning = true; break }
                        }
                    }
                }
                when {
                    tapUp != null -> gestures.onTap(tapUp!!)
                    !multi && !panning -> {
                        // Press and hold: the crosshair, then slide to read any bar.
                        viewport.crosshair = start
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.first()
                            if (!ch.pressed) break
                            viewport.crosshair = ch.position
                            ch.consume()
                        }
                    }
                    else -> {
                        // Drag to scroll, pinch to zoom around the fingers.
                        while (true) {
                            val ev = awaitPointerEvent()
                            if (ev.changes.none { it.pressed }) break
                            val zoom = ev.calculateZoom()
                            val pan = ev.calculatePan()
                            if (zoom != 1f) {
                                val cx = ev.calculateCentroid(useCurrent = true).x
                                val anchor = viewport.indexAt(cx)
                                viewport.visible = (viewport.visible / zoom).coerceIn(12f, max(12f, min(400f, viewport.n * 1.2f)))
                                viewport.right = viewport.n - 1 - anchor - ((viewport.plotW - cx) / viewport.barW - 0.5f)
                            }
                            viewport.right += pan.x / viewport.barW
                            viewport.clamp()
                            ev.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    }
                }
            }
        },
    ) {
        val n = shown.size
        if (n == 0) return@Canvas
        val axisW = 62.dp.toPx()
        val timeH = 20.dp.toPx()
        val subH = subPaneHeight.toPx()
        val panes = outputs.filter { !it.first.def.overlay }
        val overlays = outputs.filter { it.first.def.overlay }
        val plotW = size.width - axisW
        val mainTop = 22.dp.toPx()
        val mainBottom = size.height - timeH - panes.size * subH
        viewport.n = n
        viewport.plotW = plotW
        viewport.mainTop = mainTop
        viewport.mainBottom = mainBottom
        viewport.clamp()

        val from = floor(n - 1 - viewport.right - viewport.visible).toInt().coerceIn(0, n - 1)
        val to = ceil(n - 1 - viewport.right).toInt().coerceIn(0, n - 1)
        val base = if (compare.isNotEmpty()) bars[from].close else null
        viewport.percentBase = base

        // ---- the price range of what is on screen ----
        var lo = Double.POSITIVE_INFINITY
        var hi = Double.NEGATIVE_INFINITY
        fun take(v: Double) { if (!v.isNaN()) { val a = viewport.toAxis(v); lo = min(lo, a); hi = max(hi, a) } }
        for (i in from..to) {
            val k = shown[i]
            if (style == ChartStyle.Line || style == ChartStyle.Area) take(k.close) else { take(k.high); take(k.low) }
            overlays.forEach { (_, out) -> out.lines.forEach { take(it.values[i]) } }
        }
        compare.forEach { s ->
            val b = s.closes.getOrNull(from) ?: return@forEach
            for (i in from..min(to, s.closes.lastIndex)) { val p = (s.closes[i] / b - 1) * 100; lo = min(lo, p); hi = max(hi, p) }
        }
        if (hi <= lo) { hi += 1; lo -= 1 }
        val pad = (hi - lo) * 0.08
        viewport.yMin = lo - pad
        viewport.yMax = hi + pad

        val bw = viewport.barW
        val body = max(1f, bw * 0.7f)
        val up = c.good
        val dn = c.critical
        val fmtPrice: (Double) -> String = { v -> if (base != null) (if (v >= 0) "+" else "") + num(v, 2) + "%" else num(v, 2) }

        // ---- grid and price axis ----
        val ticks = niceTicks(viewport.yMin, viewport.yMax, max(3, ((mainBottom - mainTop) / 60.dp.toPx()).toInt()))
        ticks.forEach { t ->
            val y = (mainBottom - (t - viewport.yMin) / (viewport.yMax - viewport.yMin) * (mainBottom - mainTop)).toFloat()
            if (y < mainTop || y > mainBottom) return@forEach
            if (settings.grid) drawLine(c.gridline, Offset(0f, y), Offset(plotW, y), 1f)
            label(tm, fmtPrice(t), Offset(plotW + 6.dp.toPx(), y - 7.dp.toPx()), c.textMuted, 10f)
        }
        val timeStep = max(1, (90.dp.toPx() / bw).toInt())
        if (settings.grid) {
            var i = (from / timeStep) * timeStep
            while (i <= to) { val x = viewport.xOf(i.toFloat()); if (x in 0f..plotW) drawLine(c.gridline, Offset(x, mainTop), Offset(x, size.height - timeH), 1f); i += timeStep }
        }
        drawLine(c.border, Offset(plotW, 0f), Offset(plotW, size.height), 1f)
        drawLine(c.border, Offset(0f, size.height - timeH), Offset(size.width, size.height - timeH), 1f)

        // ---- bars ----
        clipRect(0f, mainTop - 4f, plotW, mainBottom) {
            when (style) {
                ChartStyle.Line, ChartStyle.Area -> {
                    val path = Path()
                    for (i in from..to) { val p = Offset(viewport.xOf(i.toFloat()), viewport.yOf(shown[i].close)); if (i == from) path.moveTo(p.x, p.y) else path.lineTo(p.x, p.y) }
                    if (style == ChartStyle.Area) {
                        val area = Path().apply { addPath(path); lineTo(viewport.xOf(to.toFloat()), mainBottom); lineTo(viewport.xOf(from.toFloat()), mainBottom); close() }
                        drawPath(area, c.blue.copy(alpha = 0.16f))
                    }
                    drawPath(path, c.blue, style = Stroke(2.dp.toPx()))
                }
                else -> for (i in from..to) {
                    val k = shown[i]
                    val x = viewport.xOf(i.toFloat())
                    val rising = k.close >= k.open
                    val col = if (rising) up else dn
                    val yH = viewport.yOf(k.high); val yL = viewport.yOf(k.low)
                    val yO = viewport.yOf(k.open); val yC = viewport.yOf(k.close)
                    if (style == ChartStyle.Bars) {
                        drawLine(col, Offset(x, yH), Offset(x, yL), max(1f, bw * 0.12f))
                        drawLine(col, Offset(x - body / 2, yO), Offset(x, yO), max(1f, bw * 0.12f))
                        drawLine(col, Offset(x, yC), Offset(x + body / 2, yC), max(1f, bw * 0.12f))
                    } else {
                        val top = min(yO, yC); val h = max(1f, abs(yO - yC))
                        drawLine(col, Offset(x, yH), Offset(x, top), 1.2f)
                        drawLine(col, Offset(x, top + h), Offset(x, yL), 1.2f)
                        if (style == ChartStyle.Hollow && rising) drawRect(col, Offset(x - body / 2, top), Size(body, h), style = Stroke(1.2f))
                        else drawRect(col, Offset(x - body / 2, top), Size(body, h))
                    }
                }
            }
            // Overlay indicators
            overlays.forEach { (_, out) -> out.lines.forEach { line -> drawSeries(line.values, from, to, viewport, LINE_COLORS[line.colorIndex % LINE_COLORS.size], out.dots) } }
            // Compare lines, rebased on the first bar on screen
            compare.forEach { s ->
                val b = s.closes.getOrNull(from) ?: return@forEach
                val path = Path()
                for (i in from..min(to, s.closes.lastIndex)) {
                    val pctv = (s.closes[i] / b - 1) * 100
                    val y = (mainBottom - (pctv - viewport.yMin) / (viewport.yMax - viewport.yMin) * (mainBottom - mainTop)).toFloat()
                    val x = viewport.xOf(i.toFloat())
                    if (i == from) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(path, s.color, style = Stroke(1.8.dp.toPx()))
            }
            // Alerts
            alerts.forEach { a ->
                val y = viewport.yOf(a.price)
                drawLine(ALERT_COLOR, Offset(0f, y), Offset(plotW, y), 1.2f, pathEffect = dash)
            }
            // Drawings
            if (!drawingsHidden) drawings.forEach { d -> drawDrawing(tm, d, viewport, d.id == selected, plotW, mainTop, mainBottom) }
            if (pendingTool != null && pending.isNotEmpty()) {
                val pts = pending.map { viewport.pointAt(it) }
                for (i in 1 until pts.size) drawLine(DRAW_COLOR, pts[i - 1], pts[i], 2f, pathEffect = dash)
                pts.forEach { handle(it) }
            }
        }

        // ---- last price ----
        if (settings.lastPriceLine) {
            val ly = viewport.yOf(bars.last().close)
            val col = if (bars.last().close >= bars.last().open) up else dn
            if (ly in mainTop..mainBottom) {
                drawLine(col, Offset(0f, ly), Offset(plotW, ly), 1f, pathEffect = dash)
                axisTag(tm, fmtPrice(viewport.toAxis(bars.last().close)), plotW, ly, axisW, col)
            }
        }
        alerts.forEach { a -> val y = viewport.yOf(a.price); if (y in mainTop..mainBottom) axisTag(tm, "⏰ " + num(a.price, 2), plotW, y, axisW, ALERT_COLOR) }

        // ---- legend: overlays at the crosshair bar or the latest ----
        val cross = viewport.crosshair
        val at = cross?.let { viewport.indexAt(it.x).let { f -> Math.round(f).coerceIn(from, to) } } ?: to
        var lx = 8.dp.toPx()
        overlays.forEach { (_, out) ->
            out.lines.forEach { line ->
                val v = line.values[at]
                val text = "${line.label} ${if (v.isNaN()) "—" else num(v, 2)}"
                val lay = tm.measure(text, TextStyle(fontSize = 10.sp, color = LINE_COLORS[line.colorIndex % LINE_COLORS.size], fontWeight = FontWeight.Medium))
                if (lx + lay.size.width < plotW) drawText(lay, topLeft = Offset(lx, 4.dp.toPx()))
                lx += lay.size.width + 8.dp.toPx()
            }
        }

        // ---- indicator panes ----
        panes.forEachIndexed { pi, (ind, out) ->
            val top = mainBottom + pi * subH
            val bottom = top + subH
            drawLine(c.border, Offset(0f, top), Offset(size.width, top), 1f)
            var plo = Double.POSITIVE_INFINITY; var phi = Double.NEGATIVE_INFINITY
            for (i in from..to) {
                out.lines.forEach { l -> val v = l.values[i]; if (!v.isNaN()) { plo = min(plo, v); phi = max(phi, v) } }
                out.bars?.let { b -> val v = b.values[i]; if (!v.isNaN()) { plo = min(plo, min(v, 0.0)); phi = max(phi, max(v, 0.0)) } }
            }
            out.levels.forEach { plo = min(plo, it); phi = max(phi, it) }
            if (plo == Double.POSITIVE_INFINITY) return@forEachIndexed
            if (phi <= plo) { phi += 1; plo -= 1 }
            val ppad = (phi - plo) * 0.1
            val y0 = top + 16.dp.toPx(); val y1 = bottom - 3.dp.toPx()
            fun py(v: Double) = (y1 - (v - (plo - ppad)) / ((phi + ppad) - (plo - ppad)) * (y1 - y0)).toFloat()
            clipRect(0f, top, plotW, bottom) {
                out.levels.forEach { lv -> drawLine(c.gridline, Offset(0f, py(lv)), Offset(plotW, py(lv)), 1f, pathEffect = dash) }
                out.bars?.let { b ->
                    val zero = py(0.0).coerceIn(y0, y1)
                    for (i in from..to) {
                        val v = b.values[i]; if (v.isNaN()) continue
                        val x = viewport.xOf(i.toFloat()); val y = py(v)
                        drawRect((if (b.up[i]) up else dn).copy(alpha = if (ind.name == "VOL") 0.55f else 0.8f), Offset(x - body / 2, min(y, zero)), Size(body, max(1f, abs(zero - y))))
                    }
                }
                out.lines.forEach { l ->
                    val path = Path(); var started = false
                    for (i in from..to) {
                        val v = l.values[i]; if (v.isNaN()) { started = false; continue }
                        val p = Offset(viewport.xOf(i.toFloat()), py(v))
                        if (!started) { path.moveTo(p.x, p.y); started = true } else path.lineTo(p.x, p.y)
                    }
                    drawPath(path, LINE_COLORS[l.colorIndex % LINE_COLORS.size], style = Stroke(1.3.dp.toPx()))
                }
            }
            label(tm, compact(phi), Offset(plotW + 6.dp.toPx(), y0 - 6.dp.toPx()), c.textMuted, 9f)
            label(tm, compact(plo), Offset(plotW + 6.dp.toPx(), y1 - 12.dp.toPx()), c.textMuted, 9f)
            // Legend
            var x = 8.dp.toPx()
            val head = tm.measure("${ind.name} ${ind.params.joinToString(" ") { trimNum(it) }}", TextStyle(fontSize = 10.sp, color = c.textSecondary, fontWeight = FontWeight.SemiBold))
            drawText(head, topLeft = Offset(x, top + 2.dp.toPx())); x += head.size.width + 8.dp.toPx()
            out.lines.forEach { l ->
                val v = l.values[at]
                val lay = tm.measure("${l.label} ${if (v.isNaN()) "—" else compact(v)}", TextStyle(fontSize = 10.sp, color = LINE_COLORS[l.colorIndex % LINE_COLORS.size]))
                if (x + lay.size.width < plotW) drawText(lay, topLeft = Offset(x, top + 2.dp.toPx()))
                x += lay.size.width + 8.dp.toPx()
            }
        }

        // ---- time axis ----
        val times = viewport.times
        if (times.size == n) {
            var i = (from / timeStep) * timeStep
            while (i <= to) {
                val x = viewport.xOf(i.toFloat())
                // The first bar of a new day shows the date, so the axis reads across days.
                val newDay = viewport.interval.intraday && i > 0 &&
                    Instant.ofEpochMilli(times[i]).atZone(zone).toLocalDate() != Instant.ofEpochMilli(times[max(0, i - timeStep)]).atZone(zone).toLocalDate()
                val text = if (newDay) Instant.ofEpochMilli(times[i]).atZone(zone).format(DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH))
                    else timeLabel(times[i], viewport.interval, zone, short = true)
                if (x in 16.dp.toPx()..plotW - 16.dp.toPx()) label(tm, text, Offset(x, size.height - timeH + 4.dp.toPx()), if (newDay) c.textSecondary else c.textMuted, 10f, center = true)
                i += timeStep
            }
        }

        // ---- crosshair ----
        cross?.let { p ->
            val x = viewport.xOf(at.toFloat())
            val y = p.y.coerceIn(0f, size.height - timeH)
            val col = c.textPrimary.copy(alpha = 0.45f)
            drawLine(col, Offset(x, 0f), Offset(x, size.height - timeH), 1f, pathEffect = dash)
            drawLine(col, Offset(0f, y), Offset(plotW, y), 1f, pathEffect = dash)
            if (settings.crosshairLabels) {
                if (y in mainTop..mainBottom) axisTag(tm, fmtPrice(viewport.toAxis(viewport.priceAt(y))), plotW, y, axisW, c.textPrimary, textColor = c.page)
                if (times.size == n) {
                    val text = timeLabel(times[at], viewport.interval, zone, short = false)
                    val lay = tm.measure(text, TextStyle(fontSize = 10.sp, color = c.page, fontWeight = FontWeight.SemiBold))
                    val bx = (x - lay.size.width / 2f - 6.dp.toPx()).coerceIn(0f, plotW - lay.size.width - 12.dp.toPx())
                    drawRoundRect(c.textPrimary, Offset(bx, size.height - timeH + 1f), Size(lay.size.width + 12.dp.toPx(), timeH - 2f), CornerRadius(4.dp.toPx()))
                    drawText(lay, topLeft = Offset(bx + 6.dp.toPx(), size.height - timeH + 3.dp.toPx()))
                }
            }
        }
    }
}

/** The bar the crosshair is on (or the latest), for the readout above the chart. */
fun readoutIndex(viewport: ChartViewport, count: Int): Int {
    val to = ceil(count - 1 - viewport.right).toInt().coerceIn(0, max(0, count - 1))
    val from = floor(count - 1 - viewport.right - viewport.visible).toInt().coerceIn(0, max(0, count - 1))
    return viewport.crosshair?.let { Math.round(viewport.indexAt(it.x)).coerceIn(from, to) } ?: to
}

fun timeLabel(t: Long, interval: Interval, zone: ZoneId, short: Boolean): String {
    val z = Instant.ofEpochMilli(t).atZone(zone)
    val pattern = when {
        interval.intraday && short -> if (z.hour == 0 && z.minute == 0) "d MMM" else "HH:mm"
        interval.intraday -> "EEE d MMM  HH:mm"
        interval == Interval.Mo -> "MMM yyyy"
        short -> "d MMM"
        else -> "EEE d MMM yyyy"
    }
    return z.format(DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH))
}

private fun trimNum(v: Double) = if (v == Math.floor(v)) v.toLong().toString() else v.toString()

/** Round-number ticks, about `count` of them, across lo..hi. */
private fun niceTicks(lo: Double, hi: Double, count: Int): List<Double> {
    val span = hi - lo
    if (span <= 0) return listOf(lo)
    val raw = span / count
    val mag = Math.pow(10.0, floor(Math.log10(raw)))
    val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.first { it >= raw }
    val out = mutableListOf<Double>()
    var v = ceil(lo / step) * step
    while (v <= hi) { out += v; v += step }
    return out
}

private fun DrawScope.label(tm: TextMeasurer, text: String, at: Offset, color: Color, size: Float, center: Boolean = false) {
    val lay = tm.measure(text, TextStyle(fontSize = size.sp, color = color))
    drawText(lay, topLeft = Offset(if (center) at.x - lay.size.width / 2f else at.x, at.y))
}

private fun DrawScope.axisTag(tm: TextMeasurer, text: String, plotW: Float, y: Float, axisW: Float, bg: Color, textColor: Color = Color.White) {
    val lay = tm.measure(text, TextStyle(fontSize = 10.sp, color = textColor, fontWeight = FontWeight.SemiBold))
    val h = lay.size.height + 4.dp.toPx()
    drawRoundRect(bg, Offset(plotW + 1f, y - h / 2), Size(max(axisW - 2f, lay.size.width + 8.dp.toPx()), h), CornerRadius(3.dp.toPx()))
    drawText(lay, topLeft = Offset(plotW + 4.dp.toPx(), y - lay.size.height / 2f))
}

private fun DrawScope.drawSeries(values: DoubleArray, from: Int, to: Int, vp: ChartViewport, color: Color, dots: Boolean) {
    if (dots) {
        for (i in from..to) { val v = values[i]; if (!v.isNaN()) drawCircle(color, 1.8.dp.toPx(), Offset(vp.xOf(i.toFloat()), vp.yOf(v))) }
        return
    }
    val path = Path(); var started = false
    for (i in from..to) {
        val v = values[i]; if (v.isNaN()) { started = false; continue }
        val p = Offset(vp.xOf(i.toFloat()), vp.yOf(v))
        if (!started) { path.moveTo(p.x, p.y); started = true } else path.lineTo(p.x, p.y)
    }
    drawPath(path, color, style = Stroke(1.4.dp.toPx()))
}

private fun DrawScope.handle(p: Offset) {
    drawCircle(Color.White, 6.dp.toPx(), p)
    drawCircle(DRAW_COLOR, 6.dp.toPx(), p, style = Stroke(2.dp.toPx()))
}

/** Where a line through a and b meets the left or right edge, going from a through b. */
private fun extend(a: Offset, b: Offset, plotW: Float): Offset {
    val dx = b.x - a.x
    if (abs(dx) < 0.01f) return Offset(b.x, if (b.y > a.y) 1e5f else -1e5f)
    val edge = if (dx > 0) plotW else 0f
    return Offset(edge, a.y + (b.y - a.y) * (edge - a.x) / dx)
}

private fun DrawScope.drawDrawing(tm: TextMeasurer, d: Drawing, vp: ChartViewport, selected: Boolean, plotW: Float, top: Float, bottom: Float) {
    val pts = d.points.map { vp.pointAt(it) }
    val w = 2.dp.toPx()
    val fill = DRAW_COLOR.copy(alpha = 0.12f)
    when (d.tool) {
        DrawTool.Segment -> drawLine(DRAW_COLOR, pts[0], pts[1], w)
        DrawTool.Ray -> drawLine(DRAW_COLOR, pts[0], extend(pts[0], pts[1], plotW), w)
        DrawTool.HLine -> drawLine(DRAW_COLOR, Offset(0f, pts[0].y), Offset(plotW, pts[0].y), w)
        DrawTool.HRay -> drawLine(DRAW_COLOR, pts[0], Offset(plotW, pts[0].y), w)
        DrawTool.VLine -> drawLine(DRAW_COLOR, Offset(pts[0].x, top), Offset(pts[0].x, bottom), w)
        DrawTool.Arrow -> {
            drawLine(DRAW_COLOR, pts[0], pts[1], w)
            val ang = atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x)
            val len = 12.dp.toPx()
            listOf(ang + 2.6f, ang - 2.6f).forEach { a -> drawLine(DRAW_COLOR, pts[1], Offset(pts[1].x + len * cos(a), pts[1].y + len * sin(a)), w) }
        }
        DrawTool.Channel -> {
            val dy = if (pts.size > 2) {
                val t = if (abs(pts[1].x - pts[0].x) < 0.01f) 0f else (pts[2].x - pts[0].x) / (pts[1].x - pts[0].x)
                pts[2].y - (pts[0].y + (pts[1].y - pts[0].y) * t)
            } else 0f
            val a2 = pts[0] + Offset(0f, dy); val b2 = pts[1] + Offset(0f, dy)
            drawPath(Path().apply { moveTo(pts[0].x, pts[0].y); lineTo(pts[1].x, pts[1].y); lineTo(b2.x, b2.y); lineTo(a2.x, a2.y); close() }, fill)
            drawLine(DRAW_COLOR, pts[0], pts[1], w)
            drawLine(DRAW_COLOR, a2, b2, w)
        }
        DrawTool.FibRetracement, DrawTool.FibExtension -> {
            val ext = d.tool == DrawTool.FibExtension
            val p0 = d.points[0].price; val p1 = d.points[1].price
            val startX = if (ext) pts[2].x else min(pts[0].x, pts[1].x)
            val levels = if (ext) FIB_EXT_LEVELS else FIB_LEVELS
            if (ext) drawLine(DRAW_COLOR.copy(alpha = 0.5f), pts[0], pts[1], 1.2f, pathEffect = dash)
            if (ext) drawLine(DRAW_COLOR.copy(alpha = 0.5f), pts[1], pts[2], 1.2f, pathEffect = dash)
            levels.forEachIndexed { i, r ->
                val price = if (ext) d.points[2].price + (p1 - p0) * r else p1 + (p0 - p1) * r
                val y = vp.yOf(price)
                val col = LINE_COLORS[i % LINE_COLORS.size]
                drawLine(col, Offset(startX, y), Offset(plotW, y), 1.3f)
                val lay = tm.measure("${trimNum(r)} (${num(price, 2)})", TextStyle(fontSize = 9.sp, color = col))
                drawText(lay, topLeft = Offset(startX + 2f, y - lay.size.height))
            }
        }
        DrawTool.Rect -> {
            val r = Rect(min(pts[0].x, pts[1].x), min(pts[0].y, pts[1].y), max(pts[0].x, pts[1].x), max(pts[0].y, pts[1].y))
            drawRect(fill, r.topLeft, r.size)
            drawRect(DRAW_COLOR, r.topLeft, r.size, style = Stroke(w))
        }
        DrawTool.Circle -> {
            val rad = (pts[1] - pts[0]).getDistance()
            drawCircle(fill, rad, pts[0])
            drawCircle(DRAW_COLOR, rad, pts[0], style = Stroke(w))
        }
        DrawTool.Triangle -> {
            val path = Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) }; close() }
            drawPath(path, fill)
            drawPath(path, DRAW_COLOR, style = Stroke(w))
        }
        DrawTool.LongPosition, DrawTool.ShortPosition -> {
            val entry = d.points[0].price; val target = d.points[1].price; val stop = d.points[2].price
            val x0 = pts[0].x; val x1 = pts[1].x
            val yE = pts[0].y; val yT = pts[1].y; val yS = pts[2].y
            drawRect(Color(0xFF089981).copy(alpha = 0.18f), Offset(min(x0, x1), min(yE, yT)), Size(abs(x1 - x0), abs(yT - yE)))
            drawRect(Color(0xFFF23645).copy(alpha = 0.18f), Offset(min(x0, x1), min(yE, yS)), Size(abs(x1 - x0), abs(yS - yE)))
            drawLine(Color.Gray, Offset(x0, yE), Offset(x1, yE), 1.5f)
            val reward = abs(target - entry); val risk = abs(entry - stop)
            val rr = if (risk > 0) reward / risk else 0.0
            val tLay = tm.measure("Target ${num(target, 2)} (${num(reward / entry * 100, 2)}%)", TextStyle(fontSize = 9.sp, color = Color(0xFF089981), fontWeight = FontWeight.SemiBold))
            val sLay = tm.measure("Stop ${num(stop, 2)} (${num(risk / entry * 100, 2)}%)", TextStyle(fontSize = 9.sp, color = Color(0xFFF23645), fontWeight = FontWeight.SemiBold))
            val eLay = tm.measure("${if (d.tool == DrawTool.LongPosition) "Long" else "Short"} ${num(entry, 2)} · R:R ${num(rr, 2)}", TextStyle(fontSize = 9.sp, color = Color.Gray, fontWeight = FontWeight.SemiBold))
            val lx = min(x0, x1) + 3f
            drawText(tLay, topLeft = Offset(lx, if (yT < yE) yT + 2f else yT - tLay.size.height - 2f))
            drawText(sLay, topLeft = Offset(lx, if (yS < yE) yS + 2f else yS - sLay.size.height - 2f))
            drawText(eLay, topLeft = Offset(lx, yE - eLay.size.height - 2f))
        }
    }
    if (selected) pts.forEach { handle(it) }
}

/** Distance from p to the drawing, in pixels, for picking it with a tap. */
fun hitDistance(d: Drawing, vp: ChartViewport, p: Offset): Float {
    val pts = d.points.map { vp.pointAt(it) }
    fun seg(a: Offset, b: Offset): Float {
        val ab = b - a
        val len2 = ab.x * ab.x + ab.y * ab.y
        if (len2 < 0.01f) return (p - a).getDistance()
        val t = (((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2).coerceIn(0f, 1f)
        return (p - (a + ab * t)).getDistance()
    }
    fun inside(l: Float, t: Float, r: Float, b: Float) = p.x in min(l, r)..max(l, r) && p.y in min(t, b)..max(t, b)
    return when (d.tool) {
        DrawTool.Segment, DrawTool.Arrow -> seg(pts[0], pts[1])
        DrawTool.Ray -> seg(pts[0], extend(pts[0], pts[1], vp.plotW))
        DrawTool.HLine -> abs(p.y - pts[0].y)
        DrawTool.HRay -> if (p.x >= pts[0].x) abs(p.y - pts[0].y) else (p - pts[0]).getDistance()
        DrawTool.VLine -> abs(p.x - pts[0].x)
        DrawTool.Channel -> min(seg(pts[0], pts[1]), (p - pts[2]).getDistance())
        DrawTool.FibRetracement, DrawTool.FibExtension -> {
            val y0 = pts[0].y; val y1 = pts[1].y
            if (p.x >= min(pts[0].x, pts[1].x) && p.y in min(y0, y1)..max(y0, y1)) 0f else pts.minOf { (p - it).getDistance() }
        }
        DrawTool.Rect -> if (inside(pts[0].x, pts[0].y, pts[1].x, pts[1].y)) 0f else pts.minOf { (p - it).getDistance() }
        DrawTool.Circle -> abs((p - pts[0]).getDistance() - (pts[1] - pts[0]).getDistance()).let { if ((p - pts[0]).getDistance() < (pts[1] - pts[0]).getDistance()) 0f else it }
        DrawTool.Triangle -> min(seg(pts[0], pts[1]), min(seg(pts[1], pts[2]), seg(pts[2], pts[0])))
        DrawTool.LongPosition, DrawTool.ShortPosition ->
            if (inside(pts[0].x, min(pts[1].y, pts[2].y), pts[1].x, max(pts[1].y, pts[2].y))) 0f else pts.minOf { (p - it).getDistance() }
    }
}

/** The price a placed point snaps to under the magnet: the bar's nearest open / high / low / close. */
fun snap(magnet: Magnet, bars: List<Candle>, vp: ChartViewport, idx: Float, y: Float, reachPx: Float): Double {
    val raw = vp.priceAt(y)
    if (magnet == Magnet.Off || bars.isEmpty()) return raw
    val k = bars[Math.round(idx).coerceIn(0, bars.lastIndex)]
    val best = listOf(k.open, k.high, k.low, k.close).minBy { abs(vp.yOf(it) - y) }
    return if (magnet == Magnet.Strong || abs(vp.yOf(best) - y) <= reachPx) best else raw
}

@Suppress("unused")
private fun dist(a: Offset, b: Offset) = hypot(a.x - b.x, a.y - b.y)
