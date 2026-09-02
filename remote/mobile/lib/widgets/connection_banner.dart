import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/network/websocket_client.dart';

/// Bannière premium de perte/reprise de connexion.
///
/// Affiche l'état réseau avec un compte à rebours animé avant la prochaine
/// tentative de reconnexion (backoff exponentiel piloté par le client WS) :
///   - Offline   → « Connexion perdue · reconnexion dans 8s (3e tentative) »
///   - Connecting→ « Reconnexion en cours… » avec spinner
///   - Error     → « Erreur réseau » + bouton Réessayer immédiat
///
/// Le banner est animé (slide + fade à l'apparition) et propose un bouton
/// « Réessayer » pour ne pas subir le backoff quand on sait que le réseau est
/// revenu. Un bouton « Masquer » le replie (réapparaît à la prochaine coupe).
class ConnectionBanner extends StatefulWidget {
  final ConnectionStatus status;
  final int attempt;
  final Duration nextRetryIn;
  final bool isManualDisconnect;
  final VoidCallback? onRetry;

  const ConnectionBanner({
    super.key,
    required this.status,
    required this.attempt,
    required this.nextRetryIn,
    this.isManualDisconnect = false,
    this.onRetry,
  });

  @override
  State<ConnectionBanner> createState() => _ConnectionBannerState();
}

class _ConnectionBannerState extends State<ConnectionBanner> {
  bool _dismissed = false;

  @override
  void didUpdateWidget(covariant ConnectionBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Réapparaît dès qu'on repasse en ligne (nouvelle session de panne).
    if (widget.status == ConnectionStatus.connected) {
      if (oldWidget.status != ConnectionStatus.connected) {
        HapticFeedback.mediumImpact();
      }
      _dismissed = false;
    }
  }

  String get _title {
    switch (widget.status) {
      case ConnectionStatus.connected:
        return 'Connecté au daemon';
      case ConnectionStatus.connecting:
        return 'Reconnexion en cours…';
      case ConnectionStatus.error:
        return 'Erreur réseau';
      case ConnectionStatus.disconnected:
        return widget.isManualDisconnect
            ? 'Déconnecté (mode hors-ligne)'
            : 'Connexion perdue';
    }
  }

  String get _subtitle {
    if (widget.isManualDisconnect) {
      return 'Vos messages seront envoyés à la reconnexion.';
    }
    switch (widget.status) {
      case ConnectionStatus.connected:
        return '';
      case ConnectionStatus.connecting:
        return 'Tentative en cours vers le daemon…';
      case ConnectionStatus.error:
        return 'Une erreur est survenue, nouvelle tentative dans $_remaining';
      case ConnectionStatus.disconnected:
        if (widget.attempt <= 0) return 'Tentative de connexion…';
        final seconds = widget.nextRetryIn.inSeconds;
        final label = seconds <= 0 ? 'maintenant' : '${seconds}s';
        return 'Tentative ${widget.attempt} · prochaine dans $label';
    }
  }

  String get _remaining {
    final s = widget.nextRetryIn.inSeconds;
    if (s <= 0) return 'un instant…';
    return '${s}s';
  }

  @override
  Widget build(BuildContext context) {
    // Connecté → pas de banner : le widget se replie (AnimatedSize parent).
    if (_dismissed || widget.status == ConnectionStatus.connected) {
      return const SizedBox.shrink();
    }
    final scheme = Theme.of(context).colorScheme;
    final (icon, color, bg) = switch (widget.status) {
      ConnectionStatus.connected => (
          Icons.cloud_done_outlined,
          scheme.primary,
          scheme.primary.withValues(alpha: 0.12),
        ),
      ConnectionStatus.connecting => (
          Icons.sync_outlined,
          scheme.primary,
          scheme.primary.withValues(alpha: 0.12),
        ),
      ConnectionStatus.error => (
          Icons.cloud_off_outlined,
          scheme.error,
          scheme.error.withValues(alpha: 0.12),
        ),
      ConnectionStatus.disconnected => widget.isManualDisconnect
          ? (
              Icons.cloud_off_outlined,
              scheme.onSurfaceVariant,
              scheme.onSurfaceVariant.withValues(alpha: 0.08),
            )
          : (
              Icons.cloud_off_outlined,
              scheme.error,
              scheme.error.withValues(alpha: 0.12),
            ),
    };

    final hasKeyboard = MediaQuery.of(context).viewInsets.bottom > 0;

    return AnimatedSize(
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutQuart,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.0, end: 1.0),
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
        builder: (context, value, child) => Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, -12 * (1 - value)),
            child: child,
          ),
        ),
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(
            horizontal: 14,
            vertical: hasKeyboard ? 4 : 10,
          ),
          decoration: BoxDecoration(
            color: bg,
            border: Border(
              bottom: BorderSide(color: color.withValues(alpha: 0.35)),
            ),
          ),
          child: Row(
            children: [
              if (widget.status == ConnectionStatus.connecting)
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: color,
                  ),
                )
              else
                Icon(icon, size: hasKeyboard ? 15 : 18, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _title,
                      style: TextStyle(
                        fontSize: hasKeyboard ? 12 : 13,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                    ),
                    if (_subtitle.isNotEmpty && !hasKeyboard)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          _subtitle,
                          style: TextStyle(
                            fontSize: 11.5,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (widget.status != ConnectionStatus.connected &&
                  widget.status != ConnectionStatus.connecting &&
                  widget.onRetry != null)
                TextButton(
                  onPressed: widget.onRetry,
                  style: TextButton.styleFrom(
                    foregroundColor: color,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    minimumSize: const Size(48, 44),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text(
                    'Réessayer',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ),
              if (widget.status != ConnectionStatus.connected)
                IconButton(
                  onPressed: () => setState(() => _dismissed = true),
                  icon: Icon(
                    Icons.close,
                    size: 16,
                    color: scheme.onSurfaceVariant,
                  ),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                    minWidth: 44,
                    minHeight: 44,
                  ),
                  tooltip: 'Masquer',
                ),
            ],
          ),
        ),
      ),
    );
  }
}
