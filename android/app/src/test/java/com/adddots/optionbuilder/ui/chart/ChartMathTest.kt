package com.adddots.optionbuilder.ui.chart

import com.adddots.optionbuilder.data.Candle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

class ChartMathTest {
    private fun bars(vararg closes: Double) = closes.mapIndexed { i, c ->
        val o = if (i == 0) c else closes[i - 1]
        Candle(o, maxOf(o, c) + 1, minOf(o, c) - 1, c, 100.0 + i)
    }

    @Test fun movingAverage() {
        val out = computeIndicator(ActiveIndicator("MA", listOf(3.0)), bars(1.0, 2.0, 3.0, 4.0, 5.0))
        val ma = out.lines.single().values
        assertTrue(ma[0].isNaN() && ma[1].isNaN())
        assertEquals(2.0, ma[2], 1e-9)
        assertEquals(4.0, ma[4], 1e-9)
    }

    @Test fun rsiIs100WhenOnlyRising() {
        val out = computeIndicator(ActiveIndicator("RSI", listOf(6.0)), bars(*DoubleArray(30) { 100.0 + it }))
        assertEquals(100.0, out.lines.single().values.last(), 1e-9)
    }

    @Test fun rsiStaysInRange() {
        val closes = DoubleArray(200) { 100 + 10 * kotlin.math.sin(it / 7.0) }
        computeIndicator(ActiveIndicator("RSI", listOf(14.0)), bars(*closes)).lines.single().values
            .filter { !it.isNaN() }.forEach { assertTrue(it in 0.0..100.0) }
    }

    @Test fun macdHistogramIsTwiceDifMinusDea() {
        val closes = DoubleArray(80) { 100 + it * 0.5 + (it % 5) }
        val out = computeIndicator(ActiveIndicator("MACD", listOf(12.0, 26.0, 9.0)), bars(*closes))
        val dif = out.lines[0].values; val dea = out.lines[1].values
        assertEquals((dif[79] - dea[79]) * 2, out.bars!!.values[79], 1e-9)
    }

    @Test fun bollingerBandsSurroundTheMiddle() {
        val closes = DoubleArray(60) { 100.0 + (it % 7) }
        val out = computeIndicator(ActiveIndicator("BOLL", listOf(20.0, 2.0)), bars(*closes))
        val (up, mid, dn) = out.lines.map { it.values }
        for (i in 19 until 60) assertTrue(up[i] >= mid[i] && mid[i] >= dn[i])
    }

    @Test fun everyIndicatorComputesWithoutError() {
        val closes = DoubleArray(150) { 100 + 5 * kotlin.math.sin(it / 9.0) + it * 0.05 }
        val b = bars(*closes)
        INDICATORS.forEach { def ->
            val out = computeIndicator(ActiveIndicator(def.name, def.defaults), b)
            assertTrue("${def.name} draws something", out.lines.isNotEmpty() || out.bars != null)
            out.lines.forEach { l -> assertEquals(b.size, l.values.size); assertTrue("${def.name} ${l.label} has values", l.values.any { !it.isNaN() }) }
        }
    }

    @Test fun heikinAshiFirstBarAndRule() {
        val b = listOf(Candle(10.0, 14.0, 9.0, 12.0, 1.0), Candle(12.0, 15.0, 11.0, 13.0, 1.0))
        val ha = heikinAshi(b)
        assertEquals((10 + 14 + 9 + 12) / 4.0, ha[0].close, 1e-9)
        assertEquals(11.0, ha[0].open, 1e-9)
        assertEquals((ha[0].open + ha[0].close) / 2, ha[1].open, 1e-9)
        assertTrue(ha[1].high >= maxOf(ha[1].open, ha[1].close))
    }

    @Test fun intradayTimesAreInNseHoursOnWeekdays() {
        val now = ZonedDateTime.of(2026, 11, 9, 11, 7, 0, 0, ZoneId.of("Asia/Kolkata")).toInstant() // a Monday
        val t = barTimes(200, Interval.M15, us = false, now = now)
        val zone = ZoneId.of("Asia/Kolkata")
        for (i in 1 until t.size) assertTrue(t[i] > t[i - 1])
        t.forEach {
            val z = Instant.ofEpochMilli(it).atZone(zone)
            assertTrue(z.dayOfWeek != DayOfWeek.SATURDAY && z.dayOfWeek != DayOfWeek.SUNDAY)
            val m = z.hour * 60 + z.minute
            assertTrue("$z in session", m in (9 * 60 + 15) until (15 * 60 + 30))
        }
        assertEquals(11 * 60, Instant.ofEpochMilli(t.last()).atZone(zone).let { it.hour * 60 + it.minute })
    }

    @Test fun dailyTimesSkipWeekends() {
        val now = ZonedDateTime.of(2026, 11, 8, 12, 0, 0, 0, ZoneId.of("America/New_York")).toInstant() // a Sunday
        val t = barTimes(30, Interval.D, us = true, now = now)
        t.forEach { val d = Instant.ofEpochMilli(it).atZone(ZoneId.of("America/New_York")).dayOfWeek; assertTrue(d != DayOfWeek.SATURDAY && d != DayOfWeek.SUNDAY) }
        assertEquals(DayOfWeek.FRIDAY, Instant.ofEpochMilli(t.last()).atZone(ZoneId.of("America/New_York")).dayOfWeek)
    }

    @Test fun timeAndIndexRoundTrip() {
        val t = barTimes(100, Interval.H1, us = false)
        listOf(0f, 10.5f, 57f, 99f, 104.25f, -3f).forEach { idx ->
            assertEquals(idx, indexOfTime(t, timeOfIndex(t, idx, Interval.H1), Interval.H1), 0.01f)
        }
    }
}
