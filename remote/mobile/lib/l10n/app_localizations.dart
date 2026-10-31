import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_fr.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('fr')
  ];

  /// Titre principal de l'application
  ///
  /// In fr, this message translates to:
  /// **'Antigravity Remote'**
  String get appTitle;

  /// Message affiché lorsque le client WebSocket n'est pas connecté
  ///
  /// In fr, this message translates to:
  /// **'⚠️ Non connecté au serveur daemon'**
  String get notConnectedToDaemon;

  /// Message temporaire pendant la création d'une session
  ///
  /// In fr, this message translates to:
  /// **'Création de la nouvelle conversation...'**
  String get creatingNewConversation;

  /// Notification de nouvelle conversation
  ///
  /// In fr, this message translates to:
  /// **'✨ Nouvelle conversation ouverte ({id})'**
  String newConversationOpened(String id);

  /// Erreur lors de la création d'une session
  ///
  /// In fr, this message translates to:
  /// **'❌ Échec création session: {error}'**
  String failedToCreateSession(String error);

  /// Message de restauration de conversation
  ///
  /// In fr, this message translates to:
  /// **'Conversation restaurée'**
  String get conversationRestored;

  /// Erreur de restauration de conversation
  ///
  /// In fr, this message translates to:
  /// **'Erreur lors de la restauration: {error}'**
  String restoreError(String error);

  /// Message de suppression de conversation
  ///
  /// In fr, this message translates to:
  /// **'Conversation supprimée'**
  String get conversationDeleted;

  /// Message d'archivage de conversation
  ///
  /// In fr, this message translates to:
  /// **'Conversation archivée'**
  String get conversationArchived;

  /// Message de renommage de conversation
  ///
  /// In fr, this message translates to:
  /// **'Conversation renommée'**
  String get conversationRenamed;

  /// Confirmation de copie du Markdown
  ///
  /// In fr, this message translates to:
  /// **'Markdown de la conversation copié !'**
  String get markdownCopied;

  /// Avertissement export vide
  ///
  /// In fr, this message translates to:
  /// **'Aucun contenu à exporter'**
  String get noContentToExport;

  /// Notification de redémarrage de la recherche LAN UDP
  ///
  /// In fr, this message translates to:
  /// **'Recherche réseau relancée…'**
  String get lanSearchRestarted;

  /// Titre de session par défaut
  ///
  /// In fr, this message translates to:
  /// **'Session'**
  String get defaultSessionTitle;

  /// Titre de l'écran de découverte
  ///
  /// In fr, this message translates to:
  /// **'Découvrir les Daemons'**
  String get discoverDaemonsTitle;

  /// Bouton de connexion en un clic
  ///
  /// In fr, this message translates to:
  /// **'1-Tap Connect'**
  String get oneTapConnect;

  /// Label du champ hôte ou domaine
  ///
  /// In fr, this message translates to:
  /// **'Hôte PC / Domaine'**
  String get hostPcDomain;

  /// Label du champ port daemon
  ///
  /// In fr, this message translates to:
  /// **'Port Daemon'**
  String get daemonPort;

  /// Label du code PIN
  ///
  /// In fr, this message translates to:
  /// **'Code PIN (6 chiffres affichés sur PC)'**
  String get pinCodeLabel;

  /// Bouton de validation du PIN
  ///
  /// In fr, this message translates to:
  /// **'Valider PIN'**
  String get validatePin;

  /// Label du token d'authentification
  ///
  /// In fr, this message translates to:
  /// **'Token Auth (optionnel ou obtenu via PIN)'**
  String get authTokenLabel;

  /// Onglet ou bouton de connexion manuelle
  ///
  /// In fr, this message translates to:
  /// **'Connexion Manuelle'**
  String get manualConnection;

  /// Titre de la section des connexions enregistrées
  ///
  /// In fr, this message translates to:
  /// **'Connexions Enregistrées'**
  String get savedConnections;

  /// Message lorsque aucun serveur n'est découvert
  ///
  /// In fr, this message translates to:
  /// **'Aucun daemon détecté sur le réseau local'**
  String get noDaemonFound;

  /// Bouton pour lancer la connexion
  ///
  /// In fr, this message translates to:
  /// **'Connecter'**
  String get connect;

  /// Indicateur de connexion en cours
  ///
  /// In fr, this message translates to:
  /// **'Connexion en cours...'**
  String get connecting;

  /// Erreur de connexion générique
  ///
  /// In fr, this message translates to:
  /// **'Erreur de connexion'**
  String get connectionError;

  /// Bouton pour aller à l'interface de chat
  ///
  /// In fr, this message translates to:
  /// **'Accéder au Chat'**
  String get accessChat;

  /// Bouton pour ouvrir le scanner de QR Code
  ///
  /// In fr, this message translates to:
  /// **'Scanner QR Code'**
  String get scanQrCode;

  /// Notification de suppression d'agent
  ///
  /// In fr, this message translates to:
  /// **'Agent \"{name}\" supprimé.'**
  String agentDeleted(String name);

  /// Titre de l'écran des paramètres
  ///
  /// In fr, this message translates to:
  /// **'Paramètres'**
  String get settingsTitle;

  /// Section raccourcis clavier
  ///
  /// In fr, this message translates to:
  /// **'Raccourcis'**
  String get shortcuts;

  /// Action pour envoyer un retour utilisateur
  ///
  /// In fr, this message translates to:
  /// **'Donner un avis'**
  String get provideFeedback;

  /// Section apparence et thèmes
  ///
  /// In fr, this message translates to:
  /// **'Apparence'**
  String get appearance;

  /// Option thème sombre
  ///
  /// In fr, this message translates to:
  /// **'Sombre'**
  String get themeDark;

  /// Option thème clair
  ///
  /// In fr, this message translates to:
  /// **'Clair'**
  String get themeLight;

  /// Option thème automatique système
  ///
  /// In fr, this message translates to:
  /// **'Système'**
  String get themeSystem;

  /// Option de sélection de langue
  ///
  /// In fr, this message translates to:
  /// **'Langue'**
  String get language;

  /// Section profil
  ///
  /// In fr, this message translates to:
  /// **'Profil'**
  String get profile;

  /// Section diagnostics et santé
  ///
  /// In fr, this message translates to:
  /// **'Diagnostics'**
  String get diagnostics;

  /// Bouton d'export des diagnostics
  ///
  /// In fr, this message translates to:
  /// **'Exporter les diagnostics'**
  String get exportDiagnostics;

  /// Bouton pour vider le cache persistant
  ///
  /// In fr, this message translates to:
  /// **'Vider le cache'**
  String get clearCache;

  /// Confirmation du vidage de cache
  ///
  /// In fr, this message translates to:
  /// **'Cache vidé avec succès'**
  String get cacheCleared;

  /// Bouton fermer
  ///
  /// In fr, this message translates to:
  /// **'Fermer'**
  String get close;

  /// Bouton annuler
  ///
  /// In fr, this message translates to:
  /// **'Annuler'**
  String get cancel;

  /// Bouton enregistrer
  ///
  /// In fr, this message translates to:
  /// **'Enregistrer'**
  String get save;

  /// Bouton supprimer
  ///
  /// In fr, this message translates to:
  /// **'Supprimer'**
  String get delete;

  /// Bouton de confirmation
  ///
  /// In fr, this message translates to:
  /// **'Confirmer'**
  String get confirm;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'fr'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {


  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en': return AppLocalizationsEn();
    case 'fr': return AppLocalizationsFr();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.'
  );
}
