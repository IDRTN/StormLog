package com.stormlog.scheduler

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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
      if (nodes.isEmpty()) return@AsyncFunction mapOf("connected" to false)

      val node = nodes.first()
      Tasks.await(
        Wearable.getMessageClient(context).sendMessage(node.id, "/stormlog/watch/version/request", ByteArray(0)),
        5,
        TimeUnit.SECONDS,
      )

      mapOf("connected" to true, "nodeId" to node.id, "nodeName" to node.displayName)
    }

    Function("hasExactAlarmPermission") {
      StormLogAlarmScheduler.hasExactAlarmPermission(requireNotNull(appContext.reactContext))
    }
  }
}
