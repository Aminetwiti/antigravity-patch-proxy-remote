package com.antigravity.remote.mobile

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Notification permanente de keep-alive désactivée à la demande de l'utilisateur.
        ConnectionKeepAliveService.stop(this)
    }

    override fun onDestroy() {
        super.onDestroy()
    }
}
