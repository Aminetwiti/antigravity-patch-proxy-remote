package com.antigravity.remote.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Relance le service de keep-alive après un redémarrage du téléphone :
 * l'utilisateur qui revient retrouve une notification « Connexion maintenue »
 * et l'app se reconnecte automatiquement à la session persistée au
 * lancement (SettingsStore.loadSession < 24 h).
 *
 * ponytail: pas de vérification d'une préférence « reconnect auto » — le
 * service est inoffensif sans session (il affiche la notification et attend).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Keep-alive permanent notification disabled
    }
}
