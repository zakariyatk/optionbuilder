package com.adddots.optionbuilder.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.adddots.optionbuilder.ui.theme.Ob
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs

/** Number formats from frontend/src/lib/format.ts, with Indian digit grouping. */
private val inLocale = Locale("en", "IN")

fun num(v: Double, decimals: Int = 2): String =
    NumberFormat.getNumberInstance(inLocale).apply {
        minimumFractionDigits = decimals
        maximumFractionDigits = decimals
    }.format(v)

fun inr(v: Double): String = "₹" + num(v, if (abs(v) >= 1000) 0 else 2)

fun signedInr(v: Double): String = (if (v > 0) "+" else if (v < 0) "−" else "") + inr(abs(v))

fun usd(v: Double): String = "$" + num(v, 2)

fun pct(v: Double, decimals: Int = 2): String = (if (v >= 0) "+" else "−") + num(abs(v), decimals) + "%"

fun signed(v: Double, decimals: Int): String = (if (v >= 0) "+" else "−") + num(abs(v), decimals)

/** Lakh / crore shorthand for open interest and volume. */
fun compact(v: Double): String {
    val a = abs(v)
    val sign = if (v < 0) "−" else ""
    return sign + when {
        a >= 1e7 -> num(a / 1e7, 2) + " Cr"
        a >= 1e5 -> num(a / 1e5, 1) + " L"
        a >= 1e3 -> num(a / 1e3, 1) + " K"
        else -> num(a, 0)
    }
}

@Composable
fun pnlColor(v: Double?): Color = when {
    v == null || v == 0.0 -> Ob.colors.textPrimary
    v > 0 -> Ob.colors.goodText
    else -> Ob.colors.critical
}
