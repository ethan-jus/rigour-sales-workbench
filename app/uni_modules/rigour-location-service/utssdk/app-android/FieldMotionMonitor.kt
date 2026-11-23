package com.rigour.workbench.capture

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.abs
import kotlin.math.sqrt

/** Motion evidence only. Position and distance always come from GNSS. */
internal class FieldMotionMonitor(private val manager: SensorManager) : SensorEventListener {
    private var baseline = 0f
    private var firstSample = 0L
    private var lastSample = 0L
    private var lastPulse = 0L
    private var lastMotion = 0L

    fun start() {
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        manager.registerListener(this, accelerometer, 100_000)
    }

    fun stop() = manager.unregisterListener(this)

    fun state(): Int {
        val now = SystemClock.elapsedRealtime()
        if (lastSample == 0L || now - lastSample > 1_500) return -1
        if (lastMotion != 0L && now - lastMotion <= 2_000) return 1
        return if (now - maxOf(firstSample, lastPulse) >= 6_000) 0 else -1
    }

    override fun onSensorChanged(event: SensorEvent) {
        val at = event.timestamp / 1_000_000
        val (x, y, z) = event.values
        val magnitude = sqrt(x * x + y * y + z * z)
        if (lastSample == 0L || at - lastSample > 1_500) {
            baseline = magnitude
            firstSample = at
            lastPulse = 0
            lastMotion = 0
        }
        lastSample = at
        val deviation = magnitude - baseline
        baseline += deviation * 0.05f
        if (abs(deviation) < 0.65f) return
        if (lastPulse != 0L && at - lastPulse < 230) return
        if (lastPulse != 0L && at - lastPulse <= 1_400) lastMotion = at
        lastPulse = at
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
