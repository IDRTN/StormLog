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
      val nodes = Tasks.await(
        Wearable.getNodeClient(context).connectedNodes,
        NODE_DISCOVERY_TIMEOUT_SECONDS,
        TimeUnit.SECONDS,
      )

      if (nodes.isEmpty()) {
        return@AsyncFunction mapOf(
          "connected" to false,
          "installed" to false,
          "reachable" to false,
          "status" to "NO_WEAR_NODE",
          "latestVersionCode" to LATEST_WATCH_VERSION_CODE,
          "latestVersionName" to LATEST_WATCH_VERSION_NAME,
          "updateAvailable" to false,
        )
      }

      val messageClient = Wearable.getMessageClient(context)

      for (node in nodes) {
        val latch = CountDownLatch(1)
        var response: Map<String, Any?>? = null

        val listener = MessageClient.OnMessageReceivedListener { event: MessageEvent ->
          if (event.path != VERSION_RESPONSE_PATH || event.sourceNodeId != node.id) {
            return@OnMessageReceivedListener
          }

          runCatching {
            val json = JSONObject(String(event.data, Charsets.UTF_8))
            val packageName = json.optString("packageName", "")
            val versionCode = json.optLong("versionCode", 0L)
            val protocolVersion = json.optInt("protocolVersion", 0)

            if (
              packageName == EXPECTED_WATCH_PACKAGE &&
              versionCode > 0L &&
              protocolVersion == UPDATE_PROTOCOL_VERSION
            ) {
              response = mapOf(
                "connected" to true,
                "installed" to true,
                "reachable" to true,
                "status" to "READY",
                "nodeId" to node.id,
                "nodeName" to node.displayName,
                "packageName" to packageName,
                "versionCode" to versionCode,
                "versionName" to json.optString("versionName", ""),
                "protocolVersion" to protocolVersion,
                "latestVersionCode" to LATEST_WATCH_VERSION_CODE,
                "latestVersionName" to LATEST_WATCH_VERSION_NAME,
                "updateAvailable" to (versionCode in 1 until LATEST_WATCH_VERSION_CODE),
              )
            }
          }

          latch.countDown()
        }

        Tasks.await(
          messageClient.addListener(listener),
          LISTENER_REGISTRATION_TIMEOUT_SECONDS,
          TimeUnit.SECONDS,
        )

        try {
          repeat(HANDSHAKE_ATTEMPTS) {
            Tasks.await(
              messageClient.sendMessage(node.id, VERSION_REQUEST_PATH, ByteArray(0)),
              MESSAGE_SEND_TIMEOUT_SECONDS,
              TimeUnit.SECONDS,
            )

            if (latch.await(HANDSHAKE_RESPONSE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
              response?.let { return@AsyncFunction it }
              break
            }
          }
        } finally {
          runCatching {
            Tasks.await(
              messageClient.removeListener(listener),
              LISTENER_REGISTRATION_TIMEOUT_SECONDS,
              TimeUnit.SECONDS,
            )
          }
        }
      }

      mapOf(
        "connected" to true,
        "installed" to false,
        "reachable" to true,
        "status" to "CONNECTED_NO_STORMLOG_RESPONSE",
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
    private const val EXPECTED_WATCH_PACKAGE = "com.stormlog.app"
    private const val UPDATE_PROTOCOL_VERSION = 1
    private const val VERSION_REQUEST_PATH = "/stormlog/watch/version/request"
    private const val VERSION_RESPONSE_PATH = "/stormlog/watch/version/response"
    private const val LATEST_WATCH_VERSION_CODE = 3L
    private const val LATEST_WATCH_VERSION_NAME = "0.2.1"
    private const val HANDSHAKE_ATTEMPTS = 3
    private const val NODE_DISCOVERY_TIMEOUT_SECONDS = 5L
    private const val LISTENER_REGISTRATION_TIMEOUT_SECONDS = 5L
    private const val MESSAGE_SEND_TIMEOUT_SECONDS = 5L
    private const val HANDSHAKE_RESPONSE_TIMEOUT_SECONDS = 3L
  }
}
