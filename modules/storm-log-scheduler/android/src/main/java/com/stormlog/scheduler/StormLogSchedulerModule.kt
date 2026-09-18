package com.stormlog.scheduler

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class StormLogSchedulerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StormLogScheduler")

    Function("start") { intervalMinutes: Int ->
      val context = requireNotNull(appContext.reactContext)
      StormLogAlarmScheduler.start(context, intervalMinutes)

      if (!StormLogAlarmScheduler.hasExactAlarmPermission(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        appContext.currentActivity?.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
            data = Uri.parse("package:${context.packageName}")
          },
        )
      }
    }

    Function("stop") {
      StormLogAlarmScheduler.stop(requireNotNull(appContext.reactContext))
    }

    Function("isRunning") {
      val context = requireNotNull(appContext.reactContext)
      StormLogAlarmScheduler.hasScheduledAlarm(context)
    }

    AsyncFunction("getWatchCompanionStatus") {
      val context = requireNotNull(appContext.reactContext)
      val nodes = Tasks.await(Wearable.getNodeClient(context).connectedNodes, 5, TimeUnit.SECONDS)
      if (nodes.isEmpty()) {
        return@AsyncFunction mapOf(
          "connected" to false,
          "installed" to false,
          "updateAvailable" to false,
        )
      }

      val messageClient = Wearable.getMessageClient(context)
      for (node in nodes) {
        val latch = CountDownLatch(1)
        var response: Map<String, Any?>? = null
        val listener = MessageClient.OnMessageReceivedListener { event: MessageEvent ->
          if (event.path == VERSION_RESPONSE_PATH && event.sourceNodeId == node.id) {
            runCatching {
              val json = JSONObject(String(event.data, Charsets.UTF_8))
              val versionCode = json.optLong("versionCode", 0L)
              response = mapOf(
                "connected" to true,
                "installed" to true,
                "nodeId" to node.id,
                "nodeName" to node.displayName,
                "packageName" to json.optString("packageName", ""),
                "versionCode" to versionCode,
                "versionName" to json.optString("versionName", ""),
                "protocolVersion" to json.optInt("protocolVersion", 0),
                "latestVersionCode" to LATEST_WATCH_VERSION_CODE,
                "latestVersionName" to LATEST_WATCH_VERSION_NAME,
                "updateAvailable" to (versionCode in 1 until LATEST_WATCH_VERSION_CODE),
              )
            }
            latch.countDown()
          }
        }

        messageClient.addListener(listener)
        try {
          Tasks.await(
            messageClient.sendMessage(node.id, VERSION_REQUEST_PATH, ByteArray(0)),
            5,
            TimeUnit.SECONDS,
          )
          latch.await(5, TimeUnit.SECONDS)
          response?.let { return@AsyncFunction it }
        } finally {
          messageClient.removeListener(listener)
        }
      }

      mapOf(
        "connected" to true,
        "installed" to false,
        "nodeName" to nodes.first().displayName,
        "latestVersionCode" to LATEST_WATCH_VERSION_CODE,
        "latestVersionName" to LATEST_WATCH_VERSION_NAME,
        "updateAvailable" to false,
      )
    }

    Function("hasExactAlarmPermission") {
      StormLogAlarmScheduler.hasExactAlarmPermission(requireNotNull(appContext.reactContext))
    }
  }

  companion object {
    private const val VERSION_REQUEST_PATH = "/stormlog/watch/version/request"
    private const val VERSION_RESPONSE_PATH = "/stormlog/watch/version/response"
    private const val LATEST_WATCH_VERSION_CODE = 2L
    private const val LATEST_WATCH_VERSION_NAME = "0.2.0"
  }
}
