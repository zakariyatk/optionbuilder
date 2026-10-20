package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Position
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.EmptyState
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.LiveLabel
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.StatTile
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.pct
import com.adddots.optionbuilder.ui.components.pnlColor
import com.adddots.optionbuilder.ui.components.signedInr
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular

private val PRODUCTS = mapOf("D" to "NRML", "I" to "MIS", "CO" to "CO", "MTF" to "MTF")

/** PositionsPage.tsx: today's live positions from Upstox, read-only. */
@Composable
fun PositionsScreen(state: AppState) {
    ScreenColumn {
        if (!state.brokerConnected) {
            ObCard {
                EmptyState(
                    "Connect your broker to see live positions",
                    "Positions are read from your Upstox account and refresh every few seconds while this page is open.",
                ) {
                    ObButton("Connect Upstox", { state.brokerConnected = true }, icon = Icons.AutoMirrored.Outlined.OpenInNew, primary = true)
                }
            }
        } else {
            PositionsBody()
        }
    }
}

@Composable
private fun PositionsBody() {
    run {
        val positions = SampleData.positions
        val open = positions.filter { it.quantity != 0 }
        val closed = positions.filter { it.quantity == 0 }
        val total = positions.sumOf { it.pnl }
        val realised = positions.sumOf { it.realised }
        val unrealised = positions.sumOf { it.unrealised }

        Grid(
            listOf<@Composable (Modifier) -> Unit>(
                { StatTile("Total P&L", signedInr(total), it, pnlColor(total)) },
                { StatTile("Unrealised", signedInr(unrealised), it, pnlColor(unrealised)) },
                { StatTile("Realised", signedInr(realised), it, pnlColor(realised)) },
                { StatTile("Open positions", open.size.toString(), it) },
            ),
        )

        ObCard {
            CardHeader("Open positions (${open.size})") { LiveLabel("Live") }
            if (open.isEmpty()) EmptyState("No open positions in your Upstox account today.")
            open.forEachIndexed { i, p ->
                if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                PositionRow(p, dim = false)
            }
        }
        if (closed.isNotEmpty()) {
            ObCard {
                CardHeader("Closed today (${closed.size})")
                closed.forEachIndexed { i, p ->
                    if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                    PositionRow(p, dim = true)
                }
            }
        }
    }
}

@Composable
private fun PositionRow(p: Position, dim: Boolean) {
    val dayChg = if (p.closePrice > 0) (p.ltp - p.closePrice) / p.closePrice * 100 else null
    val text = if (dim) Ob.colors.textMuted else Ob.colors.textPrimary
    Column(Modifier.padding(horizontal = 14.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p.symbol, Modifier.weight(1f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(signedInr(p.pnl), style = Tabular, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = pnlColor(p.pnl))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${p.exchange} · ${PRODUCTS[p.product] ?: p.product}", fontSize = 11.sp, color = Ob.colors.textMuted)
            Text(
                if (p.quantity > 0) "+${p.quantity}" else p.quantity.toString(),
                style = Tabular,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = when {
                    p.quantity > 0 -> Ob.colors.blue
                    p.quantity < 0 -> Ob.colors.critical
                    else -> Ob.colors.textMuted
                },
            )
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
                Text("Avg ${num(p.averagePrice)} · LTP ${num(p.ltp)}", style = Tabular, fontSize = 11.sp, color = Ob.colors.textSecondary)
                Text(
                    "  " + (dayChg?.let { pct(it) } ?: "—"),
                    style = Tabular,
                    fontSize = 11.sp,
                    color = dayChg?.let { if (it >= 0) Ob.colors.goodText else Ob.colors.critical } ?: Ob.colors.textMuted,
                )
            }
        }
    }
}
