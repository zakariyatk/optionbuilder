package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteSweep
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Leg
import com.adddots.optionbuilder.data.LegType
import com.adddots.optionbuilder.data.Page
import com.adddots.optionbuilder.data.Pricing
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.data.Side
import com.adddots.optionbuilder.data.StrategyMetrics
import com.adddots.optionbuilder.data.View
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.EmptyState
import com.adddots.optionbuilder.ui.components.FormField
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.MarketBar
import com.adddots.optionbuilder.ui.components.NumberField
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.PayoffChart
import com.adddots.optionbuilder.ui.components.Picker
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.SidePill
import com.adddots.optionbuilder.ui.components.Stat
import com.adddots.optionbuilder.ui.components.Stepper
import com.adddots.optionbuilder.ui.components.TradeButton
import com.adddots.optionbuilder.ui.components.inr
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.signed
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular
import kotlin.math.abs

@Composable
fun viewColor(v: View): Color = when (v) {
    View.Bullish -> Ob.colors.goodText
    View.Bearish -> Ob.colors.critical
    View.Neutral -> Ob.colors.textSecondary
    View.Volatile -> Ob.colors.violet
    View.Income -> Ob.colors.warning
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BuilderScreen(state: AppState) {
    var templatesOpen by remember { mutableStateOf(false) }
    var saveOpen by remember { mutableStateOf(false) }
    val sym = state.symbol
    val legs = state.legs.toList()
    val metrics = Pricing.metrics(legs, sym.spot, sym.lotSize)

    ScreenColumn {
        MarketBar(sym, SampleData.symbols, state::selectSymbol, state.expiry, state.expiries, { state.expiry = it })

        // Toolbar (StrategyToolbar.tsx)
        ObCard(padding = true) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ObButton("Templates", { templatesOpen = true }, Modifier.weight(1f), icon = Icons.Outlined.AutoAwesome)
                ObButton("Save", { saveOpen = true }, Modifier.weight(1f), icon = Icons.Outlined.Save, enabled = legs.isNotEmpty())
                ObButton(
                    "Drafts (${SampleData.drafts.count { !it.closed }})",
                    { state.navigate(Page.Drafts) },
                    Modifier.weight(1.1f),
                    icon = Icons.Outlined.FolderOpen,
                )
            }
            Text(
                "Your working strategy is kept across restarts.",
                Modifier.padding(top = 8.dp),
                fontSize = 11.sp,
                color = Ob.colors.textMuted,
            )
        }

        // Payoff
        ObCard {
            CardHeader("Payoff", if (legs.isEmpty()) null else "Drag across the chart to read P&L") {
                Legend(Ob.colors.blue, "Expiry")
                Legend(Ob.colors.violet, "Today", dashed = true)
            }
            if (legs.isEmpty()) {
                EmptyState("No legs yet", "Tap B / S in the strike ladder below, pick a template, or add a leg to start building a strategy.") {
                    ObButton("Browse templates", { templatesOpen = true }, icon = Icons.Outlined.AutoAwesome, primary = true)
                }
            } else {
                PayoffChart(legs, sym.spot, sym.lotSize, state.years, metrics.breakevens, Modifier.padding(horizontal = 6.dp, vertical = 10.dp))
            }
        }

        MetricsCard(metrics, legs, state)
        LegsCard(state)
        StrikeLadder(state)
    }

    if (templatesOpen) {
        ModalBottomSheet(onDismissRequest = { templatesOpen = false }, containerColor = Ob.colors.raised) {
            Column(Modifier.navigationBarsPadding().verticalScroll(rememberScrollState())) {
                Text("Templates", Modifier.padding(horizontal = 20.dp), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                Text("Replaces the current legs, centred on the ATM strike.", Modifier.padding(horizontal = 20.dp, vertical = 4.dp), fontSize = 12.sp, color = Ob.colors.textMuted)
                SampleData.templates.forEach { t ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                state.applyTemplate(t)
                                templatesOpen = false
                                state.toast("${t.name} added")
                            }
                            .padding(horizontal = 20.dp, vertical = 12.dp),
                    ) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(t.name, Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Ob.colors.textPrimary)
                            Text(t.view.label.uppercase(), fontSize = 10.sp, letterSpacing = 1.sp, color = viewColor(t.view))
                        }
                        Text(t.description, fontSize = 12.sp, color = Ob.colors.textMuted)
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 20.dp), color = Ob.colors.border)
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }

    if (saveOpen) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { saveOpen = false },
            containerColor = Ob.colors.raised,
            title = { Text("Save to drafts") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "Records the legs at their current premiums so you can track live P&L under Drafts.",
                        fontSize = 13.sp,
                        color = Ob.colors.textSecondary,
                    )
                    FormField("Draft name", name, { name = it.take(80) }, placeholder = "${sym.symbol} ${state.expiry.label}")
                }
            },
            confirmButton = {
                TextButton(onClick = { saveOpen = false; state.toast("Saved to drafts") }) { Text("Save", color = Ob.colors.textPrimary, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { saveOpen = false }) { Text("Cancel", color = Ob.colors.textSecondary) } },
        )
    }
}

@Composable
private fun Legend(color: Color, label: String, dashed: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (dashed) repeat(2) { Box(Modifier.size(5.dp, 2.dp).background(color)) }
            else Box(Modifier.size(12.dp, 3.dp).background(color))
        }
        Text(label, fontSize = 11.sp, color = Ob.colors.textSecondary)
    }
}

@Composable
private fun MetricsCard(m: StrategyMetrics, legs: List<Leg>, state: AppState) {
    val sym = state.symbol
    val riskReward = when {
        legs.isEmpty() -> "—"
        m.maxProfit == null -> "1 : ∞"
        m.maxLoss == null -> "∞ : 1"
        m.maxLoss >= 0 -> "No risk"
        else -> "1 : " + num(m.maxProfit / abs(m.maxLoss), 2)
    }
    ObCard(padding = true) {
        Grid(
            listOf<@Composable (Modifier) -> Unit>(
                { mod -> Stat("Max profit", if (m.maxProfit == null) "Unlimited" else inr(m.maxProfit), mod, Ob.colors.goodText) },
                { mod -> Stat("Max loss", if (m.maxLoss == null) "Unlimited" else inr(abs(m.maxLoss)), mod, Ob.colors.critical) },
                { mod -> Stat("Risk : Reward", riskReward, mod) },
                { mod -> Stat("Breakeven", if (m.breakevens.isEmpty()) "—" else m.breakevens.joinToString(", ") { num(it, 0) }, mod) },
                { mod ->
                    Stat(
                        if (m.netPremium >= 0) "Net credit" else "Net debit",
                        inr(abs(m.netPremium)),
                        mod,
                        if (m.netPremium >= 0) Ob.colors.goodText else Ob.colors.critical,
                    )
                },
                { mod -> Stat(if (state.brokerConnected) "Margin (Upstox)" else "Est. capital", inr(m.marginEstimate), mod) },
            ),
            columns = 2,
            gap = 16,
        )
        if (legs.isNotEmpty()) {
            val g = Pricing.greeks(legs, sym.spot, sym.lotSize, state.years)
            HorizontalDivider(Modifier.padding(vertical = 14.dp), color = Ob.colors.border)
            Grid(
                listOf<@Composable (Modifier) -> Unit>(
                    { mod -> Stat("Delta", signed(g.delta, 1), mod, hint = "₹ / 1-pt") },
                    { mod -> Stat("Gamma", signed(g.gamma, 3), mod, hint = "Δ / pt") },
                    { mod -> Stat("Theta", signed(g.theta, 0), mod, if (g.theta >= 0) Ob.colors.goodText else Ob.colors.critical, "₹ / day") },
                    { mod -> Stat("Vega", signed(g.vega, 0), mod, hint = "₹ / 1% IV") },
                ),
                columns = 4,
                gap = 8,
            )
        }
        Text(
            if (state.brokerConnected) "Margin is the live SPAN + exposure figure from Upstox for these exact contracts."
            else "Margin is an estimate, not your broker's exact SPAN + exposure figure — connect Upstox or confirm with your broker before placing the trade.",
            Modifier.padding(top = 12.dp),
            fontSize = 11.sp,
            lineHeight = 15.sp,
            color = Ob.colors.textMuted,
        )
    }
}

@Composable
private fun LegsCard(state: AppState) {
    val sym = state.symbol
    ObCard {
        CardHeader("Strategy legs" + if (state.legs.isNotEmpty()) " (${state.legs.size})" else "") {
            if (state.legs.isNotEmpty()) {
                IconButton(onClick = { state.legs.clear() }) { Icon(Icons.Outlined.DeleteSweep, "Clear all", tint = Ob.colors.critical) }
            }
        }
        state.legs.forEachIndexed { i, leg ->
            if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
            Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SidePill(leg.side, onClick = { state.update(leg.id) { it.copy(side = it.side.flip()) } })
                    Picker(
                        leg.type.label,
                        LegType.entries,
                        { it.label },
                        { t -> state.update(leg.id) { it.copy(type = t, shares = if (t == LegType.EQ) sym.lotSize else 0) } },
                        Modifier.width(120.dp),
                    )
                    Spacer(Modifier.weight(1f))
                    val qty = leg.quantity(sym.lotSize)
                    Text("Qty $qty", style = Tabular, fontSize = 12.sp, color = Ob.colors.textMuted)
                    IconButton(onClick = { state.legs.removeAll { it.id == leg.id } }) {
                        Icon(Icons.Outlined.Delete, "Remove leg", tint = Ob.colors.textMuted)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (leg.type.isLinear) {
                        Column(Modifier.weight(1.2f)) {
                            Stat("Strike", "—")
                        }
                    } else {
                        Stepper(
                            "Strike",
                            num(leg.strike, 0),
                            { state.update(leg.id) { it.copy(strike = it.strike - sym.strikeStep) } },
                            { state.update(leg.id) { it.copy(strike = it.strike + sym.strikeStep) } },
                            Modifier.weight(1.2f),
                        )
                    }
                    NumberField(
                        if (leg.type.isLinear) "Price" else "Premium",
                        leg.id to leg.type,
                        leg.premium,
                        { p -> state.update(leg.id) { it.copy(premium = p) } },
                        Modifier.weight(1f),
                    )
                    if (leg.type == LegType.EQ) {
                        Stepper(
                            "Shares",
                            leg.shares.toString(),
                            { state.update(leg.id) { it.copy(shares = (it.shares - sym.lotSize).coerceAtLeast(1)) } },
                            { state.update(leg.id) { it.copy(shares = it.shares + sym.lotSize) } },
                            Modifier.weight(1f),
                        )
                    } else {
                        Stepper(
                            "Lots",
                            leg.lots.toString(),
                            { state.update(leg.id) { it.copy(lots = (it.lots - 1).coerceAtLeast(1)) } },
                            { state.update(leg.id) { it.copy(lots = it.lots + 1) } },
                            Modifier.weight(1f),
                        )
                    }
                }
                if (!leg.type.isLinear) {
                    Text(
                        "IV ${leg.iv?.let { num(it * 100, 1) + "%" } ?: "ATM"} · ${sym.symbol} ${state.expiry.label} ${num(leg.strike, 0)} ${leg.type.name}",
                        fontSize = 11.sp,
                        color = Ob.colors.textMuted,
                    )
                }
            }
        }
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ObButton("Option leg", {
                val atm = SampleData.atmStrike(sym)
                val row = SampleData.chain(sym, state.expiry.daysToExpiry, 0).first()
                state.addLeg(Side.BUY, LegType.CE, atm, row.ceLtp, row.ceIv / 100)
            }, Modifier.weight(1f), icon = Icons.Outlined.Add)
            ObButton("Stock leg", { state.addLeg(Side.BUY, LegType.EQ, 0.0, sym.spot) }, Modifier.weight(1f), icon = Icons.Outlined.Add)
        }
    }
}

/** Quick-add ladder around ATM (StrikeChain.tsx): tap B or S to add a leg. */
@Composable
private fun StrikeLadder(state: AppState) {
    val sym = state.symbol
    val rows = SampleData.chain(sym, state.expiry.daysToExpiry, 6)
    val atm = SampleData.atmStrike(sym)
    ObCard {
        CardHeader("Strike ladder", "${state.expiry.label} · lot ${sym.lotSize}")
        Row(Modifier.fillMaxWidth().background(Ob.colors.sunken).padding(horizontal = 10.dp, vertical = 6.dp)) {
            Text("CALL", Modifier.weight(1f), fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.textMuted)
            Text("STRIKE", Modifier.width(72.dp), textAlign = TextAlign.Center, fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.textMuted)
            Text("PUT", Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.textMuted)
        }
        rows.forEach { r ->
            val isAtm = r.strike == atm
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(if (isAtm) Ob.colors.warningFill else Color.Transparent)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TradeButton("B", true) { state.addLeg(Side.BUY, LegType.CE, r.strike, r.ceLtp, r.ceIv / 100) }
                    TradeButton("S", false) { state.addLeg(Side.SELL, LegType.CE, r.strike, r.ceLtp, r.ceIv / 100) }
                    Text(num(r.ceLtp), Modifier.padding(start = 4.dp), style = Tabular, fontSize = 13.sp, color = Ob.colors.textPrimary)
                }
                Box(
                    Modifier.width(72.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                        .background(if (isAtm) Ob.colors.accent else Color.Transparent).padding(vertical = 3.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(num(r.strike, 0), style = Tabular, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (isAtm) Ob.colors.accentText else Ob.colors.textPrimary)
                }
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    Text(num(r.peLtp), Modifier.padding(end = 4.dp), style = Tabular, fontSize = 13.sp, color = Ob.colors.textPrimary)
                    TradeButton("B", true) { state.addLeg(Side.BUY, LegType.PE, r.strike, r.peLtp, r.peIv / 100) }
                    TradeButton("S", false) { state.addLeg(Side.SELL, LegType.PE, r.strike, r.peLtp, r.peIv / 100) }
                }
            }
        }
        Spacer(Modifier.height(6.dp))
    }
}
