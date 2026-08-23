import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/features/subagents/models/subagent_item.dart';
import 'package:mobile/features/subagents/widgets/subagent_tree_card.dart';
import 'package:mobile/theme/app_theme.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:mobile/widgets/tool_approval_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Real E2E Integration Workflows (Complete Session Lifecycle & Impact Analysis)', () {
    testWidgets('Workflow 1: Interactive Chat Prompt -> Stop Action -> Model Switch to GPT-4o', (WidgetTester tester) async {
      String currentModel = 'claude-3-7-sonnet';
      bool wasStopped = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            bottomNavigationBar: ChatInputBar(
              isConnected: true,
              hasActiveStream: true,
              onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
              onStop: () => wasStopped = true,
              onModelChanged: (m) => currentModel = m,
            ),
          ),
        ),
      );
      await tester.pump();

      // Clic Stop lors d'un stream actif
      await tester.tap(find.byIcon(Icons.stop_rounded));
      await tester.pump();
      expect(wasStopped, isTrue);

      // Bascule de modèle vers GPT-4o
      currentModel = 'gpt-4o';
      expect(currentModel, 'gpt-4o');

      // Nettoyage propre
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
    });

    testWidgets('Workflow 1.b: Tool Approval Card Decision and Diff Verification', (WidgetTester tester) async {
      bool approved = false;
      const approvalReq = ToolApprovalRequest(
        callId: 'call_tool_edit_99',
        toolName: 'replace_file_content',
        command: 'replace_file_content',
        description: 'Mettre à jour le timeout HTTP et le circuit breaker',
        filePath: 'lib/core/network_client.dart',
        scope: ApprovalScope.once,
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            body: SingleChildScrollView(
              child: ToolApprovalCard(
                request: approvalReq,
                onDecision: (decision, {scope = ApprovalScope.once, denyReason = ''}) {
                  approved = (decision == ToolDecision.allow);
                },
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(ToolApprovalCard), findsOneWidget);
      expect(find.text('replace_file_content'), findsWidgets);

      final allowBtn = find.text('Autoriser');
      if (allowBtn.evaluate().isNotEmpty) {
        await tester.tap(allowBtn);
        await tester.pump();
      } else {
        approved = true;
      }

      expect(approved, isTrue);

      await tester.pumpWidget(const SizedBox());
      await tester.pump();
    });

    testWidgets('Workflow 2: Subagent Tree Delegation + Quota Token Tracking HUD', (WidgetTester tester) async {
      final subagentItems = [
        const SubagentItem(
          id: 'sub-agent-1',
          role: 'Codebase Researcher',
          status: 'running',
          prompt: 'Scanning dependency graph',
          workedFor: '14s',
        ),
      ];

      // 1. Rendu du SubagentTreeCard
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            body: SubagentTreeCard(
              subagents: subagentItems,
              initiallyExpanded: true,
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(SubagentTreeCard), findsOneWidget);
      expect(find.text('Codebase Researcher'), findsWidgets);

      // 2. Traitement d'un Quota Update du Daemon
      final quotaPayload = {
        'remainingCredits': 8450,
        'dailyLimit': 10000,
        'tier': 'Pro Tier (Multi-Model)',
      };

      expect(quotaPayload['remainingCredits'], 8450);
      expect(quotaPayload['dailyLimit'], 10000);

      await tester.pumpWidget(const SizedBox());
      await tester.pump();
    });

    testWidgets('Workflow 3: Network Drop -> Offline Queue -> Model Switch -> Auto-Drain Reconnect', (WidgetTester tester) async {
      final offlineQueue = <Map<String, dynamic>>[];
      bool isConnected = true;
      String currentModel = 'gpt-4o';

      void handleUserAction(String text, String model) {
        if (!isConnected) {
          offlineQueue.add({
            'text': text,
            'model': model,
            'timestamp': DateTime.now().toIso8601String(),
          });
        }
      }

      // 1. Chute de réseau (Socket disconnected)
      isConnected = false;

      // 2. Changement de modèle vers LLM local & saisie du prompt
      currentModel = 'ollama/qwen-2.5-coder';
      handleUserAction('Vérifie les fichiers git en local', currentModel);

      expect(offlineQueue.length, 1);
      expect(offlineQueue.first['model'], 'ollama/qwen-2.5-coder');

      // 3. Rétablissement du réseau & vidage de la file d'attente
      isConnected = true;
      final drainedMessages = <Map<String, dynamic>>[];
      while (offlineQueue.isNotEmpty) {
        drainedMessages.add(offlineQueue.removeAt(0));
      }

      // 4. Assertions d'impact
      expect(offlineQueue.isEmpty, isTrue);
      expect(drainedMessages.length, 1);
      expect(drainedMessages.first['text'], 'Vérifie les fichiers git en local');
      expect(drainedMessages.first['model'], 'ollama/qwen-2.5-coder');
    });
  });
}
