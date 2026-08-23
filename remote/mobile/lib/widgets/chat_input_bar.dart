import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/protocol/daemon_api.dart';
import '../core/protocol/model_catalog.dart';
import '../services/settings_store.dart';
import '../features/chat_stream/models/mention_item.dart';
import '../features/chat_stream/widgets/mention_autocomplete_overlay.dart';
import 'bouncing_tap.dart';
import 'custom_dropdown_overlay.dart';
import 'voice_prompt_dialog.dart';
import '../theme/app_colors.dart';

/// Modes d'envoi : immédiat ou mis en file pour exécution séquentielle.
enum SendMode { immediate, queued }

/// Données d'un fichier ou d'une image attachée avant l'envoi.
class _AttachedItem {
  final String name;
  final int size;
  final String? mimeType;
  final Uint8List? bytes;
  final String? base64Data;
  final bool isImage;
  final String? textContent;

  const _AttachedItem({
    required this.name,
    required this.size,
    this.mimeType,
    this.bytes,
    this.base64Data,
    required this.isImage,
    this.textContent,
  });
}

/// Entrée de la palette de commandes slash (/btw, /plan, ...).
class _SlashCommand {
  final IconData icon;
  final String title;
  final String subtitle;

  const _SlashCommand(this.icon, this.title, this.subtitle);
}

/// Registre unique des commandes slash — filtré en tapant (P2).
const List<_SlashCommand> _slashCommands = [
  _SlashCommand(Icons.chat_bubble_outline_rounded, '/btw', 'Side question without breaking flow'),
  _SlashCommand(Icons.quiz_outlined, '/grill-me', 'Interactive planning interview'),
  _SlashCommand(Icons.flag_outlined, '/goal', 'Autonomous goal until fully achieved'),
  _SlashCommand(Icons.schedule_outlined, '/schedule', 'Set recurring timer / background cron'),
  _SlashCommand(Icons.rate_review_outlined, '/review', 'Audit code diffs and complexity'),
  _SlashCommand(Icons.edit_note_rounded, '/plan', 'Draft technical implementation plan'),
  _SlashCommand(Icons.design_services, '/design', 'Generate UI components & screens'),
  _SlashCommand(Icons.code, '/code', 'Generate Code Implementation'),
  _SlashCommand(Icons.search, '/search', 'Semantic project search'),
];

class ChatInputBar extends StatefulWidget {
  /// Signature unique : message + mode file + modèle sélectionné.
  /// C2 (audit clean-code-guard) : typée — plus de `Function` opaque ni de
  /// try/catch en cascade côté appelant.
  final void Function(
    String message, {
    bool queued,
    String? modelUID,
    int? modelEnum,
    List<String>? images,
    String? base64Data,
    String? fileName,
    List<Map<String, dynamic>>? media,
  }) onSend;
  final bool isConnected;

  /// Feature queue : true si l'agent a un travail actif.
  final bool hasActiveStream;

  final DaemonApi? api;
  final String? cascadeId;
  final String? initialModel;
  final ValueChanged<String>? onModelChanged;
  final VoidCallback? onStop;

  /// P6 : texte initial (brouillon persisté) à charger dans le champ.
  final String initialText;

  /// P6 : notifie le parent de chaque frappe pour persister le brouillon.
  final ValueChanged<String>? onDraftChanged;

  /// Nom du projet / workspace actif affiché au-dessus de la barre
  final String? projectName;
  final VoidCallback? onSelectProject;

  /// Actions rapides & plan actif
  final bool hasPlan;
  final VoidCallback? onProceedPlan;
  final VoidCallback? onRunTests;
  final VoidCallback? onViewDiff;

  const ChatInputBar({
    super.key,
    required this.onSend,
    this.isConnected = true,
    this.hasActiveStream = false,
    this.api,
    this.cascadeId,
    this.initialModel,
    this.onModelChanged,
    this.onStop,
    this.initialText = '',
    this.onDraftChanged,
    this.projectName,
    this.onSelectProject,
    this.hasPlan = false,
    this.onProceedPlan,
    this.onRunTests,
    this.onViewDiff,
  });

  @override
  State<ChatInputBar> createState() => ChatInputBarState();
}

class ChatInputBarState extends State<ChatInputBar> with WidgetsBindingObserver {
  void openModelSelector() {
    if (mounted) {
      _showModelDropdown(context);
    }
  }

  /// Change programmatiquement le modèle sélectionné pour cette session
  void setModel(String modelIdOrName, {int? modelEnum, String? effort}) {
    if (!mounted) return;
    final matched = ModelCatalog.findModel(modelIdOrName, customModels: _availableModels);
    final effective = effort != null ? matched.withEffort(effort) : matched;
    setState(() {
      _selectedModel = effective.shortName;
      _selectedModelId = effective.id;
      _selectedModelEnum = modelEnum ?? effective.modelEnum;
      if (effort != null) {
        _reasoningEffort = effort;
      }
    });
    final cascadeId = widget.cascadeId;
    if (cascadeId != null && cascadeId.isNotEmpty) {
      SharedPreferences.getInstance().then((prefs) {
        prefs.setString('session_model_$cascadeId', effective.id);
      });
      widget.api?.setSessionModel(
        cascadeId,
        effective.id,
        modelEnum: effective.modelEnum,
      );
    }
    widget.onModelChanged?.call(effective.displayName);
  }

  /// Insère une citation markdown formatée (> texte) dans le champ de saisie
  void insertQuote(String quoteText) {
    if (!mounted) return;
    final lines = quoteText.trim().split('\n');
    final formattedQuote = lines.take(6).map((l) => '> $l').join('\n');
    final current = _controller.text;
    final newContent = current.isEmpty
        ? '$formattedQuote\n\n'
        : '$current\n\n$formattedQuote\n\n';
    _controller.text = newContent;
    _controller.selection = TextSelection.collapsed(offset: newContent.length);
  }

  /// Remplace le texte de la barre de saisie
  void setText(String text) {
    if (!mounted) return;
    _controller.text = text;
    _controller.selection = TextSelection.collapsed(offset: text.length);
  }

  String get selectedModel => _selectedModel;

  void setSelectedModel(String modelName) {
    if (!mounted || modelName.isEmpty) return;
    setState(() {
      _selectedModel = modelName;
      _selectedModelId = modelName.toLowerCase().replaceAll(' ', '-');
    });
  }

  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  String _selectedModel = 'Gemini 3.7 Flash';
  String? _selectedModelId = 'gemini-3.7-flash';
  int? _selectedModelEnum = 312;
  List<AntigravityModel> _availableModels = ModelCatalog.standardModels;

  String get _displayModelName {
    var name = _selectedModel.trim();
    if (name.contains('/')) {
      name = name.split('/').last.trim();
    }
    return name;
  }

  Color _getModelProviderColor(String modelName, ColorScheme scheme) {
    final lower = modelName.toLowerCase();
    if (lower.contains('claude') || lower.contains('anthropic')) {
      return AppColors.providerAnthropic;
    }
    if (lower.contains('gpt') || lower.contains('openai') || lower.contains('codex')) {
      return AppColors.providerOpenAI;
    }
    if (lower.contains('deepseek')) {
      return AppColors.providerCustom;
    }
    if (lower.contains('ollama')) {
      return AppColors.providerOllama;
    }
    if (lower.contains('gemini') || lower.contains('google')) {
      return AppColors.accentBlue;
    }
    return scheme.primary;
  }

  bool _isSendPressed = false;
  SendMode _sendMode = SendMode.immediate;
  // Feature Niveaux d'effort de raisonnement (Faible, Moyen, Élevé)
  String _reasoningEffort = 'Moyen'; // Options: 'Faible', 'Moyen', 'Élevé'
  // Feature multi-attachements fichiers et images (Quiet Console)
  final List<_AttachedItem> _attachments = [];
  double? _uploadProgress;

  final GlobalKey _modelButtonKey = GlobalKey();
  final GlobalKey _textFieldKey = GlobalKey();

  // Quel dropdown est actuellement ouvert (si ouvert via le clavier).
  // Permet de fermer mention/action à la frappe sans toucher au dropdown
  // modèle (ouvert au tap, pas au clavier).
  bool _mentionOrActionOpen = false;
  bool _isSending = false;
  Timer? _sendDebounceTimer;
  String _lastDraftText = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _focusNode.addListener(_onFocusChanged);
    if (widget.initialText.isNotEmpty) {
      // P6 : restaure le brouillon persisté avant d'écouter les frappes.
      _controller.text = widget.initialText;
      _lastDraftText = widget.initialText;
      _controller.selection = TextSelection.collapsed(
        offset: _controller.text.length,
      );
    }
    _controller.addListener(_onTextChanged);
    widget.onDraftChanged?.call(_controller.text);
    if (widget.initialModel != null && widget.initialModel!.isNotEmpty) {
      setModel(widget.initialModel!);
    }
    _loadSessionModelForCascade();
  }

  void _onFocusChanged() {
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
  }

  @override
  void didUpdateWidget(covariant ChatInputBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.cascadeId != widget.cascadeId ||
        (widget.initialModel != null && widget.initialModel != oldWidget.initialModel)) {
      if (widget.initialText != _controller.text) {
        _controller.text = widget.initialText;
        _lastDraftText = widget.initialText;
        _controller.selection = TextSelection.collapsed(
          offset: _controller.text.length,
        );
      }
      _loadSessionModelForCascade();
      // Re-focus the text input when switching conversations via keyboard shortcuts
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _focusNode.canRequestFocus) {
          _focusNode.requestFocus();
        }
      });
    } else if (oldWidget.initialText != widget.initialText && widget.initialText != _controller.text) {
      _controller.text = widget.initialText;
      _lastDraftText = widget.initialText;
      _controller.selection = TextSelection.collapsed(
        offset: _controller.text.length,
      );
    }
    if (oldWidget.api != widget.api || oldWidget.isConnected != widget.isConnected) {
      _loadModelsAndPreferences();
    }
  }

  Future<void> _loadSessionModelForCascade() async {
    if (widget.initialModel != null && widget.initialModel!.isNotEmpty) {
      setModel(widget.initialModel!);
      return;
    }
    final cascadeId = widget.cascadeId;
    if (cascadeId != null && cascadeId.isNotEmpty) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final saved = prefs.getString('session_model_$cascadeId');
        if (saved != null && saved.isNotEmpty && mounted) {
          setModel(saved);
          return;
        }
      } catch (_) {}
    }
    _loadModelsAndPreferences();
  }

  Future<void> _loadModelsAndPreferences() async {
    List<AntigravityModel> models = _availableModels;
    if (widget.api != null) {
      try {
        final fetched = await ModelCatalog.getAllAvailableModels(widget.api);
        if (fetched.isNotEmpty) {
          models = fetched;
          if (mounted) {
            setState(() {
              _availableModels = models;
            });
          }
        }
      } catch (_) {}
    }

    if (widget.initialModel != null && widget.initialModel!.isNotEmpty) {
      final matched = ModelCatalog.findModel(widget.initialModel!, customModels: models);
      if (mounted) {
        setState(() {
          _selectedModel = matched.shortName;
          _selectedModelId = matched.id;
          _selectedModelEnum = matched.modelEnum;
        });
      }
      return;
    }

    final cascadeId = widget.cascadeId;
    if (cascadeId != null && cascadeId.isNotEmpty) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final sessionModel = prefs.getString('session_model_$cascadeId');
        if (sessionModel != null && sessionModel.isNotEmpty && mounted) {
          final matched = ModelCatalog.findModel(sessionModel, customModels: models);
          setState(() {
            _selectedModel = matched.shortName;
            _selectedModelId = matched.id;
            _selectedModelEnum = matched.modelEnum;
          });
          return;
        }
      } catch (_) {}
    }

    try {
      final s = await SettingsStore.load();
      final savedModel = s['defaultModel'] as String?;
      if (savedModel != null && savedModel.isNotEmpty && mounted) {
        final matched = ModelCatalog.findModel(savedModel, customModels: models);
        setState(() {
          _selectedModel = matched.shortName;
          _selectedModelId = matched.id;
          _selectedModelEnum = matched.modelEnum;
        });
      }
    } catch (_) {}
  }

  void _onTextChanged() {
    _isSending = false;
    final text = _controller.text;
    // P6 : notifier le parent uniquement si le contenu textuel a réellement changé
    // (évite d'écrire sur disque à chaque déplacement de curseur ou sélection).
    if (text != _lastDraftText) {
      _lastDraftText = text;
      widget.onDraftChanged?.call(text);
      if (mounted) setState(() {});
    }

    final selection = _controller.selection;
    if (!selection.isValid || selection.isCollapsed == false) {
      return;
    }
    final textBeforeCursor = text.substring(0, selection.start);
    if (textBeforeCursor.endsWith('@') ||
        textBeforeCursor.contains(RegExp(r'\B@\w*$'))) {
      final atIndex = textBeforeCursor.lastIndexOf('@');
      final query = atIndex >= 0 ? textBeforeCursor.substring(atIndex + 1) : '';
      _showMentionDropdown(query);
    } else if (textBeforeCursor.startsWith('/') ||
        textBeforeCursor.contains(RegExp(r'\n/\w*$'))) {
      // P2 : extraire le début de commande tapé pour filtrer la palette.
      final slashIndex = textBeforeCursor.lastIndexOf('/');
      final query =
          slashIndex >= 0 ? textBeforeCursor.substring(slashIndex + 1) : '';
      _showActionDropdown(query);
    } else {
      // On tape autre chose : fermer les dropdowns mention/action restés
      // ouverts (le dropdown modèle, ouvert au tap, n'est pas concerné).
      if (_mentionOrActionOpen) {
        _mentionOrActionOpen = false;
        CustomDropdownOverlay.hide();
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sendDebounceTimer?.cancel();
    _focusNode.removeListener(_onFocusChanged);
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }

  String _sanitizeInput(String raw) {
    // Supprime les lignes vides en trop lors du collage de texte brut multi-lignes
    return raw.replaceAll(RegExp(r'(\r?\n){3,}'), '\n\n').trim();
  }

  Future<void> _handleSend() async {
    if (_isSending) return;
    final rawText = _controller.text;
    final text = _sanitizeInput(rawText);
    final hasContent = text.isNotEmpty || _attachments.isNotEmpty;
    if (!hasContent) return;

    _isSending = true;
    HapticFeedback.lightImpact();

    // Normaliser les commandes slash avec saut de ligne \n ou tabulation \t
    String finalPayload = text;
    if (text.startsWith('/') && (text.contains('\n') || text.contains('\t'))) {
      final parts = text.split(RegExp(r'[\n\t]'));
      final cmd = parts.first.trim();
      final args = parts.sublist(1).join(' ').trim();
      finalPayload = '$cmd $args'.trim();
    }

    if (finalPayload.isNotEmpty && (_promptHistory.isEmpty || _promptHistory.last != finalPayload)) {
      _promptHistory.add(finalPayload);
      if (_promptHistory.length > 50) _promptHistory.removeAt(0);
    }

    // Traitement et upload des attachements vers le daemon si connecté
    final uploadedPaths = <String, String>{};
    final failedImages = <_AttachedItem>[];
    var hadUploadError = false;

    String effectiveCascadeId = widget.cascadeId ?? '';
    if (effectiveCascadeId.isEmpty) {
      effectiveCascadeId = 'cascade-${DateTime.now().millisecondsSinceEpoch}';
    }

    if (widget.api != null && _attachments.isNotEmpty) {
      setState(() => _uploadProgress = 0.05);
      for (int i = 0; i < _attachments.length; i++) {
        final att = _attachments[i];
        if (att.base64Data != null) {
          try {
            if (att.isImage) {
              final res = await widget.api!.uploadMedia(
                cascadeId: effectiveCascadeId,
                fileName: att.name,
                mimeType: att.mimeType ?? 'image/png',
                base64Data: att.base64Data!,
              );
              final fp = res['filePath'] as String? ?? res['path'] as String?;
              if (fp != null && fp.isNotEmpty) {
                uploadedPaths[att.name] = fp;
              } else {
                failedImages.add(att);
              }
            } else {
              final res = await widget.api!.uploadChunk(
                uploadId: 'up_${DateTime.now().millisecondsSinceEpoch}_$i',
                cascadeId: effectiveCascadeId,
                fileName: att.name,
                chunkIndex: 0,
                totalChunks: 1,
                totalBytes: att.size,
                base64Data: att.base64Data!,
              );
              final fp = res['filePath'] as String? ?? res['path'] as String?;
              if (fp != null && fp.isNotEmpty) {
                uploadedPaths[att.name] = fp;
              }
            }
          } catch (_) {
            hadUploadError = true;
            if (att.isImage) {
              failedImages.add(att);
            }
          }
        }
        if (mounted) {
          setState(() => _uploadProgress = (i + 1) / _attachments.length);
        }
      }
    } else if (_attachments.any((a) => a.isImage)) {
      failedImages.addAll(_attachments.where((a) => a.isImage));
    }

    if (hadUploadError && mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          content: Text('Upload direct vers le PC incomplet — transmission des images via le prompt.'),
          duration: Duration(seconds: 3),
        ),
      );
    }

    // Construction du payload textuel et de la liste des pièces jointes
    final buffer = StringBuffer();
    final images = _attachments.where((a) => a.isImage).toList();
    final files = _attachments.where((a) => !a.isImage).toList();
    final mediaList = <Map<String, dynamic>>[];

    if (images.isNotEmpty) {
      for (final img in images) {
        final fp = uploadedPaths[img.name];
        var clean = '';
        if (fp != null && fp.isNotEmpty) {
          clean = fp.replaceAll(r'\', '/');
          if (!clean.startsWith('file:///')) {
            clean = clean.startsWith('/') ? 'file://$clean' : 'file:///$clean';
          }
        } else if (img.base64Data != null && img.base64Data!.isNotEmpty) {
          clean = 'data:${img.mimeType ?? "image/png"};base64,${img.base64Data}';
        }
        if (clean.isNotEmpty) {
          buffer.writeln('![${img.name}]($clean)');
        }
        mediaList.add({
          'uri': clean,
          'mimeType': img.mimeType ?? 'image/png',
          'description': img.name,
          'name': img.name,
          if (img.base64Data != null) 'base64Data': img.base64Data,
        });
      }
    }

    for (final f in files) {
      if (f.textContent != null) {
        buffer.writeln('[Fichier: ${f.name}]\n${f.textContent}\n');
      } else {
        final fp = uploadedPaths[f.name];
        if (fp != null && fp.isNotEmpty) {
          var clean = fp.replaceAll(r'\', '/');
          if (!clean.startsWith('file:///')) {
            clean = clean.startsWith('/') ? 'file://$clean' : 'file:///$clean';
          }
          buffer.writeln('[ARTIFACT: ${f.name}]\nPath: $clean\n');
        } else {
          buffer.writeln('[Fichier joint: ${f.name} (${_formatBytes(f.size)})]');
        }
      }
      final fp = uploadedPaths[f.name];
      var clean = '';
      if (fp != null && fp.isNotEmpty) {
        clean = fp.replaceAll(r'\', '/');
        if (!clean.startsWith('file:///')) {
          clean = clean.startsWith('/') ? 'file://$clean' : 'file:///$clean';
        }
      }
      mediaList.add({
        'uri': clean,
        'mimeType': f.mimeType ?? _detectMime(f.name),
        'description': f.name,
        'name': f.name,
        if (f.base64Data != null) 'base64Data': f.base64Data,
      });
    }

    if (finalPayload.isNotEmpty) {
      if (buffer.isNotEmpty) buffer.writeln();
      buffer.write(finalPayload);
    }

    final fullMessage = buffer.toString().trim();

    List<String>? fallbackImages;
    String? fallbackBase64;
    String? fallbackFileName;

    if (failedImages.length == 1) {
      fallbackBase64 = failedImages.first.base64Data;
      fallbackFileName = failedImages.first.name;
    } else if (failedImages.length > 1) {
      fallbackImages = failedImages
          .map((f) => f.base64Data)
          .whereType<String>()
          .toList();
    }

    widget.onSend(
      fullMessage,
      queued: _sendMode == SendMode.queued || widget.hasActiveStream,
      modelUID: _selectedModelId,
      modelEnum: _selectedModelEnum,
      images: fallbackImages,
      base64Data: fallbackBase64,
      fileName: fallbackFileName,
      media: mediaList.isNotEmpty ? mediaList : null,
    );
    _controller.clear();
    _lastDraftText = '';
    // P6 : le message a été envoyé → purge le brouillon persisté.
    widget.onDraftChanged?.call('');
    if (mounted) {
      FocusScope.of(context).unfocus(); // Ferme le clavier sur mobile après l'envoi
      setState(() {
        _attachments.clear();
        _uploadProgress = null;
        _isSending = false;
      });
    }
  }

  /// Shortcut Cmd+L / Ctrl+L : citer le texte sélectionné
  void _quoteSelectedText() {
    final selection = _controller.selection;
    if (!selection.isValid || selection.isCollapsed) {
      final text = _controller.text;
      if (text.isNotEmpty) {
        _controller.text = '> $text';
      }
      return;
    }
    final selectedText = _controller.text.substring(
      selection.start,
      selection.end,
    );
    final quoted = selectedText.split('\n').map((l) => '> $l').join('\n');
    final newText = _controller.text.replaceRange(
      selection.start,
      selection.end,
      quoted,
    );
    _controller.text = newText;
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  static String _detectMime(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.webm')) return 'audio/webm';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    return 'application/octet-stream';
  }

  Color _badgeColorForExtension(String name, ColorScheme scheme) {
    if (name.endsWith('/') || !name.contains('.')) {
      return scheme.tertiary;
    }
    final ext = name.split('.').last.toLowerCase();
    switch (ext) {
      case 'json':
        return scheme.tertiary;
      case 'md':
        return scheme.primary;
      case 'csv':
        return scheme.secondary;
      case 'dart':
      case 'ts':
      case 'js':
      case 'py':
      case 'go':
        return scheme.primary;
      default:
        return scheme.tertiary;
    }
  }

  IconData _iconForExtension(String name) {
    final clean = name.trim();
    if (clean.endsWith('/') || clean.endsWith('\\') || clean.startsWith('folder:') || clean.startsWith('dir:') || (!clean.contains('.') && !clean.startsWith('.'))) {
      return Icons.folder_outlined;
    }
    final ext = clean.split('.').last.toLowerCase();
    switch (ext) {
      case 'json':
        return Icons.data_object;
      case 'md':
        return Icons.article_outlined;
      case 'csv':
        return Icons.table_chart_outlined;
      case 'dart':
      case 'ts':
      case 'js':
      case 'py':
      case 'go':
        return Icons.code_rounded;
      case 'pdf':
        return Icons.picture_as_pdf_outlined;
      default:
        return Icons.description_outlined;
    }
  }

  void _removeAttachment(int index) {
    if (index >= 0 && index < _attachments.length) {
      setState(() => _attachments.removeAt(index));
    }
  }

  void _clearAttachments() {
    setState(() => _attachments.clear());
  }

  /// Sélection d'images natives depuis la galerie (support multi-sélection)
  Future<void> _pickImageFromGallery() async {
    try {
      final picker = ImagePicker();
      final pickedList = await picker.pickMultiImage(
        maxWidth: 2048,
        maxHeight: 2048,
        imageQuality: 85,
      );
      if (pickedList.isEmpty) return;

      const maxFileSize = 20 * 1024 * 1024; // 20 MB
      const maxAttachments = 10;
      final newItems = <_AttachedItem>[];

      for (final picked in pickedList) {
        if (_attachments.length + newItems.length >= maxAttachments) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Limite atteinte : 10 pièces jointes au maximum'),
                duration: Duration(seconds: 3),
              ),
            );
          }
          break;
        }

        final bytes = await picked.readAsBytes();
        final name = picked.name.isNotEmpty ? picked.name : 'image_${DateTime.now().millisecondsSinceEpoch}.jpg';
        if (bytes.length > maxFileSize) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Image trop volumineuse : "$name" dépasse 20 Mo'),
                duration: const Duration(seconds: 3),
              ),
            );
          }
          continue;
        }

        final mime = picked.mimeType ?? _detectMime(name);
        final b64 = base64Encode(bytes);
        newItems.add(_AttachedItem(
          name: name,
          size: bytes.length,
          mimeType: mime,
          bytes: bytes,
          base64Data: b64,
          isImage: true,
        ));
      }

      if (newItems.isNotEmpty) {
        setState(() => _attachments.addAll(newItems));
      }
    } catch (_) {
      _pickImage();
    }
  }

  /// Prise de photo directe avec l'appareil photo
  Future<void> _pickImageFromCamera() async {
    try {
      if (_attachments.length >= 10) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Limite atteinte : 10 pièces jointes au maximum'),
              duration: Duration(seconds: 3),
            ),
          );
        }
        return;
      }
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 2048,
        maxHeight: 2048,
        imageQuality: 85,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      final name = 'photo_${DateTime.now().millisecondsSinceEpoch}.jpg';
      if (bytes.length > 20 * 1024 * 1024) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Photo trop volumineuse (> 20 Mo)'), duration: Duration(seconds: 3)),
          );
        }
        return;
      }
      final mime = 'image/png';
      final b64 = base64Encode(bytes);

      setState(() {
        _attachments.add(_AttachedItem(
          name: name,
          size: bytes.length,
          mimeType: mime,
          bytes: bytes,
          base64Data: b64,
          isImage: true,
        ));
      });
    } catch (_) {
      _pickImage();
    }
  }

  /// Sélection de fichiers natifs du smartphone (support multi-fichiers)
  Future<void> _pickFileNative() async {
    try {
      final res = await FilePicker.pickFiles(
        withData: true,
        allowMultiple: true,
      );
      if (res == null || res.files.isEmpty) return;

      const maxFileSize = 20 * 1024 * 1024;
      const maxAttachments = 10;
      final newItems = <_AttachedItem>[];
      for (final f in res.files) {
        if (_attachments.length + newItems.length >= maxAttachments) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Limite atteinte : 10 pièces jointes au maximum'), duration: Duration(seconds: 3)),
            );
          }
          break;
        }
        Uint8List? bytes = f.bytes;
        if (bytes == null && f.path != null) {
          try {
            bytes = await File(f.path!).readAsBytes();
          } catch (_) {}
        }
        if (bytes == null || bytes.isEmpty) continue;
        final name = f.name;
        final size = f.size > 0 ? f.size : bytes.length;
        if (size > maxFileSize) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Fichier "$name" trop volumineux (> 20 Mo)'), duration: const Duration(seconds: 3)),
            );
          }
          continue;
        }
        final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
        final isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif'].contains(ext);
        final b64 = base64Encode(bytes);
        String? textContent;
        if (['txt', 'json', 'md', 'csv', 'dart', 'ts', 'js', 'py', 'go', 'yaml', 'yml', 'html', 'css', 'xml', 'sh'].contains(ext) && bytes.length < 500000) {
          try {
            textContent = utf8.decode(bytes, allowMalformed: true);
          } catch (_) {}
        }
        newItems.add(_AttachedItem(
          name: name,
          size: size,
          mimeType: isImg ? 'image/png' : 'application/octet-stream',
          bytes: bytes,
          base64Data: b64,
          isImage: isImg,
          textContent: textContent,
        ));
      }

      if (newItems.isNotEmpty) {
        setState(() => _attachments.addAll(newItems));
      }
    } catch (_) {
      _pickTextFile();
    }
  }

  /// Collage automatique et intelligent depuis le presse-papier
  Future<void> _pasteFromClipboard() async {
    try {
      final data = await Clipboard.getData(Clipboard.kTextPlain);
      final text = data?.text?.trim();
      if (text == null || text.isEmpty) return;

      if (text.startsWith('data:image/') && text.contains('base64,')) {
        final parts = text.split('base64,');
        final b64 = parts.last.trim();
        Uint8List? bytes;
        try {
          bytes = base64Decode(b64);
        } catch (_) {}
        final name = 'clipboard_${DateTime.now().millisecondsSinceEpoch}.png';
        setState(() {
          _attachments.add(_AttachedItem(
            name: name,
            size: bytes?.length ?? 0,
            mimeType: 'image/png',
            bytes: bytes,
            base64Data: b64,
            isImage: true,
          ));
        });
      } else if (text.length > 100 || text.startsWith('{') || text.startsWith('[') || text.startsWith('<?') || text.contains('\n')) {
        final isJson = (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
        final name = isJson ? 'clipboard_data.json' : 'clipboard_snippet.txt';
        final bytes = Uint8List.fromList(utf8.encode(text));
        setState(() {
          _attachments.add(_AttachedItem(
            name: name,
            size: bytes.length,
            mimeType: isJson ? 'application/json' : 'text/plain',
            bytes: bytes,
            base64Data: base64Encode(bytes),
            isImage: false,
            textContent: text,
          ));
        });
      } else {
        _insertTextAtCursor(text);
      }
    } catch (_) {}
  }

  /// Feature attachement .txt, .json, .md, .csv (Fallback manuel)
  Future<void> _pickTextFile() async {
    final result = await showDialog<Map<String, String>?>(
      context: context,
      builder: (ctx) {
        final scheme = Theme.of(ctx).colorScheme;
        final nameCtrl = TextEditingController(text: 'data.json');
        final contentCtrl = TextEditingController();
        return AlertDialog(
          scrollable: true,
          backgroundColor: scheme.surfaceContainer,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            side: BorderSide(color: scheme.outlineVariant),
          ),
          title: Text(
            'Joindre un fichier (.txt, .json, .md, .csv)',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: scheme.onSurface,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameCtrl,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: const InputDecoration(
                    labelText: 'Nom du fichier (ex: data.json, doc.md)',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: contentCtrl,
                  maxLines: 6,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: const InputDecoration(
                    labelText: 'Contenu',
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Annuler'),
            ),
            ElevatedButton(
              onPressed:
                  () => Navigator.of(ctx).pop({
                    'name': nameCtrl.text.trim(),
                    'content': contentCtrl.text,
                  }),
              child: const Text('Joindre'),
            ),
          ],
        );
      },
    );
    if (result != null && result['content']!.isNotEmpty) {
      final name = result['name']!.isEmpty ? 'fichier.txt' : result['name']!;
      final content = result['content']!;
      final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
      final isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif'].contains(ext);
      Uint8List? bytes;
      if (isImg) {
        try {
          bytes = base64Decode(content);
        } catch (_) {
          bytes = Uint8List.fromList(utf8.encode(content));
        }
      } else {
        bytes = Uint8List.fromList(utf8.encode(content));
      }
      final b64 = isImg ? base64Encode(bytes) : base64Encode(bytes);
      setState(() {
        _attachments.add(_AttachedItem(
          name: name,
          size: bytes!.length,
          mimeType: isImg ? 'image/png' : 'text/plain',
          bytes: bytes,
          base64Data: b64,
          isImage: isImg,
          textContent: isImg ? null : content,
        ));
      });
    }
  }

  /// Feature attachement image/photo (Fallback Base64)
  Future<void> _pickImage() async {
    final result = await showDialog<Map<String, String>?>(
      context: context,
      builder: (ctx) {
        final scheme = Theme.of(ctx).colorScheme;
        final nameCtrl = TextEditingController(text: 'screenshot.png');
        final mimeCtrl = TextEditingController(text: 'image/png');
        final base64Ctrl = TextEditingController();
        return AlertDialog(
          scrollable: true,
          backgroundColor: scheme.surfaceContainer,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            side: BorderSide(color: scheme.outlineVariant),
          ),
          title: Text(
            'Joindre une image / photo',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: scheme.onSurface,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameCtrl,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: const InputDecoration(
                    labelText: 'Nom du fichier (ex: photo.png, img.jpg)',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: mimeCtrl,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: const InputDecoration(
                    labelText: 'Type MIME (ex: image/png, image/jpeg)',
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: base64Ctrl,
                  maxLines: 4,
                  style: TextStyle(fontSize: 13, color: scheme.onSurface),
                  decoration: const InputDecoration(
                    labelText: 'Données Base64',
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Annuler'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop({
                'fileName': nameCtrl.text.trim().isEmpty ? 'screenshot.png' : nameCtrl.text.trim(),
                'mimeType': mimeCtrl.text.trim().isEmpty ? 'image/png' : mimeCtrl.text.trim(),
                'base64Data': base64Ctrl.text.trim(),
              }),
              child: const Text('Joindre'),
            ),
          ],
        );
      },
    );

    if (result != null && result['base64Data']!.isNotEmpty) {
      final fileName = result['fileName']!;
      final mimeType = result['mimeType']!;
      final base64Data = result['base64Data']!;

      Uint8List? rawBytes;
      try {
        rawBytes = base64Decode(base64Data);
      } catch (_) {}

      setState(() {
        _attachments.add(_AttachedItem(
          name: fileName,
          size: rawBytes?.length ?? 0,
          mimeType: mimeType,
          bytes: rawBytes,
          base64Data: base64Data,
          isImage: true,
        ));
      });
    }
  }

  /// Aperçu visuel Quiet Console des attachements sélectionnés (carte unique ou carousel scrollable)
  Widget _buildAttachmentPreview(ColorScheme scheme, bool isDark) {
    if (_attachments.isEmpty) return const SizedBox.shrink();

    final totalBytes = _attachments.fold<int>(0, (sum, item) => sum + item.size);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Barre de progression d'upload si en cours
          if (_uploadProgress != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: _uploadProgress,
                        minHeight: 3,
                        backgroundColor: isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest,
                        valueColor: AlwaysStoppedAnimation<Color>(scheme.primary),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${((_uploadProgress ?? 0) * 100).toInt()}%',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: scheme.primary,
                    ),
                  ),
                ],
              ),
            ),

          if (_attachments.length == 1)
            // Carte unique détaillée
            _buildSingleAttachmentCard(_attachments.first, 0, scheme, isDark)
          else
            // Multi-attachements : Header récapitulatif + Carousel horizontal
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 6, left: 2, right: 2),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.attach_file_rounded, size: 13, color: scheme.primary),
                          const SizedBox(width: 4),
                          Text(
                            '${_attachments.length} pièces jointes (${_formatBytes(totalBytes)})',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                      BouncingTap(
                        onTap: _clearAttachments,
                        child: Text(
                          'Tout effacer',
                          style: TextStyle(
                            fontSize: 11,
                            color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                            decoration: TextDecoration.underline,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  height: 48,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _attachments.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (ctx, idx) => _buildCompactAttachmentCard(_attachments[idx], idx, scheme, isDark),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  void _showAttachmentInspectDialog(_AttachedItem att, int index) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          side: BorderSide(
            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
          ),
        ),
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
              child: Row(
                children: [
                  Icon(
                    att.isImage ? Icons.image_outlined : _iconForExtension(att.name),
                    size: 18,
                    color: _badgeColorForExtension(att.name, scheme),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      att.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                      ),
                    ),
                  ),
                  Text(
                    _formatBytes(att.size),
                    style: TextStyle(
                      fontSize: 11,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: () => Navigator.of(ctx).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

            // Content preview
            Flexible(
              child: att.isImage && att.bytes != null
                  ? Container(
                      constraints: const BoxConstraints(maxHeight: 380),
                      color: isDark ? AppColors.editorBackground : scheme.surfaceContainerLow,
                      child: InteractiveViewer(
                        minScale: 0.5,
                        maxScale: 4.0,
                        child: Center(
                          child: Image.memory(
                            att.bytes!,
                            fit: BoxFit.contain,
                          ),
                        ),
                      ),
                    )
                  : Container(
                      constraints: const BoxConstraints(maxHeight: 300),
                      padding: const EdgeInsets.all(12),
                      color: isDark ? AppColors.editorBackground : scheme.surfaceContainerLow,
                      child: SingleChildScrollView(
                        child: SelectableText(
                          att.textContent ?? '[Fichier binaire (${_formatBytes(att.size)})]',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 11.5,
                            color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                          ),
                        ),
                      ),
                    ),
            ),
            const Divider(height: 1),

            // Actions
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton.icon(
                    icon: Icon(Icons.delete_outline_rounded, size: 16, color: scheme.error),
                    label: Text(
                      'Supprimer',
                      style: TextStyle(color: scheme.error, fontSize: 12.5),
                    ),
                    onPressed: () {
                      Navigator.of(ctx).pop();
                      _removeAttachment(index);
                    },
                  ),
                  ElevatedButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    ),
                    child: const Text('Fermer'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSingleAttachmentCard(_AttachedItem att, int index, ColorScheme scheme, bool isDark) {
    final sizeStr = _formatBytes(att.size);
    final isImg = att.isImage;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.6),
          width: 0.8,
        ),
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => _showAttachmentInspectDialog(att, index),
            child: isImg && att.bytes != null
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.memory(
                      att.bytes!,
                      width: 36,
                      height: 36,
                      fit: BoxFit.cover,
                    ),
                  )
                : Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: _badgeColorForExtension(att.name, scheme).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Icon(
                      _iconForExtension(att.name),
                      size: 20,
                      color: _badgeColorForExtension(att.name, scheme),
                    ),
                  ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: GestureDetector(
              onTap: () => _showAttachmentInspectDialog(att, index),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    att.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                  ),
                  if (sizeStr.isNotEmpty)
                    Text(
                      sizeStr,
                      style: TextStyle(
                        fontSize: 11,
                        color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          BouncingTap(
            onTap: () => _removeAttachment(index),
            child: Container(
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(
                color: isDark ? AppColors.surfaceHover : scheme.surfaceContainer,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.close_rounded,
                size: 14,
                color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompactAttachmentCard(_AttachedItem att, int index, ColorScheme scheme, bool isDark) {
    final isImg = att.isImage;

    return Container(
      width: 140,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.6),
          width: 0.8,
        ),
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => _showAttachmentInspectDialog(att, index),
            child: isImg && att.bytes != null
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Image.memory(
                      att.bytes!,
                      width: 28,
                      height: 28,
                      fit: BoxFit.cover,
                    ),
                  )
                : Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: _badgeColorForExtension(att.name, scheme).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Icon(
                      _iconForExtension(att.name),
                      size: 16,
                      color: _badgeColorForExtension(att.name, scheme),
                    ),
                  ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: GestureDetector(
              onTap: () => _showAttachmentInspectDialog(att, index),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    att.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                    ),
                  ),
                  Text(
                    _formatBytes(att.size),
                    style: TextStyle(
                      fontSize: 10,
                      color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 4),
          BouncingTap(
            onTap: () => _removeAttachment(index),
            child: Icon(
              Icons.close_rounded,
              size: 14,
              color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  void _showAttachmentMenu() {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                ),
              ),
              ListTile(
                leading: Icon(Icons.camera_alt_outlined, color: scheme.primary),
                title: Text(
                  'Prendre une photo',
                  style: TextStyle(color: isDark ? AppColors.inkPrimary : scheme.onSurface, fontWeight: FontWeight.w500),
                ),
                subtitle: Text('Appareil photo en direct', style: TextStyle(color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant, fontSize: 12)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _pickImageFromCamera();
                },
              ),
              ListTile(
                leading: Icon(Icons.photo_library_outlined, color: scheme.primary),
                title: Text(
                  'Choisir des images',
                  style: TextStyle(color: isDark ? AppColors.inkPrimary : scheme.onSurface, fontWeight: FontWeight.w500),
                ),
                subtitle: Text('Galerie photos multi-sélection (PNG, JPEG, WebP, GIF)', style: TextStyle(color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant, fontSize: 12)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _pickImageFromGallery();
                },
              ),
              ListTile(
                leading: Icon(Icons.file_present_outlined, color: scheme.primary),
                title: Text(
                  'Sélectionner des fichiers',
                  style: TextStyle(color: isDark ? AppColors.inkPrimary : scheme.onSurface, fontWeight: FontWeight.w500),
                ),
                subtitle: Text('Code, JSON, Markdown, texte, PDF...', style: TextStyle(color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant, fontSize: 12)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _pickFileNative();
                },
              ),
              ListTile(
                leading: Icon(Icons.content_paste_rounded, color: scheme.primary),
                title: Text(
                  'Coller depuis le presse-papier',
                  style: TextStyle(color: isDark ? AppColors.inkPrimary : scheme.onSurface, fontWeight: FontWeight.w500),
                ),
                subtitle: Text('Image Base64, JSON, texte ou extrait de code', style: TextStyle(color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant, fontSize: 12)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _pasteFromClipboard();
                },
              ),
              ListTile(
                leading: Icon(Icons.edit_note_outlined, color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant),
                title: Text(
                  'Saisie manuelle (Base64 / Texte)',
                  style: TextStyle(color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant, fontSize: 13),
                ),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _pickTextFile();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showQueueSettings(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder:
          (ctx) => SafeArea(
            top: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Drag handle
                  Center(
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      width: 36,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Theme.of(ctx).colorScheme.outlineVariant,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                    ),
                  ),
                  Text(
                    "Mode d'envoi",
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    "Configurer le comportement d'exécution des messages.",
                    style: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 16),
                  _QueueTile(
                    title: 'Envoyer immédiatement',
                    subtitle: "Le message part dès l'envoi.",
                    icon: Icons.send_outlined,
                    selected: _sendMode == SendMode.immediate,
                    onTap: () {
                      setState(() => _sendMode = SendMode.immediate);
                      Navigator.of(ctx).pop();
                    },
                  ),
                  const SizedBox(height: 8),
                  _QueueTile(
                    title: "Mettre en file d'attente",
                    subtitle: 'Le message sera exécuté après la tâche en cours.',
                    icon: Icons.playlist_add_outlined,
                    selected: _sendMode == SendMode.queued,
                    onTap: () {
                      setState(() => _sendMode = SendMode.queued);
                      Navigator.of(ctx).pop();
                    },
                  ),
                  const SizedBox(height: 16),
                  Text(
                    "Effort de raisonnement par modèle",
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children:
                        ['Faible', 'Moyen', 'Élevé'].map((effort) {
                          final selected = _reasoningEffort == effort;
                          return Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 4),
                              child: ChoiceChip(
                                label: Text(effort),
                                selected: selected,
                                onSelected: (val) {
                                  if (val) {
                                    setState(() => _reasoningEffort = effort);
                                    Navigator.of(ctx).pop();
                                  }
                                },
                              ),
                            ),
                          );
                        }).toList(),
                  ),
                  const SizedBox(height: 12),
                ],
              ),
            ),
          ),
    );
  }

  void _insertTextAtCursor(String insertText) {
    final text = _controller.text;
    final selection = _controller.selection;
    if (selection.isValid) {
      // find where the @ or / started
      int start = selection.start;
      while (start > 0 && text[start - 1] != '@' && text[start - 1] != '/') {
        start--;
      }
      if (start > 0) start--; // include the @ or /

      final newText = text.replaceRange(start, selection.end, '$insertText ');
      _controller.text = newText;
      _controller.selection = TextSelection.collapsed(
        offset: start + insertText.length + 1,
      );
    } else {
      final prefix = text.isEmpty ? '' : '$text ';
      _controller.text = '$prefix$insertText ';
      _controller.selection = TextSelection.collapsed(
        offset: _controller.text.length,
      );
    }
  }

  void _showMentionDropdown([String query = '']) {
    _mentionOrActionOpen = true;
    final items = const [
      MentionItem(type: MentionType.file, label: 'main.dart', detail: 'lib/main.dart'),
      MentionItem(type: MentionType.file, label: 'pubspec.yaml', detail: 'Configuration & dependencies'),
      MentionItem(type: MentionType.file, label: 'README.md', detail: 'Project documentation'),
      MentionItem(type: MentionType.rule, label: 'clean_code', detail: '.agents/rules/clean_code.md'),
      MentionItem(type: MentionType.rule, label: 'ponytail', detail: 'Lazy senior dev / YAGNI architecture'),
      MentionItem(type: MentionType.rule, label: 'security', detail: 'Sandbox & security policies'),
      MentionItem(type: MentionType.mcp, label: 'coolify', detail: 'Coolify deploy & server management'),
      MentionItem(type: MentionType.mcp, label: 'github', detail: 'GitHub issues & PR automation'),
      MentionItem(type: MentionType.mcp, label: 'postgres', detail: 'PostgreSQL database inspection'),
      MentionItem(type: MentionType.conversation, label: 'previous_session', detail: 'Include previous turn context'),
      MentionItem(type: MentionType.terminal, label: 'active_terminal', detail: 'Include active terminal buffer'),
    ];

    CustomDropdownOverlay.show(
      context: context,
      targetKey: _textFieldKey,
      width: 280,
      maxHeight: 260,
      child: MentionAutocompleteOverlay(
        query: query,
        items: items,
        onSelected: (item) {
          _insertTextAtCursor(item.tag);
          CustomDropdownOverlay.hide();
        },
      ),
    );
  }

  void _showActionDropdown([String query = '']) {
    _mentionOrActionOpen = true;
    final q = query.toLowerCase().replaceAll('/', '').trim();

    // Classement et filtrage intelligent :
    // 1. Débute par la requête (priorité max)
    // 2. Titre contient la requête
    // 3. Description contient la requête
    final filtered = List<_SlashCommand>.from(_slashCommands.where((c) {
      if (q.isEmpty) return true;
      final t = c.title.toLowerCase().replaceAll('/', '');
      final sub = c.subtitle.toLowerCase();
      return t.contains(q) || sub.contains(q);
    }))
      ..sort((a, b) {
        if (q.isEmpty) return 0;
        final aT = a.title.toLowerCase().replaceAll('/', '');
        final bT = b.title.toLowerCase().replaceAll('/', '');
        final aStarts = aT.startsWith(q) ? 1 : 0;
        final bStarts = bT.startsWith(q) ? 1 : 0;
        if (aStarts != bStarts) return bStarts.compareTo(aStarts);
        return aT.compareTo(bT);
      });

    CustomDropdownOverlay.show(
      context: context,
      targetKey: _textFieldKey,
      width: 280,
      maxHeight: 240,
      child: Material(
        color: Colors.transparent,
        child: filtered.isEmpty
            ? _buildEmptySlashState(query)
            : ListView(
                padding: EdgeInsets.zero,
                shrinkWrap: true,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Text(
                      'Commandes & Actions rapides',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  for (final c in filtered)
                    _buildPopupItem(
                      c.icon,
                      c.title,
                      c.subtitle,
                      q,
                      () {
                        _insertTextAtCursor('${c.title} ');
                        CustomDropdownOverlay.hide();
                      },
                    ),
                ],
              ),
      ),
    );
  }

  /// État vide de la palette slash : aucune commande ne matche le début tapé.
  Widget _buildEmptySlashState(String query) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Icon(Icons.search_off, size: 16, color: scheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              "Aucune commande ne correspond à '/$query'",
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPopupItem(
    IconData icon,
    String title,
    String subtitle,
    String searchQuery,
    VoidCallback onTap,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      label: '$title: $subtitle',
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(icon, size: 16, color: scheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _buildHighlightedText(
                        title,
                        searchQuery,
                        (textTheme.bodyMedium ?? const TextStyle(fontSize: 13)).copyWith(
                          color: scheme.onSurface,
                          fontWeight: FontWeight.w600,
                        ),
                        scheme.primary,
                      ),
                      _buildHighlightedText(
                        subtitle,
                        searchQuery,
                        (textTheme.bodySmall ?? const TextStyle(fontSize: 11)).copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                        scheme.primary,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHighlightedText(
    String text,
    String query,
    TextStyle baseStyle,
    Color highlightColor,
  ) {
    if (query.isEmpty) {
      return Text(text, style: baseStyle, overflow: TextOverflow.ellipsis, maxLines: 1);
    }
    final lowerText = text.toLowerCase();
    final lowerQuery = query.toLowerCase();
    final index = lowerText.indexOf(lowerQuery);
    if (index < 0) {
      return Text(text, style: baseStyle, overflow: TextOverflow.ellipsis, maxLines: 1);
    }
    final before = text.substring(0, index);
    final match = text.substring(index, index + query.length);
    final after = text.substring(index + query.length);

    return RichText(
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      text: TextSpan(
        style: baseStyle,
        children: [
          if (before.isNotEmpty) TextSpan(text: before),
          TextSpan(
            text: match,
            style: baseStyle.copyWith(
              color: highlightColor,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (after.isNotEmpty) TextSpan(text: after),
        ],
      ),
    );
  }

  void _showModelDropdown(BuildContext context) {
    _mentionOrActionOpen = false;
    _loadModelsAndPreferences();

    final standard = _availableModels.where((m) => !m.isCustom).toList();
    final custom = _availableModels.where((m) => m.isCustom).toList();

    CustomDropdownOverlay.show(
      context: context,
      targetKey: _modelButtonKey,
      width: 300,
      maxHeight: 480,
      child: _ModelDropdownMenuContent(
        standardModels: standard,
        customModels: custom,
        selectedModel: _selectedModel,
        reasoningEffort: _reasoningEffort,
        onModelSelected: (model, effort) => _selectModelWithEffort(model, effort),
        onViewUsage: () {
          CustomDropdownOverlay.hide();
          _showUsageLimitsDialog(context);
        },
      ),
    );
  }

  Future<void> _selectModelWithEffort(AntigravityModel model, String? effort) async {
    HapticFeedback.selectionClick();
    final effectiveModel = effort != null ? model.withEffort(effort) : model;
    final short = effectiveModel.shortName;
    setState(() {
      _selectedModel = short;
      _selectedModelId = effectiveModel.id;
      _selectedModelEnum = effectiveModel.modelEnum;
      if (effort != null) {
        _reasoningEffort = effort;
      }
    });
    CustomDropdownOverlay.hide();

    final cascadeId = widget.cascadeId;
    if (cascadeId != null && cascadeId.isNotEmpty) {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('session_model_$cascadeId', effectiveModel.id);
      } catch (_) {}
      widget.api?.setSessionModel(
        cascadeId,
        effectiveModel.id,
        modelEnum: effectiveModel.modelEnum,
      );
    }

    widget.onModelChanged?.call(effectiveModel.displayName);

    // Persist choice in local settings
    await SettingsStore.save({
      'defaultModel': effectiveModel.displayName,
      if (effort != null) 'reasoningEffort': effort.toLowerCase(),
    });

    // Send /model and /effort commands to daemon
    try {
      await widget.api?.sendCommand('/model ${effectiveModel.id}');
      if (effort != null) {
        await widget.api?.sendCommand('/effort ${effort.toLowerCase()}');
      }
    } catch (_) {}
  }

  void _showUsageLimitsDialog(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: scheme.surfaceContainer,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (ctx) => _UsageLimitsModal(api: widget.api),
    );
  }

  static final List<String> _promptHistory = [];
  int _historyNavIndex = -1;

  void _navigatePromptHistory(int direction) {
    if (_promptHistory.isEmpty) return;
    HapticFeedback.selectionClick();
    if (direction > 0) {
      // Plus ancien dans l'historique
      if (_historyNavIndex < _promptHistory.length - 1) {
        _historyNavIndex++;
        final prompt = _promptHistory[_promptHistory.length - 1 - _historyNavIndex];
        _controller.text = prompt;
        _controller.selection = TextSelection.collapsed(offset: prompt.length);
        widget.onDraftChanged?.call(prompt);
      }
    } else {
      // Plus récent
      if (_historyNavIndex > 0) {
        _historyNavIndex--;
        final prompt = _promptHistory[_promptHistory.length - 1 - _historyNavIndex];
        _controller.text = prompt;
        _controller.selection = TextSelection.collapsed(offset: prompt.length);
        widget.onDraftChanged?.call(prompt);
      } else if (_historyNavIndex == 0) {
        _historyNavIndex = -1;
        _controller.clear();
        widget.onDraftChanged?.call('');
      }
    }
  }

  void _showPromptHistoryMenu(BuildContext context) {
    if (_promptHistory.isEmpty) return;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scheme = Theme.of(context).colorScheme;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.55,
        ),
        decoration: BoxDecoration(
          color: isDark ? AppColors.surfaceBase : scheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
          border: Border(
            top: BorderSide(
              color: isDark ? AppColors.borderStrong : scheme.outlineVariant,
              width: 1,
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.4 : 0.12),
              blurRadius: 16,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 8, bottom: 6),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: isDark ? AppColors.borderStrong : scheme.outlineVariant,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.accentBlue.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: const Icon(Icons.history_rounded, size: 16, color: AppColors.accentBlue),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Historique des messages envoyés',
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(
                        '${_promptHistory.length}',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.close_rounded, size: 16),
                      tooltip: 'Fermer',
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
              ),
              Divider(
                height: 1,
                thickness: 1,
                color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.4),
              ),
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
                  itemCount: _promptHistory.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 4),
                  itemBuilder: (context, idx) {
                    final item = _promptHistory[_promptHistory.length - 1 - idx];
                    return InkWell(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      onTap: () {
                        HapticFeedback.selectionClick();
                        _controller.text = item;
                        _controller.selection = TextSelection.collapsed(offset: item.length);
                        widget.onDraftChanged?.call(item);
                        Navigator.of(ctx).pop();
                      },
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: isDark ? AppColors.surfaceRaised.withValues(alpha: 0.5) : scheme.surfaceContainerLow,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(
                            color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.3),
                            width: 0.8,
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                item,
                                style: TextStyle(
                                  fontSize: 12.5,
                                  height: 1.35,
                                  color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Icon(
                              Icons.north_west_rounded,
                              size: 14,
                              color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isQueued = _sendMode == SendMode.queued;
    final viewInsets = MediaQuery.of(context).viewInsets;
    final viewPadding = MediaQuery.of(context).viewPadding;
    final rawInsetsBottom = View.of(context).viewInsets.bottom / MediaQuery.of(context).devicePixelRatio;
    final hasKeyboard = viewInsets.bottom > 50 || rawInsetsBottom > 50;
    final isIdle = !_focusNode.hasFocus && _controller.text.isEmpty && _attachments.isEmpty && !hasKeyboard;
    final bottomMargin = hasKeyboard
        ? 2.0
        : (viewPadding.bottom > 0 ? 4.0 : 8.0);

    final providerColor = _getModelProviderColor(_selectedModel, scheme);
    final isThinking = _selectedModel.toLowerCase().contains('thinking') ||
        _selectedModel.toLowerCase().contains('high') ||
        _reasoningEffort == 'Élevé';

    return SafeArea(
      top: false,
      bottom: !hasKeyboard,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        margin: EdgeInsets.fromLTRB(12, 2, 12, bottomMargin),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.projectName != null && widget.projectName!.isNotEmpty && !hasKeyboard)
              Padding(
                padding: const EdgeInsets.only(bottom: 6, left: 4),
                child: InkWell(
                  onTap: widget.onSelectProject,
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                    decoration: BoxDecoration(
                      color: isDark
                          ? AppColors.surfaceRaised
                          : AppColors.panel(context),
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(
                        color: isDark
                            ? AppColors.borderSubtle
                            : AppColors.border(context),
                        width: 1,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.folder_outlined, size: 14, color: scheme.primary),
                        const SizedBox(width: 6),
                        Text(
                          widget.projectName!,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: isDark ? AppColors.inkPrimary : AppColors.text(context),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.keyboard_arrow_down_rounded, size: 14, color: isDark ? AppColors.inkMuted : AppColors.textMuted(context)),
                      ],
                    ),
                  ),
                ),
              ),
            if (!hasKeyboard && !isIdle && widget.hasPlan)
              _buildQuickActionPills(scheme, isDark),
            DragTarget<String>(
              onWillAcceptWithDetails: (details) => true,
              onAcceptWithDetails: (details) {
                final dropped = details.data;
                if (dropped.isNotEmpty) {
                  final cur = _controller.text;
                  final prefix = cur.isEmpty || cur.endsWith(' ') ? '' : ' ';
                  _controller.text = '$cur$prefix$dropped ';
                  _controller.selection = TextSelection.fromPosition(TextPosition(offset: _controller.text.length));
                  setState(() {});
                }
              },
              builder: (ctx, candidateData, rejectedData) => Container(
              padding: EdgeInsets.symmetric(
                horizontal: 12,
                vertical: hasKeyboard ? 6 : (isIdle ? 7 : 10),
              ),
              decoration: BoxDecoration(
                color: candidateData.isNotEmpty
                    ? scheme.primary.withValues(alpha: 0.15)
                    : (isDark ? AppColors.surfaceRaised : AppColors.panel(context)),
                borderRadius: BorderRadius.circular(16),
                boxShadow: _focusNode.hasFocus
                    ? [
                        BoxShadow(
                          color: (isDark ? AppColors.accentBlue : scheme.primary).withValues(alpha: 0.1),
                          blurRadius: 10,
                          spreadRadius: 0,
                          offset: const Offset(0, 2),
                        ),
                      ]
                    : null,
                border: Border.all(
                  color: candidateData.isNotEmpty
                      ? scheme.primary
                      : (isQueued
                          ? scheme.primary.withValues(alpha: 0.8)
                          : (_focusNode.hasFocus
                              ? (isDark ? AppColors.accentBlue : scheme.primary)
                              : (isDark
                                  ? AppColors.borderSubtle
                                  : AppColors.border(context)))),
                  width: (candidateData.isNotEmpty || _focusNode.hasFocus) ? 1.2 : 1.0,
                ),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Aperçu attachement Quiet Console (Image ou Fichier)
                  _buildAttachmentPreview(scheme, isDark),

                  // Badge mode queue + "Envoyer maintenant"
                  if (isQueued)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: scheme.primaryContainer.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.playlist_add_check_outlined,
                            size: 13,
                            color: scheme.primary,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            "En file d'attente",
                            style: TextStyle(
                              fontSize: 11.5,
                              color: scheme.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 10),
                          // "Envoyer maintenant" — bypass la queue
                          InkWell(
                            onTap: () {
                              setState(() => _sendMode = SendMode.immediate);
                              _handleSend();
                            },
                            child: Text(
                              'Envoyer maintenant',
                              style: TextStyle(
                                fontSize: 11.5,
                                color: scheme.primary,
                                decoration: TextDecoration.underline,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                  // Input TextField avec raccourci Cmd+L / Ctrl+L (autofocus: false pour éviter l'ouverture du clavier au chargement)
                  CallbackShortcuts(
                    bindings: {
                      const SingleActivator(
                            LogicalKeyboardKey.keyL,
                            control: true,
                          ):
                          _quoteSelectedText,
                      const SingleActivator(
                            LogicalKeyboardKey.keyL,
                            meta: true,
                          ):
                          _quoteSelectedText,
                    },
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onHorizontalDragEnd: (details) {
                        final vx = details.primaryVelocity ?? 0;
                        if (vx > 200) {
                          // Glissement vers la droite -> prompt plus ancien
                          _navigatePromptHistory(1);
                        } else if (vx < -200) {
                          // Glissement vers la gauche -> prompt plus récent
                          _navigatePromptHistory(-1);
                        }
                      },
                      child: Container(
                        key: _textFieldKey,
                        child: TextField(
                          focusNode: _focusNode,
                          controller: _controller,
                          autofocus: false,
                          maxLines: isIdle ? 1 : 6,
                          minLines: 1,
                          style: TextStyle(fontSize: 14, color: scheme.onSurface),
                          decoration: InputDecoration(
                            hintText:
                                widget.isConnected
                                    ? (isQueued
                                        ? "Message en file d'attente (envoi automatique)..."
                                        : 'Poser une question, @ pour mentionner...')
                                    : 'Hors ligne — message mis en attente locale',
                            hintStyle: TextStyle(
                              color:
                                  widget.isConnected ? scheme.onSurfaceVariant.withValues(alpha: 0.8) : scheme.error,
                              fontSize: 13.5,
                            ),
                            border: InputBorder.none,
                            enabledBorder: InputBorder.none,
                            focusedBorder: InputBorder.none,
                            disabledBorder: InputBorder.none,
                            contentPadding: EdgeInsets.zero,
                            fillColor: Colors.transparent,
                            filled: false,
                          ),
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: isIdle ? 4 : (hasKeyboard ? 4 : 8)),

                  // Bottom Action Bar
                  Row(
                    children: [
                      // Attach media/file
                      BouncingTap(
                        hapticType: BouncingHapticType.selection,
                        onTap: _showAttachmentMenu,
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: Icon(
                            Icons.add,
                            size: 20,
                            color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),

                      // Model & Reasoning Effort Pill with Brand Dot & Thinking Badge
                      Flexible(
                        fit: FlexFit.loose,
                        child: BouncingTap(
                          key: _modelButtonKey,
                          hapticType: BouncingHapticType.selection,
                          onTap: () => _showModelDropdown(context),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4.5,
                            ),
                            decoration: BoxDecoration(
                              color: isDark ? AppColors.surfaceInput : scheme.surfaceContainerHigh,
                              borderRadius: BorderRadius.circular(AppRadius.pill),
                              border: Border.all(
                                color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5),
                                width: 0.8,
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  width: 7,
                                  height: 7,
                                  decoration: BoxDecoration(
                                    color: isQueued ? scheme.primary : providerColor,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 5),
                                Flexible(
                                  child: ConstrainedBox(
                                    constraints: BoxConstraints(
                                      maxWidth: MediaQuery.of(context).size.width * 0.55,
                                    ),
                                    child: Text(
                                      _displayModelName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      softWrap: false,
                                      style: TextStyle(
                                        fontSize: 11.5,
                                        color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ),
                                if (isThinking) ...[
                                  const SizedBox(width: 4),
                                  Icon(
                                    Icons.psychology_outlined,
                                    size: 13,
                                    color: isDark ? AppColors.accentBlue : scheme.primary,
                                  ),
                                ],
                                const SizedBox(width: 2),
                                Icon(
                                  Icons.keyboard_arrow_up_rounded,
                                  size: 14,
                                  color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),

                      const Spacer(),

                      // Clear text button (when text is typed)
                      if (_controller.text.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(right: 2),
                          child: BouncingTap(
                            hapticType: BouncingHapticType.selection,
                            onTap: () {
                              _controller.clear();
                              widget.onDraftChanged?.call('');
                            },
                            child: Container(
                              width: 30,
                              height: 30,
                              alignment: Alignment.center,
                              child: Icon(
                                Icons.close_rounded,
                                size: 16,
                                color: isDark ? AppColors.inkMuted : scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),

                      // Voice / Dictée vocale avec formatage intelligent de code
                      BouncingTap(
                        hapticType: BouncingHapticType.selection,
                        onTap: () {
                          VoicePromptDialog.show(
                            context,
                            onInsert: (formattedText) {
                              final current = _controller.text;
                              final newText = current.isEmpty
                                  ? formattedText
                                  : '$current $formattedText';
                              _controller.text = newText;
                              _controller.selection = TextSelection.collapsed(offset: newText.length);
                              widget.onDraftChanged?.call(newText);
                            },
                          );
                        },
                        child: Container(
                          width: 32,
                          height: 32,
                          alignment: Alignment.center,
                          child: Icon(
                            Icons.mic_rounded,
                            size: 19,
                            color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      const SizedBox(width: 2),

                      // Historique des messages envoyés
                      if (_promptHistory.isNotEmpty &&
                          (MediaQuery.of(context).size.width >= 360 || _controller.text.isEmpty)) ...[
                        BouncingTap(
                          hapticType: BouncingHapticType.selection,
                          onTap: () => _showPromptHistoryMenu(context),
                          child: Container(
                            width: 32,
                            height: 32,
                            alignment: Alignment.center,
                            child: Icon(
                              Icons.history_rounded,
                              size: 19,
                              color: isDark ? AppColors.inkSecondary : scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                        const SizedBox(width: 2),
                      ],

                      // If streaming and user has typed text, show both Stop and Queue/Send buttons
                      if (widget.hasActiveStream && _controller.text.trim().isNotEmpty) ...[
                        BouncingTap(
                          key: const Key('stop-generation-button'),
                          hapticType: BouncingHapticType.heavy,
                          onTap: () => widget.onStop?.call(),
                          child: Container(
                            width: 30,
                            height: 30,
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              color: scheme.error,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.stop_rounded,
                              size: 16,
                              color: AppColors.onDanger,
                            ),
                          ),
                        ),
                      ],

                      // Primary action button (Send / Queue / Stop)
                      Semantics(
                        button: true,
                        label: widget.hasActiveStream && _controller.text.trim().isEmpty
                            ? 'Arrêter la génération'
                            : (isQueued || widget.hasActiveStream
                                ? 'Ajouter à la file d\'attente'
                                : 'Envoyer le message'),
                        child: Tooltip(
                          message: widget.hasActiveStream && _controller.text.trim().isEmpty
                              ? 'Arrêter la génération (Emergency Stop)'
                              : (widget.hasActiveStream || isQueued
                                  ? 'Ajouter à la file d\'attente'
                                  : 'Envoyer'),
                          child: GestureDetector(
                            key: widget.hasActiveStream && _controller.text.trim().isEmpty
                                ? const Key('stop-generation-button')
                                : const Key('send-message-button'),
                            onTapDown: (_) => setState(() => _isSendPressed = true),
                            onTapUp: (_) {
                              setState(() => _isSendPressed = false);
                              if (widget.hasActiveStream && _controller.text.trim().isEmpty) {
                                if (widget.onStop != null) {
                                  HapticFeedback.heavyImpact();
                                  widget.onStop!();
                                }
                              } else {
                                _handleSend();
                              }
                            },
                            onTapCancel:
                                () => setState(() => _isSendPressed = false),
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                              child: Center(
                                child: AnimatedScale(
                                  scale: _isSendPressed ? 0.85 : 1.0,
                                  duration: const Duration(milliseconds: 100),
                                  curve: Curves.easeOutQuart,
                                  child: GestureDetector(
                                    onLongPress: () => _showQueueSettings(context),
                                    child: Container(
                                      width: 30,
                                      height: 30,
                                      decoration: BoxDecoration(
                                        color: widget.hasActiveStream && _controller.text.trim().isEmpty
                                            ? scheme.error
                                            : ((_controller.text.trim().isNotEmpty || _attachments.isNotEmpty) &&
                                                    widget.isConnected
                                                ? (isDark ? AppColors.accentBlue : scheme.primary)
                                                : (isDark ? AppColors.surfaceInput : scheme.surfaceContainerHighest)),
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: ((_controller.text.trim().isNotEmpty || _attachments.isNotEmpty) &&
                                                  widget.isConnected)
                                              ? Colors.transparent
                                              : (isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.5)),
                                          width: 0.8,
                                        ),
                                      ),
                                      child: Icon(
                                        (isQueued || (widget.hasActiveStream && _controller.text.trim().isNotEmpty))
                                            ? Icons.playlist_add_check
                                            : (widget.hasActiveStream && _controller.text.trim().isEmpty
                                                ? Icons.stop_rounded
                                                : Icons.arrow_forward),
                                        size: 16,
                                        color: ((_controller.text.trim().isNotEmpty || _attachments.isNotEmpty) &&
                                                    widget.isConnected) ||
                                                (widget.hasActiveStream && _controller.text.trim().isEmpty)
                                            ? AppColors.onAccent
                                            : (isDark ? AppColors.inkMuted : scheme.onSurfaceVariant),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActionPills(ColorScheme scheme, bool isDark) {
    if (!widget.hasPlan) return const SizedBox.shrink();
    return Container(
      height: 30,
      margin: const EdgeInsets.only(bottom: 6),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 2),
        children: [
          _buildActionPill(
            icon: Icons.play_arrow_rounded,
            label: 'Proceed ⌘↵',
            color: AppColors.positive,
            isDark: isDark,
            scheme: scheme,
            onTap: () {
              HapticFeedback.selectionClick();
              if (widget.onProceedPlan != null) {
                widget.onProceedPlan!();
              } else {
                widget.onSend('proceed');
              }
            },
          ),
        ],
      ),
    );
  }

  Widget _buildActionPill({
    required IconData icon,
    required String label,
    required Color color,
    required bool isDark,
    required ColorScheme scheme,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
          decoration: BoxDecoration(
            color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isDark ? AppColors.borderSubtle : scheme.outlineVariant.withValues(alpha: 0.6),
              width: 0.8,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: color),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: isDark ? AppColors.inkPrimary : scheme.onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Tile de sélection du mode d'envoi dans le bottom sheet.
class _QueueTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _QueueTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color:
              selected
                  ? scheme.primaryContainer.withValues(alpha: 0.4)
                  : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? scheme.primary : scheme.outlineVariant,
          ),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              size: 18,
              color: selected ? scheme.primary : scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: selected ? scheme.primary : scheme.onSurface,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (selected)
              Icon(Icons.check_circle, size: 18, color: scheme.primary),
          ],
        ),
      ),
    );
  }
}

/// Antigravity 2.0 Quotas / Limits flyout sheet (matching the desktop IDE UI).
/// Charge le résumé des quotas réel via getUserQuotaSummary() dès l'ouverture
/// (dynamique) et retombe sur les valeurs statiques si le daemon est
/// injoignable ou ne renvoie pas de données exploitables.
class _UsageLimitsModal extends StatefulWidget {
  const _UsageLimitsModal({this.api});

  final DaemonApi? api;

  @override
  State<_UsageLimitsModal> createState() => _UsageLimitsModalState();
}

class _UsageLimitsModalState extends State<_UsageLimitsModal> {
  Map<String, dynamic>? _quota;
  String? _plan;

  @override
  void initState() {
    super.initState();
    _loadQuota();
  }

  Future<void> _loadQuota() async {
    final api = widget.api;
    if (api == null) return;
    // Run independently so a missing/slow getUserStatus doesn't block quota.
    api.getUserQuotaSummary().then((q) {
      if (!mounted || q.isEmpty) return;
      setState(() => _quota = q);
    }).catchError((_) {});
    api.getUserStatus().then((s) {
      if (!mounted) return;
      final user = s['user'];
      if (user is Map) {
        final plan = user['plan'];
        if (plan is String && plan.isNotEmpty) {
          setState(() => _plan = plan);
        }
      }
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Gemini Models',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: scheme.onSurface,
              ),
            ),
            if (_plan != null) ...[
              const SizedBox(height: 2),
              Text(
                'Plan $_plan',
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 12),
            _buildUsageTile(
              context: context,
              title: 'Limite hebdomadaire restante',
              subtitle: 'Quota hebdomadaire disponible',
              percent: _quotaPercent('weeklyPercent'),
            ),
            const SizedBox(height: 10),
            _buildUsageTile(
              context: context,
              title: 'Limite sur 5 heures',
              subtitle: 'Quota sur fenêtre de 5 heures',
              percent: _quotaPercent('fiveHourPercent'),
            ),
            const SizedBox(height: 20),
            Divider(color: scheme.outlineVariant, height: 1),
            const SizedBox(height: 16),
            Text(
              'Claude and GPT models',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: scheme.onSurface,
              ),
            ),
            const SizedBox(height: 12),
            _buildUsageTile(
              context: context,
              title: 'Limite hebdomadaire restante',
              subtitle: 'Quota hebdomadaire disponible',
              percent: _quotaPercent('weeklyPercentClaude'),
            ),
            const SizedBox(height: 10),
            _buildUsageTile(
              context: context,
              title: 'Limite sur 5 heures',
              subtitle: 'Quota complet de 5 heures disponible',
              percent: _quotaPercent('fiveHourPercentClaude'),
            ),
          ],
        ),
      ),
    );
  }

  /// Extrait un pourcentage entier depuis le résumé de quota (fallback null).
  /// Accepte num/num comme la réponse protobuf décodée du daemon.
  int? _quotaPercent(String key) {
    final raw = _quota?[key];
    if (raw is num) return raw.round().clamp(0, 100);
    if (raw is String) return int.tryParse(raw)?.clamp(0, 100);
    return null;
  }

  Widget _buildUsageTile({
    required BuildContext context,
    required String title,
    required String subtitle,
    int? percent,
  }) {
    final scheme = Theme.of(context).colorScheme;
    final value = percent;
    Color progressColor = scheme.primary;
    if (value != null && value < 30) {
      progressColor = scheme.error;
    } else if (value != null && value < 60) {
      progressColor = scheme.tertiary;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 11,
                    color: scheme.onSurfaceVariant,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Semantics(
            label: value == null ? '$title: indisponible' : '$title: $value%',
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 36,
                  height: 36,
                  child: CircularProgressIndicator(
                    value: value == null ? 0.0 : value / 100.0,
                    backgroundColor: scheme.surfaceContainer,
                    color: progressColor,
                    strokeWidth: 3,
                  ),
                ),
                Text(
                  value == null ? '—' : '$value%',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ModelDropdownMenuContent extends StatefulWidget {
  final List<AntigravityModel> standardModels;
  final List<AntigravityModel> customModels;
  final String selectedModel;
  final String reasoningEffort;
  final void Function(AntigravityModel model, String? effort) onModelSelected;
  final VoidCallback onViewUsage;

  const _ModelDropdownMenuContent({
    required this.standardModels,
    required this.customModels,
    required this.selectedModel,
    required this.reasoningEffort,
    required this.onModelSelected,
    required this.onViewUsage,
  });

  @override
  State<_ModelDropdownMenuContent> createState() => _ModelDropdownMenuContentState();
}

class _ModelDropdownMenuContentState extends State<_ModelDropdownMenuContent> {
  String? _expandedBaseName;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: Colors.transparent,
      child: ListView(
        padding: const EdgeInsets.symmetric(vertical: 4),
        shrinkWrap: true,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Text(
              'Model',
              style: (textTheme.labelSmall ?? const TextStyle(fontSize: 12)).copyWith(
                fontWeight: FontWeight.w600,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
          ...widget.standardModels.map((m) => _buildStandardModelRow(m, isDark, scheme, textTheme)),
          if (widget.customModels.isNotEmpty) ...[
            Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, height: 1),
            ...widget.customModels.map((m) => _buildCustomModelRow(m, isDark, scheme, textTheme)),
          ],
          Divider(color: isDark ? AppColors.borderSubtle : scheme.outlineVariant, height: 1),
          _buildViewUsageRow(isDark, scheme, textTheme),
        ],
      ),
    );
  }

  Widget _buildStandardModelRow(
    AntigravityModel model,
    bool isDark,
    ColorScheme scheme,
    TextTheme textTheme,
  ) {
    final isSelected = widget.selectedModel.toLowerCase().contains(model.baseName.toLowerCase()) ||
        widget.selectedModel.toLowerCase() == model.displayName.toLowerCase();
    final isExpanded = _expandedBaseName == model.baseName;

    final currentEffort = isSelected
        ? (widget.reasoningEffort.isNotEmpty ? _capitalize(widget.reasoningEffort) : (model.effort ?? 'Medium'))
        : (model.effort ?? 'Medium');

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          button: true,
          selected: isSelected,
          label: '${model.baseName} $currentEffort',
          child: InkWell(
            onTap: () {
              if (model.supportsEffort) {
                setState(() {
                  _expandedBaseName = isExpanded ? null : model.baseName;
                });
              } else {
                widget.onModelSelected(model, null);
              }
            },
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: isSelected && !isExpanded
                      ? (isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Flexible(
                            child: Text(
                              model.baseName,
                              style: (textTheme.bodyMedium ?? const TextStyle(fontSize: 13)).copyWith(
                                color: isSelected ? scheme.onSurface : scheme.onSurfaceVariant,
                                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (model.supportsEffort) ...[
                            const SizedBox(width: 6),
                            Text(
                              currentEffort,
                              style: (textTheme.bodyMedium ?? const TextStyle(fontSize: 12.5)).copyWith(
                                color: scheme.onSurfaceVariant.withValues(alpha: 0.8),
                                fontWeight: FontWeight.w400,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (model.tag != null) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              model.tag!,
                              style: (textTheme.labelSmall ?? const TextStyle(fontSize: 10)).copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(width: 3),
                            Icon(Icons.info_outline, size: 10, color: scheme.onSurfaceVariant),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(width: 8),
                    if (isSelected && !model.supportsEffort)
                      Icon(Icons.check, size: 16, color: scheme.primary)
                    else if (model.supportsEffort)
                      GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () {
                          setState(() {
                            _expandedBaseName = isExpanded ? null : model.baseName;
                          });
                        },
                        child: Icon(
                          isExpanded ? Icons.keyboard_arrow_down : Icons.chevron_right,
                          size: 15,
                          color: scheme.onSurfaceVariant,
                        ),
                      )
                    else
                      const SizedBox(width: 14),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (model.supportsEffort && isExpanded)
          Container(
            margin: const EdgeInsets.only(left: 20, right: 10, top: 2, bottom: 4),
            padding: const EdgeInsets.symmetric(vertical: 4),
            decoration: BoxDecoration(
              color: isDark ? AppColors.surfaceRaised : scheme.surfaceContainer,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: isDark ? AppColors.borderSubtle : scheme.outlineVariant,
                width: 0.8,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildEffortTile(model, 'Low', isSelected, currentEffort, isDark, scheme, textTheme),
                _buildEffortTile(model, 'Medium', isSelected, currentEffort, isDark, scheme, textTheme),
                _buildEffortTile(model, 'High', isSelected, currentEffort, isDark, scheme, textTheme),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildEffortTile(
    AntigravityModel model,
    String effortTier,
    bool isModelSelected,
    String currentEffort,
    bool isDark,
    ColorScheme scheme,
    TextTheme textTheme,
  ) {
    final isTierActive = isModelSelected && currentEffort.toLowerCase() == effortTier.toLowerCase();

    return InkWell(
      onTap: () => widget.onModelSelected(model, effortTier),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: isTierActive ? (isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest) : Colors.transparent,
          borderRadius: BorderRadius.circular(4),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              effortTier,
              style: (textTheme.bodyMedium ?? const TextStyle(fontSize: 12.5)).copyWith(
                fontWeight: isTierActive ? FontWeight.w600 : FontWeight.w400,
                color: isTierActive ? scheme.onSurface : scheme.onSurfaceVariant,
              ),
            ),
            if (isTierActive)
              Icon(Icons.check, size: 14, color: scheme.primary)
            else
              const SizedBox(width: 14),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomModelRow(
    AntigravityModel model,
    bool isDark,
    ColorScheme scheme,
    TextTheme textTheme,
  ) {
    final isSelected = widget.selectedModel.toLowerCase().contains(model.id.toLowerCase()) ||
        widget.selectedModel.toLowerCase().contains(model.displayName.toLowerCase());

    Color statusColor = scheme.primary;
    if (model.status == 'degraded') {
      statusColor = AppColors.warning;
    } else if (model.status == 'offline') {
      statusColor = scheme.error;
    } else {
      statusColor = AppColors.positive;
    }

    return Semantics(
      button: true,
      selected: isSelected,
      label: model.customLabel,
      child: InkWell(
        onTap: () => widget.onModelSelected(model, null),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: isSelected ? (isDark ? AppColors.surfaceHover : scheme.surfaceContainerHighest) : Colors.transparent,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: statusColor,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    model.customLabel,
                    style: (textTheme.bodyMedium ?? const TextStyle(fontSize: 12.5)).copyWith(
                      color: isSelected ? scheme.onSurface : scheme.onSurfaceVariant,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isSelected)
                  Icon(Icons.check, size: 16, color: scheme.primary),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildViewUsageRow(
    bool isDark,
    ColorScheme scheme,
    TextTheme textTheme,
  ) {
    return Semantics(
      button: true,
      label: 'View Usage',
      child: InkWell(
        onTap: widget.onViewUsage,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Icon(Icons.query_stats_outlined, size: 15, color: scheme.onSurfaceVariant),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'View Usage',
                    style: (textTheme.bodyMedium ?? const TextStyle(fontSize: 13)).copyWith(
                      fontWeight: FontWeight.w500,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
                Icon(Icons.chevron_right, size: 14, color: scheme.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _capitalize(String s) {
    if (s.isEmpty) return s;
    return s[0].toUpperCase() + s.substring(1);
  }
}

