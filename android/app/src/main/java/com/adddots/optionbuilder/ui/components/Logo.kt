package com.adddots.optionbuilder.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.adddots.optionbuilder.ui.theme.Ob

private fun svg(d: String) = PathParser().parsePathString(d).toPath()

private fun roundRect(x: Float, y: Float, w: Float, h: Float, r: Float) =
    Path().apply { addRoundRect(RoundRect(x, y, x + w, y + h, CornerRadius(r))) }

private val LogoAccent = Color(0xFF7B61FF)

/**
 * The Option Builder mark: an "A" with rising candles and a violet trend arrow,
 * on a rounded tile. Same drawing as the web's components/Logo.tsx
 * (viewBox 162 157 928 935); the launcher icon is res/drawable/ic_launcher_foreground.xml.
 */
@Composable
fun Logo(size: Dp = 36.dp, modifier: Modifier = Modifier) {
    val tile = Ob.colors.logoTile
    // Candle wicks turn to mush at small sizes, so they only show from 48dp up.
    val wicks = size >= 48.dp
    val ink = remember {
        listOf(
            svg("M578,322 C600,285 658,285 680,322 L790,527 L706,612 L626,472 L520,655 C440,738 360,805 286,866 C276,873 266,866 272,856 Z"),
            svg("M276,903 L382,816 L382,918 C382,926 376,932 368,932 L286,932 C266,932 262,914 276,903 Z"),
            roundRect(410f, 793f, 55f, 140f, 9f),
            roundRect(573f, 679f, 55f, 156f, 9f),
            svg("M828,606 L982,888 C996,912 984,932 958,932 L842,932 C822,932 808,924 800,910 L724,768 C712,744 716,722 732,704 Z"),
        )
    }
    val inkWicks = remember { listOf(roundRect(430f, 770f, 12f, 30f, 5f), roundRect(593f, 654f, 13f, 30f, 5f)) }
    val candle = remember { roundRect(488f, 739f, 63f, 138f, 9f) }
    val candleWick = remember { roundRect(513f, 713f, 13f, 30f, 5f) }
    val arrow = remember {
        listOf(
            svg("M482,710 L604,584 C610,578 618,578 624,584 L692,648 L832,516 L852,540 L702,704 C694,712 684,712 678,704 L606,622 Z"),
            svg("M806,488 L900,458 C910,455 916,462 913,472 L894,560 C891,570 882,572 876,566 Z"),
        )
    }
    Canvas(modifier.size(size)) {
        val s = this.size.height / 935f
        scale(s, s, pivot = Offset.Zero) {
            translate(-162f, -157f) {
                drawRoundRect(tile, Offset(162f, 157f), Size(928f, 935f), CornerRadius(220f))
                ink.forEach { drawPath(it, Color.White) }
                if (wicks) inkWicks.forEach { drawPath(it, Color.White) }
                drawPath(candle, LogoAccent)
                if (wicks) drawPath(candleWick, LogoAccent)
                // The arrow is outlined in the tile colour so it reads where it crosses the "A".
                arrow.forEach {
                    drawPath(it, tile, style = Stroke(14f, join = StrokeJoin.Round))
                    drawPath(it, LogoAccent)
                }
            }
        }
    }
}
