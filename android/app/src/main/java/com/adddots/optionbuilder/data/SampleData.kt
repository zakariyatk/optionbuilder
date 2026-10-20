package com.adddots.optionbuilder.data

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import java.util.Random
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Stand-in data for every screen until the app talks to the PHP API
 * (api/index.php). Deterministic, so screenshots stay stable.
 */
object SampleData {

    val symbols = listOf(
        SymbolInfo("NIFTY", "Nifty 50", 75, 24_812.35, 24_669.75, 50.0, true),
        SymbolInfo("BANKNIFTY", "Nifty Bank", 35, 53_146.80, 53_402.10, 100.0, true),
        SymbolInfo("FINNIFTY", "Nifty Fin Service", 65, 23_918.40, 23_860.05, 50.0, true),
        SymbolInfo("MIDCPNIFTY", "Nifty Midcap Select", 140, 12_904.15, 12_871.90, 25.0, true),
        SymbolInfo("RELIANCE", "Reliance Industries", 500, 2_948.60, 2_931.25, 20.0, false),
        SymbolInfo("HDFCBANK", "HDFC Bank", 550, 1_712.45, 1_721.80, 10.0, false),
        SymbolInfo("INFY", "Infosys", 400, 1_884.20, 1_869.55, 20.0, false),
        SymbolInfo("TCS", "Tata Consultancy", 175, 4_212.90, 4_198.00, 50.0, false),
    )

    private val dayFmt = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)

    /** Weekly Tuesday expiries, then the month-end ones. */
    fun expiries(today: LocalDate = LocalDate.now()): List<Expiry> {
        val out = mutableListOf<LocalDate>()
        var d = today.with(TemporalAdjusters.nextOrSame(DayOfWeek.TUESDAY))
        repeat(4) { out += d; d = d.plusWeeks(1) }
        for (m in 1..3) {
            out += today.plusMonths(m.toLong()).with(TemporalAdjusters.lastInMonth(DayOfWeek.TUESDAY))
        }
        return out.distinct().sorted().map { Expiry(it.format(dayFmt), ChronoUnit.DAYS.between(today, it).toInt()) }
    }

    fun chain(sym: SymbolInfo, dte: Int, strikesEachSide: Int = 12): List<ChainRow> {
        val atm = atmStrike(sym)
        val years = max(dte, 1) / 365.0
        val rnd = Random(sym.symbol.hashCode().toLong() + dte)
        return (-strikesEachSide..strikesEachSide).map { i ->
            val k = atm + i * sym.strikeStep
            val ceIv = Pricing.smileIv(sym.spot, k)
            val peIv = Pricing.smileIv(sym.spot, k) + 0.01
            val ce = Pricing.price(LegType.CE, sym.spot, k, years, ceIv)
            val pe = Pricing.price(LegType.PE, sym.spot, k, years, peIv)
            val prevCe = Pricing.price(LegType.CE, sym.previousClose, k, years + 1 / 365.0, ceIv)
            val prevPe = Pricing.price(LegType.PE, sym.previousClose, k, years + 1 / 365.0, peIv)
            // OI bunches at round strikes, calls above spot and puts below.
            val round = if ((k / (sym.strikeStep * 2)) % 1.0 == 0.0) 1.6 else 1.0
            val ceOi = (exp(-abs(i - 4) / 5.0) * 9_000_000 * round * (0.7 + rnd.nextDouble() * 0.6)).roundToLong()
            val peOi = (exp(-abs(i + 4) / 5.0) * 8_500_000 * round * (0.7 + rnd.nextDouble() * 0.6)).roundToLong()
            val ceChg = ((rnd.nextDouble() - 0.35) * ceOi * 0.25).roundToLong()
            val peChg = ((rnd.nextDouble() - 0.35) * peOi * 0.25).roundToLong()
            val unusual = when (i) {
                4 -> "Call OI wall — 4.6× nearby strikes"
                -4 -> "Put writing — OI +38% today"
                1 -> "Call volume surge — 5.1× nearby"
                else -> null
            }
            ChainRow(
                strike = k,
                ceOi = ceOi, ceOiChange = ceChg, ceVolume = (ceOi * (0.8 + rnd.nextDouble() * 2)).roundToLong(),
                ceIv = ceIv * 100, ceLtp = r2(ce), ceChange = r2(ce - prevCe),
                peOi = peOi, peOiChange = peChg, peVolume = (peOi * (0.8 + rnd.nextDouble() * 2)).roundToLong(),
                peIv = peIv * 100, peLtp = r2(pe), peChange = r2(pe - prevPe),
                unusual = unusual,
            )
        }
    }

    fun atmStrike(sym: SymbolInfo) = Math.round(sym.spot / sym.strikeStep) * sym.strikeStep

    private fun r2(v: Double) = Math.round(v * 20) / 20.0

    val templates = listOf(
        StrategyTemplate("Bull call spread", View.Bullish, "Buy ATM call, sell a higher call. Capped risk and reward.",
            listOf(TemplateLeg(Side.BUY, LegType.CE, 0), TemplateLeg(Side.SELL, LegType.CE, 4))),
        StrategyTemplate("Bull put spread", View.Bullish, "Sell OTM put, buy a lower put. Collects a credit.",
            listOf(TemplateLeg(Side.SELL, LegType.PE, -2), TemplateLeg(Side.BUY, LegType.PE, -6))),
        StrategyTemplate("Bear put spread", View.Bearish, "Buy ATM put, sell a lower put. Capped risk and reward.",
            listOf(TemplateLeg(Side.BUY, LegType.PE, 0), TemplateLeg(Side.SELL, LegType.PE, -4))),
        StrategyTemplate("Bear call spread", View.Bearish, "Sell OTM call, buy a higher call. Collects a credit.",
            listOf(TemplateLeg(Side.SELL, LegType.CE, 2), TemplateLeg(Side.BUY, LegType.CE, 6))),
        StrategyTemplate("Long straddle", View.Volatile, "Buy ATM call and put. Profits from a big move either way.",
            listOf(TemplateLeg(Side.BUY, LegType.CE, 0), TemplateLeg(Side.BUY, LegType.PE, 0))),
        StrategyTemplate("Long strangle", View.Volatile, "Buy OTM call and put. Cheaper than a straddle, needs a bigger move.",
            listOf(TemplateLeg(Side.BUY, LegType.CE, 4), TemplateLeg(Side.BUY, LegType.PE, -4))),
        StrategyTemplate("Short straddle", View.Neutral, "Sell ATM call and put. Unlimited risk — margin heavy.",
            listOf(TemplateLeg(Side.SELL, LegType.CE, 0), TemplateLeg(Side.SELL, LegType.PE, 0))),
        StrategyTemplate("Iron condor", View.Neutral, "Short strangle with protective wings. Defined risk range trade.",
            listOf(TemplateLeg(Side.SELL, LegType.CE, 4), TemplateLeg(Side.BUY, LegType.CE, 8), TemplateLeg(Side.SELL, LegType.PE, -4), TemplateLeg(Side.BUY, LegType.PE, -8))),
        StrategyTemplate("Iron butterfly", View.Neutral, "Short ATM straddle with wings. Max profit if it pins the strike.",
            listOf(TemplateLeg(Side.SELL, LegType.CE, 0), TemplateLeg(Side.SELL, LegType.PE, 0), TemplateLeg(Side.BUY, LegType.CE, 6), TemplateLeg(Side.BUY, LegType.PE, -6))),
    )

    val drafts = listOf(
        Draft(
            id = "d1", name = "NIFTY iron condor wk", symbol = "NIFTY", expiry = "28 Oct",
            legs = listOf(
                DraftLeg(Side.SELL, "NIFTY 25000 CE", "28 Oct", 75, 92.40, 71.15),
                DraftLeg(Side.BUY, "NIFTY 25200 CE", "28 Oct", 75, 38.10, 27.60),
                DraftLeg(Side.SELL, "NIFTY 24600 PE", "28 Oct", 75, 84.75, 58.20),
                DraftLeg(Side.BUY, "NIFTY 24400 PE", "28 Oct", 75, 35.50, 22.95),
            ),
            createdAt = "17 Oct, 9:42 am", entryNet = 7_766.0, pnl = 2_557.0, realised = 0.0, closed = false,
            trades = listOf(
                DraftTrade("17 Oct 9:42", Side.SELL, "NIFTY 25000 CE", 75, 92.40, null),
                DraftTrade("17 Oct 9:42", Side.BUY, "NIFTY 25200 CE", 75, 38.10, null),
                DraftTrade("17 Oct 9:42", Side.SELL, "NIFTY 24600 PE", 75, 84.75, null),
                DraftTrade("17 Oct 9:42", Side.BUY, "NIFTY 24400 PE", 75, 35.50, null),
            ),
        ),
        Draft(
            id = "d2", name = "BANKNIFTY bear put", symbol = "BANKNIFTY", expiry = "28 Oct",
            legs = listOf(
                DraftLeg(Side.BUY, "BANKNIFTY 53200 PE", "28 Oct", 35, 412.0, 438.5),
                DraftLeg(Side.SELL, "BANKNIFTY 52800 PE", "28 Oct", 35, 248.0, 251.2),
            ),
            createdAt = "20 Oct, 10:05 am", entryNet = -5_740.0, pnl = 815.5, realised = 0.0, closed = false,
            trades = listOf(
                DraftTrade("20 Oct 10:05", Side.BUY, "BANKNIFTY 53200 PE", 35, 412.0, null),
                DraftTrade("20 Oct 10:05", Side.SELL, "BANKNIFTY 52800 PE", 35, 248.0, null),
            ),
        ),
        Draft(
            id = "d3", name = "RELIANCE covered call", symbol = "RELIANCE", expiry = "25 Nov",
            legs = listOf(
                DraftLeg(Side.BUY, "RELIANCE EQ", "—", 500, 2_902.0, 2_948.6),
                DraftLeg(Side.SELL, "RELIANCE 3000 CE", "25 Nov", 500, 41.0, 37.25),
            ),
            createdAt = "9 Oct, 2:18 pm", entryNet = -1_430_500.0, pnl = 25_175.0, realised = 0.0, closed = false,
            trades = listOf(
                DraftTrade("9 Oct 14:18", Side.BUY, "RELIANCE EQ", 500, 2_902.0, null),
                DraftTrade("9 Oct 14:18", Side.SELL, "RELIANCE 3000 CE", 500, 41.0, null),
            ),
        ),
        Draft(
            id = "d4", name = "NIFTY short straddle", symbol = "NIFTY", expiry = "14 Oct",
            legs = listOf(
                DraftLeg(Side.SELL, "NIFTY 24700 CE", "14 Oct", 75, 118.0, 64.0, exited = true),
                DraftLeg(Side.SELL, "NIFTY 24700 PE", "14 Oct", 75, 102.5, 131.0, exited = true),
            ),
            createdAt = "8 Oct, 9:20 am", entryNet = 16_537.5, pnl = 1_912.5, realised = 1_912.5, closed = true,
            trades = listOf(
                DraftTrade("8 Oct 9:20", Side.SELL, "NIFTY 24700 CE", 75, 118.0, null),
                DraftTrade("8 Oct 9:20", Side.SELL, "NIFTY 24700 PE", 75, 102.5, null),
                DraftTrade("13 Oct 15:05", Side.BUY, "NIFTY 24700 CE", 75, 64.0, 4_050.0),
                DraftTrade("13 Oct 15:05", Side.BUY, "NIFTY 24700 PE", 75, 131.0, -2_137.5),
            ),
        ),
    )

    val positions = listOf(
        Position("NIFTY 28 OCT 25000 CE", "NFO", "D", -75, 92.40, 71.15, 86.30, 1_593.75, 0.0, 1_593.75),
        Position("NIFTY 28 OCT 25200 CE", "NFO", "D", 75, 38.10, 27.60, 34.80, -787.50, 0.0, -787.50),
        Position("NIFTY 28 OCT 24600 PE", "NFO", "D", -75, 84.75, 58.20, 77.05, 1_991.25, 0.0, 1_991.25),
        Position("NIFTY 28 OCT 24400 PE", "NFO", "D", 75, 35.50, 22.95, 31.40, -941.25, 0.0, -941.25),
        Position("BANKNIFTY OCT FUT", "NFO", "I", 0, 53_310.0, 53_146.8, 53_402.1, 2_450.0, 2_450.0, 0.0),
        Position("HDFCBANK", "NSE", "I", 0, 1_718.0, 1_712.45, 1_721.80, -412.0, -412.0, 0.0),
    )

    val holdings = listOf(
        Holding("HDFCBANK", "HDFC Bank", Market.India, 80, 1_452.30, 1_712.45, 1_721.80),
        Holding("INFY", "Infosys", Market.India, 60, 1_498.10, 1_884.20, 1_869.55),
        Holding("RELIANCE", "Reliance Industries", Market.India, 100, 2_455.80, 2_948.60, 2_931.25),
        Holding("TCS", "Tata Consultancy", Market.India, 30, 3_890.00, 4_212.90, 4_198.00),
        Holding("ICICIBANK", "ICICI Bank", Market.India, 65, 1_085.40, 1_318.75, 1_306.10),
        Holding("AAPL", "Apple", Market.US, 15, 214.30, 248.92, 246.11, 83.41),
        Holding("NVDA", "NVIDIA", Market.US, 40, 118.60, 182.45, 185.02, 83.62),
        Holding("MSFT", "Microsoft", Market.US, 10, 418.20, 512.30, 508.84, 84.05),
    )

    const val USDINR = 88.21
    const val USDINR_PREV = 88.34

    val portfolios = listOf("Long term", "Trading", "Demo portfolio")

    val globalCues = listOf(
        GlobalCue("GIFT Nifty", "24,905", 0.38, true),
        GlobalCue("Dow Jones", "46,312", 0.52, true),
        GlobalCue("Nasdaq", "22,688", 0.91, true),
        GlobalCue("Nikkei 225", "48,210", -0.27, true),
        GlobalCue("Hang Seng", "25,940", 0.64, true),
        GlobalCue("Brent crude", "$63.40", 1.12, false),
        GlobalCue("USD / INR", "88.21", -0.15, false),
        GlobalCue("India VIX", "11.42", -3.10, false),
        GlobalCue("Gold", "$4,212", 0.44, true),
    )

    val flows = listOf(
        FlowDay("20 Oct", -1_284.6, 2_917.3),
        FlowDay("17 Oct", 412.9, 1_105.4),
        FlowDay("16 Oct", -2_310.2, 3_402.8),
        FlowDay("15 Oct", 1_076.5, -218.7),
        FlowDay("14 Oct", -892.1, 1_644.0),
    )

    val news = listOf(
        NewsItem("Markets", "Nifty ends at record high as banks, IT lead broad rally", "3:42 pm"),
        NewsItem("RBI", "RBI holds repo at 5.5%, keeps neutral stance; CPI forecast trimmed", "1:10 pm"),
        NewsItem("Earnings", "Infosys Q2 beats on margins, raises FY revenue guidance band", "12:25 pm"),
        NewsItem("Global", "US yields slip ahead of Fed minutes; dollar index eases", "11:58 am"),
        NewsItem("Commodities", "Brent climbs above \$63 on Middle East supply worries", "10:31 am"),
        NewsItem("FII", "FIIs net sellers for third session, DIIs absorb outflows", "9:05 am"),
    )

    val watchlist = listOf(
        WatchItem("NIFTY", 24_812.35, 0.58),
        WatchItem("BANKNIFTY", 53_146.80, -0.48),
        WatchItem("SENSEX", 81_342.10, 0.61),
        WatchItem("RELIANCE", 2_948.60, 0.59),
        WatchItem("HDFCBANK", 1_712.45, -0.54),
        WatchItem("INFY", 1_884.20, 0.78),
        WatchItem("TCS", 4_212.90, 0.35),
        WatchItem("US:AAPL", 248.92, 1.14),
    )

    fun candles(seed: Long, count: Int, start: Double): List<Candle> {
        val rnd = Random(seed)
        var last = start
        return List(count) {
            val drift = (rnd.nextGaussian() * 0.0045 + 0.0004) * last
            val open = last
            val close = open + drift
            val high = max(open, close) + abs(rnd.nextGaussian()) * 0.0022 * open
            val low = minOf(open, close) - abs(rnd.nextGaussian()) * 0.0022 * open
            last = close
            Candle(open, high, low, close, 40_000 + rnd.nextDouble() * 120_000)
        }
    }

    /** Cumulative return series, in %, for the Performance chart. */
    fun returns(seed: Long, points: Int, annual: Double, vol: Double): List<Double> {
        val rnd = Random(seed)
        var v = 0.0
        return List(points) {
            v += annual / points + rnd.nextGaussian() * vol
            v
        }
    }

    fun fxSeries(points: Int): List<Double> {
        val rnd = Random(88)
        var v = 83.0
        return List(points) {
            v += 5.2 / points + rnd.nextGaussian() * 0.08
            v
        }.let { s -> s.map { it - s.last() + USDINR } }
    }
}
