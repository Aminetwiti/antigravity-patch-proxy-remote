// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get appTitle => 'Antigravity Remote';

  @override
  String get notConnectedToDaemon => '⚠️ Non connecté au serveur daemon';

  @override
  String get creatingNewConversation => 'Création de la nouvelle conversation...';

  @override
  String newConversationOpened(String id) {
    return '✨ Nouvelle conversation ouverte ($id)';
  }

  @override
  String failedToCreateSession(String error) {
    return '❌ Échec création session: $error';
  }

  @override
  String get conversationRestored => 'Conversation restaurée';

  @override
  String restoreError(String error) {
    return 'Erreur lors de la restauration: $error';
  }

  @override
  String get conversationDeleted => 'Conversation supprimée';

  @override
  String get conversationArchived => 'Conversation archivée';

  @override
  String get conversationRenamed => 'Conversation renommée';

  @override
  String get markdownCopied => 'Markdown de la conversation copié !';

  @override
  String get noContentToExport => 'Aucun contenu à exporter';

  @override
  String get lanSearchRestarted => 'Recherche réseau relancée…';

  @override
  String get defaultSessionTitle => 'Session';

  @override
  String get discoverDaemonsTitle => 'Découvrir les Daemons';

  @override
  String get oneTapConnect => '1-Tap Connect';

  @override
  String get hostPcDomain => 'Hôte PC / Domaine';

  @override
  String get daemonPort => 'Port Daemon';

  @override
  String get pinCodeLabel => 'Code PIN (6 chiffres affichés sur PC)';

  @override
  String get validatePin => 'Valider PIN';

  @override
  String get authTokenLabel => 'Token Auth (optionnel ou obtenu via PIN)';

  @override
  String get manualConnection => 'Connexion Manuelle';

  @override
  String get savedConnections => 'Connexions Enregistrées';

  @override
  String get noDaemonFound => 'Aucun daemon détecté sur le réseau local';

  @override
  String get connect => 'Connecter';

  @override
  String get connecting => 'Connexion en cours...';

  @override
  String get connectionError => 'Erreur de connexion';

  @override
  String get accessChat => 'Accéder au Chat';

  @override
  String get scanQrCode => 'Scanner QR Code';

  @override
  String agentDeleted(String name) {
    return 'Agent \"$name\" supprimé.';
  }

  @override
  String get settingsTitle => 'Paramètres';

  @override
  String get shortcuts => 'Raccourcis';

  @override
  String get provideFeedback => 'Donner un avis';

  @override
  String get appearance => 'Apparence';

  @override
  String get themeDark => 'Sombre';

  @override
  String get themeLight => 'Clair';

  @override
  String get themeSystem => 'Système';

  @override
  String get language => 'Langue';

  @override
  String get profile => 'Profil';

  @override
  String get diagnostics => 'Diagnostics';

  @override
  String get exportDiagnostics => 'Exporter les diagnostics';

  @override
  String get clearCache => 'Vider le cache';

  @override
  String get cacheCleared => 'Cache vidé avec succès';

  @override
  String get close => 'Fermer';

  @override
  String get cancel => 'Annuler';

  @override
  String get save => 'Enregistrer';

  @override
  String get delete => 'Supprimer';

  @override
  String get confirm => 'Confirmer';
}
