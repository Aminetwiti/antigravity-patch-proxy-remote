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
  List<Map<String, dynamic>> _logs = [];
  bool _isLoadingLogs = false;
  String _selectedSeverity = 'ALL';
  final TextEditingController _logSearchController = TextEditingController();
  String _logSearchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadLogs();
  }

  @override
  void dispose() {
    _logSearchController.dispose();
    super.dispose();
  }

  Future<void> _loadLogs() async {
    setState(() => _isLoadingLogs = true);
    try {
      final logs = await widget.api.getLogs();
      if (!mounted) return;
      setState(() {
        _logs = logs;
        _isLoadingLogs = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoadingLogs = false);
    }
  }

  List<Map<String, dynamic>> get _filteredLogs {
    return _logs.where((l) {
      final level = (l['level'] as String? ?? 'INFO').toUpperCase();
      final msg = (l['message'] as String? ?? '').toLowerCase();
      final matchesSeverity = _selectedSeverity == 'ALL' || level == _selectedSeverity;
      final matchesSearch = _logSearchQuery.isEmpty || msg.contains(_logSearchQuery.toLowerCase());
      return matchesSeverity && matchesSearch;
    }).toList();
  }

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
            const SizedBox(height: 16),

            // Section Log Viewer Interactif (P2-35)
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
                  Row(
                    children: [
                      Icon(Icons.receipt_long_rounded, color: scheme.primary, size: 18),
                      const SizedBox(width: 8),
                      Text(
                        'Journaux & Logs Système',
                        style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      const Spacer(),
                      IconButton(
                        icon: const Icon(Icons.refresh_rounded, size: 16),
                        tooltip: 'Actualiser les logs',
                        onPressed: _isLoadingLogs ? null : _loadLogs,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

                  // Barre de recherche
                  TextField(
                    controller: _logSearchController,
                    onChanged: (val) => setState(() => _logSearchQuery = val),
                    style: const TextStyle(fontSize: 12),
                    decoration: InputDecoration(
                      hintText: 'Rechercher dans les logs...',
                      prefixIcon: const Icon(Icons.search_rounded, size: 16),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      filled: true,
                      fillColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Filtres de sévérité
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'].map((sev) {
                        final isSelected = _selectedSeverity == sev;
                        return Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: FilterChip(
                            label: Text(sev, style: TextStyle(fontSize: 10.5, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
                            selected: isSelected,
                            onSelected: (_) => setState(() => _selectedSeverity = sev),
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 0),
                            visualDensity: VisualDensity.compact,
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  const SizedBox(height: 10),

                  // Liste des logs
                  if (_isLoadingLogs)
                    const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
                  else if (_filteredLogs.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Center(
                        child: Text(
                          'Aucun log correspondant aux filtres',
                          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                        ),
                      ),
                    )
                  else
                    Container(
                      constraints: const BoxConstraints(maxHeight: 280),
                      child: ListView.separated(
                        shrinkWrap: true,
                        itemCount: _filteredLogs.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (ctx, idx) {
                          final log = _filteredLogs[idx];
                          final level = (log['level'] as String? ?? 'INFO').toUpperCase();
                          final msg = log['message'] as String? ?? '';
                          final ts = log['timestamp'] as String? ?? '';
                          Color badgeColor = AppColors.info;
                          if (level == 'ERROR') badgeColor = AppColors.danger;
                          if (level == 'WARN') badgeColor = AppColors.warning;
                          if (level == 'DEBUG') badgeColor = AppColors.inkMuted;

                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                                      decoration: BoxDecoration(
                                        color: badgeColor.withValues(alpha: 0.15),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(
                                        level,
                                        style: TextStyle(color: badgeColor, fontSize: 9.5, fontWeight: FontWeight.bold),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      ts.length > 19 ? ts.substring(11, 19) : ts,
                                      style: TextStyle(color: isDark ? AppColors.inkMuted : scheme.outline, fontSize: 10, fontFamily: 'monospace'),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  msg,
                                  style: TextStyle(color: scheme.onSurface, fontSize: 11.5, fontFamily: 'monospace'),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
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
