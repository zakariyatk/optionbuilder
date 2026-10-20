package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.Holding
import com.adddots.optionbuilder.data.Market
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.CardHeader
import com.adddots.optionbuilder.ui.components.ChipRow
import com.adddots.optionbuilder.ui.components.DonutChart
import com.adddots.optionbuilder.ui.components.FormField
import com.adddots.optionbuilder.ui.components.Grid
import com.adddots.optionbuilder.ui.components.LineChart
import com.adddots.optionbuilder.ui.components.LiveLabel
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.Picker
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.Segmented
import com.adddots.optionbuilder.ui.components.Series
import com.adddots.optionbuilder.ui.components.Stat
import com.adddots.optionbuilder.ui.components.StatTile
import com.adddots.optionbuilder.ui.components.inr
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.pct
import com.adddots.optionbuilder.ui.components.pnlColor
import com.adddots.optionbuilder.ui.components.signedInr
import com.adddots.optionbuilder.ui.components.usd
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular

private val PERIODS = listOf("1M", "3M", "6M", "1Y", "3Y", "All")
private val BENCHMARKS = listOf("NIFTY", "Bank Nifty", "Sensex", "Dow Jones", "Gold")

/** null = All markets. */
private fun Market?.label() = this?.label ?: "All"

private val Holding.fx get() = if (market == Market.US) SampleData.USDINR else 1.0
private val Holding.valueInr get() = quantity * ltp * fx
private val Holding.costInr get() = quantity * avgCost * (fxAvg ?: 1.0)
private val Holding.dayInr get() = quantity * (ltp - previousClose) * fx

@Composable
private fun palette() = listOf(
    Ob.colors.blue, Ob.colors.violet, Ob.colors.goodText, Ob.colors.warning,
    Ob.colors.critical, Color(0xFF1BA3A3), Color(0xFFB0569B), Ob.colors.textMuted,
)

/** PortfolioPage.tsx: holdings across India and US, allocation, performance, USD/INR. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PortfolioScreen(state: AppState) {
    var portfolio by remember { mutableStateOf(SampleData.portfolios.first()) }
    var allocMarket by remember { mutableStateOf<Market?>(null) }
    var holdMarket by remember { mutableStateOf<Market?>(null) }
    var period by remember { mutableStateOf("1Y") }
    var benchmark by remember { mutableStateOf("NIFTY") }
    var fxPeriod by remember { mutableStateOf("1Y") }
    var txnOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Holding?>(null) }
    var nameDialog by remember { mutableStateOf<String?>(null) }
    var showAll by remember { mutableStateOf(false) }

    val holdings = SampleData.holdings
    val value = holdings.sumOf { it.valueInr }
    val invested = holdings.sumOf { it.costInr }
    val pnl = value - invested
    val day = holdings.sumOf { it.dayInr }
    val colors = palette()

    Box(Modifier.fillMaxSize()) {
        ScreenColumn {
            // Portfolio switcher
            Row(verticalAlignment = Alignment.CenterVertically) {
                Picker(portfolio, SampleData.portfolios, { it }, { portfolio = it }, Modifier.weight(1f), bold = true)
                IconButton(onClick = { nameDialog = "" }) { Icon(Icons.Outlined.CreateNewFolder, "New portfolio", tint = Ob.colors.textPrimary) }
                IconButton(onClick = { nameDialog = portfolio }) { Icon(Icons.Outlined.DriveFileRenameOutline, "Rename portfolio", tint = Ob.colors.textPrimary) }
                IconButton(onClick = { state.toast("Delete \"$portfolio\"? Long-press to confirm") }) { Icon(Icons.Outlined.Delete, "Delete portfolio", tint = Ob.colors.critical) }
            }

            Grid(
                listOf<@Composable (Modifier) -> Unit>(
                    { StatTile("Current value", inr(value), it) },
                    { StatTile("Invested", inr(invested), it, hint = "Cost of holdings") },
                    { StatTile("Total P&L", signedInr(pnl), it, pnlColor(pnl), pct(pnl / invested * 100)) },
                    { StatTile("Today's P&L", signedInr(day), it, pnlColor(day), pct(day / (value - day) * 100)) },
                ),
            )

            // Allocation
            ObCard {
                CardHeader("Allocation") {
                    Segmented(listOf(null, Market.India, Market.US), allocMarket, { it.label() }, { allocMarket = it })
                }
                val list = holdings.filter { allocMarket == null || it.market == allocMarket }.sortedByDescending { it.valueInr }
                val total = list.sumOf { it.valueInr }
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(130.dp), contentAlignment = Alignment.Center) {
                        DonutChart(list.mapIndexed { i, h -> colors[i % colors.size] to h.valueInr }, size = 130.dp)
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(allocMarket.label(), fontSize = 10.sp, color = Ob.colors.textMuted)
                            Text(inr(total).let { if (total >= 1e5) "₹" + num(total / 1e5, 1) + " L" else it }, style = Tabular, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                        }
                    }
                    Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        list.forEachIndexed { i, h ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(8.dp).clip(CircleShape).background(colors[i % colors.size]))
                                Text(h.symbol, Modifier.padding(start = 6.dp).weight(1f), fontSize = 12.sp, color = Ob.colors.textPrimary)
                                Text(num(h.valueInr / total * 100, 1) + "%", style = Tabular, fontSize = 12.sp, color = Ob.colors.textSecondary)
                            }
                        }
                    }
                }
                if (allocMarket == null) {
                    val india = holdings.filter { it.market == Market.India }.sumOf { it.valueInr }
                    HorizontalDivider(color = Ob.colors.border)
                    Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat("India", num(india / value * 100, 1) + "%", Modifier.weight(1f))
                        Stat("US", num((value - india) / value * 100, 1) + "%", Modifier.weight(1f))
                    }
                }
            }

            // Performance
            ObCard {
                CardHeader("Performance vs benchmarks", "Since start, in %")
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ChipRow(PERIODS, { it == period }, { it }, { period = it })
                    val points = when (period) { "1M" -> 22; "3M" -> 64; "6M" -> 126; "1Y" -> 250; "3Y" -> 500; else -> 700 }
                    val scale = points / 250.0
                    val mine = SampleData.returns(11 + points.toLong(), points, 24.0 * scale, 0.9)
                    val bench = SampleData.returns(benchmark.hashCode().toLong() + points, points, 13.0 * scale, 0.8)
                    LineChart(
                        listOf(
                            Series(portfolio, Ob.colors.blue, mine),
                            Series(benchmark, Ob.colors.textMuted, bench, dashed = true),
                        ),
                        height = 200.dp,
                        format = { (if (it >= 0) "+" else "") + num(it, 1) + "%" },
                        zeroLine = true,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Compare with", Modifier.weight(1f), fontSize = 12.sp, color = Ob.colors.textMuted)
                        Picker(benchmark, BENCHMARKS, { it }, { benchmark = it }, Modifier.width(150.dp))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat(portfolio, pct(mine.last()), Modifier.weight(1f), pnlColor(mine.last()))
                        Stat(benchmark, pct(bench.last()), Modifier.weight(1f), pnlColor(bench.last()), "The index in its own currency")
                    }
                }
            }

            // INR vs US dollar (FxPanel.tsx)
            ObCard {
                CardHeader("INR vs US dollar", "USD/INR · rising means a weaker rupee")
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ChipRow(PERIODS, { it == fxPeriod }, { it }, { fxPeriod = it })
                    val pts = when (fxPeriod) { "1M" -> 22; "3M" -> 64; "6M" -> 126; "1Y" -> 250; "3Y" -> 500; else -> 700 }
                    LineChart(listOf(Series("USD/INR", Ob.colors.violet, SampleData.fxSeries(pts))), height = 150.dp, format = { num(it, 2) }, fill = true)
                    val us = holdings.filter { it.market == Market.US }
                    val avgRate = us.sumOf { it.quantity * it.avgCost * (it.fxAvg ?: 0.0) } / us.sumOf { it.quantity * it.avgCost }
                    val fxGain = us.sumOf { it.quantity * it.avgCost * (SampleData.USDINR - (it.fxAvg ?: SampleData.USDINR)) }
                    Grid(
                        listOf<@Composable (Modifier) -> Unit>(
                            { Stat("Your avg buy rate", "₹" + num(avgRate, 2), it) },
                            { Stat("Today", "₹" + num(SampleData.USDINR, 2), it, hint = pct((SampleData.USDINR - SampleData.USDINR_PREV) / SampleData.USDINR_PREV * 100)) },
                            { Stat("Currency gain on US", signedInr(fxGain), it, pnlColor(fxGain)) },
                        ),
                        columns = 3,
                        gap = 8,
                    )
                }
            }

            // Holdings
            ObCard {
                CardHeader("Holdings & P&L") {
                    Segmented(listOf(null, Market.India, Market.US), holdMarket, { it.label() }, { holdMarket = it })
                }
                val list = holdings.filter { holdMarket == null || it.market == holdMarket }.sortedByDescending { it.valueInr }
                val shown = if (showAll) list else list.take(6)
                shown.forEachIndexed { i, h ->
                    if (i > 0) HorizontalDivider(color = Ob.colors.gridline)
                    HoldingRow(h, value) { editing = h }
                }
                if (list.size > 6) {
                    Text(
                        if (showAll) "Show fewer" else "Show all ${list.size}",
                        Modifier.fillMaxWidth().clickable { showAll = !showAll }.padding(12.dp),
                        textAlign = TextAlign.Center,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = Ob.colors.blue,
                    )
                }
                val tValue = list.sumOf { it.valueInr }
                val tPnl = tValue - list.sumOf { it.costInr }
                val tDay = list.sumOf { it.dayInr }
                Row(Modifier.fillMaxWidth().background(Ob.colors.sunken).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            when (holdMarket) { null -> "Total"; Market.India -> "India total"; Market.US -> "US total" },
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Ob.colors.textPrimary,
                        )
                        Text("Day ${signedInr(tDay)}", style = Tabular, fontSize = 11.sp, color = pnlColor(tDay))
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(inr(tValue), style = Tabular, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)
                        Text(signedInr(tPnl), style = Tabular, fontSize = 11.sp, color = pnlColor(tPnl))
                    }
                }
                Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) { LiveLabel("Prices live") }
            }
            Spacer(Modifier.height(64.dp))
        }

        ExtendedFloatingActionButton(
            onClick = { editing = null; txnOpen = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            containerColor = Ob.colors.accent,
            contentColor = Ob.colors.accentText,
            icon = { Icon(Icons.Outlined.Add, null) },
            text = { Text("Transaction") },
        )
    }

    if (txnOpen || editing != null) {
        TransactionSheet(editing, onClose = { txnOpen = false; editing = null }, onSave = { msg -> txnOpen = false; editing = null; state.toast(msg) })
    }

    nameDialog?.let { initial ->
        var name by remember(initial) { mutableStateOf(initial) }
        AlertDialog(
            onDismissRequest = { nameDialog = null },
            containerColor = Ob.colors.raised,
            title = { Text(if (initial.isEmpty()) "Name your portfolio" else "Rename portfolio") },
            text = { FormField("Name", name, { name = it.take(40) }) },
            confirmButton = {
                TextButton(onClick = { nameDialog = null; state.toast(if (initial.isEmpty()) "Portfolio \"$name\" created" else "Renamed to \"$name\"") }, enabled = name.isNotBlank()) {
                    Text(if (initial.isEmpty()) "Create" else "Rename", color = Ob.colors.textPrimary, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = { TextButton(onClick = { nameDialog = null }) { Text("Cancel", color = Ob.colors.textSecondary) } },
        )
    }
}

@Composable
private fun HoldingRow(h: Holding, totalValue: Double, onEdit: () -> Unit) {
    val us = h.market == Market.US
    val money: (Double) -> String = { if (us) usd(it) else inr(it) }
    val dayPct = (h.ltp - h.previousClose) / h.previousClose * 100
    val pnl = h.valueInr - h.costInr
    val pnlPct = pnl / h.costInr * 100
    Column(
        Modifier.fillMaxWidth().clickable(onClick = onEdit).padding(horizontal = 14.dp, vertical = 11.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(h.symbol, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                    if (us) Text("US", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Ob.colors.blue)
                }
                Text(h.name, fontSize = 11.sp, color = Ob.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(inr(h.valueInr), style = Tabular, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                Text("${signedInr(pnl)} (${pct(pnlPct, 1)})", style = Tabular, fontSize = 11.sp, color = pnlColor(pnl))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Qty ${h.quantity}", style = Tabular, fontSize = 11.sp, color = Ob.colors.textSecondary)
            Text("Avg ${money(h.avgCost)}", style = Tabular, fontSize = 11.sp, color = Ob.colors.textSecondary)
            Text("LTP ${money(h.ltp)}", style = Tabular, fontSize = 11.sp, color = Ob.colors.textSecondary)
            Spacer(Modifier.weight(1f))
            Text("Day ${pct(dayPct)}", style = Tabular, fontSize = 11.sp, color = pnlColor(dayPct))
            Text(num(h.valueInr / totalValue * 100, 1) + "%", style = Tabular, fontSize = 11.sp, color = Ob.colors.textMuted)
        }
    }
}

/** TransactionDialog.tsx as a full-height sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransactionSheet(editing: Holding?, onClose: () -> Unit, onSave: (String) -> Unit) {
    var side by remember { mutableStateOf("Buy") }
    var kind by remember { mutableStateOf("Stock") }
    var market by remember { mutableStateOf(editing?.market ?: Market.India) }
    var symbol by remember { mutableStateOf(editing?.symbol ?: "") }
    var date by remember { mutableStateOf(java.time.LocalDate.now().toString()) }
    var qty by remember { mutableStateOf(editing?.quantity?.toString() ?: "") }
    var price by remember { mutableStateOf(editing?.avgCost?.toString() ?: "") }
    var fees by remember { mutableStateOf("") }
    var fx by remember { mutableStateOf(editing?.fxAvg?.toString() ?: SampleData.USDINR.toString()) }
    var note by remember { mutableStateOf("") }

    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Ob.colors.raised,
    ) {
        Column(
            Modifier.navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (editing == null) "Add transaction" else "Edit · ${editing.symbol}", Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)
                IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Close", tint = Ob.colors.textSecondary) }
            }
            Segmented(listOf("Buy", "Sell"), side, { it }, { side = it }, Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Segmented(listOf("Stock", "Futures"), kind, { it }, { kind = it })
                Spacer(Modifier.weight(1f))
                Segmented(Market.entries, market, { it.label }, { market = it })
            }
            FormField(if (kind == "Futures") "Contract (e.g. NIFTY)" else "Symbol", symbol, { symbol = it.uppercase() }, placeholder = if (market == Market.US) "AAPL" else "RELIANCE")
            FormField("Date", date, { date = it }, placeholder = "YYYY-MM-DD")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FormField(if (kind == "Futures") "Lots" else "Quantity", qty, { qty = it }, Modifier.weight(1f), number = true)
                FormField("Price", price, { price = it }, Modifier.weight(1f), number = true, prefix = if (market == Market.US) "$" else "₹")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FormField("Fees", fees, { fees = it }, Modifier.weight(1f), number = true, prefix = if (market == Market.US) "$" else "₹")
                if (market == Market.US) FormField("USD/INR", fx, { fx = it }, Modifier.weight(1f), number = true)
            }
            FormField("Note", note, { note = it })
            val total = (qty.toDoubleOrNull() ?: 0.0) * (price.toDoubleOrNull() ?: 0.0) + (fees.toDoubleOrNull() ?: 0.0)
            if (total > 0) {
                Text(
                    "Total ${if (market == Market.US) usd(total) + " ≈ " + inr(total * (fx.toDoubleOrNull() ?: SampleData.USDINR)) else inr(total)}",
                    style = Tabular,
                    fontSize = 13.sp,
                    color = Ob.colors.textSecondary,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ObButton("Cancel", onClose, Modifier.weight(1f))
                ObButton(
                    if (editing == null) "Save" else "Update",
                    { onSave(if (editing == null) "$side $symbol recorded" else "${editing.symbol} updated") },
                    Modifier.weight(1f),
                    icon = Icons.Outlined.Edit.takeIf { editing != null },
                    primary = true,
                    enabled = symbol.isNotBlank() && (qty.toDoubleOrNull() ?: 0.0) > 0 && (price.toDoubleOrNull() ?: 0.0) > 0,
                )
            }
        }
    }
}
