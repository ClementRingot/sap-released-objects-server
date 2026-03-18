// ============================================================================
// REST API Routes
// Express GET endpoints that expose the same business logic as MCP tools
// ============================================================================

import { Router } from "express";
import type { Request, Response } from "express";
import type { SystemType, CleanCoreLevel } from "../types.js";
import {
  handleSearchObjects,
  handleGetObjectDetails,
  handleFindSuccessor,
  handleListObjectTypes,
  handleGetStatistics,
  handleListVersions,
  handleCheckCompliance,
} from "../handlers/api-handlers.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_SYSTEM_TYPES = new Set(["public_cloud", "btp", "private_cloud", "on_premise"]);
const VALID_LEVELS = new Set(["A", "B", "C", "D"]);
const VALID_TARGET_LEVELS = new Set(["A", "B"]);
const VALID_STATES = new Set(["released", "deprecated", "classicAPI", "notToBeReleased", "noAPI", "stable"]);

function parseSystemType(val: unknown): SystemType {
  const s = String(val || "public_cloud");
  return VALID_SYSTEM_TYPES.has(s) ? (s as SystemType) : "public_cloud";
}

function parseLevel(val: unknown): CleanCoreLevel {
  const s = String(val || "A").toUpperCase();
  return VALID_LEVELS.has(s) ? (s as CleanCoreLevel) : "A";
}

function parseTargetLevel(val: unknown): "A" | "B" {
  const s = String(val || "A").toUpperCase();
  return VALID_TARGET_LEVELS.has(s) ? (s as "A" | "B") : "A";
}

function parseVersion(val: unknown): string {
  return String(val || "latest");
}

function parseInt10(val: unknown, defaultVal: number, min: number, max: number): number {
  const n = parseInt(String(val), 10);
  if (isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Endpoint definitions (for /api index)
// ---------------------------------------------------------------------------

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/search",
    description: "Search for SAP objects with fuzzy matching and relevance ranking",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search term (SAP name or natural language, e.g. 'purchase order', 'I_PRODUCT')" },
      { name: "system_type", type: "enum", required: false, default: "public_cloud", values: ["public_cloud", "btp", "private_cloud", "on_premise"], description: "Target SAP system type" },
      { name: "clean_core_level", type: "enum", required: false, default: "A", values: ["A", "B", "C", "D"], description: "Maximum Clean Core Level (cumulative)" },
      { name: "version", type: "string", required: false, default: "latest", description: "PCE version for private_cloud/on_premise (e.g. '2025', '2023_3')" },
      { name: "object_type", type: "string", required: false, description: "TADIR type filter (e.g. 'CLAS', 'DDLS', 'TABL')" },
      { name: "app_component", type: "string", required: false, description: "Application component filter (e.g. 'MM-PUR', 'FI-GL')" },
      { name: "state", type: "enum", required: false, values: ["released", "deprecated", "classicAPI", "notToBeReleased", "noAPI", "stable"], description: "Filter by object state" },
      { name: "limit", type: "number", required: false, default: 25, description: "Results per page (1-100)" },
      { name: "offset", type: "number", required: false, default: 0, description: "Pagination offset" },
    ],
  },
  {
    method: "GET",
    path: "/api/object",
    description: "Get full details of a specific SAP object by exact type and name",
    parameters: [
      { name: "object_type", type: "string", required: true, description: "TADIR object type (e.g. 'TABL', 'CLAS', 'DDLS')" },
      { name: "object_name", type: "string", required: true, description: "Exact object name (e.g. 'MARA', 'I_PRODUCT')" },
      { name: "system_type", type: "enum", required: false, default: "public_cloud", values: ["public_cloud", "btp", "private_cloud", "on_premise"], description: "Target SAP system type" },
      { name: "version", type: "string", required: false, default: "latest", description: "PCE version" },
      { name: "clean_core_level", type: "enum", required: false, default: "A", values: ["A", "B", "C", "D"], description: "Maximum Clean Core Level" },
    ],
  },
  {
    method: "GET",
    path: "/api/successor",
    description: "Find released successor(s) for a deprecated or non-released SAP object",
    parameters: [
      { name: "object_name", type: "string", required: true, description: "Object name to find successor for (case-insensitive, partial match)" },
      { name: "object_type", type: "string", required: false, description: "TADIR type to narrow search (e.g. 'TABL', 'CLAS')" },
      { name: "system_type", type: "enum", required: false, default: "public_cloud", values: ["public_cloud", "btp", "private_cloud", "on_premise"], description: "Target SAP system type" },
      { name: "version", type: "string", required: false, default: "latest", description: "PCE version" },
    ],
  },
  {
    method: "GET",
    path: "/api/types",
    description: "List all available TADIR object types with counts per Clean Core Level",
    parameters: [
      { name: "system_type", type: "enum", required: false, default: "public_cloud", values: ["public_cloud", "btp", "private_cloud", "on_premise"], description: "Target SAP system type" },
      { name: "clean_core_level", type: "enum", required: false, default: "A", values: ["A", "B", "C", "D"], description: "Maximum Clean Core Level" },
      { name: "version", type: "string", required: false, default: "latest", description: "PCE version" },
    ],
  },
  {
    method: "GET",
    path: "/api/statistics",
    description: "Get overall repository statistics (counts by level, type, state, components)",
    parameters: [
      { name: "system_type", type: "enum", required: false, default: "public_cloud", values: ["public_cloud", "btp", "private_cloud", "on_premise"], description: "Target SAP system type" },
      { name: "clean_core_level", type: "enum", required: false, default: "A", values: ["A", "B", "C", "D"], description: "Maximum Clean Core Level" },
      { name: "version", type: "string", required: false, default: "latest", description: "PCE version" },
    ],
  },
  {
    method: "GET",
    path: "/api/versions",
    description: "List all available S/4HANA PCE versions",
    parameters: [],
  },
  {
    method: "GET",
    path: "/api/compliance",
    description: "Check Clean Core compliance of a list of SAP objects",
    parameters: [
      { name: "object_names", type: "string", required: true, description: "Comma-separated list (e.g. 'MARA,BSEG,CL_GUI_ALV_GRID' or 'TABL:MARA,CLAS:CL_TEST')" },
      { name: "target_level", type: "enum", required: false, default: "A", values: ["A", "B"], description: "Target compliance level" },
      { name: "system_type", type: "enum", required: false, default: "public_cloud", values: ["public_cloud", "btp", "private_cloud", "on_premise"], description: "Target SAP system type" },
      { name: "version", type: "string", required: false, default: "latest", description: "PCE version" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createApiRouter(): Router {
  const router = Router();

  // CORS middleware for all API routes
  router.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  // =========================================================================
  // GET /api — Auto-documentation index
  // =========================================================================
  router.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "SAP Released Objects API",
      description: "REST API for the SAP Cloudification Repository — search released objects, find successors, check Clean Core compliance.",
      endpoints: ENDPOINTS,
    });
  });

  // =========================================================================
  // GET /api/search — Search SAP objects
  // =========================================================================
  router.get("/search", async (req: Request, res: Response) => {
    const { query, system_type, clean_core_level, version, object_type, app_component, state, limit, offset } = req.query;

    if (!query || String(query).trim().length === 0) {
      res.status(400).json({ error: "missing_parameter", message: "The 'query' parameter is required." });
      return;
    }

    const q = String(query).slice(0, 200);

    if (state && !VALID_STATES.has(String(state))) {
      res.status(400).json({ error: "invalid_parameter", message: `Invalid state '${state}'. Valid values: ${[...VALID_STATES].join(", ")}` });
      return;
    }

    try {
      const result = await handleSearchObjects({
        query: q,
        system_type: parseSystemType(system_type),
        clean_core_level: parseLevel(clean_core_level),
        version: parseVersion(version),
        object_type: object_type ? String(object_type) : undefined,
        app_component: app_component ? String(app_component) : undefined,
        state: state ? String(state) as any : undefined,
        limit: parseInt10(limit, 25, 1, 100),
        offset: parseInt10(offset, 0, 0, 100000),
      });

      if ("error" in result) {
        const status = result.error === "unknown_type" ? 404 : 200;
        res.status(status).json(result);
        return;
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // =========================================================================
  // GET /api/object — Get object details
  // =========================================================================
  router.get("/object", async (req: Request, res: Response) => {
    const { object_type, object_name, system_type, version, clean_core_level } = req.query;

    if (!object_type || !object_name) {
      res.status(400).json({ error: "missing_parameter", message: "Both 'object_type' and 'object_name' parameters are required." });
      return;
    }

    try {
      const result = await handleGetObjectDetails({
        object_type: String(object_type),
        object_name: String(object_name),
        system_type: parseSystemType(system_type),
        version: parseVersion(version),
        clean_core_level: parseLevel(clean_core_level),
      });

      if (!result.found) {
        res.status(404).json(result);
        return;
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // =========================================================================
  // GET /api/successor — Find successor
  // =========================================================================
  router.get("/successor", async (req: Request, res: Response) => {
    const { object_name, object_type, system_type, version } = req.query;

    if (!object_name) {
      res.status(400).json({ error: "missing_parameter", message: "The 'object_name' parameter is required." });
      return;
    }

    try {
      const result = await handleFindSuccessor({
        object_name: String(object_name),
        object_type: object_type ? String(object_type) : undefined,
        system_type: parseSystemType(system_type),
        version: parseVersion(version),
      });

      if (result.results.length === 0) {
        res.status(404).json({ ...result, message: `No object matching '${object_name}' found in the Cloudification Repository.` });
        return;
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // =========================================================================
  // GET /api/types — List object types
  // =========================================================================
  router.get("/types", async (req: Request, res: Response) => {
    const { system_type, clean_core_level, version } = req.query;

    try {
      const result = await handleListObjectTypes({
        system_type: parseSystemType(system_type),
        clean_core_level: parseLevel(clean_core_level),
        version: parseVersion(version),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // =========================================================================
  // GET /api/statistics — Repository statistics
  // =========================================================================
  router.get("/statistics", async (req: Request, res: Response) => {
    const { system_type, clean_core_level, version } = req.query;

    try {
      const result = await handleGetStatistics({
        system_type: parseSystemType(system_type),
        clean_core_level: parseLevel(clean_core_level),
        version: parseVersion(version),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // =========================================================================
  // GET /api/versions — List PCE versions
  // =========================================================================
  router.get("/versions", async (_req: Request, res: Response) => {
    try {
      const result = await handleListVersions();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // =========================================================================
  // GET /api/compliance — Check Clean Core compliance
  // =========================================================================
  router.get("/compliance", async (req: Request, res: Response) => {
    const { object_names, target_level, system_type, version } = req.query;

    if (!object_names) {
      res.status(400).json({ error: "missing_parameter", message: "The 'object_names' parameter is required (comma-separated list)." });
      return;
    }

    try {
      const result = await handleCheckCompliance({
        object_names: String(object_names),
        target_level: parseTargetLevel(target_level),
        system_type: parseSystemType(system_type),
        version: parseVersion(version),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
