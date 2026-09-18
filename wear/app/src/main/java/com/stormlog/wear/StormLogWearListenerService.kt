package com.stormlog.wear

import android.content.pm.PackageManager
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

class StormLogWearListenerService : WearableListenerService() {
    override fun onMessageReceived(messageEvent: MessageEvent) {
        if (messageEvent.path != VERSION_REQUEST_PATH) return

        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val versionCode = if (android.os.Build.VERSION.SDK_INT >= 28) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }

        val payload = JSONObject().apply {
            put("packageName", packageName)
            put("versionCode", versionCode)
            put("versionName", packageInfo.versionName ?: "unknown")
            put("protocolVersion", UPDATE_PROTOCOL_VERSION)
        }.toString().toByteArray(Charsets.UTF_8)

        Wearable.getMessageClient(this)
            .sendMessage(messageEvent.sourceNodeId, VERSION_RESPONSE_PATH, payload)
    }

    companion object {
        const val UPDATE_PROTOCOL_VERSION = 1
        const val VERSION_REQUEST_PATH = "/stormlog/watch/version/request"
        const val VERSION_RESPONSE_PATH = "/stormlog/watch/version/response"
    }
}
