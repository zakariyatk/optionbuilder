package com.adddots.optionbuilder.data

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Just enough option maths to make the sample screens behave: Black-Scholes
 * prices and Greeks, and the expiry payoff of a set of legs. The web app's
 * frontend/src/domain is the reference; port it here when wiring real data.
 */
object Pricing {
    private const val RATE = 0.065

    private fun cdf(x: Double): Double {
        // Abramowitz-Stegun 26.2.17
        val t = 1.0 / (1.0 + 0.2316419 * abs(x))
        val d = 0.3989423 * exp(-x * x / 2)
        val p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
        return if (x >= 0) 1 - p else p
    }

    private fun pdf(x: Double) = 0.3989423 * exp(-x * x / 2)

    fun price(type: LegType, spot: Double, strike: Double, years: Double, iv: Double): Double {
        if (type == LegType.FUT || type == LegType.EQ) return spot
        if (years <= 0) return intrinsic(type, spot, strike)
        val d1 = (ln(spot / strike) + (RATE + iv * iv / 2) * years) / (iv * sqrt(years))
        val d2 = d1 - iv * sqrt(years)
        return if (type == LegType.CE) spot * cdf(d1) - strike * exp(-RATE * years) * cdf(d2)
        else strike * exp(-RATE * years) * cdf(-d2) - spot * cdf(-d1)
    }

    fun intrinsic(type: LegType, spot: Double, strike: Double) = when (type) {
        LegType.CE -> max(spot - strike, 0.0)
        LegType.PE -> max(strike - spot, 0.0)
        else -> spot
    }

    /** Smile: IV rises away from the money. */
    fun smileIv(spot: Double, strike: Double, base: Double = 0.125) = base + 0.9 * ((strike - spot) / spot).let { it * it } * 10

    fun greeks(legs: List<Leg>, spot: Double, lotSize: Int, years: Double): Greeks {
        var delta = 0.0; var gamma = 0.0; var theta = 0.0; var vega = 0.0
        for (l in legs) {
            val q = l.side.sign * l.quantity(lotSize)
            if (l.type.isLinear) { delta += q; continue }
            val iv = l.iv ?: smileIv(spot, l.strike)
            val t = max(years, 1.0 / 365)
            val d1 = (ln(spot / l.strike) + (RATE + iv * iv / 2) * t) / (iv * sqrt(t))
            val nd1 = pdf(d1)
            delta += q * if (l.type == LegType.CE) cdf(d1) else cdf(d1) - 1
            gamma += q * nd1 / (spot * iv * sqrt(t))
            theta += q * (-spot * nd1 * iv / (2 * sqrt(t))) / 365
            vega += q * spot * nd1 * sqrt(t) / 100
        }
        return Greeks(delta, gamma, theta, vega)
    }

    /** P&L of the whole strategy if the underlying settles at [at]. */
    fun payoffAtExpiry(legs: List<Leg>, at: Double, lotSize: Int): Double = legs.sumOf { l ->
        val value = if (l.type.isLinear) at else intrinsic(l.type, at, l.strike)
        l.side.sign * (value - l.premium) * l.quantity(lotSize)
    }

    /** P&L today at [at] (Black-Scholes with each leg's IV). */
    fun payoffToday(legs: List<Leg>, at: Double, lotSize: Int, years: Double): Double = legs.sumOf { l ->
        val value = price(l.type, at, l.strike, years, l.iv ?: smileIv(at, l.strike))
        l.side.sign * (value - l.premium) * l.quantity(lotSize)
    }

    fun metrics(legs: List<Leg>, spot: Double, lotSize: Int): StrategyMetrics {
        if (legs.isEmpty()) return StrategyMetrics(0.0, 0.0, emptyList(), 0.0, 0.0)
        // From zero (where every payoff is finite) to well past spot; a slope at
        // the top edge means the payoff keeps growing there: unlimited.
        val hi = spot * 2
        val n = 4000
        val xs = (0..n).map { hi * it / n }
        val ys = xs.map { payoffAtExpiry(legs, it, lotSize) }
        val rightSlope = ys[n] - ys[n - 1]
        val maxProfit = if (rightSlope > 1e-6) null else ys.max()
        val maxLoss = if (rightSlope < -1e-6) null else ys.min()
        val be = mutableListOf<Double>()
        for (i in 1..n) {
            if ((ys[i - 1] < 0) != (ys[i] < 0)) {
                val x = xs[i - 1] + (xs[i] - xs[i - 1]) * (0 - ys[i - 1]) / (ys[i] - ys[i - 1])
                be += x
            }
        }
        val net = legs.sumOf { -it.side.sign * it.premium * it.quantity(lotSize) }
        val shortOptions = legs.filter { it.side == Side.SELL && !it.type.isLinear }
        val margin = if (maxLoss != null) abs(maxLoss)
        else shortOptions.sumOf { spot * it.quantity(lotSize) * 0.12 } + legs.filter { it.type.isLinear }.sumOf { spot * it.quantity(lotSize) * 0.15 }
        return StrategyMetrics(maxProfit, maxLoss, be, net, margin)
    }
}
