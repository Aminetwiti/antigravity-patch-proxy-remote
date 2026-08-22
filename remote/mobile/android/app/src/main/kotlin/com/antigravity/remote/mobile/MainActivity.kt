package com.antigravity.remote.mobile

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Démarre le foreground service de keep-alive dès le lancement de
        // l'app : la notification permanente « Connexion maintenue » reste
        // affichée quand l'app est swipée, et START_STICKY relance le
        // process pour re-tenter la connexion à la session persistée.
        ConnectionKeepAliveService.start(this)
    }

    override fun onDestroy() {
        // L'app se ferme (back) : on laisse le service tourner — il sera
        // relancé au prochain lancement par configureFlutterEngine.
        super.onDestroy()
    }
}
