/// Centralise la conversion d'un chemin de workspace (file://, \\, /) vers un
/// nom court lisible : le dernier segment du chemin, ou le [fallback] pour les
/// chemins vides/racine.
///
/// Historique : cette logique était dupliquée dans
/// `conversation_history_screen.dart` et `sessions_list.dart` (audit
/// clean-code-guard H5) — un seul helper à maintenir désormais.
class WorkspacePath {
  /// Normalisation canonique unique pour toutes les couches Flutter.
  /// Traite de façon identique : file:///, lettres de lecteur Windows (c:/ vs C:/),
  /// barres obliques (/ vs \), encodage URL (%20, %3A), et supprime les trailing slashes.
  static String canonicalPath(String rawPath) {
    if (rawPath.isEmpty || rawPath == '.') return '';
    var clean = rawPath.replaceAll('\\', '/');
    if (clean.startsWith('file:///')) clean = clean.substring(8);
    if (clean.startsWith('file://')) clean = clean.substring(7);
    if (clean.startsWith('//?/') || clean.startsWith('//./')) clean = clean.substring(4);

    if (clean.contains('%')) {
      try {
        clean = Uri.decodeFull(clean);
      } catch (_) {}
    }
    clean = clean.trim();
    while (clean.endsWith('/') && clean.length > 1) {
      clean = clean.substring(0, clean.length - 1);
    }
    // Normalisation de la lettre de lecteur Windows en minuscule (ex: "C:/foo" -> "c:/foo")
    if (clean.length >= 3 && clean[1] == ':' && clean[2] == '/') {
      final code = clean.codeUnitAt(0);
      if (code >= 65 && code <= 90) { // 'A'..'Z'
        clean = '${clean[0].toLowerCase()}${clean.substring(1)}';
      }
    }
    return clean;
  }

  static String displayName(
    String rawPath, {
    String fallback = 'Outside of Project',
  }) {
    final clean = canonicalPath(rawPath);
    if (clean.isEmpty) return fallback;
    final lastSlash = clean.lastIndexOf('/');
    if (lastSlash >= 0 && lastSlash < clean.length - 1) {
      return clean.substring(lastSlash + 1);
    } else if (lastSlash < 0) {
      return clean;
    }
    return fallback;
  }

  /// Vérifie si deux chemins ou URIs désignent le même workspace.
  static bool isSameWorkspace(String pathA, String pathB) {
    final cA = canonicalPath(pathA).toLowerCase();
    final cB = canonicalPath(pathB).toLowerCase();
    if (cA.isEmpty || cB.isEmpty) return false;
    return cA == cB;
  }

  /// Vérifie si [childPath] est situé à l'intérieur de [parentPath] avec une vraie frontière de chemin.
  static bool isSubdirOf(String childPath, String parentPath) {
    final cChild = canonicalPath(childPath).toLowerCase();
    final cParent = canonicalPath(parentPath).toLowerCase();
    if (cChild.isEmpty || cParent.isEmpty) return false;
    if (cChild == cParent) return true;
    return cChild.startsWith('$cParent/');
  }
}
