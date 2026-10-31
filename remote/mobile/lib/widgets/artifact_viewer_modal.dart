import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/protocol/daemon_api.dart';
import '../core/protocol/markdown_renderer.dart';
import '../features/artifacts/artifact_action_bar.dart';
import '../theme/app_colors.dart';

class ArtifactViewerModal extends StatefulWidget {
  final DaemonApi api;
  final String artifactPath;
  final String artifactName;
  final String? workspacePath;
  final String? cascadeId;
  final bool requestFeedback;
  final VoidCallback? onProceed;
  final VoidCallback? onRequestFeedback;

  const ArtifactViewerModal({
    super.key,
    required this.api,
    required this.artifactPath,
    required this.artifactName,
    this.workspacePath,
    this.cascadeId,
    this.requestFeedback = false,
    this.onProceed,
    this.onRequestFeedback,
  });

  static Future<void> show(
    BuildContext context, {
    required DaemonApi api,
    required String artifactPath,
    required String artifactName,
    String? workspacePath,
    String? cascadeId,
    bool requestFeedback = false,
    VoidCallback? onProceed,
    VoidCallback? onRequestFeedback,
  }) {
    HapticFeedback.selectionClick();
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => ArtifactViewerModal(
        api: api,
        artifactPath: artifactPath,
        artifactName: artifactName,
        workspacePath: workspacePath,
        cascadeId: cascadeId,
        requestFeedback: requestFeedback,
        onProceed: onProceed,
        onRequestFeedback: onRequestFeedback,
      ),
    );
  }

  @override
  State<ArtifactViewerModal> createState() => _ArtifactViewerModalState();
}

class _ArtifactViewerModalState extends State<ArtifactViewerModal> {
  bool _isLoading = true;
  String _content = '';
  Uint8List? _imageBytes;
  String? _error;

  bool get _isImage {
    final lowerName = widget.artifactName.toLowerCase();
    final lowerPath = widget.artifactPath.toLowerCase();
    return lowerName.endsWith('.png') ||
        lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg') ||
        lowerName.endsWith('.gif') ||
        lowerName.endsWith('.webp') ||
        lowerPath.endsWith('.png') ||
        lowerPath.endsWith('.jpg') ||
        lowerPath.endsWith('.jpeg') ||
        lowerPath.endsWith('.gif') ||
        lowerPath.endsWith('.webp');
  }

  @override
  void initState() {
    super.initState();
    _fetchArtifactContent();
  }

  Future<void> _fetchArtifactContent() async {
    try {
      if (widget.artifactPath.startsWith('data:image/')) {
        final commaIdx = widget.artifactPath.indexOf(',');
        if (commaIdx != -1) {
          final b64 = widget.artifactPath.substring(commaIdx + 1);
          final bytes = base64Decode(b64);
          if (mounted) {
            setState(() {
              _imageBytes = bytes;
              _isLoading = false;
            });
          }
          return;
        }
      }

      try {
        final localF = File(widget.artifactPath);
        if (localF.existsSync()) {
          final bytes = await localF.readAsBytes();
          if (mounted) {
            setState(() {
              _imageBytes = bytes;
              _isLoading = false;
            });
          }
          return;
        }
      } catch (_) {}

      Map<String, dynamic> res;
      final cleanP = widget.artifactPath.replaceFirst(RegExp(r'^/+'), '');
      try {
        res = await widget.api.readFile(
          widget.artifactPath,
          workspacePath: widget.workspacePath,
          cascadeId: widget.cascadeId,
        );
      } catch (_) {
        try {
          res = await widget.api.readFile(
            cleanP.isNotEmpty ? cleanP : widget.artifactName,
            workspacePath: widget.workspacePath,
            cascadeId: widget.cascadeId,
          );
        } catch (_) {
          try {
            res = await widget.api.readFile(
              widget.artifactName,
              cascadeId: widget.cascadeId,
            );
          } catch (_) {
            res = await widget.api.readFile(
              widget.artifactPath,
              cascadeId: widget.cascadeId,
            );
          }
        }
      }
      if (mounted) {
        Uint8List? imgBytes;
        final b64 = res['base64Data'] as String?;
        if (b64 != null && b64.isNotEmpty) {
          try {
            imgBytes = base64Decode(b64);
          } catch (_) {}
        }
        final contentStr = res['content'] as String? ?? '';
        if (imgBytes == null && _isImage && contentStr.isNotEmpty) {
          try {
            imgBytes = base64Decode(contentStr);
          } catch (_) {
            try {
              imgBytes = Uint8List.fromList(latin1.encode(contentStr));
            } catch (_) {}
          }
        }
        setState(() {
          _imageBytes = imgBytes;
          _content = contentStr.isEmpty ? 'Contenu vide' : contentStr;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Impossible de charger l\'artefact: $e';
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      height: MediaQuery.of(context).size.height * 0.85,
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 4),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: scheme.outlineVariant,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
            ),
            // Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: scheme.outlineVariant)),
              ),
              child: Row(
                children: [
                  Icon(
                    _isImage ? Icons.image_outlined : Icons.article_outlined,
                    size: 20,
                    color: scheme.primary,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      widget.artifactName,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurface,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.close, size: 20, color: scheme.onSurfaceVariant),
                    tooltip: 'Fermer',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            
            // Content
            Expanded(
              child: _isLoading
                  ? Center(child: CircularProgressIndicator(valueColor: AlwaysStoppedAnimation(scheme.primary)))
                  : _error != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Text(
                              _error!,
                              style: TextStyle(color: scheme.error),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        )
                      : _isImage
                          ? (_imageBytes != null
                              ? Center(
                                  child: Padding(
                                    padding: const EdgeInsets.all(16.0),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(AppRadius.md),
                                      child: InteractiveViewer(
                                        minScale: 0.5,
                                        maxScale: 4.0,
                                        child: Image.memory(
                                          _imageBytes!,
                                          fit: BoxFit.contain,
                                          errorBuilder: (ctx, err, stack) => Center(
                                            child: Column(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                Icon(Icons.broken_image_outlined, size: 48, color: scheme.error),
                                                const SizedBox(height: 8),
                                                Text(
                                                  'Format d\'image non reconnu',
                                                  style: TextStyle(color: scheme.error),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                )
                              : Center(
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.broken_image_outlined, size: 48, color: scheme.onSurfaceVariant),
                                      const SizedBox(height: 8),
                                      Text(
                                        'Impossible d\'afficher l\'image',
                                        style: TextStyle(color: scheme.onSurfaceVariant),
                                      ),
                                    ],
                                  ),
                                ))
                          : SingleChildScrollView(
                              padding: const EdgeInsets.all(16),
                              child: MarkdownBody(content: _content),
                            ),
            ),
            if (widget.requestFeedback)
              ArtifactActionBar(
                requestFeedback: widget.requestFeedback,
                onProceed: () => widget.onProceed?.call(),
                onRequestFeedback: () => widget.onRequestFeedback?.call(),
              ),
          ],
        ),
      ),
    );
  }
}

class MarkdownBody extends StatelessWidget {
  final String content;

  const MarkdownBody({super.key, required this.content});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final blocks = MarkdownRenderer.blocksOf(content);
    final textStyle = TextStyle(
      fontSize: 13.5,
      height: 1.5,
      color: scheme.onSurface,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: blocks.map((block) {
        if (block.paragraph != null) {
          final spans = MarkdownRenderer.inlineSpans(block.paragraph!, textStyle, scheme: scheme);
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (block.isListItem)
                  Padding(
                    padding: const EdgeInsets.only(top: 6, right: 8),
                    child: Icon(Icons.circle, size: 6, color: scheme.onSurfaceVariant),
                  ),
                Expanded(
                  child: Text.rich(TextSpan(children: spans), style: textStyle),
                ),
              ],
            ),
          );
        } else if (block.code != null) {
          return Container(
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (block.code!.language.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainer,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.md)),
                    ),
                    child: Text(
                      block.code!.language,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: scheme.onSurfaceVariant,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    block.code!.code,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      height: 1.5,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
          );
        }
        return const SizedBox.shrink();
      }).toList(),
    );
  }
}
