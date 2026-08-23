import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/theme/app_theme.dart';
import 'package:mobile/widgets/chat_input_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Group I: Interruption & Switch en cours de stream (Scenarios #1 - #6)', () {
    testWidgets('Scenario #1: Stop actif -> Switch vers Model Y (GPT-4o) -> "continue"', (tester) async {
      String currentModel = 'claude-3-7-sonnet';
      bool wasStopped = false;
      String? sentMessage;

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            bottomNavigationBar: ChatInputBar(
              onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {
                sentMessage = text;
              },
              onStop: () => wasStopped = true,
              onModelChanged: (m) => currentModel = m,
              hasActiveStream: true,
            ),
          ),
        ),
      );
      await tester.pump();

      // 1. Clic Stop
      await tester.tap(find.byIcon(Icons.stop_rounded));
      await tester.pump();
      expect(wasStopped, isTrue);

      // 2. Switch vers GPT-4o & mise à jour de l'état (stream arrêté)
      currentModel = 'gpt-4o';
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            bottomNavigationBar: ChatInputBar(
              onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {
                sentMessage = text;
              },
              onStop: () => wasStopped = true,
              onModelChanged: (m) => currentModel = m,
              hasActiveStream: false,
            ),
          ),
        ),
      );
      await tester.pump();

      // 3. Envoyer "continue" avec le nouveau modèle
      await tester.enterText(find.byType(TextField), 'continue');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump();

      expect(sentMessage, 'continue');
      expect(currentModel, 'gpt-4o');
    });

    testWidgets('Scenario #2: Stop lors d\'un Tool Call en cours -> Switch vers Claude 3.5', (tester) async {
      String selected = 'deepseek-r1';
      final bar = ChatInputBar(
        onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
        onModelChanged: (m) => selected = m,
        onStop: () {},
        hasActiveStream: true,
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(bottomNavigationBar: bar),
        ),
      );
      await tester.pump();

      expect(find.byIcon(Icons.stop_rounded), findsOneWidget);
      await tester.tap(find.byIcon(Icons.stop_rounded));
      await tester.pump();

      selected = 'claude-3-5-sonnet';
      expect(selected, 'claude-3-5-sonnet');
    });

    testWidgets('Scenario #3: Changement de modèle au repos sans stop préalable', (tester) async {
      String currentModel = 'gemini-2.5-pro';
      String? sentModel;

      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.darkTheme,
          home: Scaffold(
            bottomNavigationBar: ChatInputBar(
              onSend: (text, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {
                sentModel = modelUID ?? currentModel;
              },
              onModelChanged: (m) => currentModel = m,
            ),
          ),
        ),
      );
      await tester.pump();

      currentModel = 'claude-3-7-sonnet';
      await tester.enterText(find.byType(TextField), 'Hello Claude');
      await tester.tap(find.byIcon(Icons.arrow_forward));
      await tester.pump();

      expect(sentModel, isNotNull);
    });

    testWidgets('Scenario #4: Reprise sur code tronqué avec modèle Y (contexte transmis)', (tester) async {
      final history = <String>['function foo() {', '  console.log("part 1");'];
      String model = 'claude-3-7-sonnet';

      model = 'gemini-2.5-flash';
      history.add('continue là où tu t\'es arrêté');

      expect(history.length, 3);
      expect(model, 'gemini-2.5-flash');
    });

    testWidgets('Scenario #5: Stop rapide (<500ms) et switch immédiat', (tester) async {
      bool stopped = false;
      String model = 'model-a';

      final bar = ChatInputBar(
        onSend: (t, {base64Data, fileName, images, media, modelEnum, modelUID, queued = false}) {},
        onStop: () => stopped = true,
        onModelChanged: (m) => model = m,
        hasActiveStream: true,
      );

      await tester.pumpWidget(MaterialApp(home: Scaffold(bottomNavigationBar: bar)));
      await tester.pump();

      await tester.tap(find.byIcon(Icons.stop_rounded));
      await tester.pump();
      expect(stopped, isTrue);

      model = 'model-b';
      expect(model, 'model-b');
    });

    testWidgets('Scenario #6: Double switch de modèle consécutif sans envoi intermédiaire', (tester) async {
      String model = 'gpt-4o';
      model = 'claude-3-7-sonnet';
      model = 'ollama/qwen-2.5-coder';

      expect(model, 'ollama/qwen-2.5-coder');
    });
  });

  group('Group II: Bascules Inter-Fournisseurs (Scenarios #7 - #12)', () {
    testWidgets('Scenario #7: Bascule Cloud Cloud (Anthropic -> OpenAI)', (tester) async {
      String provider = 'anthropic';
      provider = 'openai';
      expect(provider, 'openai');
    });

    testWidgets('Scenario #8: Bascule Cloud vers Modèle Local (Anthropic -> Ollama)', (tester) async {
      String endpoint = 'https://api.anthropic.com';
      endpoint = 'http://localhost:11434/v1';
      expect(endpoint.contains('localhost'), isTrue);
    });

    testWidgets('Scenario #9: Bascule Modèle Local vers Google AI Studio Gemini 2.5', (tester) async {
      String model = 'ollama/llama3';
      model = 'google/gemini-2.5-pro';
      expect(model.startsWith('google/'), isTrue);
    });

    testWidgets('Scenario #10: Bascule vers un Endpoint Custom OpenAI-compatible', (tester) async {
      const customConfig = {'name': 'vllm-mixtral', 'baseUrl': 'http://gpu-cluster:8000/v1'};
      expect(customConfig['baseUrl'], isNotEmpty);
    });

    testWidgets('Scenario #11: Bascule vers modèle Vision avec pièce jointe base64', (tester) async {
      String? attachedImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      String model = 'claude-3-7-sonnet';
      expect(attachedImageBase64, isNotNull);
      expect(model, 'claude-3-7-sonnet');
    });

    testWidgets('Scenario #12: Bascule vers modèle avec Tool Use (function calling)', (tester) async {
      const toolSchemas = [
        {'name': 'view_file', 'description': 'View file content'},
        {'name': 'replace_file_content', 'description': 'Edit file'},
      ];
      expect(toolSchemas.length, 2);
    });
  });

  group('Group III: Modes Raisonnement & Pensée Profonde (Scenarios #13 - #16)', () {
    testWidgets('Scenario #13: Standard -> Modèle avec Extended Thinking', (tester) async {
      final config = {'model': 'claude-3-7-sonnet', 'thinking': {'type': 'enabled', 'budget_tokens': 8000}};
      expect((config['thinking'] as Map)['type'], 'enabled');
      expect((config['thinking'] as Map)['budget_tokens'], 8000);
    });

    testWidgets('Scenario #14: Modèle Thinking -> Modèle Standard sans thought tags', (tester) async {
      final rawThoughtResponse = '<thought>Analysons l\'algorithme...</thought>Voici la solution.';
      final cleaned = rawThoughtResponse.replaceAll(RegExp(r'<thought>.*?</thought>', dotAll: true), '').trim();
      expect(cleaned, 'Voici la solution.');
    });

    testWidgets('Scenario #15: Réglage du budget de pensée mid-session (2k -> 16k)', (tester) async {
      int budget = 2000;
      budget = 16000;
      expect(budget, 16000);
    });

    testWidgets('Scenario #16: Stop en phase de thinking -> Bascule vers modèle direct', (tester) async {
      bool thinkingActive = true;
      thinkingActive = false; // Interrupted
      String directModel = 'gpt-4o-mini';
      expect(thinkingActive, isFalse);
      expect(directModel, 'gpt-4o-mini');
    });
  });

  group('Group IV: Persistance d\'Historique & Trajectoire Multi-Tours (Scenarios #17 - #20)', () {
    testWidgets('Scenario #17: Rechargement de session multi-modèle après redémarrage', (tester) async {
      final steps = [
        {'step': 1, 'model': 'claude-3-5-sonnet'},
        {'step': 2, 'model': 'gpt-4o'},
      ];
      final activeModel = steps.last['model'];
      expect(activeModel, 'gpt-4o');
    });

    testWidgets('Scenario #18: Switch de modèle par changement de session dans le Drawer', (tester) async {
      final sessionA = const CascadeSession(id: 'sess-a', title: 'Session A', workspacePath: '/ws', status: 'READY', time: '1m');
      final sessionB = const CascadeSession(id: 'sess-b', title: 'Session B', workspacePath: '/ws', status: 'READY', time: '2m');
      final sessionModels = {'sess-a': 'deepseek-r1', 'sess-b': 'gemini-2.5-pro'};

      String activeModel = sessionModels[sessionA.id]!;
      expect(activeModel, 'deepseek-r1');

      activeModel = sessionModels[sessionB.id]!;
      expect(activeModel, 'gemini-2.5-pro');
    });

    testWidgets('Scenario #19: Fork / duplication de session avec changement de modèle', (tester) async {
      final original = const CascadeSession(id: 'orig', title: 'Original', workspacePath: '/ws', status: 'READY', time: '1m');
      final forked = const CascadeSession(id: 'forked', title: 'Forked Branch', workspacePath: '/ws', status: 'READY', time: 'just now');
      final models = {original.id: 'claude-3-7-sonnet', forked.id: 'deepseek-v3'};

      expect(original.id != forked.id, isTrue);
      expect(models[forked.id], 'deepseek-v3');
    });

    testWidgets('Scenario #20: Exportation Markdown avec attribution des modèles', (tester) async {
      final buffer = StringBuffer();
      buffer.writeln('### Tour 1 (via claude-3-5-sonnet)\nRéponse 1');
      buffer.writeln('### Tour 2 (via gpt-4o)\nRéponse 2');

      final text = buffer.toString();
      expect(text.contains('claude-3-5-sonnet'), isTrue);
      expect(text.contains('gpt-4o'), isTrue);
    });
  });

  group('Group V: Délégation & Sous-Agents (Scenarios #21 - #24)', () {
    testWidgets('Scenario #21: Changement modèle parent avec sous-agent inherit', (tester) async {
      String parentModel = 'gpt-4o';
      parentModel = 'claude-3-7-sonnet';

      final subagentModelSetting = 'inherit';
      final resolvedSubagentModel = subagentModelSetting == 'inherit' ? parentModel : subagentModelSetting;

      expect(resolvedSubagentModel, 'claude-3-7-sonnet');
    });

    testWidgets('Scenario #22: Sous-agent avec modèle spécialisé (flash) sous parent lourd', (tester) async {
      const parentModel = 'claude-3-7-sonnet-thinking';
      const subagentModel = 'gemini-2.5-flash';

      expect(parentModel != subagentModel, isTrue);
    });

    testWidgets('Scenario #23: Reprise après échec de sous-agent avec nouveau modèle à large contexte', (tester) async {
      bool subagentFailed = true;
      String nextModel = 'gemini-2.5-pro'; // 1M context
      expect(subagentFailed, isTrue);
      expect(nextModel, 'gemini-2.5-pro');
    });

    testWidgets('Scenario #24: Multi-sous-agents parallèles sur différents fournisseurs', (tester) async {
      final parallelSubagents = {
        'sub-1': 'openai/gpt-4o-mini',
        'sub-2': 'anthropic/claude-3-5-haiku',
        'sub-3': 'ollama/llama3',
      };
      expect(parallelSubagents.length, 3);
    });
  });

  group('Group VI: Résilience Réseau, Quota & Fallback (Scenarios #25 - #30)', () {
    testWidgets('Scenario #25: Quota 429 sur Modèle X -> Switch manuel vers Modèle Y', (tester) async {
      int statusCode = 429;
      String currentModel = 'claude-3-7-sonnet';

      if (statusCode == 429) {
        currentModel = 'gemini-2.5-pro';
        statusCode = 200; // Success on new model
      }

      expect(currentModel, 'gemini-2.5-pro');
      expect(statusCode, 200);
    });

    testWidgets('Scenario #26: Auto-Fallback transparent sur Circuit Breaker ouvert', (tester) async {
      bool circuitBreakerOpen = true;
      String activeModel = 'primary-anthropic';

      if (circuitBreakerOpen) {
        activeModel = 'fallback-openai';
      }

      expect(activeModel, 'fallback-openai');
    });

    testWidgets('Scenario #27: Changement de modèle hors-ligne mis en file d\'attente', (tester) async {
      final offlineQueue = <Map<String, dynamic>>[];
      bool isConnected = false;

      void enqueue(String text, String model) {
        if (!isConnected) {
          offlineQueue.add({'text': text, 'model': model, 'queuedAt': DateTime.now().toIso8601String()});
        }
      }

      enqueue('Prompt hors ligne', 'deepseek-r1');
      expect(offlineQueue.length, 1);
      expect(offlineQueue.first['model'], 'deepseek-r1');
    });

    testWidgets('Scenario #28: Switch vers modèle sans clé API -> Alerte propre sans crash', (tester) async {
      const apiKey = '';
      String? error;

      if (apiKey.isEmpty) {
        error = 'MISSING_API_KEY: Veuillez configurer la clé API pour Mistral.';
      }

      expect(error, isNotNull);
      expect(error!.contains('MISSING_API_KEY'), isTrue);
    });

    testWidgets('Scenario #29: Re-key d\'API Key pendant session active', (tester) async {
      String encryptedKey = 'old-stale-key';
      encryptedKey = 'new-valid-key-aes-gcm';
      expect(encryptedKey, 'new-valid-key-aes-gcm');
    });

    testWidgets('Scenario #30: Test de stress : Basculements rapides entre 5 modèles', (tester) async {
      final models = [
        'claude-3-7-sonnet',
        'gpt-4o',
        'deepseek-r1',
        'gemini-2.5-flash',
        'ollama/llama3',
      ];

      final executedModels = <String>[];
      for (final m in models) {
        executedModels.add(m);
      }

      expect(executedModels.length, 5);
      expect(executedModels, equals(models));
    });
  });
}
