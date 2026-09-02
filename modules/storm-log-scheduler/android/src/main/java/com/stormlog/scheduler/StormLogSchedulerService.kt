package com.stormlog.scheduler

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService

class StormLogSchedulerService : Service() {
  companion object {
    const val ACTION_START = "com.stormlog.scheduler.START"
    const val ACTION_STOP = "com.stormlog.scheduler.STOP"
    const val EXTRA_INTERVAL_MINUTES = "intervalMinutes"
    private const val PREFS = "stormlog_daily_monitor_scheduler"
    private const val INTERVAL_KEY = "interval_minutes"
    private const val CHANNEL_ID = "stormlog_daily_monitor"
    private const val NOTIFICATION_ID = 41015
    private const val DEFAULT_INTERVAL_MINUTES = 15

    @Volatile
    var isRunning: Boolean = false
      private set

    fun start(context: Context, intervalMinutes: Int) {
      val safeInterval = intervalMinutes.coerceAtLeast(1)
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
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
      cancelExactAlarm(context)
      context.stopService(Intent(context, StormLogSchedulerService::class.java))
    }

    fun scheduleNextExactAlarm(context: Context, intervalMinutes: Int) {
      val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
        android.util.Log.w("StormLogScheduler", "Exact alarm permission unavailable; Handler fallback remains active")
        return
      }

      val safeInterval = intervalMinutes.coerceAtLeast(1)
      val intervalMs = safeInterval.toLong() * 60_000L
      val now = System.currentTimeMillis()
      val nextBoundary = ((now / intervalMs) + 1L) * intervalMs
      val pendingIntent = StormLogSchedulerAlarmReceiver.pendingIntent(context)
      alarmManager.setExactAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        nextBoundary,
        pendingIntent
      )
      android.util.Log.d(
        "StormLogScheduler",
        "Exact Daily Monitor alarm scheduled for $nextBoundary (interval=${safeInterval}m)"
      )
    }

    private fun cancelExactAlarm(context: Context) {
      val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
      alarmManager.cancel(StormLogSchedulerAlarmReceiver.pendingIntent(context))
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var intervalMinutes = DEFAULT_INTERVAL_MINUTES

  private val fallbackTick = object : Runnable {
    override fun run() {
      if (!isRunning) return

      val nowMs = System.currentTimeMillis()
      val intervalMs = intervalMinutes.coerceAtLeast(1).toLong() * 60_000L
      val scheduledAt = (nowMs / intervalMs) * intervalMs
      val triggerIntent = Intent(this@StormLogSchedulerService, StormLogHeadlessTaskService::class.java).apply {
        putExtra("scheduledAt", scheduledAt)
        putExtra("intervalMinutes", intervalMinutes)
        putExtra("source", "handler_fallback")
      }

      try {
        HeadlessJsTaskService.acquireWakeLockNow(this@StormLogSchedulerService)
        startService(triggerIntent)
      } catch (error: Exception) {
        android.util.Log.e("StormLogScheduler", "Handler fallback collection launch failed", error)
      }

      scheduleNext()
    }
  }

  override fun onCreate() {
    super.onCreate()
    intervalMinutes = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(INTERVAL_KEY, DEFAULT_INTERVAL_MINUTES)
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    isRunning = true
    scheduleNext()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
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
      scheduleNext()
    }

    isRunning = true
    return START_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun scheduleNext() {
    handler.removeCallbacks(fallbackTick)
    if (canScheduleExactAlarms()) {
      scheduleNextExactAlarm(this, intervalMinutes)
      return
    }

    val now = System.currentTimeMillis()
    val intervalMs = intervalMinutes.coerceAtLeast(1).toLong() * 60_000L
    val next = ((now / intervalMs) + 1L) * intervalMs
    val delay = (next - now).coerceAtLeast(1_000L)
    android.util.Log.d(
      "StormLogScheduler",
      "Exact alarms unavailable; Handler fallback boundary: $next (in ${delay}ms, interval=${intervalMinutes}m)"
    )
    handler.postDelayed(fallbackTick, delay)
  }

  private fun canScheduleExactAlarms(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "StormLog Daily Monitor",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Keeps StormLog's precise field observation scheduler active."
      }
    )
  }

  private fun buildNotification(): Notification {
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("StormLog Daily Monitor")
      .setContentText("Automatic observations scheduled every $intervalMinutes minutes")
      .setSmallIcon(android.R.drawable.ic_menu_myplaces)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }
}
