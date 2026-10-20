package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
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
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.Bar
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.ChipRow
import com.adddots.optionbuilder.ui.components.Eyebrow
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.MarketBar
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.Segmented
import com.adddots.optionbuilder.ui.components.Stat
import com.adddots.optionbuilder.ui.components.compact
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular
import kotlin.math.abs
import kotlin.math.roundToInt

private enum class OiView(val label: String) { Oi("Open interest"), Change("OI change") }

private fun minutesLabel(m: Float): String {
    val total = 9 * 60 + 15 + m.roundToInt()
    val h = total / 60
    val mm = total % 60
    return "%d:%02d".format(if (h > 12) h - 12 else h, mm)
}

/** OpenInterestPage.tsx: calls vs puts by strike, for chosen expiries and a time window. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OpenInterestScreen(state: AppState) {
    val sym = state.symbol
    var view by remember { mutableStateOf(OiView.Oi) }
    val picked = remember { mutableStateListOf(state.expiries.first()) }
    var range by remember { mutableFloatStateOf(10f) }
    var window by remember { mutableStateOf(0f..375f) }

    // Combine the picked expiries; the window scales how much of today's change is counted.
    val windowShare = (window.endInclusive - window.start) / 375f
    val rows = picked.flatMap { SampleData.chain(sym, it.daysToExpiry, range.roundToInt()) }
        .groupBy { it.strike }
        .map { (k, rs) ->
            Triple(
                k,
                if (view == OiView.Oi) rs.sumOf { it.ceOi }.toDouble() else rs.sumOf { it.ceOiChange } * windowShare.toDouble(),
                if (view == OiView.Oi) rs.sumOf { it.peOi }.toDouble() else rs.sumOf { it.peOiChange } * windowShare.toDouble(),
            )
        }
        .sortedByDescending { it.first }
    val maxAbs = rows.maxOf { maxOf(abs(it.second), abs(it.third)) }.coerceAtLeast(1.0)
    val totalCe = rows.sumOf { it.second }
    val totalPe = rows.sumOf { it.third }
    val pcr = if (totalCe != 0.0) totalPe / totalCe else 0.0
    val atm = SampleData.atmStrike(sym)

    ScreenColumn {
        MarketBar(sym, SampleData.symbols, state::selectSymbol, null, state.expiries, {})

        ObCard(padding = true) {
            Segmented(OiView.entries, view, { it.label }, { view = it }, Modifier.fillMaxWidth())
            Box(Modifier.size(12.dp))
            Grid(
                listOf<@Composable (Modifier) -> Unit>(
                    { Stat("PCR", num(pcr, 2), it, if (pcr >= 1) Ob.colors.goodText else Ob.colors.critical) },
                    { Stat(if (view == OiView.Oi) "Call OI" else "Call OI chg", compact(totalCe), it, Ob.colors.critical) },
                    { Stat(if (view == OiView.Oi) "Put OI" else "Put OI chg", compact(totalPe), it, Ob.colors.goodText) },
                ),
                columns = 3,
                gap = 10,
            )
        }

        ObCard(padding = true) {
            Eyebrow("Expiries included")
            ChipRow(
                state.expiries,
                { it in picked },
                { "${it.label} · ${it.daysToExpiry}d" },
                { e ->
                    when {
                        e !in picked -> picked.add(e)
                        picked.size > 1 -> picked.remove(e)
                        else -> {}
                    }
                },
                Modifier.padding(top = 6.dp, bottom = 12.dp),
            )
            Eyebrow("Strikes above and below ATM · ${range.roundToInt()}")
            Slider(
                range, { range = it }, valueRange = 4f..20f, steps = 15,
                colors = SliderDefaults.colors(thumbColor = Ob.colors.accent, activeTrackColor = Ob.colors.accent, inactiveTrackColor = Ob.colors.sunken, activeTickColor = Color.Transparent, inactiveTickColor = Color.Transparent),
            )
            Eyebrow("Window · ${minutesLabel(window.start)} – ${minutesLabel(window.endInclusive)}")
            RangeSlider(
                window, { window = it }, valueRange = 0f..375f,
                colors = SliderDefaults.colors(thumbColor = Ob.colors.accent, activeTrackColor = Ob.colors.accent, inactiveTrackColor = Ob.colors.sunken),
            )
        }

        ObCard {
            CardHeader(if (view == OiView.Oi) "Open interest by strike" else "OI change by strike", "Spot ${num(sym.spot, 0)}")
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text("PUT", Modifier.weight(1f), fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.goodText)
                Text("STRIKE", Modifier.width(70.dp), textAlign = TextAlign.Center, fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.textMuted)
                Text("CALL", Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.critical)
            }
            rows.forEach { (k, ce, pe) ->
                val isAtm = k == atm
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (isAtm) Ob.colors.warningFill else Color.Transparent)
                        .padding(horizontal = 12.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                        Bar((abs(pe) / maxAbs).toFloat(), if (pe >= 0) Ob.colors.good else Ob.colors.good.copy(alpha = 0.4f), Modifier.fillMaxWidth(), fromRight = true)
                        Text(compact(pe), style = Tabular, fontSize = 9.sp, color = Ob.colors.textMuted)
                    }
                    Text(
                        num(k, 0),
                        Modifier
                            .width(70.dp)
                            .padding(horizontal = 6.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (isAtm) Ob.colors.accent else Color.Transparent),
                        textAlign = TextAlign.Center,
                        style = Tabular,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isAtm) Ob.colors.accentText else Ob.colors.textPrimary,
                    )
                    Column(Modifier.weight(1f)) {
                        Bar((abs(ce) / maxAbs).toFloat(), if (ce >= 0) Ob.colors.critical else Ob.colors.critical.copy(alpha = 0.4f), Modifier.fillMaxWidth())
                        Text(compact(ce), style = Tabular, fontSize = 9.sp, color = Ob.colors.textMuted)
                    }
                }
            }
            Text(
                if (view == OiView.Change) "Faded bars are unwinding (OI falling)." else "The tallest call bar tends to act as resistance, the tallest put bar as support.",
                Modifier.padding(12.dp),
                fontSize = 11.sp,
                color = Ob.colors.textMuted,
            )
        }
    }
}
