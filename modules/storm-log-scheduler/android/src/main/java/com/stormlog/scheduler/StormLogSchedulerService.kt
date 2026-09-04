package com.stormlog.scheduler

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class StormLogSchedulerService : Service() {
  companion object {
    const val ACTION_START = "com.stormlog.scheduler.START"
    const val ACTION_STOP = "com.stormlog.scheduler.STOP"
    const val EXTRA_INTERVAL_MINUTES = "intervalMinutes"
    private const val PREFS = "stormlog_daily_monitor_scheduler"
    private const val INTERVAL_KEY = "interval_minutes"
    private const val ENABLED_KEY = "enabled"
    private const val CHANNEL_ID = "stormlog_daily_monitor"
    private const val NOTIFICATION_ID = 41015
    private const val DEFAULT_INTERVAL_MINUTES = 15

    @Volatile
    var isRunning: Boolean = false
      private set

    fun isEnabled(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getBoolean(ENABLED_KEY, false)

    fun getStoredIntervalMinutes(context: Context): Int =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getInt(INTERVAL_KEY, DEFAULT_INTERVAL_MINUTES)
        .coerceAtLeast(1)

    fun start(context: Context, intervalMinutes: Int) {
      val safeInterval = intervalMinutes.coerceAtLeast(1)
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(ENABLED_KEY, true)
        .putInt(INTERVAL_KEY, safeInterval)
        .apply()

      val intent = Intent(context, StormLogSchedulerService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_INTERVAL_MINUTES, safeInterval)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(ENABLED_KEY, false)
        .apply()
      cancelAlarm(context)
      context.stopService(Intent(context, StormLogSchedulerService::class.java))
    }

    fun scheduleNextAlarm(context: Context, intervalMinutes: Int) {
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

      val exactAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
      if (exactAllowed) {
        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextBoundary, pendingIntent)
      } else {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextBoundary, pendingIntent)
      }

      android.util.Log.d(
        "StormLogScheduler",
        "Daily Monitor alarm scheduled for $nextBoundary (interval=${safeInterval}m, exact=$exactAllowed)"
      )
    }

    private fun cancelAlarm(context: Context) {
      val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
      alarmManager.cancel(StormLogSchedulerAlarmReceiver.pendingIntent(context))
    }
  }

  private var intervalMinutes = DEFAULT_INTERVAL_MINUTES

  override fun onCreate() {
    super.onCreate()
    intervalMinutes = getStoredIntervalMinutes(this)
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    isRunning = true
    scheduleNextAlarm(this, intervalMinutes)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stop(this)
      stopSelf()
      return START_NOT_STICKY
    }

    if (!isEnabled(this)) {
      stopSelf()
      return START_NOT_STICKY
    }

    val requestedInterval = intent?.getIntExtra(EXTRA_INTERVAL_MINUTES, 0) ?: 0
    if (requestedInterval > 0 && requestedInterval != intervalMinutes) {
      intervalMinutes = requestedInterval
      getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt(INTERVAL_KEY, intervalMinutes)
        .apply()
      val manager = getSystemService(NotificationManager::class.java)
      manager.notify(NOTIFICATION_ID, buildNotification())
    }

    scheduleNextAlarm(this, intervalMinutes)
    isRunning = true
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Keep the OS-owned alarm armed even if the user removes the app task.
    if (isEnabled(this)) scheduleNextAlarm(this, intervalMinutes)
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    isRunning = false
    // Android may restart this START_STICKY service. The already-armed alarm is
    // intentionally preserved while monitoring remains enabled.
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "StormLog Daily Monitor",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Keeps StormLog's field observation scheduler active."
        setShowBadge(false)
      }
    )
  }

  private fun buildNotification(): Notification =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("StormLog Daily Monitor")
      .setContentText("Daily Monitor active — collecting every $intervalMinutes min")
      .setSmallIcon(android.R.drawable.ic_menu_myplaces)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
}
