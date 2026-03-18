// ============================================================================
// MCP Tool Implementations
// Delegates to shared handlers in ../handlers/api-handlers.ts
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OBJECT_TYPE_DESCRIPTIONS, CHARACTER_LIMIT } from "../constants.js";
import {
  SystemTypeSchema,
  CleanCoreLevelSchema,
  VersionSchema,
  QuerySchema,
  ObjectTypeFilterSchema,
  AppComponentFilterSchema,
  LimitSchema,
  OffsetSchema,
  StateFilterSchema,
} from "../schemas/common.js";
import {
  LEVEL_ORDER,
  normalizeVersion,
  getLevelsUpTo,
  needsClassicApis,
  getStore,
  filterByLevel,
  handleSearchObjects,
  handleGetObjectDetails,
  handleFindSuccessor,
  handleListObjectTypes,
  handleGetStatistics,
  handleListVersions,
  handleCheckCompliance,
} from "../handlers/api-handlers.js";
import type {
  SearchObjectsResult,
  SearchObjectsError,
  ObjectDetailsResult,
  ObjectNotFoundResult,
  ScoredObject,
} from "../handlers/api-handlers.js";

// Re-export helpers for backward compatibility (tests, etc.)
export { LEVEL_ORDER, normalizeVersion, getLevelsUpTo, needsClassicApis, filterByLevel };

// ---------------------------------------------------------------------------
// Text formatting helpers (MCP-specific)
// ---------------------------------------------------------------------------

export function formatObject(obj: {
  objectType: string;
  objectName: string;
  state: string;
  cleanCoreLevel: string;
  applicationComponent?: string;
  softwareComponent?: string;
  successor?: {
    classification?: string;
    objects?: Array<{ objectType: string; objectName: string }>;
    conceptName?: string;
  };
}, verbose: boolean = false): string {
  const typeDesc = OBJECT_TYPE_DESCRIPTIONS[obj.objectType] ?? obj.objectType;
  const levelLabel = `Level ${obj.cleanCoreLevel}`;

  let line = `${obj.objectType} ${obj.objectName} [${obj.state}] (${levelLabel})`;

  if (verbose) {
    line += `\n  Type: ${typeDesc}`;
    if (obj.applicationComponent)
      line += `\n  App Component: ${obj.applicationComponent}`;
    if (obj.softwareComponent)
      line += `\n  SW Component: ${obj.softwareComponent}`;
    if (obj.successor) {
      if (obj.successor.objects && obj.successor.objects.length > 0) {
        const succs = obj.successor.objects
          .map((s) => `${s.objectType} ${s.objectName}`)
          .join(", ");
        line += `\n  Successor(s): ${succs}`;
      }
      if (obj.successor.conceptName) {
        line += `\n  Successor Concept: ${obj.successor.conceptName}`;
      }
    }
  }

  return line;
}

export function truncateIfNeeded(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT - 200) +
    `\n\n... [Response truncated. ${text.length} characters total. Use filters or pagination to narrow results.]`
  );
}

// ---------------------------------------------------------------------------
// Register all tools
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // =========================================================================
  // TOOL 1: sap_search_objects
  // =========================================================================
  server.registerTool(
    "sap_search_objects",
    {
      title: "Search SAP Objects",
      description:
        `Search for SAP objects (classes, interfaces, CDS views, tables, data elements, ` +
        `function groups, RAP artifacts, etc.) in the SAP Cloudification Repository. ` +
        `Filter by Clean Core Level (A/B/C/D), object type, application component, and state. ` +
        `Use this tool to find released APIs for ABAP Cloud development, ` +
        `check if a specific object is available for your target system, ` +
        `or discover alternatives when an object is not released.\n\n` +
        `SEARCH TIPS:\n` +
        `- Use separate words for business concepts: 'purchase order' not 'PURCHASEORDER'\n` +
        `- SAP abbreviations are automatically resolved: 'billing document' also finds BILLGDOC*, BILDOC* objects\n` +
        `- Compound abbreviations work too: 'purchase order' finds PO* objects, 'bill of material' finds BOM*\n` +
        `- Separate words trigger fuzzy matching on SAP abbreviations (e.g., 'physical inventory' finds both PHYSICALINVENTORY* and PHYSINVTRY* objects)\n` +
        `- Use exact SAP names only when you know the precise object name (e.g., 'I_PRODUCT', 'MARA')\n` +
        `- Combine with app_component filter for targeted results (e.g., query='inventory', app_component='MM-IM')\n` +
        `- Prefer singular forms: 'handling unit' not 'handling units' (plural 's' can reduce match accuracy)\n` +
        `- Keep queries to 2-3 words maximum; use filters instead of adding more words\n\n` +
        `System types:\n` +
        `- public_cloud (S/4HANA Cloud Public Edition): Only Level A Released APIs\n` +
        `- btp (BTP ABAP Environment / Steampunk): Only Level A Released APIs (separate, smaller dataset)\n` +
        `- private_cloud / on_premise: Levels A-D available, version-specific\n\n` +
        `Clean Core Levels (cumulative filter):\n` +
        `- A: Released APIs only (ABAP Cloud, upgrade-safe)\n` +
        `- B: + Classic APIs (upgrade-stable)\n` +
        `- C: + Internal/unclassified objects\n` +
        `- D: + noAPI objects (not Clean Core)`,
      inputSchema: {
        query: QuerySchema,
        system_type: SystemTypeSchema,
        clean_core_level: CleanCoreLevelSchema,
        version: VersionSchema,
        object_type: ObjectTypeFilterSchema,
        app_component: AppComponentFilterSchema,
        state: StateFilterSchema,
        limit: LimitSchema,
        offset: OffsetSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      query, system_type, clean_core_level, version,
      object_type, app_component, state, limit, offset,
    }) => {
      try {
        const result = await handleSearchObjects({
          query, system_type, clean_core_level, version,
          object_type, app_component, state, limit, offset,
        });

        // Error: unknown type
        if ("error" in result && result.error === "unknown_type") {
          const availableTypes = (result.availableTypes ?? [])
            .map(({ type, count, description }) =>
              `  ${type}${description ? ` (${description})` : ""}: ${count} objects`
            )
            .join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `${result.message}\n\nAvailable object types:\n${availableTypes}\n\nUse sap_list_object_types for a complete list with level breakdown.`,
            }],
          };
        }

        // Error: no results
        if ("error" in result && result.error === "no_results") {
          return {
            content: [{
              type: "text" as const,
              text: `${result.message}\n\nSuggestions:\n${(result.suggestions ?? []).map((s) => `- ${s}`).join("\n")}`,
            }],
          };
        }

        // Success
        const r = result as SearchObjectsResult;
        const lines = r.objects.map((obj) =>
          formatObject(obj, true) + `\n  Relevance: ${obj.relevance}/100 (score: ${obj.score})`
        );

        const header =
          `Found ${r.total} objects matching '${r.query}' ` +
          `(system: ${r.system_type}, level: <=${r.clean_core_level}, ` +
          `showing ${r.offset + 1}-${r.offset + r.objects.length} of ${r.total})`;

        const footer = r.hasMore
          ? `\n\n--- More results available. Use offset=${r.offset + r.limit} to see next page. ---`
          : "";

        const text = truncateIfNeeded(`${header}\n\n${lines.join("\n\n")}${footer}`);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error searching objects: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // =========================================================================
  // TOOL 2: sap_get_object_details
  // =========================================================================
  server.registerTool(
    "sap_get_object_details",
    {
      title: "Get SAP Object Details",
      description:
        `Get detailed information about a specific SAP object by its exact type and name. ` +
        `Returns Clean Core Level, state, successor info, application component, and more. ` +
        `Use this to check if a specific object (table, class, CDS view...) is released ` +
        `for ABAP Cloud and what its Clean Core Level is.`,
      inputSchema: {
        object_type: z
          .string()
          .describe(
            "TADIR object type (e.g., 'TABL', 'CLAS', 'DDLS', 'DTEL', 'INTF', 'BDEF')."
          ),
        object_name: z
          .string()
          .describe("Exact object name (e.g., 'MARA', 'CL_ABAP_UNIT_ASSERT', 'I_PRODUCT')."),
        system_type: SystemTypeSchema,
        version: VersionSchema,
        clean_core_level: CleanCoreLevelSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ object_type, object_name, system_type, version, clean_core_level }) => {
      try {
        const result = await handleGetObjectDetails({
          object_type, object_name, system_type, version, clean_core_level,
        });

        if (!result.found) {
          return {
            content: [{
              type: "text" as const,
              text: result.message + "\n\n" +
                "This means:\n" +
                "- The object may not exist in this SAP version\n" +
                "- If it's a known SAP standard object, it is likely Level C (internal, unclassified) or Level D (noAPI)\n" +
                "- It is NOT available for ABAP Cloud (Level A) development\n" +
                "- Consider searching for a released successor using sap_find_successor\n" +
                "- Or search for alternative released objects using sap_search_objects",
            }],
          };
        }

        const obj = result.object;
        const lines: string[] = [
          `=== ${obj.objectType} ${obj.objectName} ===`,
          "",
          `Clean Core Level: ${obj.cleanCoreLevel}`,
          `State: ${obj.state}`,
          `Object Type: ${obj.objectType}${obj.typeDescription ? ` (${obj.typeDescription})` : ""}`,
          `Application Component: ${obj.applicationComponent}`,
          `Software Component: ${obj.softwareComponent}`,
          `Source: ${obj.source}`,
        ];

        // Level assessment with emojis
        lines.push("");
        const a = result.assessment;
        if (obj.cleanCoreLevel === "A" && obj.state === "released") {
          lines.push(`\u2705 ${a.message}`);
        } else if (obj.cleanCoreLevel === "A" && obj.state === "deprecated") {
          lines.push(`\u26a0\ufe0f  ${a.message}`);
        } else if (obj.cleanCoreLevel === "B") {
          lines.push(`\u2139\ufe0f  ${a.message}`);
        } else if (obj.cleanCoreLevel === "C") {
          lines.push(`\u26a0\ufe0f  ${a.message}`);
        } else if (obj.cleanCoreLevel === "D") {
          lines.push(`\u274c ${a.message}`);
        }

        if (obj.successor) {
          lines.push("", "--- Successor Information ---");
          lines.push(`Classification: ${obj.successor.classification}`);
          if (obj.successor.objects && obj.successor.objects.length > 0) {
            lines.push("Successor object(s):");
            for (const succ of obj.successor.objects) {
              lines.push(
                `  \u2192 ${succ.objectType} ${succ.objectName}${succ.typeDescription ? ` (${succ.typeDescription})` : ""}`
              );
            }
          }
          if (obj.successor.conceptName) {
            lines.push(`Successor Concept: ${obj.successor.conceptName}`);
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error fetching object details: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // =========================================================================
  // TOOL 3: sap_find_successor
  // =========================================================================
  server.registerTool(
    "sap_find_successor",
    {
      title: "Find SAP Object Successor",
      description:
        `Find the released successor(s) of a deprecated or non-released SAP object. ` +
        `Essential for ABAP Cloud migration: when your code uses a non-released object ` +
        `(e.g., table MARA), this tool finds the replacement (e.g., CDS view I_PRODUCT). ` +
        `Also useful for checking if a deprecated API has a modern replacement.`,
      inputSchema: {
        object_name: z
          .string()
          .min(1)
          .describe(
            "Object name to find successor for (e.g., 'MARA', 'CL_AUNIT_ASSERT', 'BAPI_MATERIAL_GET_ALL'). " +
              "The search is case-insensitive and matches partial names."
          ),
        object_type: z
          .string()
          .optional()
          .describe(
            "Optional TADIR object type to narrow the search (e.g., 'TABL', 'CLAS', 'FUGR'). " +
              "Leave empty to search all types."
          ),
        system_type: SystemTypeSchema,
        version: VersionSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ object_name, object_type, system_type, version }) => {
      try {
        const result = await handleFindSuccessor({
          object_name, object_type, system_type, version,
        });

        if (result.results.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text:
                `No object matching '${object_name}'${object_type ? ` (type: ${object_type})` : ""} ` +
                `found in the Cloudification Repository.\n\n` +
                `The object may not be cataloged. Try:\n` +
                `- Searching with sap_search_objects for related released APIs\n` +
                `- Checking the SAP Business Accelerator Hub for released APIs\n` +
                `- Using the Cloudification Repository Viewer: ` +
                `https://sap.github.io/abap-atc-cr-cv-s4hc/`,
            }],
          };
        }

        const lines: string[] = [
          `=== Successor Search for '${object_name}' ===`,
          "",
        ];

        for (const entry of result.results) {
          lines.push(`--- ${entry.objectType} ${entry.objectName} ---`);
          lines.push(`State: ${entry.state} (Level ${entry.cleanCoreLevel})`);

          if (entry.successor) {
            lines.push(`Successor Type: ${entry.successor.classification}`);
            if (entry.successor.objects && entry.successor.objects.length > 0) {
              for (const succ of entry.successor.objects) {
                lines.push(
                  `  \u2192 ${succ.objectType} ${succ.objectName}${succ.typeDescription ? ` (${succ.typeDescription})` : ""} [${succ.state} (Level ${succ.cleanCoreLevel})]`
                );
              }
            }
            if (entry.successor.conceptName) {
              lines.push(`  \u2192 Concept: ${entry.successor.conceptName}`);
            }
          } else {
            if (entry.state === "released") {
              lines.push(
                "  \u2705 This object IS released (Level A). No successor needed \u2014 use this object directly."
              );
            } else {
              lines.push(
                "  \u26a0\ufe0f  No successor information available for this object."
              );
            }
          }

          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: truncateIfNeeded(lines.join("\n")) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error finding successors: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // =========================================================================
  // TOOL 4: sap_list_object_types
  // =========================================================================
  server.registerTool(
    "sap_list_object_types",
    {
      title: "List SAP Object Types",
      description:
        `List all available TADIR object types in the Cloudification Repository ` +
        `with their counts per Clean Core Level. Useful to understand what kind of ` +
        `objects are available (classes, CDS views, tables, BDEFs, etc.) and ` +
        `their distribution across Levels A-D.`,
      inputSchema: {
        system_type: SystemTypeSchema,
        clean_core_level: CleanCoreLevelSchema,
        version: VersionSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ system_type, clean_core_level, version }) => {
      try {
        const result = await handleListObjectTypes({ system_type, clean_core_level, version });

        const lines: string[] = [
          `=== SAP Object Types (system: ${result.system_type}, level: \u2264${result.clean_core_level}) ===`,
          "",
          `Total types: ${result.totalTypes}`,
          "",
        ];

        for (const t of result.types) {
          const levelBreakdown = Object.entries(t.byLevel)
            .map(([lvl, cnt]) => `L${lvl}:${cnt}`)
            .join(" ");
          lines.push(
            `${t.type.padEnd(6)} ${String(t.count).padStart(6)} objects  (${levelBreakdown})${t.description ? `  \u2014 ${t.description}` : ""}`
          );
        }

        return {
          content: [{ type: "text" as const, text: truncateIfNeeded(lines.join("\n")) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error listing object types: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // =========================================================================
  // TOOL 5: sap_get_statistics
  // =========================================================================
  server.registerTool(
    "sap_get_statistics",
    {
      title: "Get Repository Statistics",
      description:
        `Get overall statistics about the SAP Cloudification Repository: ` +
        `total object counts by Clean Core Level, by object type, by state, ` +
        `and top application components. Useful for understanding the scope ` +
        `of available APIs and planning ABAP Cloud migration efforts.`,
      inputSchema: {
        system_type: SystemTypeSchema,
        clean_core_level: CleanCoreLevelSchema,
        version: VersionSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ system_type, clean_core_level, version }) => {
      try {
        const result = await handleGetStatistics({ system_type, clean_core_level, version });

        const lines: string[] = [
          `=== SAP Cloudification Repository Statistics ===`,
          "",
          `Source: ${result.source}`,
          `Loaded at: ${result.loadedAt}`,
          `Total unique objects: ${result.totalObjects}`,
          "",
          "--- By Clean Core Level ---",
          ...LEVEL_ORDER.map(
            (lvl) => `  Level ${lvl}: ${(result.byLevel[lvl] ?? 0).toLocaleString()} objects`
          ),
          "",
          "--- By State ---",
          ...Object.entries(result.byState)
            .sort((a, b) => b[1] - a[1])
            .map(([state, count]) => `  ${state}: ${count.toLocaleString()}`),
          "",
          "--- Top Object Types ---",
          ...result.topObjectTypes.map(({ type, count, description }) =>
            `  ${type}: ${count.toLocaleString()}${description ? ` (${description})` : ""}`
          ),
          "",
          "--- Top Application Components ---",
          ...result.topApplicationComponents.map(
            ({ component, count }) => `  ${component}: ${count.toLocaleString()}`
          ),
          "",
          `Available PCE versions: ${result.availableVersions.join(", ")}`,
        ];

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error fetching statistics: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // =========================================================================
  // TOOL 6: sap_list_versions
  // =========================================================================
  server.registerTool(
    "sap_list_versions",
    {
      title: "List Available S/4HANA Versions",
      description:
        "List all available S/4HANA PCE versions for Private Cloud and On-Premise systems. " +
        "Versions are discovered dynamically from the SAP Cloudification Repository on GitHub. " +
        "Use this to find which versions can be passed to other tools (sap_search_objects, " +
        "sap_get_object_details, etc.).",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await handleListVersions();

        const lines: string[] = [
          `=== Available S/4HANA PCE Versions ===`,
          "",
          `Total: ${result.total} versions`,
          "",
          ...result.versions.map((v) => `  ${v.version}  (${v.label})`),
          "",
          "Use 'latest' to always target the most recent version.",
          "Pass a specific version to other tools via the 'version' parameter.",
        ];

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error listing versions: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );

  // =========================================================================
  // TOOL 7: sap_check_clean_core_compliance
  // =========================================================================
  server.registerTool(
    "sap_check_clean_core_compliance",
    {
      title: "Check Clean Core Compliance",
      description:
        `Check the Clean Core compliance of a list of SAP objects. ` +
        `Provide a comma-separated list of object names and get their Clean Core Level ` +
        `classification, compliance status, and successor recommendations. ` +
        `Essential for assessing existing custom code during ABAP Cloud migration.`,
      inputSchema: {
        object_names: z
          .string()
          .describe(
            "Comma-separated list of object names to check " +
              "(e.g., 'MARA,BSEG,CL_GUI_ALV_GRID,BAPI_MATERIAL_GET_ALL'). " +
              "Optionally prefix with type: 'TABL:MARA,CLAS:CL_GUI_ALV_GRID'."
          ),
        target_level: z
          .enum(["A", "B"])
          .default("A")
          .describe(
            "Target Clean Core Level for compliance. " +
              "'A' = strict (Released APIs only). " +
              "'B' = pragmatic (Released + Classic APIs). " +
              "Default: A."
          ),
        system_type: SystemTypeSchema,
        version: VersionSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ object_names, target_level, system_type, version }) => {
      try {
        const result = await handleCheckCompliance({
          object_names, target_level, system_type, version,
        });

        const lines: string[] = [
          `=== Clean Core Compliance Check (Target: Level ${result.targetLevel}) ===`,
          `System: ${result.system_type}, Version: ${result.version}`,
          `Objects to check: ${result.totalChecked}`,
          "",
        ];

        for (const entry of result.results) {
          if (entry.status === "not_found") {
            lines.push(`\u2753 ${entry.input} \u2014 NOT FOUND in repository (likely Level C/D or non-existent)`);
          } else if (entry.status === "compliant") {
            const icon = entry.state === "deprecated" ? "\u26a0\ufe0f" : "\u2705";
            let line = `${icon} ${entry.objectType} ${entry.objectName} \u2014 Level ${entry.cleanCoreLevel} (${entry.state})`;
            if (entry.state === "deprecated" && entry.successor?.objects) {
              line += ` \u2192 Use: ${entry.successor.objects.map((s) => s.objectName).join(", ")}`;
            }
            lines.push(line);
          } else {
            let line = `\u274c ${entry.objectType} ${entry.objectName} \u2014 Level ${entry.cleanCoreLevel} (${entry.state})`;
            if (entry.successor?.objects) {
              line += ` \u2192 Successor: ${entry.successor.objects.map((s) => `${s.objectType} ${s.objectName}`).join(", ")}`;
            } else if (entry.successor?.conceptName) {
              line += ` \u2192 Concept: ${entry.successor.conceptName}`;
            }
            lines.push(line);
          }
        }

        lines.push(
          "",
          "--- Summary ---",
          `\u2705 Compliant (\u2264 Level ${result.targetLevel}): ${result.compliant}`,
          `\u274c Non-compliant: ${result.nonCompliant}`,
          `\u2753 Not found: ${result.notFound}`,
          `\ud83d\udcca Compliance rate: ${result.complianceRate}%`
        );

        return {
          content: [{ type: "text" as const, text: truncateIfNeeded(lines.join("\n")) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Error checking compliance: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );
}
