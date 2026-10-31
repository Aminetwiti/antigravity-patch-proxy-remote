import 'package:flutter/material.dart';

/// AppIcons : Système de glyphes standardisé Antigravity 2.0 ("The Quiet Console").
///
/// Référence : ICON_INVENTORY.md & DESIGN_SYSTEM/icons.json
/// Utilise la police Google Material Symbols (Outlined / Rounded).
abstract class AppIcons {
  // ── Navigation & Barres d'outils
  static const IconData search = Icons.search_rounded;
  static const IconData settings = Icons.settings_outlined;
  static const IconData chat = Icons.chat_bubble_outline_rounded;
  static const IconData history = Icons.history_rounded;
  static const IconData mcp = Icons.construction_rounded;
  static const IconData folder = Icons.folder_open_outlined;
  static const IconData close = Icons.close_rounded;
  static const IconData moreVert = Icons.more_vert_rounded;
  static const IconData chevronDown = Icons.keyboard_arrow_down_rounded;
  static const IconData chevronRight = Icons.chevron_right_rounded;
  static const IconData expandMore = Icons.expand_more_rounded;
  static const IconData filter = Icons.filter_list_rounded;

  // ── Pipeline Agentique & Outils
  static const IconData running = Icons.autorenew_rounded;
  static const IconData success = Icons.check_circle_outline_rounded;
  static const IconData error = Icons.error_outline_rounded;
  static const IconData terminal = Icons.terminal_rounded;
  static const IconData fileEdit = Icons.edit_note_rounded;
  static const IconData fileAnalysis = Icons.insert_drive_file_outlined;
  static const IconData imageAnalysis = Icons.photo_outlined;
  static const IconData subagent = Icons.smart_toy_outlined;
  static const IconData thought = Icons.lightbulb_outline_rounded;
  static const IconData timer = Icons.timer_outlined;
  static const IconData article = Icons.article_outlined;
  static const IconData code = Icons.code_rounded;
  static const IconData diff = Icons.difference_outlined;

  // ── Échelle de Calibres d'Affichage Standardisés
  /// 16 px : Micro-icônes dans badges, boîtes terminal inline, tags
  static const double sizeSm = 16.0;
  /// 18 px : Étapes d'exécution, pills de statut
  static const double sizeMd = 18.0;
  /// 20 px : Menus de navigation, boutons d'action de barre d'outils
  static const double sizeBase = 20.0;
  /// 24 px : En-têtes d'écrans, boutons flottants, dialogues
  static const double sizeLg = 24.0;
}
