# EXECUTION FEED — CODE TO UI MAPPING

Traçabilité exhaustive reliant chaque pixel et élément interactif du fil d'exécution au code source exact.

---

```text
ÉLÉMENT VISUEL             PROPRIÉTÉ / RÈGLE           FICHIER SOURCE                      LIGNE / SYMBOLE
─────────────────────────────────────────────────────────────────────────────────────────────────────────
En-tête Agent Actif        _buildLiveAgentHeader()     execution_progress_view.dart        L948, L1017
Chronomètre d'exécution    'for ' + _formatDuration()  execution_progress_view.dart        L153-159
Bouton Stop                widget.onStop?.call()       execution_progress_view.dart        L88, L77
Spinner Double-Track       Md3DoubleTrackSpinner       widgets/md3_spinner.dart            L1-80
Indicateur 'Working..'     _LiveWorkingIndicator       execution_progress_view.dart        L1972-2026
Ligne d'étape (Row)        _buildStepRow()             execution_progress_view.dart        L1179-1560
Verbe d'action             Text(item.action, #9E9FA8)  execution_progress_view.dart        L1337-1344
Icône Édition Fichier      Icons.edit_note_rounded     execution_progress_view.dart        L1350-1357 (#34D399)
Icône Lecture Fichier      Icons.insert_drive_file     execution_progress_view.dart        L1361-1370 (#38BDF8)
Icône Recherche            Icons.search_rounded        execution_progress_view.dart        L1373-1381 (#2DD4BF)
Icône Terminal / Commande  Icons.terminal_rounded      execution_progress_view.dart        L1396-1405 (#9CA3AF)
Icône Sous-Agent           Icons.smart_toy_outlined    execution_progress_view.dart        L1384-1393 (#A78BFA)
Icône Réflexion (Thought)  Icons.lightbulb_outline     execution_progress_view.dart        L1420-1430 (#FBBF24)
Badge Lignes (#L680-710)   Text(item.lineRange, mono)  execution_progress_view.dart        L1481-1492 (#71717A)
Diff Ajout (+12)           Text(item.diffAdded, mono)  execution_progress_view.dart        L1518-1527 (#4ADE80)
Diff Retrait (-3)          Text(item.diffRemoved, mono)execution_progress_view.dart        L1529-1538 (#F87171)
Boîte Console / Terminal   Container(#0E0F12, border)  execution_progress_view.dart        L1732-1770
Sous-étapes indentées      Padding(left: 14px)         execution_progress_view.dart        L1567-1570
Badge Auto-proceed         GestureDetector(onTap)      execution_progress_view.dart        L1226-1281 (#14171F)
Chevron d'expansion        Icons.keyboard_arrow_down   execution_progress_view.dart        L1548-1555 (#71717A)
Animation d'ouverture      AnimatedSize(260ms)         execution_progress_view.dart        L1006-1009
Animation sous-étapes      AnimatedSize(220ms)         execution_progress_view.dart        L1562-1565
Animation d'ellipse        Timer(550ms) -> '.'*'..'    execution_progress_view.dart        L1986-1992
```
