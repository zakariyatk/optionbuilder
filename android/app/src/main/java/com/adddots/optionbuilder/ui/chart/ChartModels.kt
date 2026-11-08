package com.adddots.optionbuilder.ui.chart

/*
 * The phone chart's model, matching the web app's phone chart
 * (frontend/src/features/chart/mobile): chart types, intervals, the indicator
 * catalog, drawing tools, alerts and the choices kept per symbol.
 */

enum class ChartStyle(val label: String) {
    Candles("Candles"),
    Hollow("Hollow candles"),
    HeikinAshi("Heikin Ashi"),
    Bars("Bars (OHLC)"),
    Line("Line"),
    Area("Area"),
}

/** periods.ts: the interval strip. */
enum class Interval(val text: String, val minutes: Int) {
    M1("1m", 1), M3("3m", 3), M5("5m", 5), M15("15m", 15), M30("30m", 30),
    H1("1H", 60), H4("4H", 240), D("D", 1440), W("W", 10080), Mo("M", 43200);

    val intraday get() = minutes < 1440
}

enum class IndicatorGroup { Trend, Momentum, Volume, Volatility }

/**
 * indicatorCatalog.ts: a plain name, whether it draws over the candles or in a
 * pane of its own, default settings and names for them. `lines` means each
 * setting is the length of one line (MA 5 / 10 / 30 / 60).
 */
data class IndicatorDef(
    val name: String,
    val title: String,
    val group: IndicatorGroup,
    val overlay: Boolean,
    val defaults: List<Double>,
    val params: List<String> = emptyList(),
    val lines: Boolean = false,
) {
    fun paramLabel(i: Int) = if (lines) "Line ${i + 1} length" else params.getOrElse(i) { "Value ${i + 1}" }
    /** Settings that are counts of bars are whole numbers. */
    fun integer(i: Int) = !(name == "BOLL" && i == 1) && name != "SAR"
}

val INDICATORS = listOf(
    IndicatorDef("MA", "Moving Average", IndicatorGroup.Trend, true, listOf(5.0, 10.0, 30.0, 60.0), lines = true),
    IndicatorDef("EMA", "Exponential Moving Average", IndicatorGroup.Trend, true, listOf(6.0, 12.0, 20.0), lines = true),
    IndicatorDef("BOLL", "Bollinger Bands", IndicatorGroup.Volatility, true, listOf(20.0, 2.0), listOf("Length", "StdDev")),
    IndicatorDef("SAR", "Parabolic SAR", IndicatorGroup.Trend, true, listOf(0.02, 0.02, 0.2), listOf("Start", "Increment", "Maximum")),
    IndicatorDef("BBI", "Bull and Bear Index", IndicatorGroup.Trend, true, listOf(3.0, 6.0, 12.0, 24.0), lines = true),
    IndicatorDef("AVP", "Average Price (VWAP)", IndicatorGroup.Volume, true, emptyList()),
    IndicatorDef("VOL", "Volume", IndicatorGroup.Volume, false, listOf(5.0, 10.0, 20.0), lines = true),
    IndicatorDef("MACD", "MACD", IndicatorGroup.Momentum, false, listOf(12.0, 26.0, 9.0), listOf("Fast length", "Slow length", "Signal length")),
    IndicatorDef("RSI", "Relative Strength Index", IndicatorGroup.Momentum, false, listOf(6.0, 12.0, 24.0), lines = true),
    IndicatorDef("KDJ", "Stochastic (KDJ)", IndicatorGroup.Momentum, false, listOf(9.0, 3.0, 3.0), listOf("%K length", "%K smoothing", "%D smoothing")),
    IndicatorDef("CCI", "Commodity Channel Index", IndicatorGroup.Momentum, false, listOf(20.0), listOf("Length")),
    IndicatorDef("DMI", "Directional Movement (ADX)", IndicatorGroup.Trend, false, listOf(14.0, 6.0), listOf("DI length", "ADX smoothing")),
    IndicatorDef("WR", "Williams %R", IndicatorGroup.Momentum, false, listOf(6.0, 10.0, 14.0), lines = true),
    IndicatorDef("ROC", "Rate of Change", IndicatorGroup.Momentum, false, listOf(12.0, 6.0), listOf("Length", "Signal length")),
    IndicatorDef("MTM", "Momentum", IndicatorGroup.Momentum, false, listOf(12.0, 6.0), listOf("Length", "Signal length")),
    IndicatorDef("AO", "Awesome Oscillator", IndicatorGroup.Momentum, false, listOf(5.0, 34.0), listOf("Fast length", "Slow length")),
    IndicatorDef("TRIX", "TRIX", IndicatorGroup.Momentum, false, listOf(12.0, 9.0), listOf("Length", "Signal length")),
    IndicatorDef("BIAS", "Bias", IndicatorGroup.Momentum, false, listOf(6.0, 12.0, 24.0), lines = true),
    IndicatorDef("PSY", "Psychological Line", IndicatorGroup.Momentum, false, listOf(12.0, 6.0), listOf("Length", "Signal length")),
    IndicatorDef("OBV", "On Balance Volume", IndicatorGroup.Volume, false, listOf(30.0), listOf("Signal length")),
    IndicatorDef("PVT", "Price Volume Trend", IndicatorGroup.Volume, false, emptyList()),
    IndicatorDef("DMA", "Different of Moving Average", IndicatorGroup.Trend, false, listOf(10.0, 50.0, 10.0), listOf("Fast length", "Slow length", "Signal length")),
)

fun indicatorDef(name: String) = INDICATORS.first { it.name == name }

/** An indicator on the chart: its settings and whether it is shown. */
data class ActiveIndicator(val name: String, val params: List<Double>, val visible: Boolean = true) {
    val def get() = indicatorDef(name)
}

/** Panes under the price chart on a phone; more leaves the candles too little room. */
const val MAX_SUB_PANES = 3
const val MAX_COMPARE = 3

enum class Magnet(val label: String) { Off("Magnet off"), Weak("Weak magnet"), Strong("Strong magnet");
    fun next() = entries[(ordinal + 1) % entries.size]
}

/** DrawingBar.tsx: the tools and how many taps each takes to place. */
enum class DrawTool(val label: String, val taps: Int) {
    Segment("Trend line", 2),
    Ray("Ray", 2),
    HLine("Horizontal line", 1),
    HRay("Horizontal ray", 1),
    VLine("Vertical line", 1),
    Channel("Parallel channel", 3),
    FibRetracement("Fib retracement", 2),
    FibExtension("Fib extension", 3),
    Rect("Rectangle", 2),
    Circle("Circle", 2),
    Triangle("Triangle", 3),
    Arrow("Arrow", 2),
    LongPosition("Long position", 1),
    ShortPosition("Short position", 1),
}

/** A drawing's point: a bar time (so it stays put across intervals) and a price. */
data class Pt(val time: Long, val price: Double)

data class Drawing(val id: Long, val tool: DrawTool, val points: List<Pt>)

enum class AlertCondition(val label: String) { CrossingUp("Crossing up"), CrossingDown("Crossing down"), Crossing("Crossing") }

data class PriceAlert(val id: Long, val condition: AlertCondition, val price: Double)

/** Interval, chart type and compared symbols, remembered per symbol (mobilePrefs.ts). */
data class SymbolPrefs(val interval: Interval = Interval.M15, val style: ChartStyle = ChartStyle.Candles, val compare: List<String> = emptyList())

enum class ChartZone(val label: String, val id: String) {
    Kolkata("India (UTC+5:30)", "Asia/Kolkata"),
    Utc("UTC", "UTC"),
    NewYork("New York", "America/New_York"),
    London("London", "Europe/London"),
}

/** ChartSettingsDialog: what the phone chart offers. */
data class ChartSettings(
    val grid: Boolean = true,
    val lastPriceLine: Boolean = true,
    val crosshairLabels: Boolean = true,
    val zone: ChartZone = ChartZone.Kolkata,
)
