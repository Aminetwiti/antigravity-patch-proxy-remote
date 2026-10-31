import 'package:flutter/material.dart';

class GitWorktreeSelector extends StatelessWidget {
  final String currentBranch;
  final List<String> branches;
  final ValueChanged<String> onBranchSelected;

  const GitWorktreeSelector({
    super.key,
    required this.currentBranch,
    required this.branches,
    required this.onBranchSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text('Active Git Worktree / Branch', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        ...branches.map((b) {
          final isSelected = b == currentBranch;
          return ListTile(
            leading: Icon(isSelected ? Icons.check_circle : Icons.alt_route, size: 20),
            title: Text(b),
            trailing: isSelected ? const Chip(label: Text('Active', style: TextStyle(fontSize: 11))) : null,
            onTap: () => onBranchSelected(b),
          );
        }),
      ],
    );
  }
}
