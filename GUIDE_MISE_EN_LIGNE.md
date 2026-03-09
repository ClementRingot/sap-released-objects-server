# 🚀 Guide de mise en ligne — sap-released-objects-mcp-server

## Pré-requis

- Node.js 20+ installé
- Git installé
- Compte GitHub
- GitHub CLI (`gh`) installé (optionnel mais recommandé)

---

## Étape 1 — Vérifier que le projet compile

```bash
cd sap-released-objects-mcp-server
npm install
npm run build
npm run bundle
```

Tu dois voir :
```
bundle/index.cjs  1.9mb
```

Test rapide (le serveur doit démarrer puis tu fais Ctrl+C) :
```bash
node bundle/index.cjs
# → [SAP Released Objects MCP] Starting in stdio mode...
# → [SAP Released Objects MCP] Server connected via stdio
```

---

## Étape 2 — Remplacer YOUR_USERNAME dans le README

Ouvre `README.md` et remplace toutes les occurrences de `YOUR_USERNAME` par ton pseudo GitHub.

Commande rapide (Linux/macOS) :
```bash
sed -i 's/YOUR_USERNAME/ton-pseudo-github/g' README.md
```

Windows PowerShell :
```powershell
(Get-Content README.md) -replace 'YOUR_USERNAME','ton-pseudo-github' | Set-Content README.md
```

---

## Étape 3 — Créer le repo GitHub

### Option A — Avec GitHub CLI (recommandé)

```bash
gh repo create sap-released-objects-mcp-server --public --description "MCP server for SAP Cloudification Repository - Clean Core Level A/B/C/D filtering"
```

### Option B — Via l'interface web

1. Va sur https://github.com/new
2. Nom : `sap-released-objects-mcp-server`
3. Description : `MCP server for SAP Cloudification Repository - Clean Core Level A/B/C/D filtering`
4. Public ✅
5. Ne coche PAS "Add a README" (on en a déjà un)
6. Clique "Create repository"

---

## Étape 4 — Premier push

```bash
cd sap-released-objects-mcp-server

git init
git add .
git commit -m "feat: initial release - SAP Cloudification Repository MCP Server

- 6 MCP tools: search, details, successor, compliance check, types, statistics
- Clean Core Level concept (A/B/C/D) replacing 3-tier model
- Multi-system support: Public Cloud, Private Cloud, On-Premise
- PCE version filtering (2022, 2023_x, 2025)
- Dual transport: stdio + HTTP
- Executable build pipeline: esbuild + pkg"

git branch -M main
git remote add origin https://github.com/TON_USERNAME/sap-released-objects-mcp-server.git
git push -u origin main
```

À ce stade, le workflow **CI** se déclenche automatiquement et vérifie que le build passe. ✅

---

## Étape 5 — Créer la première release (déclenche le build des .exe)

```bash
# Crée le tag v1.0.0 et le pousse
git tag v1.0.0
git push origin v1.0.0
```

Le workflow **release.yml** se déclenche alors automatiquement :

1. ⏳ Build sur 3 runners en parallèle (ubuntu, windows, macos) — ~3-5 min
2. 📦 Génère les 3 exécutables
3. 🚀 Crée une GitHub Release `v1.0.0` avec les binaires en assets

Tu peux suivre la progression dans l'onglet **Actions** de ton repo.

---

## Étape 6 — Vérifier la release

Va sur : `https://github.com/TON_USERNAME/sap-released-objects-mcp-server/releases`

Tu devrais voir :
- **sap-released-objects-win.exe** (~50-60 MB)
- **sap-released-objects-linux** (~50-60 MB)
- **sap-released-objects-macos** (~50-60 MB)
- Release notes auto-générées

---

## Étape 7 — Tester l'exécutable en local

Télécharge le binaire de ta plateforme depuis la release, puis :

```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "stdio",
      "command": "C:/Tools/sap-released-objects-win.exe"
    }
  }
}
```

Ou en mode Node.js classique :
```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/repos/sap-released-objects-mcp-server/dist/index.js"]
    }
  }
}
```

---

## Pour les releases suivantes

```bash
# Modifier le code...
git add .
git commit -m "fix: description du changement"

# Bump version + tag automatique
npm version patch   # 1.0.0 → 1.0.1
# ou
npm version minor   # 1.0.0 → 1.1.0
# ou
npm version major   # 1.0.0 → 2.0.0

# Push tout (commit + tag)
git push origin main --tags
```

→ Le workflow release se déclenche automatiquement à chaque nouveau tag `v*`.

---

## Structure du repo

```
sap-released-objects-mcp-server/
├── .github/
│   └── workflows/
│       ├── ci.yml              ← Build check sur push/PR
│       └── release.yml         ← Build .exe + GitHub Release sur tag
├── src/
│   ├── index.ts                ← Entry point (stdio + HTTP)
│   ├── types.ts                ← Interfaces TypeScript
│   ├── constants.ts            ← URLs GitHub, mapping levels, config
│   ├── schemas/
│   │   └── common.ts           ← Zod schemas partagés
│   ├── services/
│   │   └── data-loader.ts      ← Fetch GitHub JSON + cache + indexation
│   └── tools/
│       └── register-tools.ts   ← 6 MCP tools
├── .gitignore
├── LICENSE                     ← MIT
├── README.md                   ← Doc complète + badges + download links
├── package.json                ← Scripts build/bundle/pkg
└── tsconfig.json
```

---

## Troubleshooting

### Le workflow release échoue

- Vérifie que le repo est **public** (pkg télécharge les binaires Node.js)
- Vérifie que les **Actions** sont activées dans Settings → Actions → General
- Vérifie que la permission `contents: write` est bien dans le workflow

### Le build `pkg` échoue sur un OS

- C'est parfois un problème réseau temporaire (retry le job depuis l'onglet Actions)
- Si persistant, essaie de changer `node20` en `node18` dans les targets pkg

### L'exécutable ne démarre pas

- Windows : possible blocage par l'antivirus (ajouter une exception)
- Linux/macOS : `chmod +x sap-released-objects-linux` avant exécution
