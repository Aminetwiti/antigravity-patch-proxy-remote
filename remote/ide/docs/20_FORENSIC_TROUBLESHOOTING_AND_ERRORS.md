# 20. Guide de Dépannage Forensique & Résolution des Erreurs

> **Catalogue des Codes d'Erreur ConnectRPC & Procédures de Récupération**

---

## 1. Tableau des Erreurs Fréquentes

| Code d'Erreur Reçu | Cause Racine Identifiée | Solution Immédiate |
|:---|:---|:---|
| `invalid_argument: CortexTrajectorySource is unspecified` | Champ Protobuf 4 manquant dans `StartCascade` | Ajouter `varintField(4, 1)` dans la sérialisation binaire de la requête. |
| `untrusted_workspace` | Clé d'API ou jeton CSRF manquant dans metadata | Transmettre `APIKey` et le header `x-codeium-csrf-token`. |
| `cannot specify both workspace URIs and project env` | Présence conjointe des champs 8 et 17 | N'envoyer que le champ 8 (workspace) ou le champ 17 (projectID), jamais les deux. |
| `La connexion sous-jacente a été fermée` | Port ConnectRPC inactif ou en cours de bascule | Exécuter l'algorithme de découverte dynamique pour actualiser le port actif. |
| `Connection refused on :51074` | Le proxy de patch local n'est pas démarré | Lancer le proxy ou exécuter `npm run mitm:start`. |

---

## 2. Procédure de Récupération d'Urgence
Si le Language Server ne répond plus :
1. Exécuter `Get-Process language_server_windows_x64` pour vérifier son état.
2. Relancer le test ConnectRPC `Heartbeat` sur les ports ouverts.
3. Vérifier que `http://localhost:51074/health` renvoie bien `{"status": "ok"}`.
