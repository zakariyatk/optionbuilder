package com.adddots.optionbuilder.ui.chart

import com.adddots.optionbuilder.data.Candle
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** One line of an indicator; NaN where it has no value yet. */
class IndLine(val label: String, val values: DoubleArray, val colorIndex: Int)

/** Histogram bars (MACD, volume, AO): value and whether it counts as "up". */
class IndBars(val values: DoubleArray, val up: BooleanArray)

class IndOutput(val lines: List<IndLine>, val bars: IndBars? = null, val dots: Boolean = false, val levels: List<Double> = emptyList())

private fun nan(n: Int) = DoubleArray(n) { Double.NaN }

private fun sma(src: DoubleArray, len: Int): DoubleArray {
    val out = nan(src.size)
    if (len <= 0) return out
    var sum = 0.0
    var count = 0
    for (i in src.indices) {
        if (!src[i].isNaN()) { sum += src[i]; count++ }
        if (i >= len && !src[i - len].isNaN()) { sum -= src[i - len]; count-- }
        if (i >= len - 1 && count == len) out[i] = sum / len
    }
    return out
}

private fun ema(src: DoubleArray, len: Int): DoubleArray {
    val out = nan(src.size)
    if (len <= 0) return out
    val k = 2.0 / (len + 1)
    var prev = Double.NaN
    for (i in src.indices) {
        val v = src[i]
        if (v.isNaN()) continue
        prev = if (prev.isNaN()) v else v * k + prev * (1 - k)
        out[i] = prev
    }
    return out
}

/** Wilder / "SMA(N, M)" smoothing used by KDJ and RSI. */
private fun wilder(src: DoubleArray, len: Int, weight: Int = 1): DoubleArray {
    val out = nan(src.size)
    var prev = Double.NaN
    for (i in src.indices) {
        val v = src[i]
        if (v.isNaN()) continue
        prev = if (prev.isNaN()) v else (v * weight + prev * (len - weight)) / len
        out[i] = prev
    }
    return out
}

private fun highest(src: DoubleArray, len: Int, i: Int): Double { var m = Double.NEGATIVE_INFINITY; for (j in max(0, i - len + 1)..i) m = max(m, src[j]); return m }
private fun lowest(src: DoubleArray, len: Int, i: Int): Double { var m = Double.POSITIVE_INFINITY; for (j in max(0, i - len + 1)..i) m = min(m, src[j]); return m }

/** heikinAshi.ts: close = OHLC average, open = midpoint of the previous HA bar's body. */
fun heikinAshi(bars: List<Candle>): List<Candle> {
    val out = ArrayList<Candle>(bars.size)
    bars.forEachIndexed { i, b ->
        val close = (b.open + b.high + b.low + b.close) / 4
        val open = if (i == 0) (b.open + b.close) / 2 else (out[i - 1].open + out[i - 1].close) / 2
        out += Candle(open, max(b.high, max(open, close)), min(b.low, min(open, close)), close, b.volume)
    }
    return out
}

/** Works out an indicator over all bars. */
fun computeIndicator(ind: ActiveIndicator, bars: List<Candle>): IndOutput {
    val n = bars.size
    val c = DoubleArray(n) { bars[it].close }
    val h = DoubleArray(n) { bars[it].high }
    val l = DoubleArray(n) { bars[it].low }
    val v = DoubleArray(n) { bars[it].volume }
    val p = ind.params.ifEmpty { ind.def.defaults }
    fun pi(i: Int) = p.getOrElse(i) { ind.def.defaults.getOrElse(i) { 1.0 } }.toInt().coerceAtLeast(1)
    fun pd(i: Int) = p.getOrElse(i) { ind.def.defaults.getOrElse(i) { 1.0 } }

    return when (ind.name) {
        "MA" -> IndOutput(p.mapIndexed { i, len -> IndLine("MA${len.toInt()}", sma(c, len.toInt()), i) })
        "EMA" -> IndOutput(p.mapIndexed { i, len -> IndLine("EMA${len.toInt()}", ema(c, len.toInt()), i) })
        "BBI" -> {
            val mas = p.map { sma(c, it.toInt()) }
            IndOutput(listOf(IndLine("BBI", DoubleArray(n) { i -> mas.map { it[i] }.average() }, 0)))
        }
        "BOLL" -> {
            val len = pi(0); val k = pd(1)
            val mid = sma(c, len)
            val up = nan(n); val dn = nan(n)
            for (i in len - 1 until n) {
                var s = 0.0
                for (j in i - len + 1..i) s += (c[j] - mid[i]) * (c[j] - mid[i])
                val sd = sqrt(s / len)
                up[i] = mid[i] + k * sd; dn[i] = mid[i] - k * sd
            }
            IndOutput(listOf(IndLine("UP", up, 1), IndLine("MID", mid, 0), IndLine("DN", dn, 2)))
        }
        "SAR" -> {
            val start = pd(0); val step = pd(1); val maxAf = pd(2)
            val out = nan(n)
            if (n > 1) {
                var long = c[1] >= c[0]
                var af = start
                var ep = if (long) h[0] else l[0]
                var sar = if (long) l[0] else h[0]
                for (i in 1 until n) {
                    sar += af * (ep - sar)
                    if (long) {
                        sar = min(sar, min(l[i - 1], if (i > 1) l[i - 2] else l[i - 1]))
                        if (l[i] < sar) { long = false; sar = ep; ep = l[i]; af = start }
                        else if (h[i] > ep) { ep = h[i]; af = min(maxAf, af + step) }
                    } else {
                        sar = max(sar, max(h[i - 1], if (i > 1) h[i - 2] else h[i - 1]))
                        if (h[i] > sar) { long = true; sar = ep; ep = h[i]; af = start }
                        else if (l[i] < ep) { ep = l[i]; af = min(maxAf, af + step) }
                    }
                    out[i] = sar
                }
            }
            IndOutput(listOf(IndLine("SAR", out, 0)), dots = true)
        }
        "AVP" -> {
            var pv = 0.0; var vol = 0.0
            IndOutput(listOf(IndLine("AVP", DoubleArray(n) { i -> pv += (h[i] + l[i] + c[i]) / 3 * v[i]; vol += v[i]; if (vol > 0) pv / vol else Double.NaN }, 0)))
        }
        "VOL" -> IndOutput(
            p.mapIndexed { i, len -> IndLine("MA${len.toInt()}", sma(v, len.toInt()), i) },
            IndBars(v, BooleanArray(n) { bars[it].close >= bars[it].open }),
        )
        "MACD" -> {
            val fast = ema(c, pi(0)); val slow = ema(c, pi(1))
            val dif = DoubleArray(n) { fast[it] - slow[it] }
            val dea = ema(dif, pi(2))
            val hist = DoubleArray(n) { (dif[it] - dea[it]) * 2 }
            IndOutput(listOf(IndLine("DIF", dif, 0), IndLine("DEA", dea, 1)), IndBars(hist, BooleanArray(n) { hist[it] >= 0 }))
        }
        "RSI" -> IndOutput(p.mapIndexed { idx, lenD ->
            val len = lenD.toInt().coerceAtLeast(1)
            val gain = DoubleArray(n) { if (it == 0) Double.NaN else max(c[it] - c[it - 1], 0.0) }
            val loss = DoubleArray(n) { if (it == 0) Double.NaN else max(c[it - 1] - c[it], 0.0) }
            val ag = wilder(gain, len); val al = wilder(loss, len)
            IndLine("RSI${len}", DoubleArray(n) { i -> if (i < len) Double.NaN else if (al[i] == 0.0) 100.0 else 100 - 100 / (1 + ag[i] / al[i]) }, idx)
        }, levels = listOf(30.0, 70.0))
        "KDJ" -> {
            val len = pi(0)
            val rsv = DoubleArray(n) { i -> val hh = highest(h, len, i); val ll = lowest(l, len, i); if (hh == ll) 50.0 else (c[i] - ll) / (hh - ll) * 100 }
            val k = wilder(rsv, pi(1)); val d = wilder(k, pi(2))
            IndOutput(listOf(IndLine("K", k, 0), IndLine("D", d, 1), IndLine("J", DoubleArray(n) { 3 * k[it] - 2 * d[it] }, 2)), levels = listOf(20.0, 80.0))
        }
        "CCI" -> {
            val len = pi(0)
            val tp = DoubleArray(n) { (h[it] + l[it] + c[it]) / 3 }
            val ma = sma(tp, len)
            IndOutput(listOf(IndLine("CCI", DoubleArray(n) { i ->
                if (i < len - 1) Double.NaN else {
                    var md = 0.0
                    for (j in i - len + 1..i) md += abs(tp[j] - ma[i])
                    md /= len
                    if (md == 0.0) 0.0 else (tp[i] - ma[i]) / (0.015 * md)
                }
            }, 0)), levels = listOf(-100.0, 100.0))
        }
        "DMI" -> {
            val len = pi(0)
            val tr = DoubleArray(n) { i -> if (i == 0) h[0] - l[0] else max(h[i] - l[i], max(abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))) }
            val pdm = DoubleArray(n) { i -> if (i == 0) 0.0 else { val up = h[i] - h[i - 1]; val dn = l[i - 1] - l[i]; if (up > dn && up > 0) up else 0.0 } }
            val mdm = DoubleArray(n) { i -> if (i == 0) 0.0 else { val up = h[i] - h[i - 1]; val dn = l[i - 1] - l[i]; if (dn > up && dn > 0) dn else 0.0 } }
            val atr = wilder(tr, len); val sp = wilder(pdm, len); val sm = wilder(mdm, len)
            val pdi = DoubleArray(n) { if (atr[it] == 0.0) 0.0 else sp[it] / atr[it] * 100 }
            val mdi = DoubleArray(n) { if (atr[it] == 0.0) 0.0 else sm[it] / atr[it] * 100 }
            val dx = DoubleArray(n) { val s = pdi[it] + mdi[it]; if (s == 0.0) 0.0 else abs(pdi[it] - mdi[it]) / s * 100 }
            IndOutput(listOf(IndLine("PDI", pdi, 0), IndLine("MDI", mdi, 1), IndLine("ADX", wilder(dx, pi(1)), 2)))
        }
        "WR" -> IndOutput(p.mapIndexed { idx, lenD ->
            val len = lenD.toInt().coerceAtLeast(1)
            IndLine("WR$len", DoubleArray(n) { i -> val hh = highest(h, len, i); val ll = lowest(l, len, i); if (hh == ll) -50.0 else (hh - c[i]) / (hh - ll) * -100 }, idx)
        }, levels = listOf(-80.0, -20.0))
        "ROC" -> {
            val len = pi(0)
            val roc = DoubleArray(n) { i -> if (i < len) Double.NaN else (c[i] - c[i - len]) / c[i - len] * 100 }
            IndOutput(listOf(IndLine("ROC", roc, 0), IndLine("MAROC", sma(roc, pi(1)), 1)))
        }
        "MTM" -> {
            val len = pi(0)
            val mtm = DoubleArray(n) { i -> if (i < len) Double.NaN else c[i] - c[i - len] }
            IndOutput(listOf(IndLine("MTM", mtm, 0), IndLine("MAMTM", sma(mtm, pi(1)), 1)))
        }
        "AO" -> {
            val mid = DoubleArray(n) { (h[it] + l[it]) / 2 }
            val f = sma(mid, pi(0)); val s = sma(mid, pi(1))
            val ao = DoubleArray(n) { f[it] - s[it] }
            IndOutput(emptyList(), IndBars(ao, BooleanArray(n) { it > 0 && ao[it] >= ao[it - 1] }))
        }
        "TRIX" -> {
            val len = pi(0)
            val e3 = ema(ema(ema(c, len), len), len)
            val trix = DoubleArray(n) { i -> if (i == 0 || e3[i - 1].isNaN() || e3[i - 1] == 0.0) Double.NaN else (e3[i] - e3[i - 1]) / e3[i - 1] * 100 }
            IndOutput(listOf(IndLine("TRIX", trix, 0), IndLine("MATRIX", sma(trix, pi(1)), 1)))
        }
        "BIAS" -> IndOutput(p.mapIndexed { idx, lenD ->
            val ma = sma(c, lenD.toInt())
            IndLine("BIAS${lenD.toInt()}", DoubleArray(n) { (c[it] - ma[it]) / ma[it] * 100 }, idx)
        })
        "PSY" -> {
            val len = pi(0)
            val psy = DoubleArray(n) { i -> if (i < len) Double.NaN else (i - len + 1..i).count { c[it] > c[it - 1] } * 100.0 / len }
            IndOutput(listOf(IndLine("PSY", psy, 0), IndLine("MAPSY", sma(psy, pi(1)), 1)))
        }
        "OBV" -> {
            var acc = 0.0
            val obv = DoubleArray(n) { i -> if (i > 0) acc += if (c[i] > c[i - 1]) v[i] else if (c[i] < c[i - 1]) -v[i] else 0.0; acc }
            IndOutput(listOf(IndLine("OBV", obv, 0), IndLine("MAOBV", sma(obv, pi(0)), 1)))
        }
        "PVT" -> {
            var acc = 0.0
            IndOutput(listOf(IndLine("PVT", DoubleArray(n) { i -> if (i > 0 && c[i - 1] != 0.0) acc += (c[i] - c[i - 1]) / c[i - 1] * v[i]; acc }, 0)))
        }
        "DMA" -> {
            val f = sma(c, pi(0)); val s = sma(c, pi(1))
            val dif = DoubleArray(n) { f[it] - s[it] }
            IndOutput(listOf(IndLine("DMA", dif, 0), IndLine("AMA", sma(dif, pi(2)), 1)))
        }
        else -> IndOutput(emptyList())
    }
}

/**
 * Times for `count` bars ending at the latest one, in market hours: NSE
 * 09:15–15:30 IST, US 09:30–16:00 New York, weekdays only. Sample data has
 * no times of its own, so the chart gives it believable ones.
 */
fun barTimes(count: Int, interval: Interval, us: Boolean, now: Instant = Instant.now()): LongArray {
    val zone = ZoneId.of(if (us) "America/New_York" else "Asia/Kolkata")
    val open = if (us) LocalTime.of(9, 30) else LocalTime.of(9, 15)
    val close = if (us) LocalTime.of(16, 0) else LocalTime.of(15, 30)
    fun tradingDay(d: ZonedDateTime) = d.dayOfWeek != DayOfWeek.SATURDAY && d.dayOfWeek != DayOfWeek.SUNDAY
    val out = LongArray(count)
    val today = now.atZone(zone)
    when {
        interval == Interval.Mo -> {
            var d = today.truncatedTo(ChronoUnit.DAYS).withDayOfMonth(1).with(open)
            for (i in count - 1 downTo 0) { out[i] = d.toInstant().toEpochMilli(); d = d.minusMonths(1) }
        }
        interval == Interval.W -> {
            var d = today.truncatedTo(ChronoUnit.DAYS).with(DayOfWeek.MONDAY).with(open)
            for (i in count - 1 downTo 0) { out[i] = d.toInstant().toEpochMilli(); d = d.minusWeeks(1) }
        }
        interval == Interval.D -> {
            var d = today.truncatedTo(ChronoUnit.DAYS).with(open)
            for (i in count - 1 downTo 0) {
                while (!tradingDay(d)) d = d.minusDays(1)
                out[i] = d.toInstant().toEpochMilli(); d = d.minusDays(1)
            }
        }
        else -> {
            val step = interval.minutes.toLong()
            val sessionMin = ChronoUnit.MINUTES.between(open, close)
            val lastSlot = (sessionMin - 1) / step * step
            var day = today.truncatedTo(ChronoUnit.DAYS)
            val sinceOpen = ChronoUnit.MINUTES.between(day.with(open), today)
            var slot = if (tradingDay(today) && sinceOpen >= 0) min(sinceOpen / step * step, lastSlot) else -1
            if (slot < 0) { day = day.minusDays(1); slot = lastSlot }
            for (i in count - 1 downTo 0) {
                while (!tradingDay(day)) day = day.minusDays(1)
                out[i] = day.with(open).plusMinutes(slot).toInstant().toEpochMilli()
                slot -= step
                if (slot < 0) { day = day.minusDays(1); slot = lastSlot }
            }
        }
    }
    return out
}

/** The (fractional) bar index for a time, extending past either end at the interval's spacing. */
fun indexOfTime(times: LongArray, t: Long, interval: Interval): Float {
    if (times.isEmpty()) return 0f
    val stepMs = interval.minutes * 60_000.0
    if (t <= times.first()) return ((t - times.first()) / stepMs).toFloat()
    if (t >= times.last()) return times.lastIndex + ((t - times.last()) / stepMs).toFloat()
    var lo = 0; var hi = times.lastIndex
    while (hi - lo > 1) { val mid = (lo + hi) / 2; if (times[mid] <= t) lo = mid else hi = mid }
    val span = (times[hi] - times[lo]).toFloat()
    return lo + if (span > 0) (t - times[lo]) / span else 0f
}

/** The time at a (fractional) bar index; the inverse of [indexOfTime]. */
fun timeOfIndex(times: LongArray, idx: Float, interval: Interval): Long {
    if (times.isEmpty()) return 0
    val stepMs = interval.minutes * 60_000.0
    if (idx <= 0f) return (times.first() + idx * stepMs).toLong()
    if (idx >= times.lastIndex) return (times.last() + (idx - times.lastIndex) * stepMs).toLong()
    val lo = idx.toInt()
    return (times[lo] + (times[lo + 1] - times[lo]) * (idx - lo)).toLong()
}
