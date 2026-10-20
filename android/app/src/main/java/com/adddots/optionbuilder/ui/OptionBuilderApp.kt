package com.adddots.optionbuilder.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material.icons.outlined.CandlestickChart
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Newspaper
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import com.adddots.optionbuilder.data.ANALYSE_PAGES
import com.adddots.optionbuilder.data.Page
import com.adddots.optionbuilder.data.SampleData
import com.adddots.optionbuilder.ui.components.LiveDot
import com.adddots.optionbuilder.ui.components.Logo
import com.adddots.optionbuilder.ui.screens.BuilderScreen
import com.adddots.optionbuilder.ui.screens.ChartScreen
import com.adddots.optionbuilder.ui.screens.DraftDetailScreen
import com.adddots.optionbuilder.ui.screens.DraftsScreen
import com.adddots.optionbuilder.ui.screens.LoginScreen
import com.adddots.optionbuilder.ui.screens.OpenInterestScreen
import com.adddots.optionbuilder.ui.screens.OptionChainScreen
import com.adddots.optionbuilder.ui.screens.PortfolioScreen
import com.adddots.optionbuilder.ui.screens.PositionsScreen
import com.adddots.optionbuilder.ui.screens.ReportScreen
import com.adddots.optionbuilder.ui.theme.Ob
import com.adddots.optionbuilder.ui.theme.OptionBuilderTheme

val Page.icon: ImageVector
    get() = when (this) {
        Page.Builder -> Icons.Outlined.Layers
        Page.Drafts -> Icons.Outlined.FolderOpen
        Page.Chart -> Icons.Outlined.CandlestickChart
        Page.Oi -> Icons.Outlined.BarChart
        Page.Chain -> Icons.Outlined.TableChart
        Page.Report -> Icons.Outlined.Newspaper
        Page.Positions -> Icons.Outlined.Work
        Page.Portfolio -> Icons.Outlined.PieChart
    }

/** The phone tab bar from tabs.ts (MOBILE_TABS): Analyse opens as a sheet. */
private sealed interface Tab {
    val label: String
    val icon: ImageVector
    data class To(val page: Page, override val label: String) : Tab { override val icon get() = page.icon }
    data object Analyse : Tab { override val label = "Analyse"; override val icon = Icons.AutoMirrored.Outlined.ShowChart }
}

private val TABS = listOf(
    Tab.To(Page.Builder, "Builder"),
    Tab.To(Page.Drafts, "Drafts"),
    Tab.Analyse,
    Tab.To(Page.Positions, "Positions"),
    Tab.To(Page.Portfolio, "Portfolio"),
)

@Composable
fun OptionBuilderApp() {
    val state = remember { AppState() }
    val dark = state.darkOverride ?: isSystemInDarkTheme()
    OptionBuilderTheme(dark) {
        Box(Modifier.fillMaxSize().background(Ob.colors.page)) {
            if (!state.loggedIn) LoginScreen(onOpen = { state.loggedIn = true })
            else Shell(state, dark)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Shell(state: AppState, dark: Boolean) {
    var analyseOpen by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            state.message = null
        }
    }
    BackHandler(enabled = state.draftId != null || state.page != Page.Builder) {
        if (state.draftId != null) state.draftId = null else state.navigate(Page.Builder)
    }

    Scaffold(
        containerColor = Ob.colors.page,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Ob.colors.page, titleContentColor = Ob.colors.textPrimary),
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Logo(36.dp)
                        Column {
                            Text(state.page.label, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Text("OPTION BUILDER · ADD DOTS", fontSize = 9.sp, letterSpacing = 1.2.sp, color = Ob.colors.textMuted)
                        }
                    }
                },
                actions = {
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .clickable { menuOpen = true }
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        if (state.brokerConnected) LiveDot() else Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(Ob.colors.textMuted))
                        Text("Upstox", fontSize = 11.sp, color = Ob.colors.textSecondary)
                    }
                    IconButton(onClick = { state.darkOverride = !dark }) {
                        Icon(if (dark) Icons.Outlined.LightMode else Icons.Outlined.DarkMode, "Toggle theme", tint = Ob.colors.textPrimary)
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = Ob.colors.textPrimary) }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = Ob.colors.raised) {
                            DropdownMenuItem(
                                text = { Text(if (state.brokerConnected) "Disconnect Upstox" else "Connect Upstox") },
                                leadingIcon = { Icon(if (state.brokerConnected) Icons.Outlined.LinkOff else Icons.Outlined.Link, null) },
                                onClick = { menuOpen = false; state.brokerConnected = !state.brokerConnected },
                            )
                            DropdownMenuItem(
                                text = { Text("Log out") },
                                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, null) },
                                onClick = { menuOpen = false; state.loggedIn = false },
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Ob.colors.card, tonalElevation = 0.dp) {
                TABS.forEach { tab ->
                    val selected = when (tab) {
                        is Tab.To -> state.page == tab.page
                        Tab.Analyse -> state.page in ANALYSE_PAGES
                    }
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            when (tab) {
                                is Tab.To -> state.navigate(tab.page)
                                Tab.Analyse -> analyseOpen = true
                            }
                        },
                        icon = { Icon(tab.icon, null) },
                        label = { Text(tab.label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Ob.colors.accentText,
                            indicatorColor = Ob.colors.accent,
                            selectedTextColor = Ob.colors.textPrimary,
                            unselectedIconColor = Ob.colors.textMuted,
                            unselectedTextColor = Ob.colors.textMuted,
                        ),
                    )
                }
            }
        },
    ) { inner ->
        Box(Modifier.fillMaxSize().padding(inner)) {
            val draft = state.draftId?.let { id -> SampleData.drafts.firstOrNull { it.id == id } }
            when {
                state.page == Page.Drafts && draft != null -> DraftDetailScreen(state, draft)
                else -> when (state.page) {
                    Page.Builder -> BuilderScreen(state)
                    Page.Drafts -> DraftsScreen(state)
                    Page.Chart -> ChartScreen(state)
                    Page.Oi -> OpenInterestScreen(state)
                    Page.Chain -> OptionChainScreen(state)
                    Page.Report -> ReportScreen(state)
                    Page.Positions -> PositionsScreen(state)
                    Page.Portfolio -> PortfolioScreen(state)
                }
            }
        }
    }

    if (analyseOpen) {
        ModalBottomSheet(onDismissRequest = { analyseOpen = false }, containerColor = Ob.colors.raised) {
            Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
                Text("Analyse", Modifier.padding(horizontal = 20.dp, vertical = 4.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textMuted)
                ANALYSE_PAGES.forEach { p ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { state.navigate(p); analyseOpen = false }
                            .padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Box(
                            Modifier.size(38.dp).clip(RoundedCornerShape(9.dp))
                                .background(if (state.page == p) Ob.colors.accent else Ob.colors.sunken),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(p.icon, null, tint = if (state.page == p) Ob.colors.accentText else Ob.colors.textPrimary, modifier = Modifier.size(20.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(p.label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ob.colors.textPrimary)
                            Text(p.description, fontSize = 12.sp, color = Ob.colors.textMuted)
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = Ob.colors.textMuted)
                    }
                    if (p != ANALYSE_PAGES.last()) HorizontalDivider(Modifier.padding(start = 72.dp), color = Ob.colors.border)
                }
                Spacer(Modifier.size(8.dp))
            }
        }
    }
}
