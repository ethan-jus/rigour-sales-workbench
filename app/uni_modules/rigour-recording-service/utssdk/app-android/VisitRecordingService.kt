package com.rigour.workbench.capture

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

/** Keeps microphone access across visit recording segments; never restarts a stale recording. */
class VisitRecordingService : Service() {
    companion object {
        private const val CHANNEL = "rigour_visit_recording"
        private const val NOTIFICATION = 2101
        private var requested = false
        @JvmStatic fun start(context: Context) {
            if (requested) return
            requested = true
            try {
                val intent = Intent(context, VisitRecordingService::class.java)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (failure: RuntimeException) { requested = false; throw failure }
        }
        @JvmStatic fun stop(context: Context) {
            requested = false
            context.stopService(Intent(context, VisitRecordingService::class.java))
        }
    }
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "拜访录音", NotificationManager.IMPORTANCE_LOW))
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        builder.setSmallIcon(applicationInfo.icon).setContentTitle("拜访录音进行中")
            .setContentText("返回销售工作台查看或结束拜访").setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIFICATION, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(NOTIFICATION, builder.build())
        if (!requested) stopSelf()
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() { requested = false; super.onDestroy() }
}
