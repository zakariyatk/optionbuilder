package com.adddots.optionbuilder.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.ui.components.Logo
import com.adddots.optionbuilder.ui.theme.Ob

/** Mirrors components/LoginGate.tsx. Any non-empty password opens it until the API is wired. */
@Composable
fun LoginScreen(onOpen: () -> Unit) {
    var password by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding().padding(16.dp), contentAlignment = Alignment.Center) {
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
            Text("ADD DOTS · Enter your password", Modifier.padding(top = 6.dp, bottom = 26.dp), fontSize = 12.sp, color = Ob.colors.textSecondary, textAlign = TextAlign.Center)
            Text("PASSWORD", Modifier.fillMaxWidth(), fontSize = 9.sp, letterSpacing = 1.4.sp, color = Ob.colors.textSecondary)
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                singleLine = true,
                shape = RectangleShape,
                visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (password.isNotEmpty()) onOpen() }),
                trailingIcon = {
                    IconButton(onClick = { show = !show }) {
                        Icon(if (show) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (show) "Hide password" else "Show password", tint = Ob.colors.textMuted)
                    }
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Ob.colors.textPrimary,
                    unfocusedBorderColor = Ob.colors.border,
                    cursorColor = Ob.colors.textPrimary,
                ),
            )
            Button(
                onClick = onOpen,
                enabled = password.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp).heightIn(min = 48.dp),
                shape = RectangleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Ob.colors.accent,
                    contentColor = Ob.colors.accentText,
                    disabledContainerColor = Ob.colors.accent.copy(alpha = 0.5f),
                    disabledContentColor = Ob.colors.accentText,
                ),
            ) {
                Text("OPEN", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            }
            Text(
                "Sessions stay signed in on this device.",
                Modifier.padding(top = 14.dp),
                fontSize = 11.sp,
                color = Ob.colors.textMuted,
            )
        }
    }
}
