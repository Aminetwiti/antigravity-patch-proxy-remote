package com.antigravity.remote.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock

/**
 * Service foreground qui garde le lien avec le daemon vivant quand l'app est
 * swipée (task removed) ou en arrière-plan complet.
 *
 * Limite plateforme (documentée) : le Dart VM de Flutter est tué avec le
 * process → ce service NATIF Kotlin est le seul moyen fiable de rester
 * notifié. Il ne transporte pas le WebSocket lui-même (le daemon ferme les
 * connexions inactives) : il relance l'activité principale au boot / au
 * tap sur la notification, et l'app se reconnecte alors automatiquement à la
 * session persistée (SettingsStore.loadSession < 24 h).
 *
 * ponytail: pas de vraie connexion réseau ici — relance + persistance côté
 * Flutter. Un vrai socket natif (OkHttp) serait plus robuste mais ajoute une
 * dépendance ; ce niveau couvre le cas « app fermée → notification → tap →
 * reconnexion directe » demandé. Certains OEM (Xiaomi/Huawei) tuent les
 * services malgré START_STICKY — plafond plateforme documenté.
 */
class ConnectionKeepAliveService : Service() {

    companion object {
        const val CHANNEL_ID = "connection_keepalive"
        const val NOTIF_ID = 0x4B41 // 'KA'
        private const val WAKELOCK_TAG = "antigravity:keepalive"
        private const val WAKELOCK_TIMEOUT_MS = 120_000L

        fun start(context: Context) {
            val intent = Intent(context, ConnectionKeepAliveService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ConnectionKeepAliveService::class.java))
        }
    }

    private var wakelock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakelock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
            setReferenceCounted(false)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        // Petit réveil réseau toutes les 2 min : le ping Dart 20 s s'arrête
        // quand le process est tué, mais ce wakelock temporaire permet au
        // process relancé (START_STICKY) de re-tenter la connexion à la
        // session persistée. ponytail: 2 min fixe — la fréquence réelle est
        // contrainte par les OEM; upgrade = WorkManager périodique.
        wakelock?.acquire(WAKELOCK_TIMEOUT_MS)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swipe de l'app : on se relance nous-mêmes (START_STICKY ne suffit
        // pas toujours pour un service foreground stoppé par le système).
        val restart = Intent(applicationContext, ConnectionKeepAliveService::class.java)
        restart.setPackage(packageName)
        startService(restart)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        wakelock?.let {
            if (it.isHeld) it.release()
        }
        wakelock = null
        super.onDestroy()
    }

    private fun startForegroundCompat() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val largeIcon = try {
            BitmapFactory.decodeResource(resources, R.mipmap.launcher_icon)
        } catch (_: Exception) {
            null
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        
        builder
            .setSmallIcon(R.drawable.ic_service_notification)
            .setContentTitle("Antigravity Remote")
            .setContentText("Connexion maintenue — touchez pour rouvrir")
            .setContentIntent(pending)
            .setOngoing(true)
            .setShowWhen(false)
            .setColor(0xFF3186FF.toInt())

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon)
        }

        return builder.build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Connexion Antigravity",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Maintient la connexion au daemon en arrière-plan"
            setShowBadge(false)
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }
}
