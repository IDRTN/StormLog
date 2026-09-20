package com.stormlog.wear
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
class MainActivity : ComponentActivity() {
 override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); val p=packageManager.getPackageInfo(packageName,0); setContent { StormLogWatchScreen(WatchPreviewSnapshot.sample,p.versionName?:"unknown") } }
}
data class WatchPreviewSnapshot(val assessment:String,val confidence:String,val station:String,val radarAgeMinutes:Int,val rotation:String,val shearKt:Int?,val lightning:String,val nwsWarning:String?) {
 companion object { val sample=WatchPreviewSnapshot("MARGINAL","MODERATE","KCLE",2,"MODERATE",53,"No nearby lightning",null) }
}
@Composable fun StormLogWatchScreen(s:WatchPreviewSnapshot,v:String) {
 MaterialTheme { Column(modifier=Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=28.dp,vertical=18.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(3.dp)) {
  Text("STORMLOG",fontWeight=FontWeight.Bold); Text("v"+v,fontSize=10.sp); s.nwsWarning?.let { Text("NWS: "+it,fontWeight=FontWeight.Bold) }; Text(s.assessment,fontWeight=FontWeight.Bold); Text("Confidence "+s.confidence); Text(s.station+" Level II - "+s.radarAgeMinutes+"m"); Text("Rotation "+s.rotation); Text(s.shearKt?.let{"Shear "+it+" kt"}?:"Shear unavailable"); Text(s.lightning,fontWeight=FontWeight.Bold)
 } }
}
