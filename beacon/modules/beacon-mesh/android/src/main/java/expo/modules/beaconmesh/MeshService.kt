package expo.modules.beaconmesh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the process alive while the mesh is running, so phones keep relaying for each other when the screen is off
 * or Beacon is not on screen. Android requires a visible (low-priority) notification for this, and on Android 14
 * the foreground service type "connectedDevice" plus a granted Bluetooth permission.
 */
class MeshService : Service() {
  companion object {
    private const val CHANNEL = "beacon_mesh"
    private const val NOTIF_ID = 4711

    /** true between a successful startForeground and onDestroy; read by the self-test screen */
    @Volatile var running = false
    @Volatile var lastError: String? = null

    /** Returns null on success, or the reason the service could not be started. */
    fun start(ctx: Context): String? {
      return try {
        val i = Intent(ctx, MeshService::class.java)
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        null
      } catch (e: Throwable) {
        val msg = "foreground service: ${e.javaClass.simpleName} ${e.message ?: ""}".trim()
        lastError = msg
        msg
      }
    }

    fun stop(ctx: Context) {
      runCatching { ctx.stopService(Intent(ctx, MeshService::class.java)) }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // startForeground must happen within seconds of startForegroundService, so do it as early as possible
  override fun onCreate() {
    super.onCreate()
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Nearby mesh", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Beacon relays messages between nearby phones"
          setShowBadge(false)
        })
      }
      val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
        PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
      val n = builder
        .setContentTitle("Beacon is connecting nearby phones · पास के फ़ोन जुड़ रहे हैं")
        .setContentText("Messages and SOS hop between phones with no internet. · बिना इंटरनेट संदेश फ़ोन से फ़ोन पहुँचते हैं।")
        .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
        .setOngoing(true)
        .setContentIntent(open)
        .build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      else startForeground(NOTIF_ID, n)
      running = true
      lastError = null
    } catch (e: Throwable) {
      // Android 14 throws SecurityException without a granted Bluetooth permission, Android 12+ refuses
      // background starts: report it instead of crashing the app
      lastError = "startForeground: ${e.javaClass.simpleName} ${e.message ?: ""}".trim()
      running = false
      stopSelf()
    }
  }

  // not sticky: after a process kill nothing would drive the radio, so a lone notification would lie
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }
}
