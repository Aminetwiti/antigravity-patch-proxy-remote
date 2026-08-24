# 10. Flux d'Interaction `AskQuestion` & Choix Multiples

> **Protocole d'Échange des Formulaires Interactifs**

---

## 1. Structure de la Demande (`AskQuestion`)
Lorsque l'agent pose une question à choix multiples, le Language Server émet un payload de type interaction :

```json
{
  "question": "Quel framework souhaitez-vous utiliser pour ce projet ?",
  "options": [
    "(Recommended) Gin Web Framework",
    "Fiber Framework",
    "Standard Library net/http"
  ],
  "is_multi_select": false
}
```

---

## 2. Rendu Mobile & Réponse
1. Le Mobile Flutter intercepte l'événement et affiche une boîte de dialogue modale interactive (`AskQuestionDialog`).
2. L'utilisateur sélectionne son option.
3. Le Daemon renvoie la réponse via `HandleCascadeUserInteraction` avec l'option choisie, permettant à l'agent de reprendre immédiatement son exécution.
