import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/widgets/unified_diff_viewer.dart';

void main() {
  group('UnifiedDiffViewer Hunk Approval Tests', () {
    const multiHunkDiff = '''
diff --git a/lib/main.dart b/lib/main.dart
--- a/lib/main.dart
+++ b/lib/main.dart
@@ -10,4 +10,5 @@ void foo() {
-  print("old");
+  print("new 1");
+  print("new 2");
 }
@@ -30,3 +31,4 @@ void bar() {
-  int x = 1;
+  int x = 2;
+  int y = 3;
 }
''';

    testWidgets('renders hunks with checkboxes and allows selective hunk application', (tester) async {
      String? appliedPatch;
      List<int>? appliedIndices;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UnifiedDiffViewer(
              diffContent: multiHunkDiff,
              fileName: 'main.dart',
              onApplySelectedHunks: (patch, indices) {
                appliedPatch = patch;
                appliedIndices = indices;
              },
            ),
          ),
        ),
      );

      await tester.pumpAndSettle();

      // Check that both hunk headers are present
      expect(find.text('Hunk #1'), findsOneWidget);
      expect(find.text('Hunk #2'), findsOneWidget);
      expect(find.text('2/2 hunk(s) sélectionné(s)'), findsOneWidget);

      // Deselect Hunk #1
      final checkboxes = find.byType(Checkbox);
      expect(checkboxes, findsNWidgets(2));
      await tester.tap(checkboxes.first);
      await tester.pumpAndSettle();

      expect(find.text('1/2 hunk(s) sélectionné(s)'), findsOneWidget);

      // Tap Validate selection button
      final validateBtn = find.text('Valider sélection');
      expect(validateBtn, findsOneWidget);
      await tester.tap(validateBtn);
      await tester.pumpAndSettle();

      expect(appliedIndices, equals([1]));
      expect(appliedPatch, contains('int x = 2;'));
      expect(appliedPatch, isNot(contains('print("new 1");')));
    });
  });
}
