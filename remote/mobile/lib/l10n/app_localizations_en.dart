// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Antigravity Remote';

  @override
  String get notConnectedToDaemon => '⚠️ Not connected to daemon server';

  @override
  String get creatingNewConversation => 'Creating new conversation...';

  @override
  String newConversationOpened(String id) {
    return '✨ New conversation opened ($id)';
  }

  @override
  String failedToCreateSession(String error) {
    return '❌ Failed to create session: $error';
  }

  @override
  String get conversationRestored => 'Conversation restored';

  @override
  String restoreError(String error) {
    return 'Error during restoration: $error';
  }

  @override
  String get conversationDeleted => 'Conversation deleted';

  @override
  String get conversationArchived => 'Conversation archived';

  @override
  String get conversationRenamed => 'Conversation renamed';

  @override
  String get markdownCopied => 'Conversation Markdown copied!';

  @override
  String get noContentToExport => 'No content to export';

  @override
  String get lanSearchRestarted => 'LAN discovery restarted…';

  @override
  String get defaultSessionTitle => 'Session';

  @override
  String get discoverDaemonsTitle => 'Discover Daemons';

  @override
  String get oneTapConnect => '1-Tap Connect';

  @override
  String get hostPcDomain => 'Host PC / Domain';

  @override
  String get daemonPort => 'Daemon Port';

  @override
  String get pinCodeLabel => 'PIN Code (6 digits shown on PC)';

  @override
  String get validatePin => 'Validate PIN';

  @override
  String get authTokenLabel => 'Auth Token (optional or obtained via PIN)';

  @override
  String get manualConnection => 'Manual Connection';

  @override
  String get savedConnections => 'Saved Connections';

  @override
  String get noDaemonFound => 'No daemon found on local network';

  @override
  String get connect => 'Connect';

  @override
  String get connecting => 'Connecting...';

  @override
  String get connectionError => 'Connection Error';

  @override
  String get accessChat => 'Access Chat';

  @override
  String get scanQrCode => 'Scan QR Code';

  @override
  String agentDeleted(String name) {
    return 'Agent \"$name\" deleted.';
  }

  @override
  String get settingsTitle => 'Settings';

  @override
  String get shortcuts => 'Shortcuts';

  @override
  String get provideFeedback => 'Provide Feedback';

  @override
  String get appearance => 'Appearance';

  @override
  String get themeDark => 'Dark';

  @override
  String get themeLight => 'Light';

  @override
  String get themeSystem => 'System';

  @override
  String get language => 'Language';

  @override
  String get profile => 'Profile';

  @override
  String get diagnostics => 'Diagnostics';

  @override
  String get exportDiagnostics => 'Export Diagnostics';

  @override
  String get clearCache => 'Clear Cache';

  @override
  String get cacheCleared => 'Cache cleared successfully';

  @override
  String get close => 'Close';

  @override
  String get cancel => 'Cancel';

  @override
  String get save => 'Save';

  @override
  String get delete => 'Delete';

  @override
  String get confirm => 'Confirm';
}
