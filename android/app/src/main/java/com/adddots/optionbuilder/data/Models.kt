package com.adddots.optionbuilder.data

/** Screens that mirror the web app's `PageId`s (frontend/src/components/tabs.ts). */
enum class Page(val label: String, val description: String) {
    Builder("Strategy Builder", "Build and analyse a strategy"),
    Drafts("Draft Portfolios", "Saved strategies, tracked live"),
    Chart("Chart", "Candles with indicators and drawing tools"),
    Oi("Open Interest", "OI and OI change by strike, over any part of the day"),
    Chain("Option Chain", "Full chain with OI, volume and IV"),
    Report("Daily Report", "Levels, flows, global cues and news"),
    Positions("Positions", "Today's live positions from Upstox"),
    Portfolio("Portfolio", "Holdings, P&L and performance"),
}

val ANALYSE_PAGES = listOf(Page.Chart, Page.Oi, Page.Chain, Page.Report)

enum class Side { BUY, SELL;
    fun flip() = if (this == BUY) SELL else BUY
    val sign get() = if (this == BUY) 1.0 else -1.0
}

enum class LegType(val label: String) {
    CE("Call"), PE("Put"), FUT("Future"), EQ("Stock");
    val isLinear get() = this == FUT || this == EQ
}

data class Leg(
    val id: Long,
    val side: Side,
    val type: LegType,
    val strike: Double,
    val premium: Double,
    val lots: Int = 1,
    /** Share count for an EQ leg; options and futures use lots × lot size. */
    val shares: Int = 0,
    val iv: Double? = null,
) {
    fun quantity(lotSize: Int) = if (type == LegType.EQ) shares else lots * lotSize
}

data class SymbolInfo(
    val symbol: String,
    val label: String,
    val lotSize: Int,
    val spot: Double,
    val previousClose: Double,
    val strikeStep: Double,
    val isIndex: Boolean,
)

data class Expiry(val label: String, val daysToExpiry: Int)

data class ChainRow(
    val strike: Double,
    val ceOi: Long, val ceOiChange: Long, val ceVolume: Long, val ceIv: Double, val ceLtp: Double, val ceChange: Double,
    val peOi: Long, val peOiChange: Long, val peVolume: Long, val peIv: Double, val peLtp: Double, val peChange: Double,
    /** Why the row is flagged in "Unusual activity", or null. */
    val unusual: String? = null,
)

enum class View(val label: String) { Bullish("Bullish"), Bearish("Bearish"), Neutral("Neutral"), Volatile("Volatile"), Income("Income") }

data class TemplateLeg(val side: Side, val type: LegType, val stepsFromAtm: Int)

data class StrategyTemplate(val name: String, val view: View, val description: String, val legs: List<TemplateLeg>)

data class StrategyMetrics(
    val maxProfit: Double?,
    val maxLoss: Double?,
    val breakevens: List<Double>,
    val netPremium: Double,
    val marginEstimate: Double,
)

data class Greeks(val delta: Double, val gamma: Double, val theta: Double, val vega: Double)

data class DraftLeg(val side: Side, val instrument: String, val expiry: String, val qty: Int, val entry: Double, val ltp: Double?, val exited: Boolean = false)

data class DraftTrade(val time: String, val side: Side, val instrument: String, val qty: Int, val price: Double, val booked: Double?)

data class Draft(
    val id: String,
    val name: String,
    val symbol: String,
    val expiry: String,
    val legs: List<DraftLeg>,
    val createdAt: String,
    val entryNet: Double,
    val pnl: Double?,
    val realised: Double,
    val closed: Boolean,
    val trades: List<DraftTrade>,
)

data class Position(
    val symbol: String,
    val exchange: String,
    val product: String,
    val quantity: Int,
    val averagePrice: Double,
    val ltp: Double,
    val closePrice: Double,
    val pnl: Double,
    val realised: Double,
    val unrealised: Double,
)

enum class Market(val label: String) { India("India"), US("US") }

data class Holding(
    val symbol: String,
    val name: String,
    val market: Market,
    val quantity: Int,
    val avgCost: Double,
    val ltp: Double,
    val previousClose: Double,
    /** USD/INR paid on average, for US holdings. */
    val fxAvg: Double? = null,
)

data class Candle(val open: Double, val high: Double, val low: Double, val close: Double, val volume: Double)

data class GlobalCue(val name: String, val value: String, val changePct: Double, val upIsGoodForIndia: Boolean)

data class FlowDay(val date: String, val fii: Double, val dii: Double)

data class NewsItem(val tag: String, val text: String, val time: String)

data class WatchItem(val symbol: String, val last: Double, val changePct: Double)
