# Execution Feed / Timeline Component — Design System Specification

## 1. Overview
The **Execution Feed** (`ExecutionProgressView`) is the core agentic interaction surface of Google Antigravity 2.0 ("The Quiet Console"). It visualizes the step-by-step observable trajectory of an autonomous AI agent in real time.

## 2. Visual Structure
```text
┌─────────────────────────────────────────────────────────────┐
│ [DoubleTrackSpinner] Working... (for 2m 14s)         [Stop] │  <- Live Header
│                                                             │
│ Thought   Examining Conditional Logic                     ▼ │  <- Thought step
│ Explored  12 files                                        ▼ │  <- Explored group
│   ├─ Analyzed  chat_stream_screen.dart           #L680-710  │  <- Indented sub-step
│   ├─ Edited    execution_progress_view.dart    +12 -3       │  <- File edit with diff
│   └─ Run       flutter test --exclude-tags=live           ▼ │  <- Command with terminal
│      ┌───────────────────────────────────────────────────┐  │
│      │ > flutter test --exclude-tags=live                │  │  <- Console output card
│      │ 215 tests passed                                  │  │
│      └───────────────────────────────────────────────────┘  │
│ Auto-proceeded with [Article] Implementation Plan           │  <- Auto-proceed badge
└─────────────────────────────────────────────────────────────┘
```

## 3. Specifications Index
- [Structure](structure.json)
- [Tokens](tokens.json)
- [States](states.json)
- [Icons](icons.json)
- [Motion](motion.json)
- [Styles](styles.json)
- [Data Model](data-model.json)
- [Interactions](interactions.json)
- [Responsive](responsive.json)
