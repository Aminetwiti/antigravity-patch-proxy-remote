# EXECUTION FEED — RAPPORT FORENSIC & DESIGN SYSTEM EXHAUSTIF

**Composant analysé** : `ExecutionProgressView` (Fil d'exécution agentique en direct / Timeline de run)  
**Emplacement source principal** : `remote/mobile/lib/features/chat_stream/widgets/execution_progress_view.dart`  
**Sources corrélées** : `remote/mobile/lib/theme/app_colors.dart`, `remote/daemon/pkg/gateway/`, `DESIGN.md`  

---

## 1. Component Identification
- **Nom du composant** : `ExecutionProgressView`
- **Type d'UI** : Fil d'exécution dynamique, hiérarchique et temps réel (Feed / Timeline / Accordion).
- **Rôle principal** : Visualiser de manière transparente le cheminement cognitif et opérationnel de l'agent (réflexion, exploration de fichiers, éditions de code avec diffs, commandes shell, exécution de sous-agents et vérifications).

---

## 2. Source Location
- **Fichier maître** : `remote/mobile/lib/features/chat_stream/widgets/execution_progress_view.dart` (2 027 lignes, 82 509 octets).
- **Widgets satellites** :
  - `remote/mobile/lib/widgets/md3_spinner.dart` (`Md3DoubleTrackSpinner`, rotation continue).
  - `remote/mobile/lib/widgets/antigravity_spinning_arc.dart` (`AntigravitySpinningArc`, arc rotatif IDE).
  - `remote/mobile/lib/widgets/resolved_ask_question_card.dart` (`ResolvedAskQuestionCard`, questions répondues).
- **Composant parent** : `ChatStreamScreen` (`remote/mobile/lib/features/chat_stream/chat_stream_screen.dart: L410-460`), inséré en haut de chaque bulle de message de l'agent.

---

## 3. DOM / Widget Structure
```text
ExecutionProgressView (StatefulWidget)
  └─ RepaintBoundary (isolation du rendu 60/120 Hz)
      └─ AnimatedSize (260ms, fastOutSlowIn)
          └─ Container (margin: 0 0 8px 0)
              └─ Column
                  ├─ [Streaming] _buildLiveAgentHeader()
                  │     └─ Row (ActiveModel + Chronomètre + Bouton Stop)
                  │
                  ├─ [Completed] _buildCollapsedSummary()
                  │     └─ InkWell -> MasterTitle + ChevronDown
                  │
                  ├─ For each ExecutionStepItem -> _buildStepRow()
                  │     └─ Row
                  │         ├─ ActionVerb Text ("Edited", "Ran", "Thought")
                  │         ├─ BadgeIcon (EditNote, Terminal, Lightbulb...)
                  │         ├─ Title Text (filename, command)
                  │         ├─ LineRange Badge (#L680-710)
                  │         ├─ DiffBadges (+12 en vert, -3 en rouge)
                  │         └─ ExpandChevron (si expandable)
                  │     └─ AnimatedSize (220ms) -> Indented Sub-items (Padding left: 14px)
                  │         └─ For each subItem -> SubStepRow
                  │         └─ If command expanded -> TerminalCard (#0E0F12)
                  │
                  └─ [Streaming] _LiveWorkingIndicator
                        └─ Row (Md3DoubleTrackSpinner + "Working...")
```

---

## 4. Parent / Child Components
- **Parent** : `MessageBubble` / `AgentMessageItem` dans `ChatStreamScreen`.
- **Enfants directs** :
  - `_LiveWorkingIndicator`
  - `Md3DoubleTrackSpinner`
  - `ResolvedAskQuestionCard`
  - `SelectableText` (pour les blocs de logs et prompts de console)

---

## 5. Design Tokens Détectés

| Rôle Token | Valeur Hex / CSS | Source Exacte | Classification |
|---|---|---|---|
| Surface Conteneur Console | `#0E0F12` | `execution_progress_view.dart: L1737` | **EXTERNAL_CONFIRMED** |
| Surface Carte Auto-Proceed | `#14171F` | `execution_progress_view.dart: L1236` | **EXTERNAL_CONFIRMED** |
| Surface Badge Recherche | `#1F2430` | `execution_progress_view.dart: L1500` | **EXTERNAL_CONFIRMED** |
| Bordure Subtile | `#27272A` | `execution_progress_view.dart: L1239` | **EXTERNAL_CONFIRMED** |
| Bordure Recherche | `#2E3345` | `execution_progress_view.dart: L1503` | **EXTERNAL_CONFIRMED** |
| Encre Principale | `#F4F4F5` | `execution_progress_view.dart: L1264` | **EXTERNAL_CONFIRMED** |
| Encre Secondaire / Verbes | `#9E9FA8` | `execution_progress_view.dart: L1341` | **EXTERNAL_CONFIRMED** |
| Encre Muted / Numéros lignes | `#71717A` | `execution_progress_view.dart: L1473` | **EXTERNAL_CONFIRMED** |
| Diff Ajout Vert | `#4ADE80` | `execution_progress_view.dart: L1525` | **EXTERNAL_CONFIRMED** |
| Diff Retrait Rouge | `#F87171` | `execution_progress_view.dart: L1535` | **EXTERNAL_CONFIRMED** |
| Icône Édition Vert Émeraude | `#34D399` | `execution_progress_view.dart: L1355` | **EXTERNAL_CONFIRMED** |
| Icône Analyse Bleu Ciel | `#38BDF8` | `execution_progress_view.dart: L1367` | **EXTERNAL_CONFIRMED** |
| Icône Recherche Teal | `#2DD4BF` | `execution_progress_view.dart: L1379` | **EXTERNAL_CONFIRMED** |
| Icône Sous-Agent Violet | `#A78BFA` | `execution_progress_view.dart: L1391` | **EXTERNAL_CONFIRMED** |
| Icône Terminal Gris | `#9CA3AF` | `execution_progress_view.dart: L1403` | **EXTERNAL_CONFIRMED** |
| Icône Réflexion Or | `#FBBF24` | `execution_progress_view.dart: L1427` | **EXTERNAL_CONFIRMED** |
| Icône Timer Orange | `#FB923C` | `execution_progress_view.dart: L1415` | **EXTERNAL_CONFIRMED** |

---

## 6. Colors
La palette du composant utilise la neutralité feutrée de "The Quiet Console" rehaussée d'accents fonctionnels stricts par type d'outil :
- Les **fichiers modifiés** affichent le vert émeraude (`#34D399`) et les pastilles de diffs atomiques (`#4ADE80` / `#F87171`).
- Les **fichiers analysés / lus** utilisent le bleu ciel (`#38BDF8`).
- Les **recherches** utilisent le teal (`#2DD4BF`).
- Les **sous-agents** utilisent le violet lavande (`#A78BFA`).
- La **réflexion interne** utilise l'ambre (`#FBBF24`).
- Le **terminal** utilise un gris neutre (`#9CA3AF`) sur fond sombre profond (`#0E0F12`).

---

## 7. Typography
- **Verbe d'action** : `font-size: 12px; font-weight: 400; color: #9E9FA8;`
- **Titre de fichier / Commande** : `font-size: 12px; font-weight: 500; font-family: monospace; color: #F4F4F5;`
- **Plage de lignes** : `font-size: 11px; font-family: monospace; color: #71717A;`
- **Diffs (+ / -)** : `font-size: 11px; font-weight: 600; font-family: monospace;`
- **Sortie de terminal** : `font-size: 11px; font-family: monospace; line-height: 1.45; color: #D4D4D8;`
- **Indicateur de travail** : `font-size: 12px; font-weight: 400; letter-spacing: -0.1px; color: #9E9FA8;`

---

## 8. Spacing
- Marge inférieure globale : `8px`.
- Espacement vertical entre étapes consécutives : `2.5px`.
- Espacement entre verbe et icône : `5px`.
- Retrait (indentation) des sous-étapes groupées : `14px` (`padding-left: 14px`).
- Padding interne de la boîte terminal : `horizontal: 12px, vertical: 8px`.

---

## 9. Radius
- `4px` : Badges de diff et conteneurs de résultats de recherche.
- `6px` : Boîte console / terminal (`BorderRadius.circular(6)`).
- `8px` : Carte de validation `Auto-proceeded` (`BorderRadius.circular(8)`).
- `50%` : Spinner et status dots.

---

## 10. Borders
- Standard : `width: 0.8px` à `1px solid #27272A`.
- Recherche : `width: 0.5px solid #2E3345`.

---

## 11. Shadows
- Aucune ombre sur les étapes de la timeline (conforme à **The Flat-By-Default Rule**).
- Fond transparent sur les étapes simples, fond `#0E0F12` sur les consoles déroulées.

---

## 12. Icons System
Chaque étape utilise un glyphe standardisé Material Symbols de `13.5px` à `14px` de diamètre :
- Édition : `edit_note_rounded`
- Lecture : `insert_drive_file_outlined`
- Image : `photo_outlined`
- Recherche : `search_rounded`
- Terminal : `terminal_rounded`
- Sous-agent : `smart_toy_outlined`
- Chrono : `timer_outlined`
- Réflexion : `lightbulb_outline_rounded`
- Validation : `check_circle_outline_rounded`
- Chevrons : `keyboard_arrow_down_rounded` / `chevron_right_rounded`

---

## 13. States Matrice

| État | Icône | Couleur Icône | Rendu Visuel |
|---|---|---|---|
| **Running (En cours)** | `Md3DoubleTrackSpinner` | `#60A5FA` | Rotation fluide 1.2s, indicateur "Working..." animé |
| **File Edit (Modifié)** | `edit_note_rounded` | `#34D399` | Nom de fichier mono, badges verts/rouges `+12 -3` |
| **File Read (Lu)** | `insert_drive_file` | `#38BDF8` | Nom de fichier mono, badge `#L10-40` |
| **Command (Exécuté)**| `terminal_rounded` | `#9CA3AF` | Clic déplie la boîte `#0E0F12` avec stdout complet |
| **Group (Exploré)** | `folder_open` | `#9CA3AF` | Clic déplie la liste indentée des fichiers inspectés |
| **Thought (Pensé)** | `lightbulb_outline`| `#FBBF24` | Texte explicatif en gris `#9E9FA8` |
| **Completed (Terminé)**| `keyboard_arrow_down` | `#8B8D98` | Timeline repliée en bandeau condensé |
| **Error (Échoué)** | `error_outline` | `#F87171` | Titre rouge `#F87171` avec prompt d'erreur affiché |

---

## 14. Timeline Connector
- **Structure physique du connecteur** : Dans `ExecutionProgressView`, les liens hiérarchiques entre étapes et sous-étapes sont réalisés par une **indentation géométrique stricte de `14px`** combinée à des paires d'arborescence (arbre textuel et chevron dynamique), complétée dans les cartes d'outils par un trait vertical continu de `1px solid #27272A`.

---

## 15. Animations
1. **AnimatedSize (260ms, fastOutSlowIn)** : Transition de hauteur fluide lors du déploiement ou du repliement de la timeline complète.
2. **AnimatedSize (220ms, fastOutSlowIn)** : Transition lors de l'ouverture d'un groupe d'étapes ou d'une boîte console.
3. **Pulse Animation (1200ms, repeat reverse)** : Animation de pulsation sur l'indicateur d'activité en cours.
4. **Ellipsis Animation (550ms)** : Cycle de l'indicateur de progression textuel `Working.` -> `Working..` -> `Working...`.

---

## 16. Streaming & Live Update
- Le composant est connecté au flux WebSocket du daemon (`DaemonApi.chatStream`).
- Chaque chunk de pensée ou appel d'outil reçu est accumulé dans `thoughtText`.
- La méthode `_parseSteps(raw)` découpe le flux en temps réel et met à jour la liste des `ExecutionStepItem` sans scintillement grâce au wrapper `RepaintBoundary`.

---

## 17. Data Model (`ExecutionStepItem`)
Modèle typé immuable (`L30-66`) encapsulant :
- `ExecutionStepType type`
- `String action`
- `String title`
- `String? diffAdded`, `String? diffRemoved`, `String? lineRange`
- `String? consolePrompt`, `String? consoleOutput`
- `List<ExecutionStepItem>? subItems`
- `bool isExpandable`, `bool isRunning`, `bool isImage`

---

## 18. Events & User Interactions
- **Tap sur une étape déroulante** : Déclenche `HapticFeedback.selectionClick()`, bascule l'état local dans `_expandedIndices` et anime le déroulement.
- **Tap sur une carte Auto-proceed** : Déclenche `widget.onOpenArtifact?.call(item.title)` et ouvre le visualiseur de diffs ou de plan.
- **Tap sur le bouton Stop** : Appelle `widget.onStop?.call()` qui émet une trame `stop_task` vers le serveur.

---

## 19. Accessibility (a11y)
- **Contraste** : Texte principal `#F4F4F5` sur fond sombre respecte 14.2:1 (AAA).
- **Règle Tripartite** : L'état combine systématiquement **Icône dédiée + Verbe textuel ("Edited", "Ran") + Couleur spécifique**.
- **Sélection de texte** : Tout le contenu des logs est encapsulé dans des `SelectableText` permettant la copie intégrale sans déformer l'accordéon.

---

## 20. Responsive Adaptation
- **Mobile** : Marges condensées (`padding: 2.5px 2px`), troncature automatique des noms de fichiers longs avec points de suspension, boîte terminal prenant 100% de la largeur disponible.
- **Desktop / Tablet** : Indentation portée à `18px`, largeur de boîte terminal bornée à `680px`.

---

## 21. Code Mapping
Cartographie intégrale consignée dans [**`EXECUTION_FEED_CODE_MAP.md`**](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/EXECUTION_FEED_CODE_MAP.md).

---

## 22. Reconstructed Component Code
Une implémentation pédagogique autonome prête à l'emploi est fournie dans le répertoire `DESIGN_SYSTEM/components/execution-feed/README.md`.

---

## 23. Evidence & Proof of Ground Truth
- Présence littérale vérifiée dans `remote/mobile/lib/features/chat_stream/widgets/execution_progress_view.dart`.
- 10 tests unitaires et d'intégration validant le comportement du composant (`test/widgets/execution_progress_view_test.dart`, `test/agent_streaming_screen_test.dart`).

---

## 24. Confidence Matrix
- Structure et tokens : **EXTERNAL_CONFIRMED** (**HIGH**).
- Intégration dans le flux streaming : **EXTERNAL_CONFIRMED** (**HIGH**).
- Présence dans l'ASAR hôte : **INFERRED** (**HIGH** - ASAR hôte délègue l'exécution à `language_server.exe` et aux protocoles RPC).

---

## 25. Unknowns
- La signature exacte des fonctions React sous-jacentes compilées dans le binaire Go `language_server.exe` avant son exposition gRPC/Web.
