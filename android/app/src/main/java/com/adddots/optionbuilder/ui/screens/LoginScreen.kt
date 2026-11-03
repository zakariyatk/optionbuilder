package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.ui.components.Logo
import com.adddots.optionbuilder.ui.theme.Ob

/**
 * Mirrors components/LoginGate.tsx: Google is the only way in, as on the web and in the Windows app.
 * Until the API is wired the button just opens the app on its sample data.
 */
@Composable
fun LoginScreen(onOpen: () -> Unit) {
    Box(Modifier.fillMaxSize().systemBarsPadding().padding(16.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .widthIn(max = 360.dp)
                .fillMaxWidth()
                .background(Ob.colors.card)
                .border(1.dp, Ob.colors.border)
                .padding(start = 28.dp, end = 28.dp, top = 34.dp, bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Logo(64.dp)
            Spacer(Modifier.size(18.dp))
            Text("AddStock", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Ob.colors.textPrimary)
            Text("ADD DOTS · Sign in to your workspace", Modifier.padding(top = 6.dp, bottom = 26.dp), fontSize = 12.sp, color = Ob.colors.textSecondary, textAlign = TextAlign.Center)
            Button(
                onClick = onOpen,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                shape = RectangleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Ob.colors.accent, contentColor = Ob.colors.accentText),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    GoogleMark()
                    Spacer(Modifier.size(10.dp))
                    Text("CONTINUE WITH GOOGLE", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
                }
            }
            Text(
                "Only approved Google accounts can sign in.",
                Modifier.padding(top = 14.dp),
                fontSize = 11.sp,
                color = Ob.colors.textMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** A blue "G" on a white disc, so it reads on the accent button. */
@Composable
private fun GoogleMark() {
    Box(Modifier.size(20.dp).background(Color.White, CircleShape), contentAlignment = Alignment.Center) {
        Text("G", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color(0xFF4285F4))
    }
}
