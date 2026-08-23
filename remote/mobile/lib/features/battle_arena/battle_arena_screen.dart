import 'package:flutter/material.dart';
import '../../core/protocol/daemon_api.dart';
import '../../theme/app_colors.dart';

/// Écran Colosseum Battle Arena : Duel multi-modèles et arbitrage de branches.
class BattleArenaScreen extends StatefulWidget {
  final DaemonApi? api;
  final String workspaceUri;

  const BattleArenaScreen({
    super.key,
    this.api,
    required this.workspaceUri,
  });

  @override
  State<BattleArenaScreen> createState() => _BattleArenaScreenState();
}

class _BattleArenaScreenState extends State<BattleArenaScreen> {
  final _promptController = TextEditingController();
  bool _isRunning = false;
  String _modelA = 'claude-3-7-sonnet';
  String _modelB = 'gemini-2-5-pro';
  Map<String, dynamic>? _battleDiff;
  String? _winningArm;
  String? _statusMessage;

  final List<Map<String, dynamic>> _availableModels = [
    {'uid': 'claude-3-7-sonnet', 'enum': 312, 'name': 'Claude 3.7 Sonnet', 'badge': 'Anthropic'},
    {'uid': 'gemini-2-5-pro', 'enum': 246, 'name': 'Gemini 2.5 Pro', 'badge': 'Google'},
    {'uid': 'gpt-4o', 'enum': 101, 'name': 'GPT-4o', 'badge': 'OpenAI'},
    {'uid': 'deepseek-r1', 'enum': 405, 'name': 'DeepSeek R1', 'badge': 'Reasoning'},
  ];

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _startBattle() async {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Veuillez entrer un prompt pour le duel.')),
      );
      return;
    }

    if (widget.api == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Impossible de lancer le duel en mode hors ligne.')),
      );
      return;
    }

    setState(() {
      _isRunning = true;
      _statusMessage = 'Initialisation des worktrees éphémères...';
    });

    try {
      final api = widget.api!;
      final selectedA = _availableModels.firstWhere((m) => m['uid'] == _modelA);
      final selectedB = _availableModels.firstWhere((m) => m['uid'] == _modelB);

      await api.startBattleMode(
        widget.workspaceUri,
        prompt,
        modelUIDA: selectedA['uid'] as String?,
        modelEnumA: selectedA['enum'] as int?,
        modelUIDB: selectedB['uid'] as String?,
        modelEnumB: selectedB['enum'] as int?,
      );

      setState(() {
        _statusMessage = 'Génération simultanée en cours sur Arm A et Arm B...';
      });

      // Rafraîchir le diff comparatif
      await _refreshDiff();
    } catch (e) {
      setState(() {
        _isRunning = false;
        _statusMessage = 'Erreur: $e';
      });
    }
  }

  Future<void> _refreshDiff() async {
    final api = widget.api;
    if (api == null) return;
    try {
      final diff = await api.getBattleDiff(widget.workspaceUri);
      setState(() {
        _battleDiff = diff;
      });
    } catch (_) {}
  }

  Future<void> _eliminateArm(String armId) async {
    final api = widget.api;
    if (api == null) return;
    try {
      await api.eliminateBattleArm(armId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Branche $armId éliminée')),
      );
      await _refreshDiff();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Échec élimination: $e')),
      );
    }
  }

  Future<void> _concludeBattle(String winningArm, int strategy) async {
    final api = widget.api;
    if (api == null) return;
    try {
      await api.endBattleMode(winningArm, mergeStrategy: strategy);
      if (!mounted) return;
      setState(() {
        _isRunning = false;
        _winningArm = winningArm;
        _statusMessage = 'Victoire validée pour $winningArm via SafeMerge.';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: AppColors.positive,
          content: Text('Fusion appliquée avec succès dans la branche principale !'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erreur arbitrage: $e')),
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
        title: Text(
          'Colosseum Battle Arena ⚔️',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: scheme.onSurface),
        ),
        actions: [
          if (_isRunning)
            IconButton(
              icon: Icon(Icons.refresh, color: scheme.primary),
              onPressed: _refreshDiff,
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Sélecteurs de modèles
            Row(
              children: [
                Expanded(
                  child: _buildModelSelector(
                    title: 'Arm A (Modèle 1)',
                    selectedUID: _modelA,
                    color: AppColors.providerAnthropic,
                    scheme: scheme,
                    isDark: isDark,
                    onChanged: (uid) => setState(() => _modelA = uid),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Text('VS', style: TextStyle(color: AppColors.codeGold, fontWeight: FontWeight.bold)),
                ),
                Expanded(
                  child: _buildModelSelector(
                    title: 'Arm B (Modèle 2)',
                    selectedUID: _modelB,
                    color: AppColors.providerGoogle,
                    scheme: scheme,
                    isDark: isDark,
                    onChanged: (uid) => setState(() => _modelB = uid),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Saisie du prompt
            TextField(
              controller: _promptController,
              maxLines: 3,
              style: TextStyle(color: scheme.onSurface, fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Entrez la tâche à mettre en compétition (ex: Refactor du tokenizer en zéro-allocation)...',
                hintStyle: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                filled: true,
                fillColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 12),

            // Bouton de lancement
            ElevatedButton.icon(
              onPressed: _isRunning ? null : _startBattle,
              style: ElevatedButton.styleFrom(
                backgroundColor: scheme.primary,
                foregroundColor: AppColors.onAccent,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              icon: const Icon(Icons.flash_on, size: 18),
              label: Text(_isRunning ? 'Combat en cours...' : 'Lancer le Duel Multi-Modèles'),
            ),

            if (_statusMessage != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                ),
                child: Text(_statusMessage!, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
              ),
            ],

            const SizedBox(height: 20),
            // Actions d'arbitrage
            if (_isRunning) ...[
              Text(
                'Arbitrage & SafeMerge',
                style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.bold, fontSize: 14),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.danger),
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      ),
                      onPressed: () => _eliminateArm('arm_a'),
                      child: const Text(
                        'Éliminer Arm A',
                        style: TextStyle(color: AppColors.danger, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AppColors.danger),
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      ),
                      onPressed: () => _eliminateArm('arm_b'),
                      child: const Text(
                        'Éliminer Arm B',
                        style: TextStyle(color: AppColors.danger, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.positive,
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      ),
                      onPressed: () => _concludeBattle('arm_a', 2), // 2 = SAFE_MERGE
                      child: const Text(
                        'Gagnant : Arm A',
                        style: TextStyle(color: Colors.white, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.positive,
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      ),
                      onPressed: () => _concludeBattle('arm_b', 2), // 2 = SAFE_MERGE
                      child: const Text(
                        'Gagnant : Arm B',
                        style: TextStyle(color: Colors.white, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
              ),
            ],

            if (_battleDiff != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Diff Comparatif Live', style: TextStyle(color: AppColors.codeGold, fontWeight: FontWeight.bold, fontSize: 12)),
                    const SizedBox(height: 4),
                    Text('${_battleDiff!}', style: TextStyle(color: scheme.onSurface, fontSize: 11, fontFamily: 'monospace')),
                  ],
                ),
              ),
            ],

            if (_winningArm != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.positive.withAlpha(40),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppColors.positive),
                ),
                child: Text('Victoire validée : $_winningArm', style: const TextStyle(color: AppColors.positive, fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildModelSelector({
    required String title,
    required String selectedUID,
    required Color color,
    required ColorScheme scheme,
    required bool isDark,
    required ValueChanged<String> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withAlpha(100)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          DropdownButton<String>(
            value: selectedUID,
            isExpanded: true,
            dropdownColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
            underline: const SizedBox(),
            items: _availableModels.map((m) {
              return DropdownMenuItem<String>(
                value: m['uid'] as String,
                child: Text(m['name'] as String, style: TextStyle(color: scheme.onSurface, fontSize: 12)),
              );
            }).toList(),
            onChanged: (val) {
              if (val != null) onChanged(val);
            },
          ),
        ],
      ),
    );
  }
}
