# SAP Released Objects API — Skill for LLM

## What this API does

This API queries the **SAP Cloudification Repository** — the official source of truth for which SAP objects are released, deprecated, or forbidden in ABAP Cloud / Clean Core. It answers questions like:

- Is this SAP object released for ABAP Cloud?
- What is the successor of a deprecated object (e.g. MARA → I_PRODUCT)?
- Which objects are available for a given functional area (e.g. purchase orders)?
- Is a set of objects Clean Core compliant?

Data comes from SAP's public GitHub repository and is cached for 24 hours. No SAP system connection needed.

## Base URL

```
https://sap-released-objects-mcp-server-production.up.railway.app
```

All endpoints return JSON. All parameters are passed as query string. All endpoints support CORS.

## Common Parameters

These parameters appear on most endpoints:

| Parameter | Default | Values | Description |
|---|---|---|---|
| `system_type` | `public_cloud` | `public_cloud`, `btp`, `private_cloud`, `on_premise` | Target SAP system. `public_cloud` and `btp` only have Level A objects. |
| `clean_core_level` | `A` | `A`, `B`, `C`, `D` | Maximum level (cumulative). A = Released APIs, B = + Classic APIs, C = + Internal, D = + noAPI |
| `version` | `latest` | `latest`, `2022`, `2023_3`, etc. | PCE version. Only relevant for `private_cloud` and `on_premise`. |

## Endpoints

### GET /api/search

Search for SAP objects with fuzzy matching and relevance ranking.

**Parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `query` | **yes** | — | Search term. SAP name (`I_PRODUCT`) or natural language (`purchase order`). Max 200 chars. |
| `system_type` | no | `public_cloud` | Target system |
| `clean_core_level` | no | `A` | Max level |
| `version` | no | `latest` | PCE version |
| `object_type` | no | all | TADIR type filter: `CLAS`, `DDLS`, `TABL`, `INTF`, `BDEF`, etc. |
| `app_component` | no | all | Application component prefix: `MM-PUR`, `FI-GL`, `SD-SLS`, etc. |
| `state` | no | all | `released`, `deprecated`, `classicAPI`, `notToBeReleased`, `noAPI`, `stable` |
| `limit` | no | 25 | Results per page (1-100) |
| `offset` | no | 0 | Pagination offset |

**Example:**

```
GET /api/search?query=purchase+order&object_type=DDLS&limit=5
```

**Response:**

```json
{
  "query": "purchase order",
  "system_type": "public_cloud",
  "clean_core_level": "A",
  "version": "latest",
  "total": 42,
  "offset": 0,
  "limit": 5,
  "hasMore": true,
  "objects": [
    {
      "objectType": "DDLS",
      "objectName": "I_PURCHASEORDER",
      "state": "released",
      "cleanCoreLevel": "A",
      "applicationComponent": "MM-PUR-PO",
      "softwareComponent": "S4CORE",
      "typeDescription": "Data Definition Language Source (CDS View)",
      "relevance": 100,
      "score": 48
    }
  ]
}
```

### GET /api/object

Get full details of a specific SAP object.

**Parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `object_type` | **yes** | — | TADIR type (`TABL`, `CLAS`, `DDLS`, etc.) |
| `object_name` | **yes** | — | Exact object name (`MARA`, `I_PRODUCT`) |
| `system_type` | no | `public_cloud` | Target system |
| `version` | no | `latest` | PCE version |
| `clean_core_level` | no | `A` | Max level |

**Example:**

```
GET /api/object?object_type=TABL&object_name=MARA
```

**Response (found):**

```json
{
  "found": true,
  "object": {
    "objectType": "TABL",
    "objectName": "MARA",
    "state": "deprecated",
    "cleanCoreLevel": "A",
    "applicationComponent": "LO-MD-MM",
    "softwareComponent": "S4CORE",
    "typeDescription": "Database Table / Structure",
    "source": "Released APIs (Tier 1)",
    "successor": {
      "classification": "successor available",
      "objects": [
        { "objectType": "DDLS", "objectName": "I_PRODUCT", "typeDescription": "Data Definition Language Source (CDS View)" }
      ]
    }
  },
  "assessment": {
    "level": "A",
    "message": "DEPRECATED. Was previously released but should no longer be used. Check successor information."
  }
}
```

**Response (not found) — HTTP 404:**

```json
{
  "found": false,
  "message": "Object TABL ZTEST was NOT found in the Cloudification Repository..."
}
```

### GET /api/successor

Find released successor(s) for a deprecated or non-released object.

**Parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `object_name` | **yes** | — | Object name (case-insensitive, partial match supported) |
| `object_type` | no | all | TADIR type to narrow search |
| `system_type` | no | `public_cloud` | Target system |
| `version` | no | `latest` | PCE version |

**Example:**

```
GET /api/successor?object_name=MARA&object_type=TABL
```

**Response:**

```json
{
  "query": "MARA",
  "object_type": "TABL",
  "results": [
    {
      "objectType": "TABL",
      "objectName": "MARA",
      "state": "deprecated",
      "cleanCoreLevel": "A",
      "hasSuccessor": true,
      "successor": {
        "classification": "successor available",
        "objects": [
          {
            "objectType": "DDLS",
            "objectName": "I_PRODUCT",
            "typeDescription": "Data Definition Language Source (CDS View)",
            "state": "released",
            "cleanCoreLevel": "A"
          }
        ]
      },
      "assessment": "Successor(s) available."
    }
  ]
}
```

### GET /api/compliance

Check Clean Core compliance of a list of objects.

**Parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `object_names` | **yes** | — | Comma-separated list. Optional type prefix: `TABL:MARA,CLAS:CL_TEST` |
| `target_level` | no | `A` | `A` (strict) or `B` (pragmatic) |
| `system_type` | no | `public_cloud` | Target system |
| `version` | no | `latest` | PCE version |

**Example:**

```
GET /api/compliance?object_names=MARA,BSEG,I_PRODUCT&target_level=A
```

**Response:**

```json
{
  "targetLevel": "A",
  "system_type": "public_cloud",
  "version": "latest",
  "totalChecked": 3,
  "compliant": 1,
  "nonCompliant": 1,
  "notFound": 1,
  "complianceRate": 33,
  "results": [
    { "input": "MARA", "status": "compliant", "objectType": "TABL", "objectName": "MARA", "cleanCoreLevel": "A", "state": "deprecated", "successor": { "objects": [{"objectType": "DDLS", "objectName": "I_PRODUCT"}] } },
    { "input": "BSEG", "status": "not_found" },
    { "input": "I_PRODUCT", "status": "compliant", "objectType": "DDLS", "objectName": "I_PRODUCT", "cleanCoreLevel": "A", "state": "released" }
  ]
}
```

### GET /api/types

List all TADIR object types with counts.

**Parameters:** `system_type`, `clean_core_level`, `version` (all optional, defaults above).

**Example:**

```
GET /api/types
```

**Response:**

```json
{
  "system_type": "public_cloud",
  "clean_core_level": "A",
  "totalTypes": 47,
  "types": [
    { "type": "DDLS", "count": 2847, "description": "Data Definition Language Source (CDS View)", "byLevel": { "A": 2847 } },
    { "type": "CLAS", "count": 1926, "description": "ABAP Class", "byLevel": { "A": 1926 } }
  ]
}
```

### GET /api/statistics

Get overall repository statistics.

**Parameters:** `system_type`, `clean_core_level`, `version` (all optional).

**Example:**

```
GET /api/statistics
```

**Response:**

```json
{
  "source": "objectReleaseInfoLatest.json",
  "loadedAt": "2025-01-15T10:30:00.000Z",
  "totalObjects": 9500,
  "byLevel": { "A": 9500 },
  "byState": { "released": 8200, "deprecated": 1300 },
  "topObjectTypes": [ { "type": "DDLS", "count": 2847, "description": "Data Definition Language Source (CDS View)" } ],
  "topApplicationComponents": [ { "component": "MM-PUR", "count": 450 } ],
  "availableVersions": ["2022", "2022_1", "2023", "2023_1", "2023_2", "2023_3", "2024", "2025", "2025_1"]
}
```

### GET /api/versions

List available S/4HANA PCE versions.

**No parameters.**

**Example:**

```
GET /api/versions
```

**Response:**

```json
{
  "total": 9,
  "versions": [
    { "version": "2022", "label": "2022 base release" },
    { "version": "2022_1", "label": "2022 FPS01 / SP01" },
    { "version": "2025_1", "label": "2025 FPS01 / SP01" }
  ]
}
```

### GET /health

Health check.

**Response:** `{ "status": "ok", "server": "sap-released-objects-mcp-server" }`

## Typical Use Cases

### "Is BAPI_MATERIAL_GETLIST released?"

1. Call `/api/search?query=BAPI_MATERIAL_GETLIST`
2. If found, check `objects[0].state` and `objects[0].cleanCoreLevel`
3. If `state === "released"` and `cleanCoreLevel === "A"` → yes, it's released
4. If `state === "deprecated"` → it was released but is now deprecated, check `successor`
5. If not found or low relevance → likely not released, suggest using `/api/successor`

Or more directly: `/api/object?object_type=FUGR&object_name=BAPI_MATERIAL_GETLIST`

### "What is the successor of ME21N?"

1. Call `/api/successor?object_name=ME21N`
2. Check `results[0].successor.objects` for the replacement object(s)
3. If `hasSuccessor === false` → no known successor in the repository

### "List all released CDS views for purchasing"

1. Call `/api/search?query=purchase&object_type=DDLS&app_component=MM-PUR&limit=50`
2. Results are ranked by relevance
3. All returned objects are within the requested Clean Core Level

### "Is my code Clean Core compliant?"

Given a list of objects used in custom code:
1. Call `/api/compliance?object_names=MARA,BSEG,CL_GUI_ALV_GRID,I_PRODUCT&target_level=A`
2. Check `complianceRate` for the overall percentage
3. Check individual `results` entries — `status: "non_compliant"` items need remediation
4. Look at `successor` field for recommended replacements

### "What object types exist in the repository?"

1. Call `/api/types`
2. Returns all types sorted by count, with description and level breakdown

## Instructions for LLM

### How to interpret results

- **cleanCoreLevel**: The most important field. `A` = safe for ABAP Cloud. `B` = classic, OK for private cloud. `C`/`D` = avoid.
- **state**: `released` is best. `deprecated` means use the successor. `classicAPI` is Level B.
- **relevance**: 0-100 score relative to the best match. Use this to rank results when presenting to the user.
- **successor**: When present, always mention the successor to the user. It's the recommended replacement.
- **assessment.message**: Human-readable summary of the object's status. Use this directly in your response.

### Search strategy

1. **If the user gives an exact SAP name** (e.g. "MARA", "CL_GUI_ALV_GRID"): Use `/api/object` with the correct type, or `/api/search` with the name as query.
2. **If the user describes a concept** (e.g. "purchase order", "send email"): Use `/api/search` with natural language. The API handles fuzzy matching and SAP abbreviation expansion.
3. **If the user asks about successors/replacements**: Use `/api/successor`.
4. **If the user has a list of objects to check**: Use `/api/compliance`.

### Common TADIR types

- `TABL` — Database table / structure
- `CLAS` — ABAP Class
- `INTF` — ABAP Interface
- `DDLS` — CDS View (most common for released APIs)
- `BDEF` — RAP Business Object Definition
- `SRVB` — Service Binding (OData)
- `FUGR` — Function Group (includes BAPIs)
- `DTEL` — Data Element
- `DOMA` — Domain

### Presenting results to the user

- Always mention the **Clean Core Level** and **state**.
- If an object is **deprecated**, always mention the **successor**.
- For search results, show the **top 3-5 most relevant** results unless the user asks for more.
- When an object is **not found**, explain it's likely Level C/D (internal/noAPI) and suggest searching for alternatives.
- Use the `typeDescription` field to explain what kind of object it is (CDS view, class, table...).

### Error handling

- HTTP 400: Missing required parameter. The `message` field explains what's needed.
- HTTP 404: Object or type not found. Suggest alternatives.
- HTTP 500: Server error. Retry once, then inform the user.
- `"error": "no_results"`: The query matched nothing. Suggest broadening the search.
- `"error": "unknown_type"`: The object_type doesn't exist. `availableTypes` lists valid ones.
