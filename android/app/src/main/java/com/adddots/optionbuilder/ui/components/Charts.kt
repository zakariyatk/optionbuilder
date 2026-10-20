package com.adddots.optionbuilder.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Candle
import com.adddots.optionbuilder.data.Leg
import com.adddots.optionbuilder.data.Pricing
import com.adddots.optionbuilder.ui.theme.Ob
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val dash = PathEffect.dashPathEffect(floatArrayOf(8f, 6f))

private fun DrawScope.label(tm: TextMeasurer, text: String, at: Offset, color: Color, size: Float = 10f, bold: Boolean = false, alignRight: Boolean = false, center: Boolean = false) {
    val layout = tm.measure(text, TextStyle(fontSize = size.sp, color = color, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal))
    val x = when {
        alignRight -> at.x - layout.size.width
        center -> at.x - layout.size.width / 2f
        else -> at.x
    }
    drawText(layout, topLeft = Offset(x.coerceIn(0f, max(0f, this.size.width - layout.size.width)), at.y))
}

/**
 * Expiry payoff (solid, filled green above zero and red below) and the
 * today / target-date curve (dashed), with spot and breakeven markers.
 * Drag across it to read the P&L at any price.
 */
@Composable
fun PayoffChart(legs: List<Leg>, spot: Double, lotSize: Int, years: Double, breakevens: List<Double>, modifier: Modifier = Modifier, height: Dp = 260.dp) {
    val c = Ob.colors
    val tm = rememberTextMeasurer()
    var touchX by remember { mutableStateOf<Float?>(null) }
    val strikes = legs.filter { !it.type.isLinear }.map { it.strike }
    val lo = min(spot * 0.94, (strikes.minOrNull() ?: spot) * 0.98)
    val hi = max(spot * 1.06, (strikes.maxOrNull() ?: spot) * 1.02)
    val n = 160
    val xs = remember(lo, hi) { (0..n).map { lo + (hi - lo) * it / n } }
    val expiry = remember(legs, xs) { xs.map { Pricing.payoffAtExpiry(legs, it, lotSize) } }
    val today = remember(legs, xs, years) { xs.map { Pricing.payoffToday(legs, it, lotSize, years) } }

    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = { touchX = null },
                    onDragCancel = { touchX = null },
                ) { change, _ -> touchX = change.position.x }
            }
            .pointerInput(Unit) { detectTapGestures { touchX = if (touchX == null) it.x else null } },
    ) {
        val left = 8f
        val right = size.width - 8f
        val top = 18f
        val bottom = size.height - 26f
        val all = expiry + today
        var yMax = all.max()
        var yMin = all.min()
        if (yMax == yMin) { yMax += 1; yMin -= 1 }
        val pad = (yMax - yMin) * 0.1
        yMax += pad; yMin -= pad
        fun px(v: Double) = (left + (v - lo) / (hi - lo) * (right - left)).toFloat()
        fun py(v: Double) = (bottom - (v - yMin) / (yMax - yMin) * (bottom - top)).toFloat()

        // Grid
        for (i in 0..4) {
            val y = top + (bottom - top) * i / 4
            drawLine(c.gridline, Offset(left, y), Offset(right, y), 1f)
        }
        val zeroY = py(0.0).coerceIn(top, bottom)
        drawLine(c.baseline, Offset(left, zeroY), Offset(right, zeroY), 1.5f)

        if (legs.isNotEmpty()) {
            val area = Path().apply {
                moveTo(px(xs.first()), zeroY)
                xs.indices.forEach { lineTo(px(xs[it]), py(expiry[it])) }
                lineTo(px(xs.last()), zeroY)
                close()
            }
            clipRect(top = 0f, bottom = zeroY) { drawPath(area, c.goodFill.copy(alpha = c.goodFill.alpha * 2.2f)) }
            clipRect(top = zeroY, bottom = size.height) { drawPath(area, c.criticalFill.copy(alpha = c.criticalFill.alpha * 2.2f)) }

            val todayPath = Path().apply { xs.indices.forEach { if (it == 0) moveTo(px(xs[0]), py(today[0])) else lineTo(px(xs[it]), py(today[it])) } }
            drawPath(todayPath, c.violet, style = Stroke(2f, pathEffect = dash))
            val expPath = Path().apply { xs.indices.forEach { if (it == 0) moveTo(px(xs[0]), py(expiry[0])) else lineTo(px(xs[it]), py(expiry[it])) } }
            drawPath(expPath, c.blue, style = Stroke(3f, cap = StrokeCap.Round))
        }

        // Spot
        val sx = px(spot)
        drawLine(c.textMuted, Offset(sx, top), Offset(sx, bottom), 1.5f, pathEffect = dash)
        label(tm, "Spot ${num(spot, 0)}", Offset(sx, 0f), c.textSecondary, center = true)

        breakevens.filter { it in lo..hi }.forEach { b ->
            val bx = px(b)
            drawCircle(c.warning, 5f, Offset(bx, zeroY))
            label(tm, "BE ${num(b, 0)}", Offset(bx, zeroY + 6f), c.warning, 9f, center = true)
        }

        // X ticks
        for (i in 0..4) {
            val v = lo + (hi - lo) * i / 4
            label(tm, num(v, 0), Offset(px(v), bottom + 8f), c.textMuted, 9f, center = true)
        }
        // Y extremes
        label(tm, compact(yMax - pad), Offset(left, top), c.textMuted, 9f)
        label(tm, compact(yMin + pad), Offset(left, bottom - 14f), c.textMuted, 9f)

        touchX?.let { tx ->
            val i = (((tx - left) / (right - left)) * n).roundToInt().coerceIn(0, n)
            val x = px(xs[i])
            drawLine(c.textPrimary.copy(alpha = 0.4f), Offset(x, top), Offset(x, bottom), 1f)
            drawCircle(c.blue, 6f, Offset(x, py(expiry[i])))
            drawCircle(c.violet, 5f, Offset(x, py(today[i])))
            val text = "${num(xs[i], 0)}   Expiry ${signedInr(expiry[i])}   Today ${signedInr(today[i])}"
            val layout = tm.measure(text, TextStyle(fontSize = 10.sp, color = c.textPrimary, fontWeight = FontWeight.Medium))
            val bx = (x - layout.size.width / 2f).coerceIn(0f, size.width - layout.size.width - 12f)
            drawRoundRect(c.raised, Offset(bx, top + 2f), Size(layout.size.width + 12f, layout.size.height + 8f), CornerRadius(6f))
            drawRoundRect(c.borderStrong, Offset(bx, top + 2f), Size(layout.size.width + 12f, layout.size.height + 8f), CornerRadius(6f), style = Stroke(1f))
            drawText(layout, topLeft = Offset(bx + 6f, top + 6f))
        }
    }
}

/** Candles with a volume strip, moving average and last-price tag; drag to pan. */
@Composable
fun CandleChart(
    candles: List<Candle>,
    modifier: Modifier = Modifier,
    visible: Int = 60,
    showVolume: Boolean = true,
    showMa: Boolean = true,
    line: Boolean = false,
    height: Dp = 360.dp,
) {
    val c = Ob.colors
    val tm = rememberTextMeasurer()
    var offset by remember { mutableFloatStateOf(0f) }
    var crossX by remember { mutableStateOf<Float?>(null) }
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .pointerInput(candles.size, visible) {
                detectHorizontalDragGestures { _, drag ->
                    val per = (size.width - 56f) / visible
                    offset = (offset + drag / per).coerceIn(0f, (candles.size - visible).toFloat().coerceAtLeast(0f))
                }
            }
            .pointerInput(Unit) { detectTapGestures { crossX = if (crossX == null) it.x else null } },
    ) {
        val axisW = 56f
        val w = size.width - axisW
        val volH = if (showVolume) size.height * 0.16f else 0f
        val top = 8f
        val bottom = size.height - volH - 22f
        val end = (candles.size - offset.roundToInt()).coerceIn(1, candles.size)
        val start = (end - visible).coerceAtLeast(0)
        val shown = candles.subList(start, end)
        if (shown.isEmpty()) return@Canvas
        var hiP = shown.maxOf { it.high }
        var loP = shown.minOf { it.low }
        val pad = (hiP - loP) * 0.06
        hiP += pad; loP -= pad
        val per = w / visible
        val body = per * 0.62f
        fun py(v: Double) = (bottom - (v - loP) / (hiP - loP) * (bottom - top)).toFloat()

        for (i in 0..5) {
            val y = top + (bottom - top) * i / 5
            drawLine(c.gridline, Offset(0f, y), Offset(w, y), 1f)
            val v = hiP - (hiP - loP) * i / 5
            label(tm, num(v, if (v > 1000) 0 else 2), Offset(w + 6f, y - 7f), c.textMuted, 9f)
        }

        val maxVol = shown.maxOf { it.volume }
        val closes = candles.map { it.close }
        val ma = if (showMa) closes.indices.map { i -> if (i < 19) null else closes.subList(i - 19, i + 1).average() } else emptyList()
        val linePath = Path()
        shown.forEachIndexed { i, k ->
            val cx = per * i + per / 2
            val up = k.close >= k.open
            val col = if (up) c.good else c.critical
            if (line) {
                if (i == 0) linePath.moveTo(cx, py(k.close)) else linePath.lineTo(cx, py(k.close))
            } else {
                drawLine(col, Offset(cx, py(k.high)), Offset(cx, py(k.low)), 1.5f)
                val yTop = py(max(k.open, k.close))
                val yBot = py(min(k.open, k.close))
                drawRect(col, Offset(cx - body / 2, yTop), Size(body, max(1.5f, yBot - yTop)))
            }
            if (showVolume) {
                val vh = (k.volume / maxVol * (volH - 6)).toFloat()
                drawRect(col.copy(alpha = 0.35f), Offset(cx - body / 2, size.height - 22f - vh), Size(body, vh))
            }
        }
        if (line) drawPath(linePath, c.blue, style = Stroke(2.5f))
        if (showMa) {
            val p = Path()
            var started = false
            shown.indices.forEach { i ->
                val m = ma[start + i] ?: return@forEach
                val x = per * i + per / 2
                if (!started) { p.moveTo(x, py(m)); started = true } else p.lineTo(x, py(m))
            }
            drawPath(p, c.warning, style = Stroke(1.6f))
        }

        // Last price tag
        val last = shown.last()
        val ly = py(last.close)
        val tagCol = if (last.close >= last.open) c.good else c.critical
        drawLine(tagCol, Offset(0f, ly), Offset(w, ly), 1f, pathEffect = dash)
        drawRoundRect(tagCol, Offset(w + 2f, ly - 10f), Size(axisW - 4f, 20f), CornerRadius(4f))
        label(tm, num(last.close, if (last.close > 1000) 1 else 2), Offset(w + 6f, ly - 8f), Color.White, 9f, bold = true)

        crossX?.let { x ->
            val i = (x / per).toInt().coerceIn(0, shown.lastIndex)
            val k = shown[i]
            val cx = per * i + per / 2
            drawLine(c.textPrimary.copy(alpha = 0.4f), Offset(cx, top), Offset(cx, size.height), 1f, pathEffect = dash)
            val text = "O ${num(k.open)}  H ${num(k.high)}  L ${num(k.low)}  C ${num(k.close)}"
            label(tm, text, Offset(4f, top), if (k.close >= k.open) c.goodText else c.critical, 10f, bold = true)
        }
    }
}

data class Series(val name: String, val color: Color, val values: List<Double>, val dashed: Boolean = false)

/** Several series on one value axis; used for performance and USD/INR. */
@Composable
fun LineChart(series: List<Series>, modifier: Modifier = Modifier, height: Dp = 200.dp, format: (Double) -> String = { num(it, 1) }, zeroLine: Boolean = false, fill: Boolean = false) {
    val c = Ob.colors
    val tm = rememberTextMeasurer()
    var touchX by remember { mutableStateOf<Float?>(null) }
    Canvas(
        modifier.fillMaxWidth().height(height).pointerInput(Unit) {
            detectHorizontalDragGestures(onDragEnd = { touchX = null }) { change, _ -> touchX = change.position.x }
        },
    ) {
        val axisW = 48f
        val w = size.width - axisW
        val top = 8f
        val bottom = size.height - 8f
        val all = series.flatMap { it.values }
        if (all.isEmpty()) return@Canvas
        var hiV = all.max(); var loV = all.min()
        if (zeroLine) { hiV = max(hiV, 0.0); loV = min(loV, 0.0) }
        val pad = (hiV - loV).coerceAtLeast(1e-6) * 0.08
        hiV += pad; loV -= pad
        fun py(v: Double) = (bottom - (v - loV) / (hiV - loV) * (bottom - top)).toFloat()
        for (i in 0..4) {
            val y = top + (bottom - top) * i / 4
            drawLine(c.gridline, Offset(0f, y), Offset(w, y), 1f)
            label(tm, format(hiV - (hiV - loV) * i / 4), Offset(w + 6f, y - 7f), c.textMuted, 9f)
        }
        if (zeroLine) drawLine(c.baseline, Offset(0f, py(0.0)), Offset(w, py(0.0)), 1.5f)
        series.forEach { s ->
            if (s.values.size < 2) return@forEach
            val step = w / (s.values.size - 1)
            val p = Path()
            s.values.forEachIndexed { i, v -> if (i == 0) p.moveTo(0f, py(v)) else p.lineTo(i * step, py(v)) }
            if (fill) {
                val area = Path().apply { addPath(p); lineTo(w, bottom); lineTo(0f, bottom); close() }
                drawPath(area, s.color.copy(alpha = 0.10f))
            }
            drawPath(p, s.color, style = Stroke(if (s.dashed) 1.6f else 2.4f, pathEffect = if (s.dashed) dash else null))
        }
        touchX?.let { x ->
            val xx = x.coerceIn(0f, w)
            drawLine(c.textPrimary.copy(alpha = 0.35f), Offset(xx, top), Offset(xx, bottom), 1f)
            var y = top
            series.forEach { s ->
                val i = ((xx / w) * (s.values.size - 1)).roundToInt().coerceIn(0, s.values.lastIndex)
                drawCircle(s.color, 4.5f, Offset(i * (w / (s.values.size - 1)), py(s.values[i])))
                label(tm, "${s.name} ${format(s.values[i])}", Offset(if (xx > w / 2) 4f else w - 4f, y), s.color, 10f, bold = true, alignRight = xx <= w / 2)
                y += 15f
            }
        }
    }
}

@Composable
fun DonutChart(slices: List<Pair<Color, Double>>, modifier: Modifier = Modifier, size: Dp = 150.dp) {
    val c = Ob.colors
    Canvas(modifier.height(size).fillMaxWidth()) {
        val d = min(this.size.width, this.size.height)
        val stroke = d * 0.16f
        val tl = Offset((this.size.width - d) / 2 + stroke / 2, stroke / 2)
        val sz = Size(d - stroke, d - stroke)
        val total = slices.sumOf { it.second }.takeIf { it > 0 } ?: return@Canvas
        var start = -90f
        drawArc(c.sunken, 0f, 360f, false, tl, sz, style = Stroke(stroke))
        slices.forEach { (col, v) ->
            val sweep = (v / total * 360).toFloat()
            drawArc(col, start, max(0f, sweep - 1.2f), false, tl, sz, style = Stroke(stroke))
            start += sweep
        }
    }
}

/** Horizontal bar with an optional lighter "change" overlay. */
@Composable
fun Bar(fraction: Float, color: Color, modifier: Modifier = Modifier, fromRight: Boolean = false, height: Dp = 12.dp) {
    val track = Ob.colors.sunken
    Canvas(modifier.height(height)) {
        val f = fraction.coerceIn(0f, 1f)
        drawRoundRect(track, cornerRadius = CornerRadius(3f))
        val w = size.width * abs(f)
        drawRoundRect(color, if (fromRight) Offset(size.width - w, 0f) else Offset.Zero, Size(w, size.height), CornerRadius(3f))
    }
}
