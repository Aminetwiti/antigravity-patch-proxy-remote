import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/env_config.dart';
import '../../core/discovery/lan_discovery.dart';
import '../../services/saved_connections_store.dart';
import '../../services/settings_store.dart';
import 'qr_scanner_screen.dart';
import 'package:mobile/theme/app_colors.dart';

class DiscoveryScreen extends StatefulWidget {
  final Future<bool> Function(String host, int port, String csrfToken)? onConnect;

  const DiscoveryScreen({super.key, this.onConnect});

  @override
  State<DiscoveryScreen> createState() => _DiscoveryScreenState();
}

class _DiscoveryScreenState extends State<DiscoveryScreen> {
  final TextEditingController _hostController =
      TextEditingController(text: EnvConfig.daemonHost);
  final TextEditingController _portController =
      TextEditingController(text: EnvConfig.daemonPort.toString());
  final TextEditingController _csrfController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();

  final LanDiscoveryService _lanDiscovery = LanDiscoveryService();
  StreamSubscription<List<DiscoveredDaemon>>? _lanDiscoverySub;
  List<DiscoveredDaemon> _discoveredDaemons = [];
  List<SavedConnection> _savedConnections = [];

  bool _isConnecting = false;
  String? _errorMessage;
  String? _successMessage;

  @override
  void initState() {
    super.initState();
    _startLanDiscovery();
    _loadSavedConnections();
    _prefillFromSession();
  }

  Future<void> _loadSavedConnections() async {
    final list = await SavedConnectionsStore.getSavedConnections();
    if (mounted) {
      setState(() {
        _savedConnections = list;
      });
    }
  }

  /// Pré-remplit hôte/port/token/PIN depuis la session sauvegardée ou la dernière
  /// connexion mémorisée. Même si l'app a été fermée, toutes les informations
  /// sont restaurées.
  Future<void> _prefillFromSession() async {
    final s = await SettingsStore.loadSession();
    final lastConn = await SavedConnectionsStore.getLastConnection();
    if (!mounted) return;

    final url = s['wsUrl'] as String? ?? lastConn?.wsUrl ?? '';
    final token = (s['token'] as String? ?? '').isNotEmpty
        ? s['token'] as String
        : (lastConn?.authToken ?? '');
    final pin = (s['pin'] as String? ?? '').isNotEmpty
        ? s['pin'] as String
        : (lastConn?.pin ?? '');
    final host = (s['host'] as String? ?? '').isNotEmpty
        ? s['host'] as String
        : (lastConn?.host ?? '');
    final port = (s['port'] as int? ?? 0) > 0
        ? s['port'] as int
        : (lastConn?.port ?? EnvConfig.daemonPort);

    if (host.isNotEmpty) _hostController.text = host;
    if (port > 0) _portController.text = port.toString();
    if (token.isNotEmpty) _csrfController.text = token;
    if (pin.isNotEmpty) _pinController.text = pin;

    if (url.isNotEmpty) {
      final uri = Uri.tryParse(url);
      if (uri != null && uri.host.isNotEmpty) {
        _hostController.text = uri.host;
        if (uri.port > 0) _portController.text = uri.port.toString();
      }
    }

    setState(() {});
  }

  void _startLanDiscovery() {
    _lanDiscovery.startDiscovery();
    _lanDiscoverySub?.cancel();
    _lanDiscoverySub = _lanDiscovery.daemonsStream.listen((daemons) {
      if (mounted) {
        setState(() {
          _discoveredDaemons = daemons;
        });
      }
    });
  }

  // Lancement du scanner QR
  Future<void> _startScan() async {
    final scannedCode = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (context) => const QrScannerScreen()),
    );

    if (scannedCode != null && scannedCode.isNotEmpty) {
      final uri = Uri.tryParse(scannedCode);
      if (uri != null) {
        final host = '${uri.scheme}://${uri.host}${uri.path}';
        final port = uri.port > 0 ? uri.port : (uri.scheme == 'wss' || uri.scheme == 'https' ? 443 : 80);
        final token = uri.queryParameters['token'] ?? '';

        setState(() {
          _hostController.text = host;
          _portController.text = port.toString();
          _csrfController.text = token;
        });

        // Auto-connect
        _connect();
      }
    }
  }

  Future<void> _connectWithDaemon(DiscoveredDaemon d) async {
    setState(() {
      _hostController.text = d.host;
      _portController.text = d.port.toString();
      if (d.authToken.isNotEmpty) {
        _csrfController.text = d.authToken;
      }
    });
    await _connect();
  }

  Future<void> _connectWithSavedConnection(SavedConnection c) async {
    setState(() {
      _hostController.text = c.host;
      _portController.text = c.port.toString();
      if (c.authToken.isNotEmpty) _csrfController.text = c.authToken;
      if (c.pin.isNotEmpty) _pinController.text = c.pin;
    });
    await _connect();
  }

  Future<void> _deleteSavedConnection(String id) async {
    await SavedConnectionsStore.removeConnection(id);
    await _loadSavedConnections();
  }

  Future<void> _connect({bool silent = false}) async {
    final host = _hostController.text.trim();
    final port = int.tryParse(_portController.text.trim());
    if (host.isEmpty || port == null) {
      if (!silent) {
        setState(() => _errorMessage = 'Veuillez saisir un hôte et un port valides.');
      }
      return;
    }
    final token = _csrfController.text.trim();
    final pin = _pinController.text.trim();

    setState(() {
      _isConnecting = true;
      _errorMessage = null;
      _successMessage = null;
    });
    await Future.delayed(const Duration(milliseconds: 300));
    if (!mounted) return;

    final ok = widget.onConnect == null || await widget.onConnect!(host, port, token);
    if (!mounted) return;
    setState(() {
      _isConnecting = false;
      if (ok) {
        final isSsl = host.startsWith('https') || host.startsWith('wss') || port == 443;
        final cleanHost = host.replaceAll(RegExp(r'^https?://|^wss?://'), '').replaceAll(RegExp(r'/.*$'), '');
        final wsUrl = '${isSsl ? 'wss' : 'ws'}://$cleanHost:$port/ws';
        SettingsStore.saveSession(
          wsUrl: wsUrl,
          token: token,
          pin: pin,
          host: cleanHost,
          port: port,
          ssl: isSsl,
        );
        _loadSavedConnections();
        _successMessage = 'Appairé avec succès : $host:$port';
      } else {
        if (!silent) {
          _errorMessage = 'Connexion refusée. Vérifiez le port et le Token Auth ou PIN.';
        }
      }
    });
  }

  /// Appairage par code PIN 6 chiffres (P4) : interroge POST /pair sur le daemon,
  /// récupère le token de session et se connecte automatiquement.
  Future<void> _pairWithPin() async {
    final host = _hostController.text.trim();
    final port = int.tryParse(_portController.text.trim());
    final pin = _pinController.text.trim();
    if (host.isEmpty || port == null || pin.isEmpty) {
      setState(() => _errorMessage = 'Veuillez saisir l\'hôte, le port et le code PIN 6 chiffres.');
      return;
    }
    setState(() {
      _isConnecting = true;
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final scheme = (host.startsWith('https') || host.startsWith('wss')) ? 'https' : 'http';
      final cleanHost = host.replaceAll(RegExp(r'^https?://|^wss?://'), '').replaceAll(RegExp(r'/.*$'), '');
      final uri = Uri.parse('$scheme://$cleanHost:$port/pair');
      final res = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'pin': pin, 'deviceId': 'antigravity-mobile'}),
      ).timeout(const Duration(seconds: 10));

      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        final token = data['token'] as String;
        _csrfController.text = token;
        _pinController.clear();
        await _connect();
      } else {
        if (!mounted) return;
        setState(() {
          _isConnecting = false;
          _errorMessage = data['error']?.toString() ?? 'Échec d\'appairage (HTTP ${res.statusCode})';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isConnecting = false;
        _errorMessage = 'Impossible de joindre le daemon pour appairage: $e';
      });
    }
  }

  String _formatRelativeTime(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inSeconds < 60) return 'À l\'instant';
    if (diff.inMinutes < 60) return 'Il y a ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'Il y a ${diff.inHours} h';
    if (diff.inDays == 1) return 'Hier';
    return 'Il y a ${diff.inDays} j';
  }

  Widget _buildSavedConnectionsSection() {
    if (_savedConnections.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          child: Row(
            children: [
              Icon(Icons.history, size: 14, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 6),
              Text(
                'DERNIÈRES CONNEXIONS SAUVEGARDÉES',
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: Theme.of(context).colorScheme.primary,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Column(
          children: _savedConnections.map((c) {
            final isCurrent = _hostController.text.trim() == c.host &&
                _portController.text.trim() == c.port.toString();
            final isTunnel = c.host.contains('trycloudflare') || c.host.contains('pinggy') || c.ssl;

            return Card(
              key: Key('saved-conn-${c.id}'),
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: (isTunnel ? const Color(0xFF8B5CF6) : const Color(0xFF3B82F6))
                            .withValues(alpha: 0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isTunnel ? Icons.cloud_done_outlined : Icons.computer_outlined,
                        size: 20,
                        color: isTunnel ? const Color(0xFF8B5CF6) : const Color(0xFF3B82F6),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  c.label.isNotEmpty ? c.label : '${c.host}:${c.port}',
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w600,
                                    color: Theme.of(context).colorScheme.onSurface,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (isCurrent) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'Actuel',
                                    style: TextStyle(
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.w700,
                                      color: Theme.of(context).colorScheme.primary,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 3),
                          Wrap(
                            spacing: 6,
                            runSpacing: 2,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                '${c.host}:${c.port}',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                                ),
                              ),
                              if (c.authToken.isNotEmpty)
                                const Text(
                                  '• 🔑 Token',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w500,
                                    color: Color(0xFF10B981),
                                  ),
                                ),
                              if (c.pin.isNotEmpty)
                                // SEC-04 : PIN jamais affiché en clair
                                // (shoulder-surfing) — présence seulement.
                                const Text(
                                  '• PIN: ••••••',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Color(0xFF9CA3AF),
                                  ),
                                ),
                              Text(
                                '• ${_formatRelativeTime(c.lastConnectedAt)}',
                                style: TextStyle(
                                  fontSize: 10.5,
                                  color: Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.8),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      key: Key('btn-connect-${c.id}'),
                      onPressed: _isConnecting ? null : () => _connectWithSavedConnection(c),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Theme.of(context).colorScheme.primary,
                        foregroundColor: Theme.of(context).colorScheme.onPrimary,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        minimumSize: const Size(60, 32),
                      ),
                      child: const Text('1-Tap', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
                    ),
                    IconButton(
                      key: Key('btn-delete-${c.id}'),
                      icon: const Icon(Icons.delete_outline, size: 18),
                      color: Theme.of(context).colorScheme.error.withValues(alpha: 0.8),
                      tooltip: 'Supprimer cette connexion',
                      onPressed: () => _deleteSavedConnection(c.id),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  @override
  void dispose() {
    _lanDiscoverySub?.cancel();
    _lanDiscovery.dispose();
    _hostController.dispose();
    _portController.dispose();
    _csrfController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      appBar: AppBar(
        title: Text('Découvrir les Daemons', style: TextStyle(fontSize: 14, color: Theme.of(context).colorScheme.onSurface)),
        backgroundColor: Theme.of(context).colorScheme.surfaceContainer,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, size: 20),
            tooltip: 'Relancer la recherche réseau',
            onPressed: () {
              _startLanDiscovery();
              _loadSavedConnections();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Recherche réseau relancée…'), duration: Duration(seconds: 1)),
              );
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          // ── Section Connexions Sauvegardées
          _buildSavedConnectionsSection(),

          // ── Intro Card
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(AppRadius.lg),
                    ),
                    child: Icon(Icons.podcasts, size: 24, color: Theme.of(context).colorScheme.primary),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Détection Automatique LAN & Scan',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurface),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Connectez-vous instantanément à votre PC Antigravity sur le même Wi-Fi.',
                          style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // ── SECTION DÉCOUVERTE ZERO-CONFIG UDP
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Row(
              children: [
                Icon(Icons.wifi_tethering, size: 14, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 6),
                Text(
                  'PC DÉTECTÉS SUR LE RÉSEAU (ZERO-CONFIG)',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: Theme.of(context).colorScheme.primary,
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),

          if (_discoveredDaemons.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
                child: Row(
                  children: [
                    SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        'Recherche active de votre PC Antigravity sur le Wi-Fi local…',
                        style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            Column(
              children: _discoveredDaemons.map((d) {
                return Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: const Color(0xFF10B981).withValues(alpha: 0.15),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.laptop_chromebook, size: 20, color: Color(0xFF10B981)),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    d.displayName,
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: Theme.of(context).colorScheme.onSurface,
                                    ),
                                  ),
                                  Text(
                                    'IP: ${d.formattedAddress}',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            ElevatedButton(
                              onPressed: _isConnecting ? null : () => _connectWithDaemon(d),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Theme.of(context).colorScheme.primary,
                                foregroundColor: Theme.of(context).colorScheme.onPrimary,
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                              ),
                              child: const Text('1-Tap Connect', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                            ),
                          ],
                        ),
                        if (d.workspaces.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            children: d.workspaces.map((ws) {
                              return Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '📁 $ws',
                                  style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant),
                                ),
                              );
                            }).toList(),
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),

          const SizedBox(height: 16),

          // ── Scan QR Code Button
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _startScan,
              icon: Icon(Icons.qr_code_scanner, size: 16, color: Theme.of(context).colorScheme.primary),
              label: Text(
                'Scanner le QR Code (Tunnel Distant)',
                style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurface),
              ),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),

          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 16),

          // ── Manual Entry Section
          Text(
            'CONNEXION MANUELLE',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 8),

          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final hostWidget = Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Hôte PC / Domaine', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _hostController,
                            style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurface),
                            decoration: InputDecoration(
                              prefixIcon: Icon(Icons.lan_outlined, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                              hintText: '192.168.1.50',
                            ),
                          ),
                        ],
                      );

                      final portWidget = Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Port Daemon', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _portController,
                            keyboardType: TextInputType.number,
                            style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurface),
                            decoration: InputDecoration(
                              prefixIcon: Icon(Icons.numbers, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                              hintText: EnvConfig.daemonPort.toString(),
                            ),
                          ),
                        ],
                      );

                      if (constraints.maxWidth > 500) {
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(flex: 2, child: hostWidget),
                            const SizedBox(width: 12),
                            Expanded(flex: 1, child: portWidget),
                          ],
                        );
                      }
                      return Column(
                        children: [
                          hostWidget,
                          const SizedBox(height: 12),
                          portWidget,
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Code PIN (6 chiffres affichés sur PC)', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _pinController,
                              keyboardType: TextInputType.number,
                              maxLength: 6,
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 3, color: Theme.of(context).colorScheme.onSurface),
                              decoration: InputDecoration(
                                counterText: '',
                                prefixIcon: Icon(Icons.pin_outlined, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                                hintText: '123456',
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Padding(
                        padding: const EdgeInsets.only(top: 22),
                        child: OutlinedButton(
                          onPressed: _isConnecting ? null : _pairWithPin,
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                          ),
                          child: const Text('Valider PIN', style: TextStyle(fontSize: 12)),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text('Token Auth (optionnel ou obtenu via PIN)', style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _csrfController,
                    obscureText: true,
                    style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurface),
                    decoration: InputDecoration(
                      prefixIcon: Icon(Icons.key_outlined, size: 18, color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                  ),
                  const SizedBox(height: 16),

                  if (_errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.error.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.error_outline, size: 16, color: Theme.of(context).colorScheme.error),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(_errorMessage!, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.error)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],

                  if (_successMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.3)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.check_circle_rounded, size: 18, color: Color(0xFF10B981)),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _successMessage!,
                                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFF10B981)),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: () => Navigator.of(context).pop(true),
                              icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16),
                              label: const Text('Accéder au Chat', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: const Color(0xFF10B981),
                                side: const BorderSide(color: Color(0xFF10B981)),
                                padding: const EdgeInsets.symmetric(vertical: 8),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],

                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _isConnecting ? null : _connect,
                      icon: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 300),
                        child: _isConnecting
                            ? SizedBox(
                                key: const ValueKey('loading'),
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Theme.of(context).colorScheme.onPrimary),
                              )
                            : Icon(Icons.link, key: const ValueKey('link'), size: 16, color: Theme.of(context).colorScheme.onPrimary),
                      ),
                      label: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 300),
                        child: Text(
                          _isConnecting ? 'Connexion…' : 'Appairer & Connecter',
                          key: ValueKey<bool>(_isConnecting),
                          style: TextStyle(color: Theme.of(context).colorScheme.onPrimary),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 20),
          const _SectionHeader(title: 'AGENTS PERSONNALISÉS'),
          const SizedBox(height: 8),

          _CustomAgentManager(),
        ],
      ),
    );
  }
}

class _CustomAgentManager extends StatefulWidget {
  @override
  State<_CustomAgentManager> createState() => _CustomAgentManagerState();
}

class _CustomAgentManagerState extends State<_CustomAgentManager> {
  final List<Map<String, dynamic>> _customAgents = [
    {'id': 'ca1', 'name': 'Code Reviewer Agent', 'active': true},
    {'id': 'ca2', 'name': 'Refactoring Specialist', 'active': false},
    {'id': 'ca3', 'name': 'Doc Generator', 'active': true},
  ];

  @override
  Widget build(BuildContext context) {
    if (_customAgents.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'Aucun agent personnalisé configuré.',
            style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ),
      );
    }

    return Card(
      child: Column(
        children: [
          for (int i = 0; i < _customAgents.length; i++) ...[
            if (i > 0) const Divider(),
            ListTile(
              dense: true,
              leading: Icon(
                Icons.smart_toy_outlined,
                size: 18,
                color: _customAgents[i]['active'] ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              title: Text(
                _customAgents[i]['name'],
                style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.onSurface, fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                _customAgents[i]['active'] ? 'Activé' : 'Désactivé',
                style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Switch(
                    value: _customAgents[i]['active'],
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    onChanged: (val) => setState(() => _customAgents[i]['active'] = val),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.delete_outline, size: 16),
                    tooltip: 'Supprimer l\'agent',
                    onPressed: () {
                      final name = _customAgents[i]['name'];
                      setState(() => _customAgents.removeAt(i));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Agent "$name" supprimé.')),
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
        letterSpacing: 0.8,
      ),
    );
  }
}
