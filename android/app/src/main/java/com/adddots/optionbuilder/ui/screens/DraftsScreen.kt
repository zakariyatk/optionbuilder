package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Draft
import com.adddots.optionbuilder.data.Page
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.data.Side
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.EmptyState
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.LiveLabel
import com.adddots.optionbuilder.ui.components.Notice
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.SidePill
import com.adddots.optionbuilder.ui.components.Stat
import com.adddots.optionbuilder.ui.components.StatTile
import com.adddots.optionbuilder.ui.components.StatusPill
import com.adddots.optionbuilder.ui.components.Tone
import com.adddots.optionbuilder.ui.components.inr
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.pct
import com.adddots.optionbuilder.ui.components.pnlColor
import com.adddots.optionbuilder.ui.components.signedInr
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular
import kotlin.math.abs

/** DraftsPage.tsx: saved strategies with live P&L. */
@Composable
fun DraftsScreen(state: AppState) {
    val drafts = SampleData.drafts
    val open = drafts.filter { !it.closed }
    val openTotal = open.sumOf { it.pnl ?: 0.0 }
    val closedTotal = drafts.filter { it.closed }.sumOf { it.pnl ?: 0.0 }

    ScreenColumn {
        if (!state.brokerConnected) Notice("Connect Upstox to see live P&L — until then drafts show their entry prices only.")
        Grid(
            listOf<@Composable (Modifier) -> Unit>(
                { StatTile("Open drafts", open.size.toString(), it) },
                { StatTile("Open P&L (live)", if (state.brokerConnected) signedInr(openTotal) else "—", it, pnlColor(openTotal)) },
                { StatTile("Closed P&L", signedInr(closedTotal), it, pnlColor(closedTotal)) },
                { mod ->
                    ObCard(mod) {
                        ObButton(
                            "New strategy",
                            { state.legs.clear(); state.navigate(Page.Builder) },
                            Modifier.fillMaxWidth().padding(10.dp),
                            icon = Icons.Outlined.Add,
                            primary = true,
                        )
                    }
                },
            ),
        )

        ObCard {
            CardHeader("Draft portfolios") { if (state.brokerConnected) LiveLabel("Live") }
            if (drafts.isEmpty()) {
                EmptyState("No drafts yet", "Build a strategy, then use Save to drafts to track it here with live prices.")
            }
            drafts.forEachIndexed { i, d ->
                if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                DraftRow(d, state.brokerConnected) { state.draftId = d.id }
            }
        }
    }
}

@Composable
private fun DraftRow(d: Draft, live: Boolean, onOpen: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(d.name, Modifier.weight(1f, fill = false), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.blue, maxLines = 1, overflow = TextOverflow.Ellipsis)
                StatusPill(d.closed)
            }
            Text("${d.symbol} · ${d.expiry} · ${d.legs.size} legs", fontSize = 12.sp, color = Ob.colors.textSecondary)
            Text(d.createdAt, fontSize = 11.sp, color = Ob.colors.textMuted)
        }
        Column(horizontalAlignment = Alignment.End) {
            val showPnl = d.closed || live
            Text(
                if (showPnl && d.pnl != null) signedInr(d.pnl) else "—",
                style = Tabular,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (showPnl) pnlColor(d.pnl) else Ob.colors.textMuted,
            )
            Text(
                (if (d.entryNet >= 0) "Cr " else "Dr ") + inr(abs(d.entryNet)),
                style = Tabular,
                fontSize = 11.sp,
                color = if (d.entryNet >= 0) Ob.colors.goodText else Ob.colors.critical,
            )
        }
        Icon(Icons.Outlined.ChevronRight, null, Modifier.padding(start = 4.dp), tint = Ob.colors.textMuted)
    }
}

/** DraftMonitor.tsx: one draft's legs, live P&L, exits and trade log. */
@Composable
fun DraftDetailScreen(state: AppState, d: Draft) {
    ScreenColumn {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { state.draftId = null }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to drafts", tint = Ob.colors.textPrimary) }
            Column(Modifier.weight(1f)) {
                Text(d.name, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${d.symbol} · created ${d.createdAt}", fontSize = 12.sp, color = Ob.colors.textMuted)
            }
            StatusPill(d.closed)
        }
        if (!state.brokerConnected && !d.closed) Notice("Connect Upstox to monitor live prices and adjust legs. Showing entry prices only.", Tone.Info)

        ObCard(padding = true) {
            Text("P&L", fontSize = 11.sp, color = Ob.colors.textMuted)
            Text(
                d.pnl?.let { signedInr(it) } ?: "—",
                style = Tabular,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = pnlColor(d.pnl),
            )
            Spacer(Modifier.size(12.dp))
            Grid(
                listOf<@Composable (Modifier) -> Unit>(
                    { Stat("Realized", signedInr(d.realised), it, pnlColor(d.realised)) },
                    { Stat("Status", if (d.closed) "Closed" else "Open", it) },
                    { Stat("Entry credit / debit", (if (d.entryNet >= 0) "Cr " else "Dr ") + inr(abs(d.entryNet)), it, if (d.entryNet >= 0) Ob.colors.goodText else Ob.colors.critical) },
                    { Stat("Expiry", d.expiry, it) },
                ),
                gap = 16,
            )
        }

        ObCard {
            CardHeader("Legs") { if (!d.closed && state.brokerConnected) LiveLabel("Live") }
            if (d.legs.all { it.exited }) {
                Text("All legs exited.", Modifier.padding(14.dp), fontSize = 13.sp, color = Ob.colors.textMuted)
            }
            d.legs.forEachIndexed { i, l ->
                if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                val ltp = l.ltp ?: l.entry
                val legPnl = (if (l.side == Side.BUY) ltp - l.entry else l.entry - ltp) * l.qty
                val change = (ltp - l.entry) / l.entry * 100
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SidePill(l.side)
                        Column(Modifier.weight(1f)) {
                            Text(l.instrument, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = if (l.exited) Ob.colors.textMuted else Ob.colors.textPrimary)
                            Text("Expiry ${l.expiry} · Qty ${l.qty}", fontSize = 11.sp, color = Ob.colors.textMuted)
                        }
                        Text(signedInr(legPnl), style = Tabular, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = pnlColor(legPnl))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        MiniKv("Entry", num(l.entry))
                        MiniKv(if (l.exited || d.closed) "Exit" else "LTP", num(ltp))
                        MiniKv("Change", pct(change), if (change >= 0) Ob.colors.goodText else Ob.colors.critical)
                        Spacer(Modifier.weight(1f))
                        if (!l.exited && !d.closed) {
                            ObButton("Exit", { state.toast("Exit recorded for ${l.instrument}") }, icon = Icons.AutoMirrored.Outlined.Logout, danger = true)
                        }
                    }
                }
            }
        }

        ObCard {
            CardHeader("Trade log")
            Row(Modifier.fillMaxWidth().background(Ob.colors.sunken).padding(horizontal = 14.dp, vertical = 6.dp)) {
                listOf("Time" to 1.1f, "Instrument" to 2f, "Price" to 0.9f, "Booked" to 1f).forEach { (h, w) ->
                    Text(h, Modifier.weight(w), fontSize = 10.sp, color = Ob.colors.textMuted, textAlign = if (h == "Time" || h == "Instrument") TextAlign.Start else TextAlign.End)
                }
            }
            d.trades.forEach { t ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(t.time, Modifier.weight(1.1f), fontSize = 11.sp, color = Ob.colors.textSecondary)
                    Column(Modifier.weight(2f)) {
                        Text(t.instrument, fontSize = 12.sp, color = Ob.colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${t.side.name} · ${t.qty}", fontSize = 10.sp, color = if (t.side == Side.BUY) Ob.colors.goodText else Ob.colors.critical)
                    }
                    Text(num(t.price), Modifier.weight(0.9f), style = Tabular, fontSize = 12.sp, textAlign = TextAlign.End, color = Ob.colors.textPrimary)
                    Text(t.booked?.let { signedInr(it) } ?: "—", Modifier.weight(1f), style = Tabular, fontSize = 12.sp, textAlign = TextAlign.End, color = pnlColor(t.booked))
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ObButton("Open in builder", { state.navigate(Page.Builder) }, Modifier.weight(1f), icon = Icons.Outlined.ContentCopy)
            if (!d.closed) ObButton("Exit all", { state.toast("All legs exited") }, Modifier.weight(1f), danger = true)
        }
    }
}

@Composable
private fun MiniKv(k: String, v: String, color: androidx.compose.ui.graphics.Color = Ob.colors.textPrimary) {
    Column(Modifier.width(IntrinsicWidth)) {
        Text(k, fontSize = 10.sp, color = Ob.colors.textMuted)
        Text(v, style = Tabular, fontSize = 12.sp, color = color)
    }
}

private val IntrinsicWidth = 64.dp
