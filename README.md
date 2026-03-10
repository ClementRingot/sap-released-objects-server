# SAP Released Objects MCP Server

[![CI](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/ci.yml)
[![Release](https://github.com/ClementRingot/sap-released-objects-mcp-server/actions/workflows/release.yml/badge.svg)](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [MCP server](https://modelcontextprotocol.io/) that gives AI coding agents (Claude Code, Cline, Copilot…) real-time knowledge of **which SAP objects are released for ABAP Cloud / Clean Core** — and what to use instead when they're not.

## The Problem

When you use an AI agent to write ABAP Cloud code, the agent has no idea which objects are released, deprecated, or forbidden. It will happily generate code using `MARA`, `CL_GUI_ALV_GRID`, or `BSEG` — all of which are **not released** in ABAP Cloud.

This MCP server plugs directly into the [SAP Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) (the official source of truth) and exposes it as tools your agent can call. Ask *"Is MARA available?"* and the agent instantly knows: **no — use `I_PRODUCT` instead.**

## Quick Start

### Option 1: Remote server (zero install — recommended)

A hosted instance is available. Just add this to your MCP client config (Claude Desktop, Claude Code, Cline…):

```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "url",
      "url": "https://sap-released-objects-mcp-server-production.up.railway.app/mcp"
    }
  }
}
```

Nothing to install, nothing to maintain — you're ready to go.

### Option 2: Standalone executable (offline, no Node.js required)

If you prefer running locally, download the executable for your platform:

| Platform | Download |
| --- | --- |
| **Windows** | [`sap-released-objects-win.exe`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-win.exe) |
| **Linux** | [`sap-released-objects-linux`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-linux) |
| **macOS** | [`sap-released-objects-macos`](https://github.com/ClementRingot/sap-released-objects-mcp-server/releases/latest/download/sap-released-objects-macos) |

Then add to your MCP client config:

```json
{
  "mcpServers": {
    "sap-released-objects": {
      "type": "stdio",
      "command": "/path/to/sap-released-objects-win.exe"
    }
  }
}
```

## Features

- **Search SAP objects** — classes, CDS views, tables, data elements, BDEFs, etc.
- **Filter by Clean Core Level** (A / B / C / D) — the new model replacing the 3-tier system since August 2025
- **Find successors** for deprecated or non-released objects
- **Clean Core compliance check** for a list of objects (with compliance rate)
- **Statistics** — counts by level, type, and application component
- **Multi-system support** — Public Cloud, Private Cloud, On-Premise
- **Versioning** — version-specific files for PCE (2022, 2023_x, 2025)
- **Dual transport** — hosted remote server or local stdio executable

## How It Works

The server fetches JSON files from the official [SAP Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc) at runtime and caches them **in memory for 1 hour**. No SAP system connection is required — all data comes from SAP's public GitHub repository.

## Clean Core Level Concept

Since August 2025, SAP replaced the 3-tier model with the **Clean Core Level Concept**:

| Level | Description | Data Source | Upgrade Safety |
| --- | --- | --- | --- |
| **A** | Released APIs (ABAP Cloud) | `objectReleaseInfoLatest.json` | ✅ Upgrade-safe |
| **B** | Classic APIs | `objectClassifications_SAP.json` | ⚠️ Upgrade-stable |
| **C** | Internal / unclassified objects | Uncatalogued objects | 🟡 Manageable risk |
| **D** | noAPI (not recommended) | Objects marked `noAPI` | 🔴 High risk |

## Available Tools

### `sap_search_objects`

Search for objects with advanced filters.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | string | *(required)* | Search term (e.g. `I_PRODUCT`, `MARA`) |
| `system_type` | enum | `public_cloud` | `public_cloud`, `private_cloud`, `on_premise` |
| `clean_core_level` | enum | `A` | Maximum cumulative level: `A`, `B`, `C`, or `D` |
| `version` | string | `latest` | PCE version (e.g. `2025`, `2023_3`) |
| `object_type` | string | *(all)* | TADIR filter (e.g. `CLAS`, `DDLS`, `TABL`) |
| `app_component` | string | *(all)* | Application component (e.g. `MM-PUR`, `FI-GL`) |
| `state` | enum | *(all)* | Filter by specific state |
| `limit` | number | `25` | Results per page (1–100) |
| `offset` | number | `0` | Pagination offset |

### `sap_get_object_details`

Get full details of a specific object including its Clean Core assessment, release state, and successor information.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `object_type` | string | *(required)* | TADIR type (e.g. `TABL`, `CLAS`, `DDLS`) |
| `object_name` | string | *(required)* | Object name (e.g. `MARA`, `CL_GUI_ALV_GRID`) |
| `system_type` | enum | `public_cloud` | `public_cloud`, `private_cloud`, `on_premise` |

### `sap_find_successor`

Find the successor(s) of a deprecated or non-released object. Essential for ABAP Cloud migration.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `object_type` | string | *(required)* | TADIR type of the deprecated object |
| `object_name` | string | *(required)* | Name of the deprecated object |
| `system_type` | enum | `public_cloud` | Target system type |

### `sap_check_clean_core_compliance`

Check Clean Core compliance for a list of objects. Returns individual assessments and an overall compliance rate.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `object_names` | string | *(required)* | Comma-separated list of object names |
| `system_type` | enum | `public_cloud` | Target system type |
| `target_level` | enum | `A` | Target Clean Core level |

### `sap_list_object_types`

List all available TADIR object types with counts per Clean Core level. No required parameters.

### `sap_get_statistics`

Statistical overview of the repository — total counts, breakdown by level, by object type, and by application component. No required parameters.

## Usage Examples

```
You:    "Is table MARA available in ABAP Cloud?"
Agent:  → calls sap_get_object_details(TABL, MARA, public_cloud)
        → "MARA is deprecated. Successor: I_PRODUCT (CDS view)"

You:    "Find all released CDS views for the MM-PUR module"
Agent:  → calls sap_search_objects(query="I_", object_type="DDLS", app_component="MM-PUR")
        → Returns list of Level A CDS views

You:    "My code uses BSEG, MARA, CL_GUI_ALV_GRID. Is it Clean Core?"
Agent:  → calls sap_check_clean_core_compliance(object_names="BSEG,MARA,CL_GUI_ALV_GRID")
        → "Compliance rate: 0% — none of these objects are Level A"
```

## Building Standalone Executables

<details>
<summary>Build details (esbuild + pkg pipeline)</summary>

The project uses `esbuild` for bundling and `@yao-pkg/pkg` for packaging into native executables.

**Pipeline:** `TypeScript → tsc → ESM JS → esbuild → single CJS bundle → pkg → native executable`

```bash
# Bundle first (required before pkg)
npm run bundle

# Build for a specific platform
npm run pkg:win      # → bin/sap-released-objects-win.exe
npm run pkg:linux    # → bin/sap-released-objects-linux
npm run pkg:macos    # → bin/sap-released-objects-macos

# Or all 3 at once
npm run pkg:all
```

The resulting executable requires **no Node.js** on the target machine.

</details>

## Publishing a New Release

Executables are automatically built by GitHub Actions when a version tag is pushed:

```bash
npm version patch   # or minor / major
git push origin main --tags
```

GitHub Actions will then build on 3 runners (Ubuntu, Windows, macOS)
