package com.adddots.optionbuilder.ui.screens

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.adddots.optionbuilder.data.Page
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.adddots.optionbuilder.ui.AppState
import com.adddots.optionbuilder.ui.theme.OptionBuilderTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders the phone chart and saves PNGs to build/chart-shots, so its layout
 * can be checked without a device. Fails if the screen throws while drawing
 * or a sheet doesn't open.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class ChartScreenRenderTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun shot(name: String) {
        rule.waitForIdle()
        rule.onAllNodes(isRoot()).onFirst().captureRoboImage(File("build/chart-shots/$name.png").absolutePath)
    }

    private fun show(dark: Boolean) {
        val state = AppState().apply { loggedIn = true; page = Page.Chart }
        rule.setContent { OptionBuilderTheme(dark) { Box(Modifier.fillMaxSize()) { ChartScreen(state) } } }
        rule.waitForIdle()
    }

    @Test fun chartLight() { show(false); shot("chart-light") }

    @Test fun chartDark() { show(true); shot("chart-dark") }

    @Test fun drawingBar() {
        show(false)
        rule.onNodeWithText("Draw").performClick()
        rule.onNodeWithText("Trend line").assertExists()
        shot("chart-drawing")
    }

    @Test fun indicatorSheet() {
        show(false)
        rule.onNodeWithText("Indicators").performClick()
        rule.waitForIdle()
        captureScreenRoboImage(File("build/chart-shots/chart-indicators.png").absolutePath)
    }

    @Test fun moreSheetDark() {
        show(true)
        rule.onNodeWithText("More").performClick()
        rule.waitForIdle()
        captureScreenRoboImage(File("build/chart-shots/chart-more.png").absolutePath)
    }

    @Test fun sheetsOpen() {
        show(false)
        listOf("Indicators" to "Search indicators", "Alert" to "Create alert", "Compare" to "Add symbol", "More" to "Bar replay", "Watchlist" to "BANKNIFTY").forEach { (button, inSheet) ->
            rule.onAllNodesWithText(button).onFirst().performClick()
            rule.waitForIdle()
            rule.onAllNodesWithText(inSheet).onFirst().assertExists()
            rule.activity.onBackPressedDispatcher.onBackPressed()
            rule.waitForIdle()
        }
    }
}
