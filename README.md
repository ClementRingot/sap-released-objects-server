# SAP Released Objects MCP Server

[![CI](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/ci.yml)
[![Release](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Serveur MCP pour interroger le [SAP Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) — la source officielle des APIs released, Classic APIs, et informations de successeurs pour le développement ABAP Cloud / Clean Core.

## Téléchargement rapide

Exécutables standalone (aucune installation de Node.js requise) :

| Plateforme | Téléchargement |
|------------|---------------|
| **Windows** | [`sap-released-objects-win.exe`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-win.exe) |
| **Linux** | [`sap-released-objects-linux`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-linux) |
| **macOS** | [`sap-released-objects-macos`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-macos) |

> 💡 Remplacez `ClementRingot` par votre nom d'utilisateur GitHub après la création du repo.

## Fonctionnalités

- 🔍 **Recherche d'objets SAP** (classes, CDS views, tables, data elements, BDEFs, etc.)
- 🏷️ **Filtrage par Clean Core Level** (A/B/C/D) — remplace le modèle 3-tier depuis août 2025
- 🔄 **Recherche de successeurs** pour les objets deprecated ou non-released
- ✅ **Vérification de conformité Clean Core** pour une liste d'objets
- 📊 **Statistiques** du repository (comptages par level, type, composant)
- 🌐 **Support multi-systèmes** : Public Cloud, Private Cloud, On-Premise
- 📦 **Versioning** : fichiers spécifiques par version PCE (2022, 2023_x, 2025)
- 🔌 **Dual transport** : stdio (local) + HTTP (remote)

## Clean Core Level Concept

Depuis août 2025, SAP a remplacé le modèle 3-tier par le **Clean Core Level Concept** :

| Level | Description | Source de données | Upgrade Safety |
|-------|-------------|-------------------|----------------|
| **A** | Released APIs (ABAP Cloud) | `objectReleaseInfoLatest.json` | ✅ Upgrade-safe |
| **B** | Classic APIs | `objectClassifications_SAP.json` | ⚠️ Upgrade-stable |
| **C** | Objets internes/non classifiés | Objets non catalogués | ❌ Risque gérable |
| **D** | noAPI (non recommandé) | Objets marqués `noAPI` | ❌ Risque élevé |

## Installation

```bash
npm install
npm run build
```

## Générer des exécutables (sans Node.js requis)

Le projet utilise `esbuild` (bundling) + `@yao-pkg/pkg` (packaging) pour produire des binaires standalone.

```bash
# Bundle d'abord (requis avant pkg)
npm run bundle

# Windows
npm run pkg:win      # → bin/sap-released-objects-win.exe

# Linux
npm run pkg:linux    # → bin/sap-released-objects-linux

# macOS
npm run pkg:macos    # → bin/sap-released-objects-macos

# Les 3 d'un coup
npm run pkg:all      # → bin/
```

Le pipeline : `TypeScript → tsc → ESM JS → esbuild → single CJS bundle → pkg → executable natif`

L'exécutable ne nécessite **aucune installation de Node.js** sur la machine cible.

## Configuration

### stdio (Claude Code, Cline, etc.)

```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/sap-released-objects-mcp-server/dist/index.js"]
    }
  }
}
```

### stdio avec exécutable (sans Node.js)

```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "stdio",
      "command": "/path/to/bin/sap-released-objects-win.exe"
    }
  }
}
```

### HTTP (remote, multi-clients)

```bash
TRANSPORT=http PORT=3001 node dist/index.js
```

```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

## Tools disponibles

### 1. `sap_search_objects`

Recherche d'objets avec filtres avancés.

**Paramètres :**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *(requis)* | Terme de recherche (ex: `I_PRODUCT`, `MARA`) |
| `system_type` | enum | `public_cloud` | `public_cloud`, `private_cloud`, `on_premise` |
| `clean_core_level` | enum | `A` | Level max cumulatif : A, B, C, ou D |
| `version` | string | `latest` | Version PCE (ex: `2025`, `2023_3`) |
| `object_type` | string | *(tous)* | Filtre TADIR (ex: `CLAS`, `DDLS`, `TABL`) |
| `app_component` | string | *(tous)* | Composant applicatif (ex: `MM-PUR`, `FI-GL`) |
| `state` | enum | *(tous)* | Filtre par état spécifique |
| `limit` | number | `25` | Résultats par page (1-100) |
| `offset` | number | `0` | Pagination |

### 2. `sap_get_object_details`

Détails complets d'un objet spécifique avec évaluation Clean Core.

### 3. `sap_find_successor`

Trouve le(s) successeur(s) d'un objet deprecated ou non-released. Essentiel pour la migration ABAP Cloud.

### 4. `sap_list_object_types`

Liste tous les types d'objets TADIR disponibles avec comptages par level.

### 5. `sap_get_statistics`

Vue d'ensemble statistique du repository.

### 6. `sap_check_clean_core_compliance`

Vérifie la conformité Clean Core d'une liste d'objets. Retourne un taux de conformité.

## Exemples d'utilisation

### Par un agent IA

```
"Est-ce que la table MARA est disponible en ABAP Cloud ?"
→ L'agent utilise sap_get_object_details(TABL, MARA, public_cloud)
→ Réponse : deprecated, successeur = I_PRODUCT (CDS)

"Trouve-moi toutes les CDS views released pour le module MM-PUR"
→ L'agent utilise sap_search_objects(query="I_", object_type="DDLS", app_component="MM-PUR")

"Mon code utilise BSEG, MARA, CL_GUI_ALV_GRID. Est-ce Clean Core Level A ?"
→ L'agent utilise sap_check_clean_core_compliance(object_names="BSEG,MARA,CL_GUI_ALV_GRID")
```

## Publier une nouvelle release

Les exécutables sont buildés automatiquement par GitHub Actions quand un tag de version est poussé :

```bash
# 1. Bump la version dans package.json
npm version patch   # ou minor / major

# 2. Push le tag
git push origin main --tags
```

GitHub Actions va alors :
1. Builder le TypeScript sur 3 runners (ubuntu, windows, macos)
2. Bundler avec esbuild → single CJS file
3. Packager avec pkg → exécutables natifs
4. Créer une GitHub Release avec les 3 binaires en assets
5. Générer les release notes automatiquement

## Contribuer

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une issue ou une PR.

```bash
git clone https://github.com/ClementRingot/sap-released-objects-mcp-server.git
cd sap-released-objects-mcp-server
npm install
npm run build
npm run bundle
# Test local
node bundle/index.cjs
```

## Source des données

Toutes les données proviennent du repository officiel SAP :
**https://github.com/SAP/abap-atc-cr-cv-s4hc**

Les fichiers JSON sont mis en cache en mémoire pendant 1 heure pour optimiser les performances.

## Licence

MIT
