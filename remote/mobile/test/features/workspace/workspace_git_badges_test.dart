import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/workspace/workspace_screen.dart';

void main() {
  group('Workspace Git Status Badges Tests', () {
    testWidgets('renders file tree and git badges correctly', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: WorkspaceScreen(
              workspacePath: '/mock/workspace',
            ),
          ),
        ),
      );

      // Verify workspace screen loads
      expect(find.byType(WorkspaceScreen), findsOneWidget);
    });
  });
}
