package com.adddots.optionbuilder.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adddots.optionbuilder.ui.theme.Ob

private fun plain(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()

/** −  value  + ; for strikes, lots and quantities. */
@Composable
fun Stepper(label: String, value: String, onMinus: () -> Unit, onPlus: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier) {
        Eyebrow(label)
        Row(
            Modifier
                .padding(top = 3.dp)
                .fillMaxWidth()
                .height(38.dp)
                .clip(RoundedCornerShape(7.dp))
                .border(1.dp, Ob.colors.borderStrong, RoundedCornerShape(7.dp)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(34.dp, 38.dp).clickable(onClick = onMinus), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Remove, "Decrease $label", Modifier.size(16.dp), tint = Ob.colors.textSecondary)
            }
            Text(value, Modifier.weight(1f), textAlign = TextAlign.Center, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Ob.colors.textPrimary, maxLines = 1)
            Box(Modifier.size(34.dp, 38.dp).clickable(onClick = onPlus), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Add, "Increase $label", Modifier.size(16.dp), tint = Ob.colors.textSecondary)
            }
        }
    }
}

/**
 * A compact decimal field. [key] scopes the text being typed, so
 * half-typed values like "12." aren't reformatted under the cursor.
 */
@Composable
fun NumberField(label: String, key: Any, initial: Double, onChange: (Double) -> Unit, modifier: Modifier = Modifier) {
    var text by remember(key) { mutableStateOf(plain(initial)) }
    Column(modifier) {
        Eyebrow(label)
        BasicTextField(
            value = text,
            onValueChange = { t ->
                text = t
                t.toDoubleOrNull()?.let { if (it >= 0) onChange(it) }
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            textStyle = TextStyle(fontSize = 13.sp, color = Ob.colors.textPrimary, fontFeatureSettings = "tnum"),
            cursorBrush = SolidColor(Ob.colors.textPrimary),
            modifier = Modifier
                .padding(top = 3.dp)
                .fillMaxWidth()
                .height(38.dp)
                .clip(RoundedCornerShape(7.dp))
                .border(1.dp, Ob.colors.borderStrong, RoundedCornerShape(7.dp))
                .padding(horizontal = 10.dp, vertical = 10.dp),
        )
    }
}

/** Labelled full-width text field for forms (transactions, draft names). */
@Composable
fun FormField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    number: Boolean = false,
    prefix: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it, color = Ob.colors.textMuted) } },
        prefix = prefix?.let { { Text(it) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = if (number) KeyboardType.Decimal else KeyboardType.Text),
        shape = RoundedCornerShape(8.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Ob.colors.textPrimary,
            unfocusedBorderColor = Ob.colors.borderStrong,
            focusedLabelColor = Ob.colors.textPrimary,
            cursorColor = Ob.colors.textPrimary,
        ),
    )
}

/** Small square B / S buttons used in the strike ladder. */
@Composable
fun TradeButton(text: String, buy: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(5.dp))
            .border(1.dp, if (buy) Ob.colors.goodText.copy(alpha = 0.5f) else Ob.colors.critical.copy(alpha = 0.5f), RoundedCornerShape(5.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (buy) Ob.colors.goodText else Ob.colors.critical)
    }
}
