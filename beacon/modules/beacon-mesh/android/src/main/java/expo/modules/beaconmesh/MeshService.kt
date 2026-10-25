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
 * or Beacon is not on screen. Android requires a visible (low-priority) notification for this.
 */
class MeshService : Service() {
  companion object {
    private const val CHANNEL = "beacon_mesh"
    private const val NOTIF_ID = 4711

    fun start(ctx: Context) {
      val i = Intent(ctx, MeshService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, MeshService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
      .setContentTitle("Beacon is connecting nearby phones")
      .setContentText("Messages and SOS can hop between phones with no internet.")
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    else startForeground(NOTIF_ID, n)
    return START_STICKY
  }
}
