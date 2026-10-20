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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddAlert
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Functions
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.components.CandleChart
import com.adddots.optionbuilder.ui.components.ChipRow
import com.adddots.optionbuilder.ui.components.FormField
import com.adddots.optionbuilder.ui.components.ObButton
import com.adddots.optionbuilder.ui.components.ObCard
import com.adddots.optionbuilder.ui.components.ScreenColumn
import com.adddots.optionbuilder.ui.components.Segmented
import com.adddots.optionbuilder.ui.components.num
import com.adddots.optionbuilder.ui.components.pct
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.Tabular

private val INTERVALS = listOf("1m", "5m", "15m", "1h", "4h", "1D", "1W")

private enum class ChartSheet { Search, Indicators, Draw, Alert, Replay, Settings }

private val INDICATORS = listOf(
    "Moving average (20)" to "Trend",
    "EMA (50)" to "Trend",
    "VWAP" to "Volume",
    "Volume" to "Volume",
    "Bollinger Bands" to "Volatility",
    "RSI (14)" to "Momentum",
    "MACD" to "Momentum",
    "Supertrend" to "Trend",
)

private val DRAWING_TOOLS = listOf("Trend line", "Horizontal line", "Ray", "Fib retracement", "Rectangle", "Long position", "Short position", "Text", "Measure")

/** ChartPage.tsx: candles, intervals, watchlist, indicators, alerts, replay. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChartScreen(state: AppState) {
    var chartSymbol by remember { mutableStateOf(SampleData.watchlist.first()) }
    var interval by remember { mutableStateOf("15m") }
    var lineMode by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<ChartSheet?>(null) }
    val activeIndicators = remember { mutableStateListOf("Moving average (20)", "Volume") }
    var replayAt by remember { mutableFloatStateOf(1f) }
    var showGrid by remember { mutableStateOf(true) }
    var extended by remember { mutableStateOf(false) }

    val all = remember(chartSymbol.symbol, interval) {
        SampleData.candles((chartSymbol.symbol + interval).hashCode().toLong(), 180, chartSymbol.last * 0.93)
    }
    val candles = if (sheet == ChartSheet.Replay || replayAt < 1f) all.take((all.size * replayAt).toInt().coerceAtLeast(30)) else all
    val last = candles.last()
    val first = candles.first()
    val chg = (last.close - first.open) / first.open * 100

    ScreenColumn {
        // Symbol + quote
        ObCard(padding = true) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.clip(RoundedCornerShape(7.dp)).clickable { sheet = ChartSheet.Search }.padding(end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.Outlined.Search, null, Modifier.size(18.dp), tint = Ob.colors.textSecondary)
                    Text(chartSymbol.symbol, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    Text(num(last.close), style = Tabular, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                    Text(pct(chg), style = Tabular, fontSize = 12.sp, color = if (chg >= 0) Ob.colors.goodText else Ob.colors.critical)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                ChipRow(INTERVALS, { it == interval }, { it }, { interval = it }, Modifier.weight(1f))
                Spacer(Modifier.size(8.dp))
                Segmented(listOf(false, true), lineMode, { if (it) "Line" else "Candle" }, { lineMode = it })
            }
        }

        // Chart
        ObCard {
            Row(Modifier.padding(start = 12.dp, top = 10.dp, end = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                activeIndicators.forEach { Text(it, fontSize = 10.sp, color = Ob.colors.warning) }
            }
            CandleChart(
                candles,
                Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
                visible = 70,
                showVolume = "Volume" in activeIndicators,
                showMa = "Moving average (20)" in activeIndicators,
                line = lineMode,
            )
            Text(
                "Drag to pan · tap for OHLC",
                Modifier.padding(start = 12.dp, bottom = 8.dp),
                fontSize = 10.sp,
                color = Ob.colors.textMuted,
            )
        }

        // Toolbar
        ObCard {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                ToolButton(Icons.Outlined.Functions, "Indicators") { sheet = ChartSheet.Indicators }
                ToolButton(Icons.Outlined.Draw, "Draw") { sheet = ChartSheet.Draw }
                ToolButton(Icons.Outlined.AddAlert, "Alert") { sheet = ChartSheet.Alert }
                ToolButton(Icons.Outlined.Replay, "Replay") { sheet = ChartSheet.Replay }
                ToolButton(Icons.Outlined.Settings, "Settings") { sheet = ChartSheet.Settings }
                ToolButton(Icons.Outlined.PhotoCamera, "Snapshot") { state.toast("Snapshot saved to Pictures") }
            }
        }

        // Watchlist
        ObCard {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.StarOutline, null, Modifier.size(16.dp), tint = Ob.colors.textSecondary)
                Text("Watchlist", Modifier.padding(start = 6.dp).weight(1f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                Text("${SampleData.watchlist.size} symbols", fontSize = 11.sp, color = Ob.colors.textMuted)
            }
            HorizontalDivider(color = Ob.colors.border)
            SampleData.watchlist.forEach { w ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(if (w == chartSymbol) Ob.colors.sunken else androidx.compose.ui.graphics.Color.Transparent)
                        .clickable { chartSymbol = w }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(w.symbol, Modifier.weight(1f), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Ob.colors.textPrimary)
                    Text(num(w.last), style = Tabular, fontSize = 13.sp, color = Ob.colors.textPrimary)
                    Text(
                        pct(w.changePct),
                        Modifier.padding(start = 12.dp).size(width = 64.dp, height = 18.dp),
                        style = Tabular,
                        fontSize = 12.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.End,
                        color = if (w.changePct >= 0) Ob.colors.goodText else Ob.colors.critical,
                    )
                }
            }
        }
    }

    sheet?.let { s ->
        ModalBottomSheet(onDismissRequest = { sheet = null }, containerColor = Ob.colors.raised) {
            Column(
                Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (s) {
                    ChartSheet.Search -> {
                        var q by remember { mutableStateOf("") }
                        SheetTitle("Symbol search")
                        FormField("Search NSE, BSE or US symbols", q, { q = it })
                        SampleData.watchlist.filter { q.isBlank() || it.symbol.contains(q.trim(), ignoreCase = true) }.forEach { w ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable { chartSymbol = w; sheet = null }.padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(w.symbol, Modifier.weight(1f), fontSize = 14.sp, color = Ob.colors.textPrimary)
                                Text(if (w.symbol.startsWith("US:")) "NASDAQ" else "NSE", fontSize = 11.sp, color = Ob.colors.textMuted)
                            }
                        }
                    }
                    ChartSheet.Indicators -> {
                        SheetTitle("Indicators")
                        INDICATORS.forEach { (name, group) ->
                            val on = name in activeIndicators
                            Row(
                                Modifier.fillMaxWidth().clickable { if (on) activeIndicators.remove(name) else activeIndicators.add(name) },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(on, { if (on) activeIndicators.remove(name) else activeIndicators.add(name) }, colors = CheckboxDefaults.colors(checkedColor = Ob.colors.accent, checkmarkColor = Ob.colors.accentText))
                                Text(name, Modifier.weight(1f), fontSize = 14.sp, color = Ob.colors.textPrimary)
                                Text(group, fontSize = 11.sp, color = Ob.colors.textMuted)
                            }
                        }
                    }
                    ChartSheet.Draw -> {
                        SheetTitle("Drawing tools")
                        DRAWING_TOOLS.forEach { t ->
                            Text(
                                t,
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable { sheet = null; state.toast("$t: tap two points on the chart") }.padding(vertical = 10.dp),
                                fontSize = 14.sp,
                                color = Ob.colors.textPrimary,
                            )
                        }
                    }
                    ChartSheet.Alert -> {
                        var price by remember { mutableStateOf(num(last.close, 2).replace(",", "")) }
                        var crossing by remember { mutableStateOf("Crossing up") }
                        SheetTitle("Create alert · ${chartSymbol.symbol}")
                        Segmented(listOf("Crossing up", "Crossing down", "Crossing"), crossing, { it }, { crossing = it })
                        FormField("Price", price, { price = it }, number = true)
                        ObButton("Create alert", { sheet = null; state.toast("Alert set: ${chartSymbol.symbol} $crossing $price") }, Modifier.fillMaxWidth(), primary = true)
                    }
                    ChartSheet.Replay -> {
                        SheetTitle("Bar replay")
                        Text("Slide back to hide later bars, then step forward to practise reading the chart.", fontSize = 12.sp, color = Ob.colors.textMuted)
                        Slider(
                            replayAt, { replayAt = it }, valueRange = 0.2f..1f,
                            colors = SliderDefaults.colors(thumbColor = Ob.colors.accent, activeTrackColor = Ob.colors.accent, inactiveTrackColor = Ob.colors.sunken),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ObButton("Step +1", { replayAt = (replayAt + 1f / all.size).coerceAtMost(1f) }, Modifier.weight(1f))
                            ObButton("Exit replay", { replayAt = 1f; sheet = null }, Modifier.weight(1f), primary = true)
                        }
                    }
                    ChartSheet.Settings -> {
                        SheetTitle("Chart settings")
                        SettingRow("Grid lines", showGrid) { showGrid = it }
                        SettingRow("Extended hours", extended) { extended = it }
                        SettingRow("Line chart", lineMode) { lineMode = it }
                        Text("Timezone: Asia/Kolkata (UTC+5:30)", fontSize = 12.sp, color = Ob.colors.textMuted)
                    }
                }
            }
        }
    }
}

@Composable
private fun SheetTitle(text: String) = Text(text, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)

@Composable
private fun SettingRow(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!on) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 14.sp, color = Ob.colors.textPrimary)
        androidx.compose.material3.Switch(
            on, onChange,
            colors = androidx.compose.material3.SwitchDefaults.colors(checkedTrackColor = Ob.colors.accent, checkedThumbColor = Ob.colors.accentText),
        )
    }
}

@Composable
private fun ToolButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(icon, null, Modifier.size(20.dp), tint = Ob.colors.textPrimary)
        Text(label, fontSize = 10.sp, color = Ob.colors.textSecondary)
    }
}
