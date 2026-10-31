import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/protocol/messages.dart';
import 'package:mobile/widgets/project_selector_bottom_sheet.dart';

void main() {
  testWidgets('ProjectSelectorBottomSheet renders scrollable list of projects without overflow', (tester) async {
    final manyProjects = List.generate(
      15,
      (i) => ProjectItem(
        id: 'proj-$i',
        name: 'Project $i',
        path: '/Users/developer/code/project_$i',
        folderUri: 'file:///Users/developer/code/project_$i',
      ),
    );

    ProjectItem? selected;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () {
                ProjectSelectorBottomSheet.show(
                  context,
                  projects: manyProjects,
                  activeProjectPath: manyProjects[2].path,
                  onSelectProject: (p) => selected = p,
                );
              },
              child: const Text('Open Sheet'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open Sheet'));
    await tester.pumpAndSettle();

    // Verify modal header and count badge
    expect(find.text('Sélectionner un projet de travail'), findsOneWidget);
    expect(find.text('15'), findsOneWidget);

    // Verify items are displayed in scrollable list
    expect(find.text('Project 0'), findsOneWidget);
    expect(find.text('Project 1'), findsOneWidget);

    // Select an item
    await tester.tap(find.text('Project 1'));
    await tester.pumpAndSettle();

    // Verify callback was fired and bottom sheet popped
    expect(selected, isNotNull);
    expect(selected!.name, 'Project 1');
    expect(find.text('Sélectionner un projet de travail'), findsNothing);
  });
}
