# SAP Released Objects MCP Server

[![CI](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/ci.yml)
[![Release](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for querying the [SAP Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) — the official source for Released APIs, Classic APIs, and successor information for ABAP Cloud / Clean Core development.

## Quick Download

Standalone executables (no Node.js installation required):

| Platform | Download |
|----------|----------|
| **Windows** | [`sap-released-objects-win.exe`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-win.exe) |
| **Linux** | [`sap-released-objects-linux`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-linux) |
| **macOS** | [`sap-released-objects-macos`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-macos) |

> Replace `ClementRingot` with your GitHub username after creating your own repo.

## Features

- **Search SAP objects** (classes, CDS views, tables, data elements, BDEFs, etc.)
- **Filter by Clean Core Level** (A/B/C/D) — replaces the 3-tier model since August 2025
- **Find successors** for deprecated or non-released objects
- **Clean Core compliance check** for a list of objects
- **Statistics** overview of the repository (counts by level, type, component)
- **Multi-system support**: Public Cloud, Private Cloud, On-Premise
- **Versioning**: version-specific files for PCE (2022, 2023_x, 2025)
- **Dual transport**: stdio (local) + HTTP (remote)

## Clean Core Level Concept

Since August 2025, SAP has replaced the 3-tier model with the **Clean Core Level Concept**:

| Level | Description | Data Source | Upgrade Safety |
|-------|-------------|-------------|----------------|
| **A** | Released APIs (ABAP Cloud) | `objectReleaseInfoLatest.json` | Upgrade-safe |
| **B** | Classic APIs | `objectClassifications_SAP.json` | Upgrade-stable |
| **C** | Internal/unclassified objects | Uncatalogued objects | Manageable risk |
| **D** | noAPI (not recommended) | Objects marked `noAPI` | High risk |

## Installation

```bash
npm install
npm run build
```

## Building Standalone Executables (no Node.js required)

The project uses `esbuild` (bundling) + `@yao-pkg/pkg` (packaging) to produce standalone binaries.

```bash
# Bundle first (required before pkg)
npm run bundle

# Windows
npm run pkg:win      # -> bin/sap-released-objects-win.exe

# Linux
npm run pkg:linux    # -> bin/sap-released-objects-linux

# macOS
npm run pkg:macos    # -> bin/sap-released-objects-macos

# All 3 at once
npm run pkg:all      # -> bin/
```

Pipeline: `TypeScript -> tsc -> ESM JS -> esbuild -> single CJS bundle -> pkg -> native executable`

The executable requires **no Node.js installation** on the target machine.

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

### stdio with executable (no Node.js)

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

### HTTP (remote, multi-client)

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

## Available Tools

### 1. `sap_search_objects`

Search for objects with advanced filters.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | *(required)* | Search term (e.g., `I_PRODUCT`, `MARA`) |
| `system_type` | enum | `public_cloud` | `public_cloud`, `private_cloud`, `on_premise` |
| `clean_core_level` | enum | `A` | Maximum cumulative level: A, B, C, or D |
| `version` | string | `latest` | PCE version (e.g., `2025`, `2023_3`) |
| `object_type` | string | *(all)* | TADIR filter (e.g., `CLAS`, `DDLS`, `TABL`) |
| `app_component` | string | *(all)* | Application component (e.g., `MM-PUR`, `FI-GL`) |
| `state` | enum | *(all)* | Filter by specific state |
| `limit` | number | `25` | Results per page (1-100) |
| `offset` | number | `0` | Pagination offset |

### 2. `sap_get_object_details`

Get full details of a specific object with Clean Core assessment.

### 3. `sap_find_successor`

Find the successor(s) of a deprecated or non-released object. Essential for ABAP Cloud migration.

### 4. `sap_list_object_types`

List all available TADIR object types with counts per level.

### 5. `sap_get_statistics`

Statistical overview of the repository.

### 6. `sap_check_clean_core_compliance`

Check Clean Core compliance for a list of objects. Returns a compliance rate.

## Usage Examples

### With an AI Agent

```
"Is table MARA available in ABAP Cloud?"
-> The agent uses sap_get_object_details(TABL, MARA, public_cloud)
-> Answer: deprecated, successor = I_PRODUCT (CDS)

"Find all released CDS views for the MM-PUR module"
-> The agent uses sap_search_objects(query="I_", object_type="DDLS", app_component="MM-PUR")

"My code uses BSEG, MARA, CL_GUI_ALV_GRID. Is it Clean Core Level A?"
-> The agent uses sap_check_clean_core_compliance(object_names="BSEG,MARA,CL_GUI_ALV_GRID")
```

## Publishing a New Release

Executables are automatically built by GitHub Actions when a version tag is pushed:

```bash
# 1. Bump the version in package.json
npm version patch   # or minor / major

# 2. Push the tag
git push origin main --tags
```

GitHub Actions will then:
1. Build TypeScript on 3 runners (ubuntu, windows, macos)
2. Bundle with esbuild into a single CJS file
3. Package with pkg into native executables
4. Create a GitHub Release with all 3 binaries as assets
5. Auto-generate release notes

## Contributing

Contributions are welcome! Feel free to open an issue or a PR.

```bash
git clone https://github.com/ClementRingot/sap-released-objects-mcp-server.git
cd sap-released-objects-mcp-server
npm install
npm run build
npm run bundle
# Local test
node bundle/index.cjs
```

## Data Source

All data comes from the official SAP repository:
**https://github.com/SAP/abap-atc-cr-cv-s4hc**

JSON files are cached in memory for 1 hour to optimize performance.

## License

MIT
