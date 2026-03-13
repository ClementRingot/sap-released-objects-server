// ============================================================================
// MCP Tool Implementations
// ============================================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SAPObject, CleanCoreLevel, SystemType, DataStore, IndexedObject } from "../types.js";
import { loadData, discoverPCEVersions } from "../services/data-loader.js";
import { tokenizeQuery, scoreObject } from "../services/search.js";
import {
  OBJECT_TYPE_DESCRIPTIONS,
  CHARACTER_LIMIT,
  DEFAULT_LIMIT,
} from "../constants.js";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const LEVEL_ORDER: CleanCoreLevel[] = ["A", "B", "C", "D"];

/**
 * Normalize version strings from common formats to the internal YEAR_FPS format.
 * Handles: "2022 SP01" → "2022_1", "2023 FPS03" → "2023_3", "2022.1" → "2022_1", etc.
 */
export function normalizeVersion(version: string): string {
  const trimmed = version.trim();

  // Already valid: "latest", "2022", "2022_1", etc.
  if (trimmed === "latest" || /^\d{4}(_\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // Normalize "2022 SP01", "2022_FPS1", "2023.3", "2022 1", etc.
  const match = trimmed.match(
    /^(\d{4})[\s_.-]?(?:(?:SP|FPS)[\s_.-]?)?(\d+)$/i
  );
  if (match) {
    const year = match[1];
    const fps = String(parseInt(match[2], 10)); // Strip leading zeros
    return `${year}_${fps}`;
  }

  // Fallback: return as-is (will fail at data loading if invalid)
  return trimmed;
}

/** Get all levels up to and including the target level (cumulative) */
export function getLevelsUpTo(maxLevel: CleanCoreLevel): Set<CleanCoreLevel> {
  const idx = LEVEL_ORDER.indexOf(maxLevel);
  return new Set(LEVEL_ORDER.slice(0, idx + 1));
}

/** Determine if Classic APIs should be loaded based on level and system type */
export function needsClassicApis(
  level: CleanCoreLevel,
  systemType: SystemType
): boolean {
  // public_cloud and btp only have Level A — no classic APIs
  if (systemType === "public_cloud" || systemType === "btp") return false;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf("B");
}

/** Load data with appropriate parameters derived from tool inputs */
async function getStore(
  systemType: SystemType,
  version: string,
  cleanCoreLevel: CleanCoreLevel
): Promise<DataStore> {
  const includeClassic = needsClassicApis(cleanCoreLevel, systemType);
  const effectiveVersion =
    systemType === "public_cloud" || systemType === "btp"
      ? "latest"
      : normalizeVersion(version);
  return loadData(systemType, effectiveVersion, includeClassic);
}

/** Filter objects by Clean Core Level (cumulative) */
export function filterByLevel(
  objects: SAPObject[],
  maxLevel: CleanCoreLevel
): SAPObject[] {
  const allowed = getLevelsUpTo(maxLevel);
  return objects.filter((obj) => allowed.has(obj.cleanCoreLevel));
}

/** Format a single object for text output */
export function formatObject(obj: SAPObject, verbose: boolean = false): string {
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

/** Truncate text if too long */
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
        `- Separate words trigger fuzzy matching on SAP abbreviations (e.g., 'physical inventory' finds both PHYSICALINVENTORY* and PHYSINVTRY* objects)\n` +
        `- Use exact SAP names only when you know the precise object name (e.g., 'I_PRODUCT', 'MARA')\n` +
        `- Combine with app_component filter for targeted results (e.g., query='inventory', app_component='MM-IM')\n` +
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
      query,
      system_type,
      clean_core_level,
      version,
      object_type,
      app_component,
      state,
      limit,
      offset,
    }) => {
      try {
        const store = await getStore(system_type, version, clean_core_level);

        // --- Tokenize the query ---
        const { tokens: queryTokens } = tokenizeQuery(query);

        // --- Get indexed candidates (optionally narrowed by type) ---
        let indexedCandidates: IndexedObject[];
        if (object_type) {
          indexedCandidates =
            store.indexedByType.get(object_type.toUpperCase()) ?? [];
        } else {
          indexedCandidates = store.allIndexed;
        }

        // --- Apply filters BEFORE scoring ---
        const allowedLevels = getLevelsUpTo(clean_core_level);
        let filtered = indexedCandidates.filter((idx) =>
          allowedLevels.has(idx.object.cleanCoreLevel)
        );

        if (app_component) {
          const compUpper = app_component.toUpperCase();
          filtered = filtered.filter((idx) =>
            idx.object.applicationComponent.toUpperCase().includes(compUpper)
          );
        }

        if (state) {
          filtered = filtered.filter((idx) => idx.object.state === state);
        }

        // --- Score each candidate ---
        let scored: Array<{ indexed: IndexedObject; score: number }> = [];
        for (const idx of filtered) {
          const score = scoreObject(idx, queryTokens, query);
          if (score > 0) {
            scored.push({ indexed: idx, score });
          }
        }

        // --- Sort by score descending, then alphabetically by name ---
        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.indexed.object.objectName.localeCompare(
            b.indexed.object.objectName
          );
        });

        // --- Dynamic threshold: filter out low-quality tail ---
        // Exclude exact-match bonus (1000) from threshold calculation to prevent
        // killing all results when one object matches exactly.
        // Example: "I_PRODUCT" exact=1038, baseScore=38, threshold=10 → keeps I_PRODUCTDESCRIPTION (31)
        // Example: "purchase order" max=31, threshold=8 → filters single-token noise (score 6 after coverage penalty)
        if (scored.length > 0) {
          const topScore = scored[0].score;
          const baseScore = topScore > 1000 ? topScore - 1000 : topScore;
          const threshold = Math.max(Math.round(baseScore * 0.25), 3);
          scored = scored.filter(s => s.score >= threshold);
        }

        const total = scored.length;
        const paginated = scored.slice(offset, offset + limit);
        const hasMore = total > offset + paginated.length;

        if (paginated.length === 0) {
          const levelInfo =
            (system_type === "public_cloud" || system_type === "btp") && clean_core_level !== "A"
              ? ` Note: ${system_type} systems only have Level A objects. Try private_cloud or on_premise for Levels B-D.`
              : "";
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No objects found matching '${query}' with the specified filters ` +
                  `(system: ${system_type}, level: ≤${clean_core_level}, type: ${object_type ?? "all"}, ` +
                  `component: ${app_component ?? "all"}).${levelInfo}\n\n` +
                  `Suggestions:\n` +
                  `- Try a broader search term\n` +
                  `- Increase the Clean Core Level (e.g., from A to B)\n` +
                  `- Remove object type or component filters\n` +
                  `- For private/on-premise, ensure the correct version is specified`,
              },
            ],
          };
        }

        // --- Compute normalized relevance (0–100) ---
        const maxScore = scored[0].score; // first element has highest score

        const lines = paginated.map(({ indexed, score }) => {
          const relevance = Math.round((score / maxScore) * 100);
          return (
            formatObject(indexed.object, true) +
            `\n  Relevance: ${relevance}/100 (score: ${score})`
          );
        });

        const header =
          `Found ${total} objects matching '${query}' ` +
          `(system: ${system_type}, level: ≤${clean_core_level}, ` +
          `showing ${offset + 1}-${offset + paginated.length} of ${total})`;

        const footer = hasMore
          ? `\n\n--- More results available. Use offset=${offset + limit} to see next page. ---`
          : "";

        const text = truncateIfNeeded(
          `${header}\n\n${lines.join("\n\n")}${footer}`
        );

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error searching objects: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
        const store = await getStore(system_type, version, clean_core_level);
        const key = `${object_type.toUpperCase()}:${object_name.toUpperCase()}`;
        const obj = store.objectsMap.get(key);

        if (!obj) {
          // Try case-insensitive search
          let found: SAPObject | undefined;
          for (const [k, v] of store.objectsMap) {
            if (k.toUpperCase() === key) {
              found = v;
              break;
            }
          }

          if (!found) {
            // Object not found in the repo at all — might be Level C or D
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Object ${object_type} ${object_name} was NOT found in the Cloudification Repository ` +
                    `for system type '${system_type}' (version: ${version}).\n\n` +
                    `This means:\n` +
                    `- The object may not exist in this SAP version\n` +
                    `- If it's a known SAP standard object, it is likely Level C (internal, unclassified) ` +
                    `or Level D (noAPI)\n` +
                    `- It is NOT available for ABAP Cloud (Level A) development\n` +
                    `- Consider searching for a released successor using sap_find_successor\n` +
                    `- Or search for alternative released objects using sap_search_objects`,
                },
              ],
            };
          }

          return {
            content: [
              { type: "text" as const, text: formatObject(found, true) },
            ],
          };
        }

        const typeDesc = OBJECT_TYPE_DESCRIPTIONS[obj.objectType] ?? "";
        const lines: string[] = [
          `=== ${obj.objectType} ${obj.objectName} ===`,
          "",
          `Clean Core Level: ${obj.cleanCoreLevel}`,
          `State: ${obj.state}`,
          `Object Type: ${obj.objectType}${typeDesc ? ` (${typeDesc})` : ""}`,
          `Application Component: ${obj.applicationComponent || "N/A"}`,
          `Software Component: ${obj.softwareComponent || "N/A"}`,
          `Source: ${obj.source === "released" ? "Released APIs (Tier 1)" : "Classic APIs (Tier 2)"}`,
        ];

        // Level assessment
        lines.push("");
        if (obj.cleanCoreLevel === "A" && obj.state === "released") {
          lines.push(
            "✅ This object is RELEASED for ABAP Cloud development (Level A).",
            "   It has a formal stability contract and is upgrade-safe."
          );
        } else if (obj.cleanCoreLevel === "A" && obj.state === "deprecated") {
          lines.push(
            "⚠️  This object is DEPRECATED. It was previously released but should no longer be used.",
            "   Check the successor information below."
          );
        } else if (obj.cleanCoreLevel === "B") {
          lines.push(
            "ℹ️  This is a Classic API (Level B). It is generally upgrade-stable but does not have",
            "   a formal release contract. Governance sign-off recommended. Monitor for released successors."
          );
        } else if (obj.cleanCoreLevel === "C") {
          lines.push(
            "⚠️  This is an internal/unclassified object (Level C). No stability guarantee.",
            "   Consult SAP changelog for incompatible changes. Plan remediation."
          );
        } else if (obj.cleanCoreLevel === "D") {
          lines.push(
            "❌ This object is marked as 'noAPI' (Level D). It is NOT Clean Core.",
            "   Should be remediated/replaced as a priority. Check for successors."
          );
        }

        // Successor info
        if (obj.successor) {
          lines.push("", "--- Successor Information ---");
          lines.push(`Classification: ${obj.successor.classification}`);

          if (obj.successor.objects && obj.successor.objects.length > 0) {
            lines.push("Successor object(s):");
            for (const succ of obj.successor.objects) {
              const succDesc =
                OBJECT_TYPE_DESCRIPTIONS[succ.objectType] ?? "";
              lines.push(
                `  → ${succ.objectType} ${succ.objectName}${succDesc ? ` (${succDesc})` : ""}`
              );
            }
          }

          if (obj.successor.conceptName) {
            lines.push(`Successor Concept: ${obj.successor.conceptName}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error fetching object details: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
        // Load with Level D to include all objects (we need deprecated/noAPI ones)
        const store = await getStore(system_type, version, "D");
        const nameUpper = object_name.toUpperCase();
        const typeUpper = object_type?.toUpperCase();

        // Find all objects matching the name that have successors
        const withSuccessors: SAPObject[] = [];
        const exactMatches: SAPObject[] = [];

        for (const obj of store.objectsMap.values()) {
          if (typeUpper && obj.objectType !== typeUpper) continue;

          if (obj.objectName.toUpperCase() === nameUpper) {
            exactMatches.push(obj);
          } else if (obj.objectName.toUpperCase().includes(nameUpper)) {
            if (obj.successor) {
              withSuccessors.push(obj);
            }
          }
        }

        // Prioritize exact matches
        const results = [
          ...exactMatches,
          ...withSuccessors.slice(0, 20),
        ];

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No object matching '${object_name}'${object_type ? ` (type: ${object_type})` : ""} ` +
                  `found in the Cloudification Repository.\n\n` +
                  `The object may not be cataloged. Try:\n` +
                  `- Searching with sap_search_objects for related released APIs\n` +
                  `- Checking the SAP Business Accelerator Hub for released APIs\n` +
                  `- Using the Cloudification Repository Viewer: ` +
                  `https://sap.github.io/abap-atc-cr-cv-s4hc/`,
              },
            ],
          };
        }

        const lines: string[] = [
          `=== Successor Search for '${object_name}' ===`,
          "",
        ];

        for (const obj of results) {
          lines.push(`--- ${obj.objectType} ${obj.objectName} ---`);
          lines.push(`State: ${obj.state} (Level ${obj.cleanCoreLevel})`);

          if (obj.successor) {
            lines.push(`Successor Type: ${obj.successor.classification}`);

            if (obj.successor.objects && obj.successor.objects.length > 0) {
              for (const succ of obj.successor.objects) {
                const succDesc =
                  OBJECT_TYPE_DESCRIPTIONS[succ.objectType] ?? "";
                // Check if successor is released
                const succKey = `${succ.objectType}:${succ.objectName}`;
                const succObj = store.objectsMap.get(succKey);
                const succState = succObj
                  ? `${succObj.state} (Level ${succObj.cleanCoreLevel})`
                  : "status unknown";
                lines.push(
                  `  → ${succ.objectType} ${succ.objectName}${succDesc ? ` (${succDesc})` : ""} [${succState}]`
                );
              }
            }

            if (obj.successor.conceptName) {
              lines.push(`  → Concept: ${obj.successor.conceptName}`);
            }
          } else {
            if (obj.state === "released") {
              lines.push(
                "  ✅ This object IS released (Level A). No successor needed — use this object directly."
              );
            } else {
              lines.push(
                "  ⚠️  No successor information available for this object."
              );
            }
          }

          lines.push("");
        }

        return {
          content: [
            { type: "text" as const, text: truncateIfNeeded(lines.join("\n")) },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error finding successors: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
        const store = await getStore(system_type, version, clean_core_level);
        const allowedLevels = getLevelsUpTo(clean_core_level);

        // Count by type, filtered by level
        const typeCounts = new Map<string, { total: number; byLevel: Record<string, number> }>();

        for (const obj of store.objectsMap.values()) {
          if (!allowedLevels.has(obj.cleanCoreLevel)) continue;

          const entry = typeCounts.get(obj.objectType) ?? {
            total: 0,
            byLevel: {},
          };
          entry.total++;
          entry.byLevel[obj.cleanCoreLevel] =
            (entry.byLevel[obj.cleanCoreLevel] ?? 0) + 1;
          typeCounts.set(obj.objectType, entry);
        }

        // Sort by count descending
        const sorted = [...typeCounts.entries()].sort(
          (a, b) => b[1].total - a[1].total
        );

        const lines: string[] = [
          `=== SAP Object Types (system: ${system_type}, level: ≤${clean_core_level}) ===`,
          "",
          `Total types: ${sorted.length}`,
          "",
        ];

        for (const [type, data] of sorted) {
          const desc = OBJECT_TYPE_DESCRIPTIONS[type] ?? "";
          const levelBreakdown = Object.entries(data.byLevel)
            .map(([lvl, cnt]) => `L${lvl}:${cnt}`)
            .join(" ");
          lines.push(
            `${type.padEnd(6)} ${String(data.total).padStart(6)} objects  (${levelBreakdown})${desc ? `  — ${desc}` : ""}`
          );
        }

        return {
          content: [
            { type: "text" as const, text: truncateIfNeeded(lines.join("\n")) },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error listing object types: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
        const store = await getStore(system_type, version, clean_core_level);

        const levelCounts: Record<string, number> = {};
        const stateCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = {};
        const compCounts: Record<string, number> = {};

        for (const obj of store.objectsMap.values()) {
          levelCounts[obj.cleanCoreLevel] =
            (levelCounts[obj.cleanCoreLevel] ?? 0) + 1;
          stateCounts[obj.state] = (stateCounts[obj.state] ?? 0) + 1;
          typeCounts[obj.objectType] =
            (typeCounts[obj.objectType] ?? 0) + 1;
          if (obj.applicationComponent) {
            // Use top-level component (first 2 segments)
            const topComp = obj.applicationComponent.split("-").slice(0, 2).join("-");
            compCounts[topComp] = (compCounts[topComp] ?? 0) + 1;
          }
        }

        // Top 15 application components
        const topComps = Object.entries(compCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15);

        // Top 10 object types
        const topTypes = Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        const pceVersions = await discoverPCEVersions();

        const lines: string[] = [
          `=== SAP Cloudification Repository Statistics ===`,
          "",
          `Source: ${store.sourceId}`,
          `Loaded at: ${store.loadedAt.toISOString()}`,
          `Total unique objects: ${store.objectsMap.size}`,
          "",
          "--- By Clean Core Level ---",
          ...LEVEL_ORDER.map(
            (lvl) => `  Level ${lvl}: ${(levelCounts[lvl] ?? 0).toLocaleString()} objects`
          ),
          "",
          "--- By State ---",
          ...Object.entries(stateCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([state, count]) => `  ${state}: ${count.toLocaleString()}`),
          "",
          "--- Top Object Types ---",
          ...topTypes.map(([type, count]) => {
            const desc = OBJECT_TYPE_DESCRIPTIONS[type] ?? "";
            return `  ${type}: ${count.toLocaleString()}${desc ? ` (${desc})` : ""}`;
          }),
          "",
          "--- Top Application Components ---",
          ...topComps.map(
            ([comp, count]) => `  ${comp}: ${count.toLocaleString()}`
          ),
          "",
          `Available PCE versions: ${pceVersions.join(", ")}`,
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error fetching statistics: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
        const versions = await discoverPCEVersions();

        const lines: string[] = [
          `=== Available S/4HANA PCE Versions ===`,
          "",
          `Total: ${versions.length} versions`,
          "",
          ...versions.map((v) => {
            const parts = v.split("_");
            const year = parts[0];
            const fps = parts.length > 1 ? parts[1] : null;
            return fps !== null
              ? `  ${v}  (${year} FPS${fps.padStart(2, "0")} / SP${fps.padStart(2, "0")})`
              : `  ${v}  (${year} base release)`;
          }),
          "",
          "Use 'latest' to always target the most recent version.",
          "Pass a specific version to other tools via the 'version' parameter.",
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error listing versions: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
        // Load with Level D to check all possible states
        const store = await getStore(system_type, version, "D");
        const targetLevels = getLevelsUpTo(target_level);

        const items = object_names
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const lines: string[] = [
          `=== Clean Core Compliance Check (Target: Level ${target_level}) ===`,
          `System: ${system_type}, Version: ${version}`,
          `Objects to check: ${items.length}`,
          "",
        ];

        let compliant = 0;
        let nonCompliant = 0;
        let notFound = 0;

        for (const item of items) {
          let searchType: string | undefined;
          let searchName: string;

          if (item.includes(":")) {
            const [t, n] = item.split(":");
            searchType = t.toUpperCase();
            searchName = n.toUpperCase();
          } else {
            searchName = item.toUpperCase();
          }

          // Find the object
          let found: SAPObject | undefined;

          if (searchType) {
            found = store.objectsMap.get(`${searchType}:${searchName}`);
          } else {
            // Search across all types
            for (const [key, obj] of store.objectsMap) {
              if (key.endsWith(`:${searchName}`)) {
                found = obj;
                break;
              }
            }
          }

          if (!found) {
            notFound++;
            lines.push(
              `❓ ${item} — NOT FOUND in repository (likely Level C/D or non-existent)`
            );
          } else if (targetLevels.has(found.cleanCoreLevel)) {
            compliant++;
            const icon = found.state === "deprecated" ? "⚠️" : "✅";
            lines.push(
              `${icon} ${found.objectType} ${found.objectName} — Level ${found.cleanCoreLevel} (${found.state})` +
                (found.state === "deprecated" && found.successor?.objects
                  ? ` → Use: ${found.successor.objects.map((s) => s.objectName).join(", ")}`
                  : "")
            );
          } else {
            nonCompliant++;
            let line = `❌ ${found.objectType} ${found.objectName} — Level ${found.cleanCoreLevel} (${found.state})`;
            if (found.successor?.objects) {
              line += ` → Successor: ${found.successor.objects.map((s) => `${s.objectType} ${s.objectName}`).join(", ")}`;
            } else if (found.successor?.conceptName) {
              line += ` → Concept: ${found.successor.conceptName}`;
            }
            lines.push(line);
          }
        }

        lines.push(
          "",
          "--- Summary ---",
          `✅ Compliant (≤ Level ${target_level}): ${compliant}`,
          `❌ Non-compliant: ${nonCompliant}`,
          `❓ Not found: ${notFound}`,
          `📊 Compliance rate: ${items.length > 0 ? Math.round((compliant / items.length) * 100) : 0}%`
        );

        return {
          content: [
            { type: "text" as const, text: truncateIfNeeded(lines.join("\n")) },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error checking compliance: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );
}
