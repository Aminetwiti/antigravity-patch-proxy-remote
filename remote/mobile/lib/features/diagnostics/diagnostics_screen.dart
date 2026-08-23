import 'package:flutter/material.dart';
import '../../core/protocol/daemon_api.dart';
import '../../theme/app_colors.dart';

/// Écran de diagnostic & profiling FlightRecorder (runtime/trace Go).
class DiagnosticsScreen extends StatefulWidget {
  final DaemonApi api;

  const DiagnosticsScreen({super.key, required this.api});

  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  bool _isDumping = false;
  Map<String, dynamic>? _lastTraceResult;
  String? _statusMessage;

  Future<void> _dumpTrace() async {
    setState(() {
      _isDumping = true;
      _statusMessage = 'Extraction de la trace d\'exécution runtime/trace...';
    });

    try {
      final res = await widget.api.dumpFlightRecorder();
      if (!mounted) return;
      setState(() {
        _isDumping = false;
        _lastTraceResult = res;
        _statusMessage = 'Trace extraite avec succès (${res['size'] ?? 0} octets)';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isDumping = false;
        _statusMessage = 'Échec extraction trace: $e';
      });
    }
  }


  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? AppColors.surfaceBase : scheme.surface,
      appBar: AppBar(
        backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        title: Text(
          'Diagnostics & Profiling 📊',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: scheme.onSurface),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // FlightRecorder Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: isDark ? AppColors.borderStrong : scheme.outlineVariant),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.monitor_heart, color: AppColors.positive, size: 20),
                      const SizedBox(width: 8),
                      Text(
                        'Go FlightRecorder Engine',
                        style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Capture en direct les goroutines, syscalls, contention des mutex et allocations heap du Language Server Go.',
                    style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                  ),
                  const SizedBox(height: 14),
                  ElevatedButton.icon(
                    onPressed: _isDumping ? null : _dumpTrace,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: scheme.primary,
                      foregroundColor: AppColors.onAccent,
                    ),
                    icon: const Icon(Icons.download, size: 16),
                    label: Text(_isDumping ? 'Extraction en cours...' : 'Extraire un Dump FlightRecorder (.trace)'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            if (_statusMessage != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                ),
                child: Text(
                  _statusMessage!,
                  style: TextStyle(color: scheme.onSurface, fontSize: 12, fontFamily: 'monospace'),
                ),
              ),
              const SizedBox(height: 16),
            ],

            if (_lastTraceResult != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.positive),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Détails de la Trace Go Profiling', style: TextStyle(color: AppColors.positive, fontWeight: FontWeight.bold, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text(
                      'Taille: ${_lastTraceResult!['size'] ?? 0} octets | Statut: ${_lastTraceResult!['status'] ?? 'ok'}',
                      style: TextStyle(color: scheme.onSurface, fontSize: 11),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Section Métriques Système
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Métriques d\'Exécution',
                    style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                  const SizedBox(height: 12),
                  _buildMetricRow('Statut Language Server', 'Connecté (Session Active)', AppColors.positive, scheme),
                  Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                  _buildMetricRow('Protocole Wire', 'ConnectRPC / gRPC-Web', AppColors.info, scheme),
                  Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                  _buildMetricRow('Framing Protobuf', 'Manuel Zéro-Allocation', AppColors.codeGold, scheme),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricRow(String label, String value, Color valueColor, ColorScheme scheme) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              value,
              style: TextStyle(color: valueColor, fontWeight: FontWeight.bold, fontSize: 12),
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
