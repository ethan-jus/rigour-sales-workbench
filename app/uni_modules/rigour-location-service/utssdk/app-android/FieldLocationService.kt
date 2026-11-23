package com.rigour.workbench.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder

/** Keeps the current authorized fieldwork subscription in the foreground. */
class FieldLocationService : Service() {
    companion object {
        private const val CHANNEL = "rigour_field_location"
        private const val NOTIFICATION = 2102
        private var requested = false
        private var motionEnabled = false
        private var instance: FieldLocationService? = null
        @JvmStatic fun enableMotion(enabled: Boolean) {
            motionEnabled = enabled
            instance?.updateMotion()
        }
        @JvmStatic fun motionState(): Int = instance?.motion?.state() ?: -1
        @JvmStatic fun start(context: Context) {
            if (requested) return
            requested = true
            try {
                val intent = Intent(context, FieldLocationService::class.java)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (failure: RuntimeException) { requested = false; throw failure }
        }
        @JvmStatic fun stop(context: Context) {
            requested = false
            context.stopService(Intent(context, FieldLocationService::class.java))
        }
    }
    private var motion: FieldMotionMonitor? = null

    private fun updateMotion() {
        if (motionEnabled && motion == null) {
            val sensors = getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
            motion = FieldMotionMonitor(sensors).also { it.start() }
        } else if (!motionEnabled) {
            motion?.stop()
            motion = null
        }
    }
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "外勤定位", NotificationManager.IMPORTANCE_LOW))
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        builder.setSmallIcon(applicationInfo.icon).setContentTitle("外勤定位进行中")
            .setContentText("按当前作业规则记录行程，签退后停止").setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(NOTIFICATION, builder.build())
        instance = this
        if (requested) updateMotion() else stopSelf()
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        motion?.stop()
        instance = null
        requested = false
        super.onDestroy()
    }
}
