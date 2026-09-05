package com.stormlog.scheduler

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class StormLogHeadlessTaskService : HeadlessJsTaskService() {
  companion object {
    private const val CHANNEL_ID = "stormlog_daily_monitor_worker"
    private const val NOTIFICATION_ID = 41017
  }

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "StormLog Daily Collection",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "Shown briefly while StormLog collects an automatic observation."
          setShowBadge(false)
        },
      )
    }

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("StormLog Daily Monitor")
      .setContentText("Collecting weather observation…")
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    startForeground(NOTIFICATION_ID, notification)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras: Bundle = intent?.extras ?: Bundle()
    return HeadlessJsTaskConfig(
      "StormLogDailyMonitorHeadless",
      Arguments.fromBundle(extras),
      120_000,
      true,
    )
  }

  override fun onDestroy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }
}
