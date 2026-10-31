# 18. Intégration Client Mobile Flutter (`remote/mobile`)

> **Composants UI & Gestion des Flux Multi-Shells**

---

## 1. Sélecteur Multi-Shells (`sessions_drawer.dart`)

```dart
Widget _buildShellSelector() {
  return SegmentedButton<ShellType>(
    segments: const [
      ButtonSegment(value: ShellType.all, label: Text('Tous')),
      ButtonSegment(value: ShellType.classic, label: Text('2.0')),
      ButtonSegment(value: ShellType.ide, label: Text('IDE')),
    ],
    selected: {_selectedShell},
    onSelectionChanged: (set) => setState(() => _selectedShell = set.first),
  );
}
```

---

## 2. Badges de Session
Chaque tuile de session affiche un badge visuel distinct :
- 🟦 **`Antigravity 2.0`** : Sessions issues du Hub classique.
- 🟪 **`Antigravity IDE`** : Sessions créées ou ouvertes dans le fork VS Code.
