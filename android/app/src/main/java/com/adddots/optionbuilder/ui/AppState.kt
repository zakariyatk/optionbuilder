package com.adddots.optionbuilder.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.adddots.optionbuilder.data.Expiry
import com.adddots.optionbuilder.data.Leg
import com.adddots.optionbuilder.data.LegType
import com.adddots.optionbuilder.data.Page
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.data.Side
import com.adddots.optionbuilder.data.StrategyTemplate
import com.adddots.optionbuilder.data.SymbolInfo
import kotlin.math.max

/** Everything the screens share: route, market selection, the working strategy. */
class AppState {
    /** null follows the system setting. */
    var darkOverride by mutableStateOf<Boolean?>(null)
    var loggedIn by mutableStateOf(false)
    var page by mutableStateOf(Page.Builder)
    var draftId by mutableStateOf<String?>(null)
    var brokerConnected by mutableStateOf(true)
    var message by mutableStateOf<String?>(null)

    var symbol by mutableStateOf(SampleData.symbols.first())
        private set
    val expiries: List<Expiry> = SampleData.expiries()
    var expiry by mutableStateOf(expiries.first())

    val legs = mutableStateListOf<Leg>()
    private var nextId = 1L

    val years get() = max(expiry.daysToExpiry, 1) / 365.0

    fun navigate(to: Page) {
        page = to
        draftId = null
    }

    fun selectSymbol(s: SymbolInfo) {
        if (s.symbol != symbol.symbol) legs.clear()
        symbol = s
    }

    fun toast(text: String) { message = text }

    fun addLeg(side: Side, type: LegType, strike: Double, premium: Double, iv: Double? = null) {
        legs += Leg(nextId++, side, type, strike, premium, lots = 1, shares = if (type == LegType.EQ) symbol.lotSize else 0, iv = iv)
    }

    fun update(id: Long, f: (Leg) -> Leg) {
        val i = legs.indexOfFirst { it.id == id }
        if (i >= 0) legs[i] = f(legs[i])
    }

    fun applyTemplate(t: StrategyTemplate) {
        legs.clear()
        val chain = SampleData.chain(symbol, expiry.daysToExpiry, 12)
        val atm = SampleData.atmStrike(symbol)
        t.legs.forEach { tl ->
            val k = atm + tl.stepsFromAtm * symbol.strikeStep
            val row = chain.firstOrNull { it.strike == k }
            val prem = when (tl.type) {
                LegType.CE -> row?.ceLtp ?: 0.0
                LegType.PE -> row?.peLtp ?: 0.0
                else -> symbol.spot
            }
            val iv = when (tl.type) {
                LegType.CE -> row?.ceIv?.div(100)
                LegType.PE -> row?.peIv?.div(100)
                else -> null
            }
            addLeg(tl.side, tl.type, k, prem, iv)
        }
    }
}
