package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.ChainRow
import com.adddots.optionbuilder.data.LegType
import com.adddots.optionbuilder.data.Page
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.data.Side
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.MarketBar
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.Stat
import com.adddots.optionbuilder.ui.components.compact
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.signed
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular

private data class Col(val title: String, val width: Dp, val value: (ChainRow) -> String, val color: @Composable (ChainRow) -> Color? = { null })

/** OptionChainTable.tsx (detailed): calls left, puts right, ITM shaded, unusual rows marked. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OptionChainScreen(state: AppState) {
    val sym = state.symbol
    val rows = SampleData.chain(sym, state.expiry.daysToExpiry, 15)
    val atm = SampleData.atmStrike(sym)
    var detailed by remember { mutableStateOf(false) }
    var unusualOnly by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf<ChainRow?>(null) }

    val pcr = rows.sumOf { it.peOi }.toDouble() / rows.sumOf { it.ceOi }
    val maxCall = rows.maxBy { it.ceOi }
    val maxPut = rows.maxBy { it.peOi }

    val chg: @Composable (Double) -> Color = { if (it >= 0) Ob.colors.goodText else Ob.colors.critical }
    val callCols = buildList {
        add(Col("OI", 62.dp, { compact(it.ceOi.toDouble()) }))
        if (detailed) {
            add(Col("OI chg", 62.dp, { compact(it.ceOiChange.toDouble()) }, { chg(it.ceOiChange.toDouble()) }))
            add(Col("Volume", 62.dp, { compact(it.ceVolume.toDouble()) }))
            add(Col("IV", 44.dp, { num(it.ceIv, 1) }))
        }
        add(Col("Chg", 54.dp, { signed(it.ceChange, 1) }, { chg(it.ceChange) }))
        add(Col("LTP", 62.dp, { num(it.ceLtp) }))
    }
    val putCols = buildList {
        add(Col("LTP", 62.dp, { num(it.peLtp) }))
        add(Col("Chg", 54.dp, { signed(it.peChange, 1) }, { chg(it.peChange) }))
        if (detailed) {
            add(Col("IV", 44.dp, { num(it.peIv, 1) }))
            add(Col("Volume", 62.dp, { compact(it.peVolume.toDouble()) }))
            add(Col("OI chg", 62.dp, { compact(it.peOiChange.toDouble()) }, { chg(it.peOiChange.toDouble()) }))
        }
        add(Col("OI", 62.dp, { compact(it.peOi.toDouble()) }))
    }
    val shown = if (unusualOnly) rows.filter { it.unusual != null } else rows

    ScreenColumn {
        MarketBar(sym, SampleData.symbols, state::selectSymbol, state.expiry, state.expiries, { state.expiry = it })

        ObCard(padding = true) {
            Grid(
                listOf<@Composable (Modifier) -> Unit>(
                    { Stat("PCR (OI)", num(pcr, 2), it, if (pcr >= 1) Ob.colors.goodText else Ob.colors.critical) },
                    { Stat("Max call OI", num(maxCall.strike, 0), it, Ob.colors.critical) },
                    { Stat("Max put OI", num(maxPut.strike, 0), it, Ob.colors.goodText) },
                ),
                columns = 3,
                gap = 10,
            )
        }

        ObCard {
            CardHeader("Option chain", "${state.expiry.label} · lot ${sym.lotSize}")
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Detailed", Modifier.weight(1f), fontSize = 13.sp, color = Ob.colors.textPrimary)
                Switch(detailed, { detailed = it }, colors = switchColors())
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Unusual activity", fontSize = 13.sp, color = Ob.colors.textPrimary)
                    Text("OI, volume or build-up ≥ 4× nearby strikes", fontSize = 11.sp, color = Ob.colors.textMuted)
                }
                Switch(unusualOnly, { unusualOnly = it }, colors = switchColors())
            }
            Spacer(Modifier.height(6.dp))
            HorizontalDivider(color = Ob.colors.border)

            Column(Modifier.horizontalScroll(rememberScrollState())) {
                // Header
                Row(Modifier.background(Ob.colors.sunken).padding(vertical = 4.dp)) {
                    Text("CALLS", Modifier.width(callCols.sumOf { it.width.value.toDouble() }.toFloat().dp), textAlign = TextAlign.Center, fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.critical)
                    Spacer(Modifier.width(76.dp))
                    Text("PUTS", Modifier.width(putCols.sumOf { it.width.value.toDouble() }.toFloat().dp), textAlign = TextAlign.Center, fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.goodText)
                }
                Row(Modifier.background(Ob.colors.sunken).padding(bottom = 6.dp)) {
                    callCols.forEach { HeaderCell(it.title, it.width) }
                    HeaderCell("STRIKE", 76.dp, center = true)
                    putCols.forEach { HeaderCell(it.title, it.width, alignStart = true) }
                }
                shown.forEach { r ->
                    val callItm = r.strike < sym.spot
                    val putItm = r.strike > sym.spot
                    val isAtm = r.strike == atm
                    Row(
                        Modifier.clickable { picked = r }.padding(vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(Modifier.background(if (callItm) Ob.colors.itmFill else Color.Transparent)) {
                            callCols.forEach { c -> Cell(c.value(r), c.width, c.color(r)) }
                        }
                        Box(Modifier.width(76.dp), contentAlignment = Alignment.Center) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                if (r.unusual != null) Box(Modifier.size(6.dp).clip(CircleShape).background(Ob.colors.violet))
                                Text(
                                    num(r.strike, 0),
                                    Modifier
                                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                                        .background(if (isAtm) Ob.colors.accent else Color.Transparent)
                                        .padding(horizontal = 5.dp, vertical = 1.dp),
                                    style = Tabular,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isAtm) Ob.colors.accentText else Ob.colors.textPrimary,
                                )
                            }
                        }
                        Row(Modifier.background(if (putItm) Ob.colors.itmFill else Color.Transparent)) {
                            putCols.forEach { c -> Cell(c.value(r), c.width, c.color(r), alignStart = true) }
                        }
                    }
                    HorizontalDivider(color = Ob.colors.gridline)
                }
            }
            Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                LegendSwatch(Ob.colors.itmFill, "In the money")
                LegendSwatch(Ob.colors.accent, "At the money")
                LegendSwatch(Ob.colors.violet, "Unusual", round = true)
            }
        }
    }

    picked?.let { r ->
        ModalBottomSheet(onDismissRequest = { picked = null }, containerColor = Ob.colors.raised) {
            Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${sym.symbol} ${num(r.strike, 0)} · ${state.expiry.label}", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)
                r.unusual?.let { Text(it, fontSize = 12.sp, color = Ob.colors.violet) }
                listOf(LegType.CE to r.ceLtp, LegType.PE to r.peLtp).forEach { (type, ltp) ->
                    val iv = if (type == LegType.CE) r.ceIv else r.peIv
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text("${type.label} · ${num(ltp)}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                            Text("IV ${num(iv, 1)}%", fontSize = 11.sp, color = Ob.colors.textMuted)
                        }
                        ObButton("Buy", {
                            state.addLeg(Side.BUY, type, r.strike, ltp, iv / 100); picked = null; state.toast("Added to builder")
                        })
                        ObButton("Sell", {
                            state.addLeg(Side.SELL, type, r.strike, ltp, iv / 100); picked = null; state.toast("Added to builder")
                        }, danger = true)
                    }
                }
                ObButton("Open Strategy Builder", { picked = null; state.navigate(Page.Builder) }, Modifier.fillMaxWidth(), primary = true)
            }
        }
    }
}

@Composable
private fun switchColors() = SwitchDefaults.colors(
    checkedThumbColor = Ob.colors.accentText,
    checkedTrackColor = Ob.colors.accent,
    uncheckedThumbColor = Ob.colors.textMuted,
    uncheckedTrackColor = Ob.colors.sunken,
    uncheckedBorderColor = Ob.colors.borderStrong,
)

@Composable
private fun HeaderCell(text: String, width: Dp, center: Boolean = false, alignStart: Boolean = false) {
    Text(
        text,
        Modifier.width(width).padding(horizontal = 6.dp),
        textAlign = when { center -> TextAlign.Center; alignStart -> TextAlign.Start; else -> TextAlign.End },
        fontSize = 10.sp,
        color = Ob.colors.textMuted,
    )
}

@Composable
private fun Cell(text: String, width: Dp, color: Color?, alignStart: Boolean = false) {
    Text(
        text,
        Modifier.width(width).padding(horizontal = 6.dp),
        textAlign = if (alignStart) TextAlign.Start else TextAlign.End,
        style = Tabular,
        fontSize = 12.sp,
        color = color ?: Ob.colors.textPrimary,
        maxLines = 1,
    )
}

@Composable
private fun LegendSwatch(color: Color, label: String, round: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(10.dp).clip(if (round) CircleShape else androidx.compose.foundation.shape.RoundedCornerShape(2.dp)).background(color))
        Text(label, fontSize = 11.sp, color = Ob.colors.textSecondary)
    }
}
