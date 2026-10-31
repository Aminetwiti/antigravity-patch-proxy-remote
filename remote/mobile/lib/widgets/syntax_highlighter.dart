import 'package:flutter/material.dart';

/// Lightweight, progressive syntax highlighter for Markdown code blocks.
/// Inspired by Antigravity 2.0 / VS Code Dark+ theme tokens.
class SyntaxHighlighter {
  SyntaxHighlighter._();

  // Dark theme syntax colors (VS Code Dark+ fidelity)
  static const Color colorKeyword = Color(0xFFC586C0); // purple
  static const Color colorControl = Color(0xFFC586C0); // purple
  static const Color colorString = Color(0xFFCE9178); // orange/gold
  static const Color colorNumber = Color(0xFFB5CEA8); // soft green
  static const Color colorComment = Color(0xFF6A9955); // green italic
  static const Color colorType = Color(0xFF4EC9B0); // teal
  static const Color colorFunction = Color(0xFFDCDCAA); // soft yellow
  static const Color colorAnnotation = Color(0xFFD7BA7D); // gold
  static const Color colorVariable = Color(0xFF9CDCFE); // light blue
  static const Color colorPunctuation = Color(0xFFD4D4D4); // light gray
  static const Color colorBoolean = Color(0xFF569CD6); // blue

  static const _keywordsByLang = <String, Set<String>>{
    'dart': {
      'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch',
      'class', 'const', 'continue', 'covariant', 'default', 'deferred', 'do',
      'dynamic', 'else', 'enum', 'export', 'extends', 'extension', 'external',
      'factory', 'false', 'final', 'finally', 'for', 'Function', 'get', 'hide',
      'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
      'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow',
      'return', 'set', 'show', 'static', 'super', 'switch', 'sync', 'this',
      'throw', 'true', 'try', 'typedef', 'var', 'void', 'while', 'with', 'yield',
    },
    'go': {
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
      'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
      'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
      'var', 'true', 'false', 'nil', 'iota', 'make', 'new', 'len', 'cap', 'append',
    },
    'typescript': {
      'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case',
      'catch', 'class', 'const', 'constructor', 'continue', 'debugger', 'declare',
      'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
      'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import',
      'in', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module', 'namespace',
      'never', 'new', 'null', 'number', 'of', 'package', 'private', 'protected',
      'public', 'readonly', 'require', 'return', 'set', 'static', 'string',
      'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type',
      'typeof', 'undefined', 'unique', 'unknown', 'var', 'void', 'while', 'with', 'yield',
    },
    'python': {
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
      'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from',
      'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not',
      'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
    },
    'json': {
      'true', 'false', 'null',
    },
    'rust': {
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
      'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
      'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
      'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type',
      'unsafe', 'use', 'where', 'while',
    },
    'powershell': {
      'param', 'function', 'filter', 'workflow', 'configuration', 'if', 'else',
      'elseif', 'switch', 'while', 'do', 'until', 'for', 'foreach', 'in', 'break',
      'continue', 'return', 'try', 'catch', 'finally', 'throw', 'trap', 'data',
      'dynamicparam', 'begin', 'process', 'end', 'exit', 'using', 'module', 'class',
      'enum', 'hidden', 'static', 'cmdletbinding', 'true', 'false', 'null',
      'write-host', 'write-output', 'write-error', 'write-warning', 'invoke-command',
      'where-object', 'select-object', 'new-object', 'get-command', 'get-process',
      'get-content', 'set-content', 'test-path', 'start-process', 'stop-process',
    },
    'zsh': {
      'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while',
      'until', 'do', 'done', 'in', 'function', 'time', 'repeat', 'nocorrect',
      'foreach', 'end', 'autoload', 'typeset', 'local', 'export', 'return', 'exit',
      'set', 'unset', 'source', 'eval', 'alias', 'unalias', 'echo', 'printf',
      'read', 'cd', 'pwd', 'test', 'true', 'false', 'bindkey', 'zstyle', 'setopt',
      'unsetopt', 'whence', 'where', 'which',
    },
    'shell': {
      'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until',
      'do', 'done', 'in', 'function', 'export', 'return', 'exit', 'set', 'unset',
      'source', 'eval', 'alias', 'echo', 'printf', 'read', 'cd', 'pwd', 'test',
    },
    'sql': {
      'select', 'from', 'where', 'insert', 'into', 'update', 'delete', 'create',
      'table', 'drop', 'alter', 'add', 'join', 'inner', 'left', 'right', 'full',
      'outer', 'on', 'group', 'by', 'order', 'having', 'as', 'distinct', 'count',
      'sum', 'avg', 'min', 'max', 'null', 'not', 'and', 'or', 'in', 'between',
      'like', 'is', 'union', 'all', 'limit', 'offset', 'values', 'set', 'case',
      'when', 'then', 'else', 'end', 'primary', 'key', 'foreign', 'references',
    },
  };

  static String _normalizeLang(String lang) {
    final l = lang.trim().toLowerCase();
    if (l == 'js' || l == 'javascript' || l == 'ts' || l == 'tsx' || l == 'jsx') return 'typescript';
    if (l == 'golang') return 'go';
    if (l == 'py') return 'python';
    if (l == 'rs') return 'rust';
    if (l == 'powershell' || l == 'pwsh' || l == 'ps1' || l == 'psm1' || l == 'psd1') return 'powershell';
    if (l == 'zsh') return 'zsh';
    if (l == 'sh' || l == 'bash' || l == 'shell' || l == 'cmd') return 'shell';
    if (l == 'sql' || l == 'pgsql' || l == 'mysql' || l == 'sqlite') return 'sql';
    return l;
  }

  static final Map<int, List<TextSpan>> _highlightCache = {};
  static const int _maxCacheSize = 256;

  /// Parses code into a list of styled [TextSpan] elements based on the language.
  static List<TextSpan> highlight(String code, String rawLanguage, {required Color defaultTextColor}) {
    if (code.isEmpty) return [TextSpan(text: '', style: TextStyle(color: defaultTextColor))];

    final cacheKey = Object.hash(code, rawLanguage, defaultTextColor.value);
    final cached = _highlightCache.remove(cacheKey);
    if (cached != null) {
      _highlightCache[cacheKey] = cached;
      return cached;
    }

    final lang = _normalizeLang(rawLanguage);
    final keywords = _keywordsByLang[lang] ?? _keywordsByLang['typescript']!;

    final spans = <TextSpan>[];
    final lines = code.split('\n');

    for (int i = 0; i < lines.length; i++) {
      final line = lines[i];
      _tokenizeLine(line, lang, keywords, defaultTextColor, spans);
      if (i < lines.length - 1) {
        spans.add(const TextSpan(text: '\n'));
      }
    }

    if (_highlightCache.length >= _maxCacheSize) {
      _highlightCache.remove(_highlightCache.keys.first);
    }
    _highlightCache[cacheKey] = spans;

    return spans;
  }

  static void _tokenizeLine(
    String line,
    String lang,
    Set<String> keywords,
    Color defaultColor,
    List<TextSpan> spans,
  ) {
    if (line.isEmpty) return;

    // Fast check for line comment
    final trimmed = line.trimLeft();
    final leadingSpaces = line.length - trimmed.length;
    if (leadingSpaces > 0) {
      spans.add(TextSpan(text: line.substring(0, leadingSpaces)));
    }

    if (trimmed.startsWith('//') || ((lang == 'python' || lang == 'shell' || lang == 'zsh' || lang == 'powershell') && trimmed.startsWith('#')) || (lang == 'sql' && trimmed.startsWith('--'))) {
      spans.add(TextSpan(
        text: trimmed,
        style: const TextStyle(
          color: colorComment,
          fontStyle: FontStyle.italic,
        ),
      ));
      return;
    }

    int cursor = leadingSpaces;
    while (cursor < line.length) {
      final char = line[cursor];

      // String literal ("..." or '...' or `...`)
      if (char == '"' || char == "'" || char == '`') {
        final quote = char;
        int end = cursor + 1;
        while (end < line.length) {
          if (line[end] == '\\') {
            end += 2;
            continue;
          }
          if (line[end] == quote) {
            end++;
            break;
          }
          end++;
        }
        final str = line.substring(cursor, end.clamp(0, line.length));
        spans.add(TextSpan(
          text: str,
          style: const TextStyle(color: colorString),
        ));
        cursor = end;
        continue;
      }

      // Inline comment in remainder of line
      if ((cursor < line.length - 1 && line[cursor] == '/' && line[cursor + 1] == '/') ||
          ((lang == 'python' || lang == 'shell' || lang == 'zsh' || lang == 'powershell') && char == '#' && (cursor == 0 || line[cursor - 1] == ' '))) {
        spans.add(TextSpan(
          text: line.substring(cursor),
          style: const TextStyle(color: colorComment, fontStyle: FontStyle.italic),
        ));
        break;
      }

      // Variable starting with $ ($var, $1, $?)
      if (char == r'$' && (lang == 'shell' || lang == 'zsh' || lang == 'powershell' || lang == 'typescript' || lang == 'dart')) {
        int end = cursor + 1;
        while (end < line.length && (_isWordChar(line[end]) || line[end] == '?' || line[end] == '!')) {
          end++;
        }
        spans.add(TextSpan(
          text: line.substring(cursor, end),
          style: const TextStyle(color: colorVariable, fontWeight: FontWeight.w500),
        ));
        cursor = end;
        continue;
      }

      // Number literal
      if (_isDigit(char) && (cursor == 0 || !_isWordChar(line[cursor - 1]))) {
        int end = cursor + 1;
        while (end < line.length && (_isDigit(line[end]) || line[end] == '.' || line[end] == 'x' || line[end] == 'X')) {
          end++;
        }
        spans.add(TextSpan(
          text: line.substring(cursor, end),
          style: const TextStyle(color: colorNumber),
        ));
        cursor = end;
        continue;
      }

      // Annotation / Decorator (@override, @test, @json)
      if (char == '@' && cursor + 1 < line.length && _isAlpha(line[cursor + 1])) {
        int end = cursor + 1;
        while (end < line.length && _isWordChar(line[end])) {
          end++;
        }
        spans.add(TextSpan(
          text: line.substring(cursor, end),
          style: const TextStyle(color: colorAnnotation, fontWeight: FontWeight.w600),
        ));
        cursor = end;
        continue;
      }

      // Identifier or Keyword
      if (_isAlpha(char) || char == '_') {
        int end = cursor + 1;
        while (end < line.length && _isWordChar(line[end])) {
          end++;
        }
        final word = line.substring(cursor, end);
        final lower = word.toLowerCase();

        if (keywords.contains(word) || (lang == 'sql' && keywords.contains(lower))) {
          spans.add(TextSpan(
            text: word,
            style: const TextStyle(color: colorKeyword, fontWeight: FontWeight.w600),
          ));
        } else if (_isTypeIdentifier(word)) {
          spans.add(TextSpan(
            text: word,
            style: const TextStyle(color: colorType),
          ));
        } else if (end < line.length && line[end] == '(') {
          spans.add(TextSpan(
            text: word,
            style: const TextStyle(color: colorFunction),
          ));
        } else {
          spans.add(TextSpan(
            text: word,
            style: TextStyle(color: defaultColor),
          ));
        }
        cursor = end;
        continue;
      }

      // Operators / punctuation / whitespace
      spans.add(TextSpan(
        text: char,
        style: TextStyle(
          color: (char == '{' || char == '}' || char == '(' || char == ')' || char == '[' || char == ']')
              ? colorPunctuation
              : defaultColor,
        ),
      ));
      cursor++;
    }
  }

  static bool _isDigit(String s) => s.codeUnitAt(0) >= 48 && s.codeUnitAt(0) <= 57;
  static bool _isAlpha(String s) {
    final c = s.codeUnitAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 95;
  }
  static bool _isWordChar(String s) {
    final c = s.codeUnitAt(0);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 95;
  }
  static bool _isTypeIdentifier(String word) {
    if (word.isEmpty) return false;
    final first = word[0];
    return first == first.toUpperCase() && first != first.toLowerCase() && word.length > 1;
  }
}
