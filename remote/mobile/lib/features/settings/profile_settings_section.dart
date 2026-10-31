import 'package:flutter/material.dart';
import '../../services/settings_store.dart';

/// Éditeur de profil utilisateur : avatar, nom, rôle et statut de présence.
/// Les champs sont persistés (SettingsStore) à chaque modification.
class ProfileSettingsSection extends StatefulWidget {
  const ProfileSettingsSection({
    super.key,
    this.initialName = 'Developer',
    this.initialRole = 'Remote Host Controller',
    this.initialStatus = 'Online',
  });

  final String initialName;
  final String initialRole;
  final String initialStatus;

  @override
  State<ProfileSettingsSection> createState() => _ProfileSettingsSectionState();
}

class _ProfileSettingsSectionState extends State<ProfileSettingsSection> {
  late final TextEditingController _nameController;
  late final TextEditingController _roleController;
  String _status = 'Online';

  final List<String> _statuses = ['Online', 'Busy', 'Invisible', 'Away'];

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.initialName);
    _roleController = TextEditingController(text: widget.initialRole);
    _status = widget.initialStatus;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _roleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Avatar + quick edit
            Row(
              children: [
                Stack(
                  children: [
                    CircleAvatar(
                      radius: 26,
                      backgroundColor: scheme.primary,
                      child: Text(
                        _nameController.text.isNotEmpty
                            ? _nameController.text[0].toUpperCase()
                            : 'A',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: scheme.onPrimary,
                        ),
                      ),
                    ),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: InkWell(
                        onTap: () {
                          showDialog(
                            context: context,
                            builder: (ctx) => SimpleDialog(
                              title: const Text('Statut de présence'),
                              children: _statuses
                                  .map(
                                    (s) => SimpleDialogOption(
                                      onPressed: () {
                                        setState(() => _status = s);
                                        SettingsStore.save({'status': s});
                                        Navigator.pop(ctx);
                                      },
                                      child: Text(s),
                                    ),
                                  )
                                  .toList(),
                            ),
                          );
                        },
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.all(3),
                          decoration: BoxDecoration(
                            color: scheme.surfaceContainer,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: scheme.outlineVariant,
                            ),
                          ),
                          child: Icon(
                            Icons.photo_camera_outlined,
                            size: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: _nameController,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                        decoration: const InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                          hintText: 'Nom d\'affichage',
                          contentPadding: EdgeInsets.zero,
                        ),
                        onChanged: (v) {
                          setState(() {});
                          SettingsStore.save({'displayName': v});
                        },
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            width: 7,
                            height: 7,
                            decoration: BoxDecoration(
                              color: _status == 'Online'
                                  ? scheme.primary
                                  : _status == 'Busy'
                                      ? scheme.tertiary
                                      : scheme.outline,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          DropdownButtonHideUnderline(
                            child: DropdownButton<String>(
                              value: _status,
                              isDense: true,
                              style: TextStyle(
                                fontSize: 12,
                                color: scheme.onSurfaceVariant,
                              ),
                              items: _statuses
                                  .map((s) => DropdownMenuItem(
                                        value: s,
                                        child: Text(s),
                                      ))
                                  .toList(),
                              onChanged: (val) {
                                if (val != null) {
                                  setState(() => _status = val);
                                  SettingsStore.save({'status': val});
                                }
                              },
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Rôle
            TextField(
              controller: _roleController,
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(context).colorScheme.onSurface,
              ),
              decoration: InputDecoration(
                labelText: 'Rôle / Description',
                prefixIcon: Icon(Icons.badge_outlined,
                    size: 18, color: scheme.onSurfaceVariant),
              ),
              onChanged: (v) => SettingsStore.save({'role': v}),
            ),
          ],
        ),
      ),
    );
  }
}
