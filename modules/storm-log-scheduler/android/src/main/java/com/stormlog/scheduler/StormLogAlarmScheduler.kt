package com.stormlog.scheduler

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Single Android owner for Daily Monitor timing.
 *
 * This deliberately does NOT keep a foreground service or React Native process
 * alive between observations. AlarmManager owns the clock; each alarm wakes a
 * short-lived headless collection and immediately re-arms the next boundary.
 */
object StormLogAlarmScheduler {
  private const val PREFS = "stormlog_daily_monitor_scheduler"
  private const val INTERVAL_KEY = "interval_minutes"
  private const val ENABLED_KEY = "enabled"
  private const val NEXT_ALARM_AT_KEY = "next_alarm_at"
  private const val DEFAULT_INTERVAL_MINUTES = 15
  private const val CHANNEL_ID = "stormlog_daily_monitor"
  private const val NOTIFICATION_ID = 41015

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getBoolean(ENABLED_KEY, false)

  fun getStoredIntervalMinutes(context: Context): Int =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(INTERVAL_KEY, DEFAULT_INTERVAL_MINUTES)
      .coerceAtLeast(1)

  fun hasExactAlarmPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return false
    return alarmManager.canScheduleExactAlarms()
  }

  fun start(context: Context, intervalMinutes: Int) {
    val safeInterval = intervalMinutes.coerceAtLeast(1)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(ENABLED_KEY, true)
      .putInt(INTERVAL_KEY, safeInterval)
      .apply()

    postStatusNotification(context, safeInterval)
    scheduleNext(context, safeInterval)
  }

  fun restore(context: Context) {
    if (!isEnabled(context)) return
    val intervalMinutes = getStoredIntervalMinutes(context)
    postStatusNotification(context, intervalMinutes)
    scheduleNext(context, intervalMinutes)
  }

  fun stop(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(ENABLED_KEY, false)
      .remove(NEXT_ALARM_AT_KEY)
      .apply()
    cancelAlarm(context)
    context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
  }

  fun scheduleNext(context: Context, intervalMinutes: Int = getStoredIntervalMinutes(context)) {
    if (!isEnabled(context)) {
      cancelAlarm(context)
      return
    }

    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
    val safeInterval = intervalMinutes.coerceAtLeast(1)
    val intervalMs = safeInterval.toLong() * 60_000L
    val now = System.currentTimeMillis()
    val nextBoundary = ((now / intervalMs) + 1L) * intervalMs
    val pendingIntent = StormLogSchedulerAlarmReceiver.pendingIntent(context)
    val exactAllowed = hasExactAlarmPermission(context)

    // Exact permission is the reliable path. The inexact fallback exists only
    // so monitoring degrades instead of silently stopping while the user grants
    // special access; app state exposes permission so this is never mistaken for
    // guaranteed 15-minute timing.
    if (exactAllowed) {
      alarmManager.setExactAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        nextBoundary,
        pendingIntent,
      )
    } else {
      alarmManager.setAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        nextBoundary,
        pendingIntent,
      )
    }

    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putLong(NEXT_ALARM_AT_KEY, nextBoundary)
      .apply()

    android.util.Log.i(
      "StormLogScheduler",
      "Alarm armed for $nextBoundary (interval=${safeInterval}m, exact=$exactAllowed)",
    )
  }

  fun hasScheduledAlarm(context: Context): Boolean {
    if (!isEnabled(context)) return false
    val pending = PendingIntent.getBroadcast(
      context,
      StormLogSchedulerAlarmReceiver.REQUEST_CODE,
      StormLogSchedulerAlarmReceiver.intent(context),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
    )
    return pending != null
  }

  private fun cancelAlarm(context: Context) {
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
    alarmManager.cancel(StormLogSchedulerAlarmReceiver.pendingIntent(context))
  }

  private fun postStatusNotification(context: Context, intervalMinutes: Int) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "StormLog Daily Monitor",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "Shows that StormLog automatic field observations are enabled."
          setShowBadge(false)
        },
      )
    }

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle("StormLog Daily Monitor")
      .setContentText("Automatic observations enabled — every $intervalMinutes min")
      .setSmallIcon(android.R.drawable.ic_menu_myplaces)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    manager.notify(NOTIFICATION_ID, notification)
  }
}
