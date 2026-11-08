package com.adddots.optionbuilder.ui.chart

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/**
 * The phone chart's memory, kept on the device (mobilePrefs.ts and
 * chartMemory.ts on the web): interval, chart type and compared symbols per
 * symbol; drawings and alerts per symbol; the indicators, magnet, settings and
 * recently picked symbols. Every change is saved straight away.
 */
class ChartStore private constructor(private val sp: android.content.SharedPreferences) {

    private val bySymbol = mutableStateMapOf<String, SymbolPrefs>()
    private val drawingsBySymbol = mutableStateMapOf<String, List<Drawing>>()
    private val alertsBySymbol = mutableStateMapOf<String, List<PriceAlert>>()
    val indicators = mutableStateListOf<ActiveIndicator>()
    val recent = mutableStateListOf<String>()
    var magnet by mutableStateOf(Magnet.Off)
        private set
    var keepDrawing by mutableStateOf(false)
        private set
    var settings by mutableStateOf(ChartSettings())
        private set
    private var nextId = System.currentTimeMillis()

    fun newId() = nextId++

    fun prefs(symbol: String) = bySymbol[symbol] ?: SymbolPrefs()

    fun setPrefs(symbol: String, f: (SymbolPrefs) -> SymbolPrefs) {
        bySymbol[symbol] = f(prefs(symbol))
        save()
    }

    fun addCompare(symbol: String, other: String) = setPrefs(symbol) {
        if (other == symbol || other in it.compare || it.compare.size >= MAX_COMPARE) it else it.copy(compare = it.compare + other)
    }

    fun removeCompare(symbol: String, other: String) = setPrefs(symbol) { it.copy(compare = it.compare - other) }

    fun drawings(symbol: String) = drawingsBySymbol[symbol].orEmpty()

    fun setDrawings(symbol: String, list: List<Drawing>) {
        drawingsBySymbol[symbol] = list
        save()
    }

    fun alerts(symbol: String) = alertsBySymbol[symbol].orEmpty()

    fun setAlerts(symbol: String, list: List<PriceAlert>) {
        alertsBySymbol[symbol] = list
        save()
    }

    fun setIndicators(list: List<ActiveIndicator>) {
        indicators.clear(); indicators.addAll(list); save()
    }

    fun updateMagnet(m: Magnet) { magnet = m; save() }
    fun updateKeepDrawing(on: Boolean) { keepDrawing = on; save() }
    fun updateSettings(s: ChartSettings) { settings = s; save() }

    fun touch(symbol: String) {
        recent.remove(symbol); recent.add(0, symbol)
        while (recent.size > 12) recent.removeAt(recent.lastIndex)
        save()
    }

    // ---- saving ----

    private fun save() {
        val o = JSONObject()
        o.put("v", 1)
        o.put("bySymbol", JSONObject().apply {
            bySymbol.forEach { (k, p) ->
                put(k, JSONObject().put("tf", p.interval.name).put("style", p.style.name).put("compare", JSONArray(p.compare)))
            }
        })
        o.put("drawings", JSONObject().apply {
            drawingsBySymbol.forEach { (k, list) ->
                put(k, JSONArray().apply {
                    list.forEach { d ->
                        put(JSONObject().put("id", d.id).put("tool", d.tool.name).put("pts", JSONArray().apply {
                            d.points.forEach { put(JSONArray().put(it.time).put(it.price)) }
                        }))
                    }
                })
            }
        })
        o.put("alerts", JSONObject().apply {
            alertsBySymbol.forEach { (k, list) ->
                put(k, JSONArray().apply { list.forEach { put(JSONObject().put("id", it.id).put("cond", it.condition.name).put("price", it.price)) } })
            }
        })
        o.put("indicators", JSONArray().apply {
            indicators.forEach { put(JSONObject().put("name", it.name).put("params", JSONArray(it.params)).put("visible", it.visible)) }
        })
        o.put("recent", JSONArray(recent.toList()))
        o.put("magnet", magnet.name)
        o.put("keepDrawing", keepDrawing)
        o.put("settings", JSONObject().put("grid", settings.grid).put("last", settings.lastPriceLine).put("cross", settings.crosshairLabels).put("zone", settings.zone.name))
        sp.edit().putString(KEY, o.toString()).apply()
    }

    private fun load() {
        val o = sp.getString(KEY, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (o == null) {
            indicators.addAll(listOf(ActiveIndicator("MA", indicatorDef("MA").defaults.take(2)), ActiveIndicator("VOL", indicatorDef("VOL").defaults.take(2))))
            return
        }
        runCatching {
            o.optJSONObject("bySymbol")?.let { m ->
                m.keys().forEach { k ->
                    val p = m.getJSONObject(k)
                    bySymbol[k] = SymbolPrefs(
                        enumOr(p.optString("tf"), Interval.M15),
                        enumOr(p.optString("style"), ChartStyle.Candles),
                        p.optJSONArray("compare")?.let { a -> List(a.length()) { a.getString(it) } }.orEmpty(),
                    )
                }
            }
            o.optJSONObject("drawings")?.let { m ->
                m.keys().forEach { k ->
                    val a = m.getJSONArray(k)
                    drawingsBySymbol[k] = List(a.length()) { i ->
                        val d = a.getJSONObject(i)
                        val pts = d.getJSONArray("pts")
                        Drawing(d.getLong("id"), enumOr(d.getString("tool"), DrawTool.Segment), List(pts.length()) { j -> pts.getJSONArray(j).let { Pt(it.getLong(0), it.getDouble(1)) } })
                    }
                }
            }
            o.optJSONObject("alerts")?.let { m ->
                m.keys().forEach { k ->
                    val a = m.getJSONArray(k)
                    alertsBySymbol[k] = List(a.length()) { i -> a.getJSONObject(i).let { PriceAlert(it.getLong("id"), enumOr(it.getString("cond"), AlertCondition.Crossing), it.getDouble("price")) } }
                }
            }
            o.optJSONArray("indicators")?.let { a ->
                for (i in 0 until a.length()) {
                    val x = a.getJSONObject(i)
                    val name = x.getString("name")
                    if (INDICATORS.none { it.name == name }) continue
                    val ps = x.getJSONArray("params")
                    indicators += ActiveIndicator(name, List(ps.length()) { ps.getDouble(it) }, x.optBoolean("visible", true))
                }
            }
            o.optJSONArray("recent")?.let { a -> for (i in 0 until a.length()) recent += a.getString(i) }
            magnet = enumOr(o.optString("magnet"), Magnet.Off)
            keepDrawing = o.optBoolean("keepDrawing", false)
            o.optJSONObject("settings")?.let { s ->
                settings = ChartSettings(s.optBoolean("grid", true), s.optBoolean("last", true), s.optBoolean("cross", true), enumOr(s.optString("zone"), ChartZone.Kolkata))
            }
        }
    }

    companion object {
        private const val KEY = "mobile-chart"
        @Volatile private var instance: ChartStore? = null

        fun get(context: Context): ChartStore = instance ?: synchronized(this) {
            instance ?: ChartStore(context.applicationContext.getSharedPreferences("addstock-chart", Context.MODE_PRIVATE)).also { it.load(); instance = it }
        }

        private inline fun <reified T : Enum<T>> enumOr(name: String?, fallback: T): T =
            enumValues<T>().firstOrNull { it.name == name } ?: fallback
    }
}
