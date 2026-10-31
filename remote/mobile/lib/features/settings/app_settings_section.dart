import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mobile/config/env_config.dart';
import 'package:mobile/core/protocol/daemon_api.dart';
import 'package:mobile/services/settings_store.dart';
import 'package:mobile/theme/app_colors.dart';
import 'package:mobile/widgets/app_toast.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../diagnostics/diagnostics_screen.dart';
import '../discovery/discovery_screen.dart';

/// Section App (Antigravity IDE 1:1)
/// Gère la connexion au daemon bridge, les tunnels, et les diagnostics système.
class AppSettingsSection extends StatefulWidget {
  final DaemonApi? api;
  final ValueChanged<Map<String, dynamic>>? onDaemonSaved;
  final VoidCallback? onDiscover;
  final Future<bool> Function(String host, int port, String csrfToken)? onConnect;
  final http.Client? httpClient;

  const AppSettingsSection({
    super.key,
    this.api,
    this.onDaemonSaved,
    this.onDiscover,
    this.onConnect,
    this.httpClient,
  });

  @override
  State<AppSettingsSection> createState() => _AppSettingsSectionState();
}

class _AppSettingsSectionState extends State<AppSettingsSection> {
  late TextEditingController _hostController;
  late TextEditingController _portController;
  late TextEditingController _csrfController;
  bool _useSsl = EnvConfig.useSsl;
  bool _diagnosticsBusy = false;

  @override
  void initState() {
    super.initState();
    _hostController = TextEditingController(text: EnvConfig.daemonHost);
    _portController = TextEditingController(text: '${EnvConfig.daemonPort}');
    _csrfController = TextEditingController();
    _loadSettings();
  }

  @override
  void dispose() {
    _hostController.dispose();
    _portController.dispose();
    _csrfController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final s = await SettingsStore.load();
    if (mounted) {
      setState(() {
        if ((s['host'] as String?)?.isNotEmpty == true) {
          _hostController.text = s['host'] as String;
        }
        if (s['port'] != null) {
          _portController.text = '${s['port']}';
        }
        if (s['csrf'] != null) {
          _csrfController.text = s['csrf'] as String;
        }
        if (s['ssl'] != null) {
          _useSsl = s['ssl'] as bool;
        }
      });
    }
  }

  Future<void> _saveConfig() async {
    final host = _hostController.text.trim();
    final port = int.tryParse(_portController.text.trim()) ?? EnvConfig.daemonPort;
    final csrf = _csrfController.text.trim();

    final map = {
      'host': host,
      'port': port,
      'csrf': csrf,
      'ssl': _useSsl,
    };

    await SettingsStore.save(map);
    widget.onDaemonSaved?.call(map);
    if (mounted) {
      AppToast.show(
        context,
        message: 'Configuration Daemon enregistrée ($host:$port).',
        icon: Icons.check_circle_outline,
      );
    }
  }

  Future<void> _exportDiagnostics() async {
    setState(() => _diagnosticsBusy = true);
    try {
      final scheme = _useSsl ? 'https' : 'http';
      final host = _hostController.text.trim().isEmpty ? EnvConfig.daemonHost : _hostController.text.trim();
      final port = int.tryParse(_portController.text.trim()) ?? EnvConfig.daemonPort;
      final uri = Uri.parse('$scheme://$host:$port/health/diagnostic');

      final client = widget.httpClient ?? http.Client();
      final res = await client.get(uri).timeout(const Duration(seconds: 5));

      String jsonContent;
      if (res.statusCode == 200) {
        jsonContent = res.body;
      } else {
        jsonContent = jsonEncode({
          'error': 'HTTP ${res.statusCode}',
          'timestamp': DateTime.now().toIso8601String(),
          'host': host,
          'port': port,
        });
      }

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/antigravity_diagnostic_${DateTime.now().millisecondsSinceEpoch}.json');
      await file.writeAsString(jsonContent);

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/json')],
        subject: 'Antigravity Remote Diagnostic Report',
      );
    } catch (e) {
      if (mounted) {
        AppToast.show(
          context,
          message: 'Erreur diagnostic : $e',
          icon: Icons.error_outline,
          type: ToastType.error,
        );
      }
    } finally {
      if (mounted) setState(() => _diagnosticsBusy = false);
    }
  }

  Future<void> _exportProfile() async {
    final s = await SettingsStore.load();
    final profile = {
      'version': '1.0',
      'exportedAt': DateTime.now().toIso8601String(),
      'settings': s,
    };
    final jsonStr = const JsonEncoder.withIndent('  ').convert(profile);
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/antigravity_profile_${DateTime.now().millisecondsSinceEpoch}.json');
    await file.writeAsString(jsonStr);

    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/json')],
      subject: 'Antigravity Configuration Profile',
    );
  }

  void _promptImportProfile() {
    final textController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Importer un profil de configuration'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Collez le JSON exporté pour restaurer vos paramètres :',
              style: TextStyle(fontSize: 12.5),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: textController,
              maxLines: 6,
              style: const TextStyle(fontSize: 11.5, fontFamily: 'monospace'),
              decoration: const InputDecoration(
                hintText: '{\n  "version": "1.0",\n  "settings": { ... }\n}',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Annuler')),
          FilledButton(
            onPressed: () async {
              final raw = textController.text.trim();
              Navigator.of(ctx).pop();
              if (raw.isNotEmpty) {
                try {
                  final decoded = jsonDecode(raw);
                  if (decoded is Map && decoded['settings'] is Map) {
                    final newSettings = Map<String, dynamic>.from(decoded['settings'] as Map);
                    await SettingsStore.save(newSettings);
                    await _loadSettings();
                    widget.onDaemonSaved?.call(newSettings);
                    if (mounted) {
                      AppToast.show(context, message: 'Profil importé avec succès !', icon: Icons.check_circle);
                    }
                  } else {
                    throw const FormatException('Format de profil invalide');
                  }
                } catch (e) {
                  if (mounted) {
                    AppToast.show(context, message: 'Erreur import profil: $e', icon: Icons.error_outline, type: ToastType.error);
                  }
                }
              }
            },
            child: const Text('Importer'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Text(
            'App',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: scheme.onSurface,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Daemon bridge connection, remote tunnels, and system diagnostics.',
            style: TextStyle(
              fontSize: 13,
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),

          // Connection Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: isDark ? AppColors.surfaceInput : scheme.outlineVariant,
                width: 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        'Daemon Bridge Connection',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton.icon(
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.accentBlue,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        visualDensity: VisualDensity.compact,
                      ),
                      onPressed: () {
                        if (widget.onDiscover != null) {
                          widget.onDiscover!();
                        } else {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (context) => DiscoveryScreen(
                                onConnect: widget.onConnect,
                              ),
                            ),
                          );
                        }
                      },
                      icon: const Icon(Icons.radar_rounded, size: 16),
                      label: const Text('Découvrir', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.accentBlue,
                      side: BorderSide(color: isDark ? AppColors.accentBlue.withValues(alpha: 0.5) : AppColors.accentBlue),
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
                    ),
                    onPressed: () {
                      if (widget.onDiscover != null) {
                        widget.onDiscover!();
                      } else {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (context) => DiscoveryScreen(
                              onConnect: widget.onConnect,
                            ),
                          ),
                        );
                      }
                    },
                    icon: const Icon(Icons.qr_code_scanner_rounded, size: 18),
                    label: const Text('Découvrir les daemons / Scanner QR', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ),
                const SizedBox(height: 16),
                const SizedBox(height: 12),
                Text('Daemon Host IP / Domain', style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                const SizedBox(height: 6),
                TextField(
                  controller: _hostController,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: InputDecoration(
                    hintText: 'e.g. 192.168.1.50 or tunnel.domain.com',
                    prefixIcon: Icon(Icons.lan_outlined, size: 16, color: scheme.onSurfaceVariant),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Port', style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _portController,
                            keyboardType: TextInputType.number,
                            style: TextStyle(fontSize: 13, color: scheme.onSurface),
                            decoration: InputDecoration(
                              hintText: '${EnvConfig.daemonPort}',
                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  'SSL / TLS (WSS)',
                                  style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Switch.adaptive(
                                value: _useSsl,
                                activeColor: AppColors.accentBlue,
                                onChanged: (val) => setState(() => _useSsl = val),
                              ),
                            ],
                          ),

                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text('CSRF Security Token', style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                const SizedBox(height: 6),
                TextField(
                  controller: _csrfController,
                  obscureText: true,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: InputDecoration(
                    hintText: 'Optional auth token',
                    prefixIcon: Icon(Icons.key_outlined, size: 16, color: scheme.onSurfaceVariant),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.accentBlue,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
                    ),
                    onPressed: _saveConfig,
                    icon: const Icon(Icons.save_outlined, size: 16),
                    label: const Text('Enregistrer la configuration', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),

          // Diagnostics Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: isDark ? AppColors.surfaceInput : scheme.outlineVariant,
                width: 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Diagnostics & Support',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface),
                ),
                const SizedBox(height: 6),
                Text(
                  'Générez et partagez un rapport d\'état complet (latence, processus, version patch).',
                  style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: scheme.onSurface,
                        side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outline),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
                      ),
                      onPressed: _diagnosticsBusy ? null : _exportDiagnostics,
                      icon: _diagnosticsBusy
                          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator.adaptive(strokeWidth: 2))
                          : const Icon(Icons.share_outlined, size: 16),
                      label: const Text('Exporter le rapport JSON', style: TextStyle(fontSize: 12)),
                    ),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: scheme.onSurface,
                        side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outline),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
                      ),
                      onPressed: _exportProfile,
                      icon: const Icon(Icons.file_upload_outlined, size: 16),
                      label: const Text('Exporter le profil', style: TextStyle(fontSize: 12)),
                    ),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: scheme.onSurface,
                        side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outline),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
                      ),
                      onPressed: _promptImportProfile,
                      icon: const Icon(Icons.file_download_outlined, size: 16),
                      label: const Text('Importer un profil', style: TextStyle(fontSize: 12)),
                    ),
                    if (widget.api != null)
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                          foregroundColor: scheme.onSurface,
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            side: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                          ),
                        ),
                        onPressed: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (context) => DiagnosticsScreen(api: widget.api!),
                            ),
                          );
                        },
                        icon: const Icon(Icons.monitor_heart_outlined, size: 16, color: AppColors.positive),
                        label: const Text('FlightRecorder & Profiling 📊', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}
