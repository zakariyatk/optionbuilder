package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.ViewCarousel
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.Bar
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.Eyebrow
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.MarketBar
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.Pill
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.Stat
import com.adddots.optionbuilder.ui.components.compact
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.pct
import com.adddots.optionbuilder.ui.components.pnlColor
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

/** DailyReport.tsx: levels, flows, global cues and news, with image export. */
@Composable
fun ReportScreen(state: AppState) {
    val sym = state.symbol
    val chain = SampleData.chain(sym, state.expiry.daysToExpiry, 12)
    val resistance = chain.sortedByDescending { it.ceOi }.take(3)
    val support = chain.sortedByDescending { it.peOi }.take(3)
    val pcr = chain.sumOf { it.peOi }.toDouble() / chain.sumOf { it.ceOi }
    val latest = SampleData.flows.first()
    val positives = SampleData.globalCues.count { (it.changePct >= 0) == it.upIsGoodForIndia }
    val sentiment = when {
        positives >= SampleData.globalCues.size * 0.65 -> "Positive" to Ob.colors.goodText
        positives <= SampleData.globalCues.size * 0.35 -> "Negative" to Ob.colors.critical
        else -> "Mixed" to Ob.colors.warning
    }
    val date = LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH))

    ScreenColumn {
        MarketBar(sym, SampleData.symbols, state::selectSymbol, state.expiry, state.expiries, { state.expiry = it })

        // Export
        ObCard(padding = true) {
            Text("Daily Market Report", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)
            Text(date, fontSize = 12.sp, color = Ob.colors.textMuted)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ObButton("PNG", { state.toast("Report saved as PNG") }, Modifier.weight(1f), icon = Icons.Outlined.Image)
                ObButton("JPG", { state.toast("Report saved as JPG") }, Modifier.weight(1f), icon = Icons.Outlined.Image)
                ObButton("Instagram", { state.toast("7-slide carousel ready") }, Modifier.weight(1.4f), icon = Icons.Outlined.ViewCarousel, primary = true)
            }
            Text("ZAK TRADE · Learn · Trade · Grow", Modifier.padding(top = 10.dp), fontSize = 10.sp, letterSpacing = 1.sp, color = Ob.colors.textMuted)
        }

        // Key levels
        ObCard(padding = true) {
            Grid(
                listOf<@Composable (Modifier) -> Unit>(
                    { Stat("Resistance", num(resistance.first().strike, 0), it, Ob.colors.critical, "Highest call OI") },
                    { Stat("Support", num(support.first().strike, 0), it, Ob.colors.goodText, "Highest put OI") },
                    { Stat("PCR", num(pcr, 2), it, if (pcr >= 1) Ob.colors.goodText else Ob.colors.critical, if (pcr >= 1) "Put-heavy · supportive" else "Call-heavy · capped") },
                    { Stat("FII / DII net", "${compact(latest.fii * 1e7)} / ${compact(latest.dii * 1e7)}", it, hint = "₹ · ${latest.date}") },
                ),
                gap = 16,
            )
        }

        // Global sentiment
        ObCard {
            CardHeader("Global market sentiment", "Colour is from India's point of view") {
                Pill(sentiment.first, sentiment.second, Ob.colors.sunken)
            }
            SampleData.globalCues.forEachIndexed { i, g ->
                if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                val good = (g.changePct >= 0) == g.upIsGoodForIndia
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(g.name, Modifier.weight(1f), fontSize = 13.sp, color = Ob.colors.textPrimary)
                    Text(g.value, style = Tabular, fontSize = 13.sp, color = Ob.colors.textSecondary)
                    Text(
                        pct(g.changePct),
                        Modifier.width(72.dp),
                        style = Tabular,
                        textAlign = TextAlign.End,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (good) Ob.colors.goodText else Ob.colors.critical,
                    )
                }
            }
        }

        // Max OI
        ObCard {
            CardHeader("Open interest levels", "${sym.symbol} · ${state.expiry.label} (current expiry)")
            val maxOi = maxOf(resistance.first().ceOi, support.first().peOi).toFloat()
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Eyebrow("Resistance — call OI", color = Ob.colors.critical)
                resistance.forEach { r -> OiLine(num(r.strike, 0), r.ceOi / maxOi, compact(r.ceOi.toDouble()), Ob.colors.critical) }
                Spacer(Modifier.height(4.dp))
                Eyebrow("Support — put OI", color = Ob.colors.goodText)
                support.forEach { r -> OiLine(num(r.strike, 0), r.peOi / maxOi, compact(r.peOi.toDouble()), Ob.colors.good) }
            }
        }

        // Flows
        ObCard {
            CardHeader("FII / DII activity", "Cash-market flows, ₹ crore. Source: NSE.")
            Row(Modifier.fillMaxWidth().background(Ob.colors.sunken).padding(horizontal = 14.dp, vertical = 6.dp)) {
                Text("Date", Modifier.weight(1f), fontSize = 10.sp, color = Ob.colors.textMuted)
                Text("FII", Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 10.sp, color = Ob.colors.textMuted)
                Text("DII", Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 10.sp, color = Ob.colors.textMuted)
                Text("Net", Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 10.sp, color = Ob.colors.textMuted)
            }
            SampleData.flows.forEach { f ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Text(f.date, Modifier.weight(1f), fontSize = 12.sp, color = Ob.colors.textSecondary)
                    FlowCell(f.fii, Modifier.weight(1f))
                    FlowCell(f.dii, Modifier.weight(1f))
                    FlowCell(f.fii + f.dii, Modifier.weight(1f), bold = true)
                }
            }
        }

        // News
        ObCard {
            CardHeader("Key market news", "Condensed, tagged and de-duplicated")
            if (SampleData.news.isEmpty()) Text("No headlines right now.", Modifier.padding(14.dp), color = Ob.colors.textMuted)
            SampleData.news.forEachIndexed { i, n ->
                if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Pill(n.tag, Ob.colors.blue, Ob.colors.sunken)
                    Column(Modifier.weight(1f)) {
                        Text(n.text, fontSize = 13.sp, color = Ob.colors.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(n.time, fontSize = 11.sp, color = Ob.colors.textMuted)
                    }
                }
            }
        }
    }
}

@Composable
private fun OiLine(strike: String, fraction: Float, value: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(strike, Modifier.width(56.dp), style = Tabular, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
        Bar(fraction, color, Modifier.weight(1f), height = 14.dp)
        Text(value, Modifier.width(64.dp), style = Tabular, textAlign = TextAlign.End, fontSize = 12.sp, color = Ob.colors.textSecondary)
    }
}

@Composable
private fun FlowCell(v: Double, modifier: Modifier, bold: Boolean = false) {
    Text(
        (if (v >= 0) "+" else "−") + num(abs(v), 0),
        modifier,
        style = Tabular,
        textAlign = TextAlign.End,
        fontSize = 12.sp,
        fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        color = pnlColor(v),
    )
}
