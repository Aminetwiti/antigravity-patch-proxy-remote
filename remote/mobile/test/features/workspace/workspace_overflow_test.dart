import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/workspace/workspace_screen.dart';

void main() {
  testWidgets('WorkspaceScreen does not overflow on long folder names or long file paths on mobile', (tester) async {
    // Set a narrow mobile screen constraint (360x740)
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    await tester.pumpWidget(
      const MaterialApp(
        home: WorkspaceScreen(
          workspacePath: r'c:\Users\developer\Downloads\antigravity-add-model-main\antigravity-add-model-main\very\long\nested\path\that\would\normally\overflow',
        ),
      ),
    );

    // Initial render without errors
    expect(tester.takeException(), isNull);

    // Verify workspace label renders
    expect(find.byType(WorkspaceScreen), findsOneWidget);
  });
}
