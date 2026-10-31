import 'package:flutter/material.dart';
import '../../core/protocol/daemon_api.dart';
import '../../theme/app_colors.dart';

/// Écran de supervision et de contrôle des Sidecars conteneurisés (cascade_plugins.proto).
class SidecarsDashboardScreen extends StatefulWidget {
  final DaemonApi? api;

  const SidecarsDashboardScreen({super.key, this.api});

  @override
  State<SidecarsDashboardScreen> createState() => _SidecarsDashboardScreenState();
}

class _SidecarsDashboardScreenState extends State<SidecarsDashboardScreen> {
  final List<String> _knownSidecars = ['web-dev-server', 'db-postgres-sandbox', 'build-compiler-worker'];
  String? _selectedSidecar;
  List<String> _logFiles = [];
  String? _selectedLogFile;
  String _logContent = '';
  bool _isLoadingLogs = false;
  String? _statusMessage;

  @override
  void initState() {
    super.initState();
    if (_knownSidecars.isNotEmpty) {
      _selectSidecar(_knownSidecars.first);
    }
  }

  Future<void> _selectSidecar(String sidecarId) async {
    setState(() {
      _selectedSidecar = sidecarId;
      _logFiles = [];
      _selectedLogFile = null;
      _logContent = '';
      _isLoadingLogs = true;
      _statusMessage = 'Récupération des fichiers de logs pour $sidecarId...';
    });

    final api = widget.api;
    if (api == null) {
      setState(() {
        _isLoadingLogs = false;
        _statusMessage = 'Mode hors ligne (API non disponible)';
      });
      return;
    }

    try {
      final files = await api.listSidecarLogFiles(sidecarId);
      if (!mounted) return;
      setState(() {
        _logFiles = files;
        _isLoadingLogs = false;
        if (files.isNotEmpty) {
          _selectedLogFile = files.first;
        }
      });
      if (files.isNotEmpty) {
        await _fetchLogs(sidecarId, files.first);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingLogs = false;
        _statusMessage = 'Erreur listing logs: $e';
      });
    }
  }

  Future<void> _fetchLogs(String sidecarId, String logFileName) async {
    setState(() {
      _selectedLogFile = logFileName;
      _isLoadingLogs = true;
    });

    final api = widget.api;
    if (api == null) {
      setState(() {
        _isLoadingLogs = false;
        _logContent = 'API non disponible';
      });
      return;
    }

    try {
      final content = await api.getSidecarLogs(sidecarId, logFileName);
      if (!mounted) return;
      setState(() {
        _logContent = content.isNotEmpty ? content : 'Aucun log enregistré.';
        _isLoadingLogs = false;
        _statusMessage = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoadingLogs = false;
        _statusMessage = 'Erreur lecture log: $e';
      });
    }
  }

  Future<void> _sendSidecarAction(int action, String actionName) async {
    if (_selectedSidecar == null) return;
    final api = widget.api;
    if (api == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Action impossible en mode hors ligne.')),
      );
      return;
    }
    try {
      await api.manageSidecar(_selectedSidecar!, action: action);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.positive,
          content: Text('Action $actionName envoyée avec succès au sidecar $_selectedSidecar'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: AppColors.danger,
          content: Text('Échec $actionName: $e'),
        ),
      );
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
        title: Text('Conteneurs & Sidecars 📦', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: scheme.onSurface)),
        actions: [
          if (_selectedSidecar != null && _selectedLogFile != null)
            IconButton(
              icon: Icon(Icons.refresh, color: scheme.primary),
              onPressed: () => _fetchLogs(_selectedSidecar!, _selectedLogFile!),
            ),
        ],
      ),
      body: Column(
        children: [
          // Sélecteur de Sidecar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
            child: Row(
              children: [
                const Icon(Icons.dns, size: 18, color: AppColors.codeGold),
                const SizedBox(width: 10),
                Text('Sidecar :', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButton<String>(
                    value: _selectedSidecar,
                    isExpanded: true,
                    dropdownColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                    underline: const SizedBox(),
                    items: _knownSidecars.map((id) {
                      return DropdownMenuItem<String>(
                        value: id,
                        child: Text(id, style: TextStyle(color: scheme.onSurface, fontSize: 12, fontWeight: FontWeight.bold)),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) _selectSidecar(val);
                    },
                  ),
                ),
              ],
            ),
          ),

          // Boutons de contrôle du cycle de vie
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceBase : scheme.surface,
              border: Border(bottom: BorderSide(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(side: const BorderSide(color: AppColors.positive)),
                    icon: const Icon(Icons.play_arrow, size: 14, color: AppColors.positive),
                    label: const Text('Start', style: TextStyle(color: AppColors.positive, fontSize: 11)),
                    onPressed: () => _sendSidecarAction(1, 'Start'),
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(side: const BorderSide(color: AppColors.warning)),
                    icon: const Icon(Icons.stop, size: 14, color: AppColors.warning),
                    label: const Text('Stop', style: TextStyle(color: AppColors.warning, fontSize: 11)),
                    onPressed: () => _sendSidecarAction(2, 'Stop'),
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(side: BorderSide(color: scheme.primary)),
                    icon: Icon(Icons.restart_alt, size: 14, color: scheme.primary),
                    label: Text('Restart', style: TextStyle(color: scheme.primary, fontSize: 11)),
                    onPressed: () => _sendSidecarAction(3, 'Restart'),
                  ),
                ),
              ],
            ),
          ),

          // Onglets de fichiers de log
          if (_logFiles.isNotEmpty)
            Container(
              height: 38,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _logFiles.length,
                itemBuilder: (context, idx) {
                  final file = _logFiles[idx];
                  final isSelected = file == _selectedLogFile;
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(file, style: TextStyle(fontSize: 11, color: isSelected ? Colors.white : scheme.onSurfaceVariant)),
                      selected: isSelected,
                      selectedColor: scheme.primary,
                      backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                      onSelected: (_) {
                        if (_selectedSidecar != null) {
                          _fetchLogs(_selectedSidecar!, file);
                        }
                      },
                    ),
                  );
                },
              ),
            ),

          if (_statusMessage != null)
            Padding(
              padding: const EdgeInsets.all(10),
              child: Text(_statusMessage!, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 11)),
            ),

          // Rendu des logs
          Expanded(
            child: _isLoadingLogs
                ? const Center(child: CircularProgressIndicator())
                : Container(
                    margin: const EdgeInsets.all(12),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                    ),
                    child: SingleChildScrollView(
                      child: Text(
                        _logContent,
                        style: TextStyle(
                          color: scheme.onSurface,
                          fontSize: 11,
                          fontFamily: 'monospace',
                          height: 1.4,
                        ),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
