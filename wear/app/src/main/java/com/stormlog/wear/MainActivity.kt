package com.stormlog.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { StormLogWatchScreen(WatchPreviewSnapshot.sample) }
    }
}

data class WatchPreviewSnapshot(
    val assessment: String,
    val confidence: String,
    val station: String,
    val radarAgeMinutes: Int,
    val rotation: String,
    val shearKt: Int?,
    val lightning: String,
    val nwsWarning: String?
) {
    companion object {
        val sample = WatchPreviewSnapshot(
            assessment = "MARGINAL",
            confidence = "MODERATE",
            station = "KCLE",
            radarAgeMinutes = 2,
            rotation = "MODERATE",
            shearKt = 53,
            lightning = "No nearby lightning",
            nwsWarning = null
        )
    }
}

@Composable
fun StormLogWatchScreen(snapshot: WatchPreviewSnapshot) {
    MaterialTheme {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("STORMLOG", fontWeight = FontWeight.Bold)
            snapshot.nwsWarning?.let {
                Text("NWS: $it", fontWeight = FontWeight.Bold)
            }
            Text(snapshot.assessment, fontWeight = FontWeight.Bold)
            Text("Confidence ${snapshot.confidence}")
            Text("${snapshot.station} Level II • ${snapshot.radarAgeMinutes}m")
            Text("Rotation ${snapshot.rotation}")
            Text(snapshot.shearKt?.let { "Shear $it kt" } ?: "Shear unavailable")
            Text(snapshot.lightning)
        }
    }
}
