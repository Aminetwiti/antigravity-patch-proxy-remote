# 13. Automatisation par le CLI Natif (`antigravity-ide.cmd`)

> **Contrôle Graphique en Ligne de Commande**

---

## 1. Syntaxe de la Sous-Commande `chat`

```text
Usage: antigravity-ide.cmd chat [options] [prompt]

Options:
  -r, --reuse-window       Force l'utilisation de la dernière fenêtre IDE active
  -n, --new-window         Ouvre une nouvelle fenêtre vide pour la session
  -m, --mode <mode>        Mode d'agent : 'agent' (défaut), 'edit', 'ask'
  -a, --add-file <path>    Injecte un ou plusieurs fichiers de contexte
  --maximize              Agrandit automatiquement le panneau de chat
```

---

## 2. Exemples d'Automatisation Scriptée

```powershell
# Injection d'un prompt avec pièces jointes multiples
& "tools\Antigravity IDE\bin\antigravity-ide.cmd" chat -r -a "src/main.ts" -a "src/proxy.ts" "Audit des flux de données"

# Lancement en mode édition avec validation automatique
& "tools\Antigravity IDE\bin\antigravity-ide.cmd" chat -r -m edit "Ajoute la validation des types sur les routes REST"
```
