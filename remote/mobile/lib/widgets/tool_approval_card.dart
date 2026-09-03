import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/protocol/messages.dart';
import '../theme/app_colors.dart';
import 'app_toast.dart';

class ToolApprovalCard extends StatefulWidget {
  final ToolApprovalRequest request;
  final Function(
    ToolDecision decision, {
    ApprovalScope scope,
    String denyReason,
  }) onDecision;
  // true après approval_expired du daemon : la demande a été auto-refusée
  // (timeout) — la carte passe en lecture seule.
  final bool isExpired;

  const ToolApprovalCard({
    super.key,
    required this.request,
    required this.onDecision,
    this.isExpired = false,
  });

  @override
  State<ToolApprovalCard> createState() => _ToolApprovalCardState();
}

class _ToolApprovalCardState extends State<ToolApprovalCard> {
  bool _alwaysAllow = false;
  bool _showDenyReason = false;
  int _selectedOption = 1; // 1 = once, 2 = conversation, 3 = project, 4 = global, 5 = deny
  bool _isSubmitting = false;
  // Guard timeout : si le daemon ne répond pas en 5 s, on débloque le bouton.
  Timer? _submitTimeout;
  Timer? _countdownTimer;
  int _remainingSeconds = 60;
  final TextEditingController _denyReasonController = TextEditingController();

  bool _showMcpArgs = false;
  bool _destructiveConfirmed = false;
  bool _isCollapsed = false;

  bool get _isEffectiveExpired => widget.isExpired || _remainingSeconds <= 0;
  bool get _isUrlApproval => widget.request.isUrlApproval;
  bool get _isFileApproval => widget.request.isFileApproval;
  bool get _isScopedApproval => !widget.request.isStdinApproval;
  bool get _isDestructive => widget.request.checkDestructive;

  String _extractTargetDisplay(String raw) {
    if (widget.request.isMcpApproval && widget.request.mcpServer != null) {
      final tl = widget.request.mcpTool ?? widget.request.toolName;
      return '${widget.request.mcpServer} -> $tl';
    }
    if (raw.isEmpty) {
      if (widget.request.filePath != null) return widget.request.filePath!;
      return widget.request.description;
    }
    final trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      final uri = Uri.tryParse(trimmed);
      if (uri != null && uri.host.isNotEmpty) {
        return uri.host;
      }
    }
    return trimmed.replaceAll(r'\n', '\n');
  }

  IconData _iconForTool(String toolName) {
    if (_isDestructive) return Icons.warning_amber_rounded;
    if (_isUrlApproval) return Icons.lock_outline;
    if (_isFileApproval) return Icons.folder_open_outlined;
    if (widget.request.isMcpApproval) return Icons.extension_outlined;
    if (widget.request.isStdinApproval) return Icons.keyboard_outlined;
    if (widget.request.isSubagentApproval) return Icons.smart_toy_outlined;
    if (widget.request.isDeployApproval) return Icons.cloud_upload_outlined;
    final lower = toolName.toLowerCase();
    if (lower.contains('bash') || lower.contains('command') || lower.contains('run')) {
      return Icons.terminal;
    } else if (lower.contains('file') || lower.contains('read') || lower.contains('write')) {
      return Icons.folder_outlined;
    } else if (lower.contains('browser') || lower.contains('web') || lower.contains('search')) {
      return Icons.language;
    } else if (lower.contains('sql') || lower.contains('database') || lower.contains('cloudsql')) {
      return Icons.dns_outlined;
    } else if (lower.contains('extension')) {
      return Icons.extension_outlined;
    }
    return Icons.security_outlined;
  }

  String _titleForTool() {
    if (_isDestructive) {
      return 'Action Destructive / Risque Élevé';
    }
    if (_isUrlApproval) {
      return 'Allow reading this URL?';
    }
    if (_isFileApproval) {
      return 'Allow file access outside workspace?';
    }
    if (widget.request.isMcpApproval) {
      if (widget.request.mcpServer != null && widget.request.mcpServer!.isNotEmpty) {
        return 'Allow MCP tool execution (${widget.request.mcpServer})?';
      }
      return 'Allow using this MCP tool?';
    }
    if (widget.request.isStdinApproval) {
      return 'Send terminal input (stdin)';
    }
    if (widget.request.isSubagentApproval) {
      return 'Allow subagent delegation?';
    }
    if (widget.request.isDeployApproval) {
      return 'Allow cloud deployment?';
    }
    final lower = widget.request.toolName.toLowerCase();
    final appType = widget.request.approvalType.toLowerCase();
    if (appType == 'browser_action' || lower.contains('browser')) {
      return 'Allow browser interaction?';
    }
    if (appType == 'cloudsql' || lower.contains('sql') || lower.contains('database')) {
      return 'Allow executing Cloud SQL query?';
    }
    if (appType == 'run_extension_code' || lower.contains('extension')) {
      return 'Allow running extension code?';
    }
    if (appType == 'elicitation') {
      return 'Allow plan execution?';
    }
    if (lower.contains('run') || lower.contains('command') || lower.contains('bash') || lower.contains('exec')) {
      return 'Allow running this command?';
    }
    if (lower.contains('file') || lower.contains('write')) {
      return 'Allow file modification?';
    }
    return 'Allow executing ${widget.request.toolName}?';
  }

  @override
  void initState() {
    super.initState();
    _triggerArrivalHaptic();
    _startCountdown();
  }

  void _startCountdown() {
    _countdownTimer?.cancel();
    if (!widget.isExpired) {
      _remainingSeconds = 60;
      _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        setState(() {
          if (_remainingSeconds > 0) {
            _remainingSeconds--;
          } else {
            timer.cancel();
          }
        });
      });
    }
  }

  void _triggerArrivalHaptic() {
    if (!_isEffectiveExpired) {
      if (_isDestructive) {
        HapticFeedback.heavyImpact();
      } else {
        HapticFeedback.mediumImpact();
      }
    }
  }

  @override
  void didUpdateWidget(ToolApprovalCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.request.callId != widget.request.callId) {
      _isSubmitting = false;
      _selectedOption = 1;
      _startCountdown();
      _alwaysAllow = false;
      _showDenyReason = false;
      _showMcpArgs = false;
      _destructiveConfirmed = false;
      _denyReasonController.clear();
      _submitTimeout?.cancel();
      _triggerArrivalHaptic();
    }
  }

  void _handleDecision(ToolDecision decision, {ApprovalScope scope = ApprovalScope.once, String denyReason = ''}) async {
    if (_isSubmitting) return;
    HapticFeedback.lightImpact();
    setState(() => _isSubmitting = true);
    _submitTimeout?.cancel();
    _submitTimeout = Timer(const Duration(seconds: 5), () {
      if (mounted) {
        setState(() => _isSubmitting = false);
        AppToast.show(
          context,
          message: 'Le serveur n\'a pas répondu. Veuillez réessayer.',
          type: ToastType.error,
        );
      }
    });
    try {
      await widget.onDecision(
        decision,
        scope: scope,
        denyReason: denyReason,
      );
    } finally {
      _submitTimeout?.cancel();
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _handleSubmitSelected() {
    if (_isSubmitting || widget.isExpired) return;
    if (_isScopedApproval) {
      switch (_selectedOption) {
        case 1:
          _handleDecision(ToolDecision.allow, scope: ApprovalScope.once);
          break;
        case 2:
          _handleDecision(ToolDecision.allow, scope: ApprovalScope.session);
          break;
        case 3:
          _handleDecision(ToolDecision.allow, scope: ApprovalScope.project);
          break;
        case 4:
          _handleDecision(ToolDecision.allow, scope: ApprovalScope.global);
          break;
        case 5:
          _handleDecision(
            ToolDecision.deny,
            denyReason: _denyReasonController.text.trim(),
          );
          break;
        default:
          _handleDecision(ToolDecision.allow, scope: ApprovalScope.once);
      }
    } else {
      _handleDecision(
        ToolDecision.allow,
        scope: _alwaysAllow ? ApprovalScope.session : ApprovalScope.once,
      );
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _submitTimeout?.cancel();
    _denyReasonController.dispose();
    super.dispose();
  }

  Widget _buildOptionRow({
    required int index,
    required String label,
    required ColorScheme scheme,
  }) {
    final isSelected = _selectedOption == index;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Semantics(
        button: true,
        selected: isSelected,
        label: label,
        child: InkWell(
          key: Key('approval-option-$index'),
          onTap: _isEffectiveExpired || _isSubmitting
              ? null
              : () {
                  HapticFeedback.selectionClick();
                  setState(() => _selectedOption = index);
                },
          borderRadius: BorderRadius.circular(6),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: isSelected
                  ? (isDark
                      ? AppColors.accentBlue.withValues(alpha: 0.15)
                      : scheme.primaryContainer.withValues(alpha: 0.4))
                  : (isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest.withValues(alpha: 0.4)),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(
                color: isSelected
                    ? (isDark ? AppColors.accentBlueBright : scheme.primary)
                    : (isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.4)),
                width: isSelected ? 1.5 : 1.0,
              ),
            ),
            child: Row(
              children: [
                // Numéro badge
                Container(
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    color: isSelected
                        ? (isDark ? AppColors.accentBlue : scheme.primary)
                        : (isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    '$index',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: isSelected
                          ? AppColors.onAccent
                          : (isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                      color: isSelected
                          ? (isDark ? AppColors.inkPrimary : scheme.onSurface)
                          : (isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant),
                    ),
                  ),
                ),
                if (isSelected)
                  Icon(
                    Icons.check_rounded,
                    size: 14,
                    color: isDark ? AppColors.accentBlueBright : scheme.primary,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final request = widget.request;
    final targetDisplay = _extractTargetDisplay(request.command);
    const conversationLabel = 'Yes, and always allow in this conversation';
    const projectLabel = 'Yes, and always allow in this project';
    const globalLabel = 'Yes, and always allow';

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: _isDestructive
              ? (isDark ? AppColors.danger : scheme.error)
              : (_isEffectiveExpired
                  ? (isDark ? AppColors.borderSubtle : scheme.outlineVariant)
                  : (isDark ? AppColors.accentBlue : scheme.primary)),
          width: _isDestructive ? 1.5 : 1.0,
        ),
        boxShadow: _isDestructive
            ? [
                BoxShadow(
                  color: (isDark ? AppColors.danger : scheme.error).withValues(alpha: 0.25),
                  blurRadius: 10,
                  spreadRadius: 1,
                )
              ]
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.15),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // ── En-tête : Cadenas / Outil + Titre + Countdown Badge / Pliable
            InkWell(
              onTap: _isEffectiveExpired
                  ? () {
                      HapticFeedback.selectionClick();
                      setState(() => _isCollapsed = !_isCollapsed);
                    }
                  : null,
              borderRadius: BorderRadius.circular(4),
              child: Row(
                children: [
                  Icon(
                    _iconForTool(request.toolName),
                    size: 16,
                    color: _isUrlApproval
                        ? (isDark ? AppColors.accentBlueBright : scheme.primary)
                        : (isDark ? AppColors.warning : scheme.tertiary),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _titleForTool(),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ),
                  if (!_isEffectiveExpired) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: _remainingSeconds <= 10
                              ? (isDark ? AppColors.danger : scheme.error)
                              : (isDark ? AppColors.borderSubtle : scheme.outlineVariant),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.timer_outlined,
                            size: 11,
                            color: _remainingSeconds <= 10
                                ? (isDark ? AppColors.danger : scheme.error)
                                : (isDark ? AppColors.inkMuted : scheme.onSurfaceVariant),
                          ),
                          const SizedBox(width: 3),
                          Text(
                            '${_remainingSeconds}s',
                            style: TextStyle(
                              fontSize: 10,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w600,
                              color: _remainingSeconds <= 10
                                  ? (isDark ? AppColors.danger : scheme.error)
                                  : (isDark ? AppColors.inkMuted : scheme.onSurfaceVariant),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.dangerSubtle : const Color(0xFFFEE2E2),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isDark ? AppColors.danger.withValues(alpha: 0.5) : const Color(0xFFDC2626),
                        ),
                      ),
                      child: Text(
                        'Expiré',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: isDark ? AppColors.danger : const Color(0xFFDC2626),
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      _isCollapsed ? Icons.keyboard_arrow_down_rounded : Icons.keyboard_arrow_up_rounded,
                      size: 16,
                      color: isDark ? AppColors.inkMuted : scheme.outline,
                    ),
                  ],
                ],
              ),
            ),
            if (!_isCollapsed || !_isEffectiveExpired) ...[
              const SizedBox(height: 8),

            // ── Cible : Encadré Domaine / URL / Commande
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                ),
              ),
              child: SelectableText(
                targetDisplay,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  height: 1.3,
                  fontWeight: FontWeight.w500,
                  color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                ),
              ),
            ),
            const SizedBox(height: 8),

            // ── Inspecteur de Paramètres MCP
            if (widget.request.isMcpApproval &&
                widget.request.mcpArgs != null &&
                widget.request.mcpArgs!.isNotEmpty) ...[
              InkWell(
                key: const Key('toggle-mcp-args-btn'),
                onTap: () {
                  HapticFeedback.selectionClick();
                  setState(() => _showMcpArgs = !_showMcpArgs);
                },
                borderRadius: BorderRadius.circular(6),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  margin: const EdgeInsets.only(bottom: 8),
                  decoration: BoxDecoration(
                    color: isDark
                        ? AppColors.surfaceHover
                        : scheme.surfaceContainerHighest.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.data_object,
                        size: 14,
                        color: isDark ? AppColors.accentBlueBright : scheme.primary,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          _showMcpArgs ? 'Masquer les paramètres' : 'Inspecter les paramètres JSON',
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                          ),
                        ),
                      ),
                      Icon(
                        _showMcpArgs ? Icons.expand_less : Icons.expand_more,
                        size: 16,
                        color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                ),
              ),
              if (_showMcpArgs) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(8),
                  margin: const EdgeInsets.only(bottom: 8),
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                    ),
                  ),
                  child: SelectableText(
                    widget.request.mcpArgs!,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      height: 1.3,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                  ),
                ),
              ],
            ],

            // ── Quick chips Stdin
            if (widget.request.isStdinApproval) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    ActionChip(
                      label: const Text('y (Yes)', style: TextStyle(fontSize: 11)),
                      onPressed: _isSubmitting || widget.isExpired
                          ? null
                          : () {
                              _handleDecision(ToolDecision.allow, scope: ApprovalScope.once, denyReason: 'y');
                            },
                    ),
                    ActionChip(
                      label: const Text('n (No)', style: TextStyle(fontSize: 11)),
                      onPressed: _isSubmitting || widget.isExpired
                          ? null
                          : () {
                              _handleDecision(ToolDecision.allow, scope: ApprovalScope.once, denyReason: 'n');
                            },
                    ),
                    ActionChip(
                      label: const Text('↵ Enter', style: TextStyle(fontSize: 11)),
                      onPressed: _isSubmitting || widget.isExpired
                          ? null
                          : () {
                              _handleDecision(ToolDecision.allow, scope: ApprovalScope.once, denyReason: '\n');
                            },
                    ),
                  ],
                ),
              ),
            ],

            // ── Avertissement Action Destructive si détectée
            if (_isDestructive) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  color: (isDark ? AppColors.danger : scheme.error).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(
                    color: (isDark ? AppColors.danger : scheme.error).withValues(alpha: 0.5),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.warning_amber_rounded,
                          size: 16,
                          color: isDark ? AppColors.danger : scheme.error,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Attention : Cette opération risque de supprimer ou modifier irrémédiablement des données.',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: isDark ? AppColors.danger : scheme.error,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    InkWell(
                      onTap: () {
                        HapticFeedback.lightImpact();
                        setState(() => _destructiveConfirmed = !_destructiveConfirmed);
                      },
                      child: Row(
                        children: [
                          Checkbox(
                            key: const Key('destructive-confirm-checkbox'),
                            value: _destructiveConfirmed,
                            onChanged: (v) {
                              HapticFeedback.lightImpact();
                              setState(() => _destructiveConfirmed = v ?? false);
                            },
                            activeColor: isDark ? AppColors.danger : scheme.error,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              'Je confirme le risque irréversible',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: isDark ? AppColors.danger : scheme.error,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // ── Choix d'approbation (5 options unifiées 1:1 IDE Antigravity)
            if (_isScopedApproval) ...[
              _buildOptionRow(
                index: 1,
                label: 'Yes, allow this time',
                scheme: scheme,
              ),
              _buildOptionRow(
                index: 2,
                label: conversationLabel,
                scheme: scheme,
              ),
              _buildOptionRow(
                index: 3,
                label: projectLabel,
                scheme: scheme,
              ),
              _buildOptionRow(
                index: 4,
                label: globalLabel,
                scheme: scheme,
              ),
              _buildOptionRow(
                index: 5,
                label: 'No (tell the agent what to do instead)',
                scheme: scheme,
              ),

              // Champ d'instruction si option 5
              if (_selectedOption == 5) ...[
                const SizedBox(height: 6),
                TextField(
                  key: const Key('deny-reason-field'),
                  controller: _denyReasonController,
                  maxLines: 2,
                  minLines: 1,
                  autofocus: true,
                  enabled: !_isSubmitting && !widget.isExpired,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
                  decoration: InputDecoration(
                    labelText: 'Tell the agent what to do instead (optional)',
                    hintText: 'e.g.: Analyze the design language without downloading scripts',
                    labelStyle: TextStyle(
                      fontSize: 11.5,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                    prefixIcon: Icon(
                      Icons.reply_outlined,
                      size: 16,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                    filled: true,
                    fillColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: BorderSide(
                        color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                      ),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                      borderSide: BorderSide(
                        color: isDark ? AppColors.accentBlue : scheme.primary,
                        width: 1.5,
                      ),
                    ),
                  ),
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _handleSubmitSelected(),
                ),
              ],
            ] else ...[
              // Switch standard "Toujours autoriser pour cette session"
              Row(
                children: [
                  Icon(Icons.autorenew, size: 14, color: scheme.tertiary),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Toujours autoriser ${request.toolName} pour cette session',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  Tooltip(
                    message:
                        'Si activé, le daemon approuvera automatiquement\n'
                        'toutes les commandes "${request.toolName}" pour\n'
                        'cette session sans vous redemander.',
                    child: Switch(
                      value: _alwaysAllow,
                      onChanged: (v) {
                        HapticFeedback.lightImpact();
                        setState(() => _alwaysAllow = v);
                      },
                      activeColor: scheme.tertiary,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ),
              if (_showDenyReason) ...[
                const SizedBox(height: 6),
                TextField(
                  key: const Key('deny-reason-field'),
                  controller: _denyReasonController,
                  maxLines: 2,
                  minLines: 1,
                  autofocus: true,
                  enabled: !_isSubmitting && !widget.isExpired,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                  ),
                  decoration: InputDecoration(
                    labelText: "Expliquer à l'agent (optionnel)",
                    hintText: 'Ex. : fais un revert d\u2019abord, puis réessaie',
                    labelStyle: TextStyle(
                      fontSize: 11.5,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                    prefixIcon: Icon(
                      Icons.reply_outlined,
                      size: 16,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                    filled: true,
                    fillColor: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _handleDecision(
                    ToolDecision.deny,
                    denyReason: _denyReasonController.text.trim(),
                  ),
                ),
              ],
            ],

            // ── Bandeau Expiré
            if (widget.isExpired) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: scheme.error.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: scheme.error.withValues(alpha: 0.4)),
                ),
                child: Row(
                  children: [
                    Icon(Icons.timer_off_outlined, size: 15, color: scheme.error),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Approbation expirée — auto-refusée par le daemon (5 min)',
                        style: TextStyle(
                          fontSize: 11,
                          color: scheme.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 10),

            // ── Boutons d'action : Refuser & Approuver
            LayoutBuilder(
              builder: (context, btnConstraints) {
                final isCompact = btnConstraints.maxWidth < 300;
                return Row(
                  children: [
                    // Bouton Refuser
                    OutlinedButton(
                      key: const Key('deny-btn'),
                      onPressed: _isSubmitting || widget.isExpired
                          ? null
                          : () {
                              HapticFeedback.lightImpact();
                              _handleDecision(
                                ToolDecision.deny,
                                denyReason: _denyReasonController.text.trim(),
                              );
                            },
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(
                          color: isDark ? AppColors.borderStrong : scheme.outlineVariant,
                        ),
                        padding: EdgeInsets.symmetric(horizontal: isCompact ? 8 : 18, vertical: 10),
                        minimumSize: const Size(0, 44),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                      ),
                      child: Text(
                        _isScopedApproval ? 'Skip' : 'Refuser',
                        style: TextStyle(
                          color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Spacer(),
                    // Bouton Approuver / Submit
                    ElevatedButton.icon(
                      key: const Key('allow-btn'),
                      onPressed: _isSubmitting ||
                              widget.isExpired ||
                              (_isDestructive && !_destructiveConfirmed && !(_selectedOption == 5))
                          ? null
                          : _handleSubmitSelected,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: (_selectedOption == 5)
                            ? (isDark ? AppColors.danger : scheme.error)
                            : (isDark ? AppColors.wizardAccent : scheme.primary),
                        foregroundColor: Colors.white,
                        padding: EdgeInsets.symmetric(horizontal: isCompact ? 10 : 18, vertical: 10),
                        minimumSize: const Size(0, 44),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                        elevation: 0,
                      ),
                      icon: _isSubmitting
                          ? const SizedBox(
                              width: 13,
                              height: 13,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Icon(
                              _selectedOption == 5 ? Icons.close : Icons.keyboard_return,
                              size: 14,
                              color: Colors.white,
                            ),
                      label: Text(
                        _isSubmitting
                            ? 'En cours...'
                            : (_selectedOption == 5 ? 'Refuser' : 'Approuver'),
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    ),
  );
}
}

/// Modal "Poser une question" : sélection d'option claire + bouton "Continuer" désactivé tant qu'aucune option n'est choisie.
class AskQuestionModal extends StatefulWidget {
  final String question;
  final List<String> options;
  final Function(String selectedOption) onSubmit;

  const AskQuestionModal({
    super.key,
    required this.question,
    required this.options,
    required this.onSubmit,
  });

  @override
  State<AskQuestionModal> createState() => _AskQuestionModalState();
}

class _AskQuestionModalState extends State<AskQuestionModal> {
  String? _selectedOption;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.question,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 14),
          ...widget.options.map((opt) {
            final isSelected = _selectedOption == opt;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Semantics(
                button: true,
                selected: isSelected,
                label: opt,
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _selectedOption = opt);
                  },
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Theme.of(context).colorScheme.primaryContainer
                          : Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isSelected
                            ? Theme.of(context).colorScheme.primary
                            : Theme.of(context).colorScheme.outlineVariant,
                        width: isSelected ? 1.5 : 1.0,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
                          size: 18,
                          color: isSelected
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            opt,
                            style: TextStyle(
                              fontSize: 13,
                              color: Theme.of(context).colorScheme.onSurface,
                              fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          }),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _selectedOption == null
                  ? null
                  : () {
                      widget.onSubmit(_selectedOption!);
                      Navigator.of(context).pop();
                    },
              child: const Text('Continuer'),
            ),
          ),
        ],
      ),
    );
  }
}
