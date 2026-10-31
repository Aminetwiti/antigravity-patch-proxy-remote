import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'messages.dart';

/// Parses the daemon's `list_sessions` response into [CascadeSession] items.
///
/// The gateway (remote/daemon/pkg/gateway/websocket.go) now returns structured
/// sessions: `{"sessions":[{cascadeId,title,workspace,status,updatedAt}]}`
/// (parsed server-side by connectrpc.ParseTrajectories).
///
/// Fallback: legacy daemons that still send the raw protobuf field dump
/// (`{"fields":[...]}`) are parsed heuristically (UUID + readable title).
class SessionParser {
  /// Asynchronous parse with background isolate offloading when sessions count > 200.
  static Future<List<CascadeSession>> parseListSessionsAsync(Map<String, dynamic> data) async {
    final sessions = data['sessions'] ?? (data['data'] is Map ? data['data']['sessions'] : null);
    if (sessions is List && sessions.length > 200) {
      return compute(parseListSessions, data);
    }
    return parseListSessions(data);
  }

  /// [includeArchived] conserve les sessions archivées (destinées à
  /// l'historique des conversations) ; la sidebar les filtre toujours via
  /// `isAvailable`.
  static List<CascadeSession> parseListSessions(Map<String, dynamic> data,
      {bool includeArchived = false}) {
    final sessions = data['sessions'] ?? (data['data'] is Map ? data['data']['sessions'] : null);
    if (sessions is List) {
      final now = DateTime.now();
      final entries = <(CascadeSession, int)>[];
      final seenIds = <String>{};
      for (final s in sessions) {
        if (s is Map) {
          final sMap = s;
          final rawId = sMap['cascadeId'] ?? sMap['id'];
          if (rawId is String && rawId.trim().isNotEmpty) {
            final id = rawId.trim();
            final normId = id.toLowerCase();
            if (seenIds.contains(normId)) continue;
            seenIds.add(normId);

            final stepCount = (sMap['stepCount'] as num?)?.toInt() ?? 0;
            final status = (sMap['status'] as String? ?? '').toUpperCase();
            final isWaiting = status.contains('WAIT') ||
                status.contains('APPROVAL') ||
                status.contains('QUESTION') ||
                status.contains('USER_ACTION') ||
                status.contains('BACKGROUND') ||
                status.contains('TASK') ||
                status.contains('PENDING');
            final isRunning = (status.contains('RUNNING') ||
                status.contains('BUSY') ||
                status.contains('STREAMING') ||
                status.contains('EXECUTING')) && !isWaiting;
            final hasUnread = stepCount >= 1 && !isRunning && !isWaiting;
            final updatedParsed = sMap['updatedAt'] is String
                ? DateTime.tryParse(sMap['updatedAt'] as String)
                : null;
            final updatedMs = updatedParsed?.millisecondsSinceEpoch ?? 0;
            final timeStr = sMap['time']?.toString() ??
                (updatedParsed != null ? CascadeSession.formatRelativeTime(updatedParsed, now) : 'Just now');
            final isArchived = sMap['isArchived'] == true ||
                status.contains('ARCHIV') ||
                status == 'CASCADE_STATUS_ARCHIVED';
            final session = CascadeSession(
              id: id,
              workspacePath: sMap['workspacePath'] ?? sMap['workspace'] ?? '',
              title: sMap['title'] ?? 'Cascade Session',
              status: sMap['status'] ?? 'CASCADE_STATUS_READY',
              time: timeStr,
              updatedAt: updatedParsed,
              lastPrompt: sMap['lastPrompt']?.toString(),
              worktree: sMap['worktree']?.toString(),
              projectId: sMap['projectId']?.toString(),
              stepCount: stepCount,
              hasUnread: hasUnread,
              isPinned: sMap['isPinned'] == true || sMap['pinned'] == true,
              isArchived: isArchived,
              isIde: sMap['isIde'] == true || sMap['clientType'] == 'ide' || sMap['source'] == 'ide',
            );
            if ((session.isAvailable && !session.isArchived) || (includeArchived && session.isArchived)) {
              entries.add((session, updatedMs));
            }
          }
        }
      }
      if (entries.isNotEmpty) {
        entries.sort((a, b) => b.$2.compareTo(a.$2));
        return entries.map((e) => e.$1).toList();
      }
    }
    return _parseLegacyFieldDump(data);
  }

  // ── Fallback : ancien daemon (dump de champs protobuf bruts) ──────────────

  static final RegExp _uuidRe = RegExp(
    r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
  );

  static List<CascadeSession> _parseLegacyFieldDump(Map<String, dynamic> data) {
    final fields = data['fields'] ?? (data['data'] is Map ? data['data']['fields'] : null);
    if (fields is! List) return const [];

    final sessions = <CascadeSession>[];
    final seenIds = <String>{};
    for (final f in fields) {
      if (f is! Map) continue;
      final fMap = Map<String, dynamic>.from(f);
      if (fMap['field'] != 1) continue; // trajectory entries live in field 1

      final blob = _blobOf(fMap);
      final text = fMap['text'] is String ? fMap['text'] as String : '';
      final combined = '$text ${_asAscii(blob)}';
      final id = _uuidRe.firstMatch(combined)?.group(0) ?? '';
      final title = _legacyTitleOf(fMap, text, blob);
      if (id.isEmpty) continue;
      final normId = id.toLowerCase();
      if (seenIds.contains(normId)) continue;
      seenIds.add(normId);

      final session = CascadeSession(
        id: id,
        workspacePath: _workspaceOf(combined),
        title: title,
        status: 'CASCADE_STATUS_READY',
        time: 'Just now',
      );
      if (session.isAvailable) {
        sessions.add(session);
      }
    }
    return sessions;
  }

  static Uint8List _blobOf(Map field) {
    final b = field['bytes'];
    if (b is int) {
      // Gateway sends `bytes: <length>` — the payload itself is unavailable
      // in the field dump; fall back to the text snippet when present.
      return Uint8List(0);
    }
    if (b is List) {
      return Uint8List.fromList(b.whereType<int>().toList());
    }
    return Uint8List(0);
  }

  static String _asAscii(Uint8List blob) {
    return latin1.decode(blob, allowInvalid: true);
  }

  static String _legacyTitleOf(
    Map field,
    String text,
    Uint8List blob,
  ) {
    final cleaned = text
        .trim()
        .replaceFirst(RegExp(r'^\{[\s\S]*\}\s*'), '');
    if (cleaned.isNotEmpty && cleaned.length > 4) {
      return cleaned.split('\n').first;
    }
    // Fallback: readable runs of printable chars inside the blob.
    final ascii = _asAscii(blob);
    final matches = RegExp(r'[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ._\-:]{4,60}')
        .allMatches(ascii)
        .toList();
    if (matches.isNotEmpty) {
      final candidate =
          matches.map((m) => m.group(0)!).where((s) => s.length > 6).toList();
      if (candidate.isNotEmpty) return candidate.last;
    }
    return 'Cascade Session';
  }

  static String _workspaceOf(String ascii) {
    final m = RegExp(r'file:///[^\x00-\x1f]+').firstMatch(ascii);
    return m?.group(0) ?? '';
  }
}
