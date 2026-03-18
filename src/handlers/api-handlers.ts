// ============================================================================
// Shared Business Logic Handlers
// Used by both MCP tools (text output) and REST API (JSON output)
// ============================================================================

import type { SAPObject, CleanCoreLevel, SystemType, IndexedObject } from "../types.js";
import { loadData, discoverPCEVersions } from "../services/data-loader.js";
import { tokenizeQuery, scoreObject } from "../services/search.js";
import { expandQueryTokens } from "../services/abbreviation-dictionary.js";
import { OBJECT_TYPE_DESCRIPTIONS, CHARACTER_LIMIT } from "../constants.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export const LEVEL_ORDER: CleanCoreLevel[] = ["A", "B", "C", "D"];

export function normalizeVersion(version: string): string {
  const trimmed = version.trim();
  if (trimmed === "latest" || /^\d{4}(_\d+)?$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{4})[\s_.-]?(?:(?:SP|FPS)[\s_.-]?)?(\d+)$/i);
  if (match) {
    const year = match[1];
    const fps = String(parseInt(match[2], 10));
    return `${year}_${fps}`;
  }
  return trimmed;
}

export function getLevelsUpTo(maxLevel: CleanCoreLevel): Set<CleanCoreLevel> {
  const idx = LEVEL_ORDER.indexOf(maxLevel);
  return new Set(LEVEL_ORDER.slice(0, idx + 1));
}

export function needsClassicApis(level: CleanCoreLevel, systemType: SystemType): boolean {
  if (systemType === "public_cloud" || systemType === "btp") return false;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf("B");
}

export async function getStore(
  systemType: SystemType,
  version: string,
  cleanCoreLevel: CleanCoreLevel
) {
  const includeClassic = needsClassicApis(cleanCoreLevel, systemType);
  const effectiveVersion =
    systemType === "public_cloud" || systemType === "btp"
      ? "latest"
      : normalizeVersion(version);
  return loadData(systemType, effectiveVersion, includeClassic);
}

export function filterByLevel(objects: SAPObject[], maxLevel: CleanCoreLevel): SAPObject[] {
  const allowed = getLevelsUpTo(maxLevel);
  return objects.filter((obj) => allowed.has(obj.cleanCoreLevel));
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ScoredObject {
  objectType: string;
  objectName: string;
  state: string;
  cleanCoreLevel: string;
  applicationComponent: string;
  softwareComponent: string;
  typeDescription: string;
  successor?: {
    classification: string;
    objects?: Array<{ objectType: string; objectName: string }>;
    conceptName?: string;
  };
  relevance: number;
}

export interface SearchObjectsResult {
  query: string;
  system_type: string;
  clean_core_level: string;
  version: string;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  objects: ScoredObject[];
}

export interface SearchObjectsError {
  error: "unknown_type" | "no_results";
  message: string;
  availableTypes?: Array<{ type: string; count: number; description: string }>;
  suggestions?: string[];
}

export interface ObjectDetailsResult {
  found: true;
  object: {
    objectType: string;
    objectName: string;
    state: string;
    cleanCoreLevel: string;
    applicationComponent: string;
    softwareComponent: string;
    typeDescription: string;
    source: string;
    successor?: {
      classification: string;
      objects?: Array<{ objectType: string; objectName: string; typeDescription: string }>;
      conceptName?: string;
    };
  };
  assessment: {
    level: string;
    message: string;
  };
}

export interface ObjectNotFoundResult {
  found: false;
  message: string;
}

export interface SuccessorEntry {
  objectType: string;
  objectName: string;
  state: string;
  cleanCoreLevel: string;
  hasSuccessor: boolean;
  successor?: {
    classification: string;
    objects?: Array<{
      objectType: string;
      objectName: string;
      typeDescription: string;
      state: string;
      cleanCoreLevel: string;
    }>;
    conceptName?: string;
  };
  assessment: string;
}

export interface FindSuccessorResult {
  query: string;
  object_type?: string;
  results: SuccessorEntry[];
}

export interface ObjectTypeEntry {
  type: string;
  count: number;
  description: string;
  byLevel: Record<string, number>;
}

export interface ListObjectTypesResult {
  system_type: string;
  clean_core_level: string;
  totalTypes: number;
  types: ObjectTypeEntry[];
}

export interface StatisticsResult {
  source: string;
  loadedAt: string;
  totalObjects: number;
  byLevel: Record<string, number>;
  byState: Record<string, number>;
  topObjectTypes: Array<{ type: string; count: number; description: string }>;
  topApplicationComponents: Array<{ component: string; count: number }>;
  availableVersions: string[];
}

export interface VersionEntry {
  version: string;
  label: string;
}

export interface ListVersionsResult {
  total: number;
  versions: VersionEntry[];
}

export interface ComplianceEntry {
  input: string;
  status: "compliant" | "non_compliant" | "not_found";
  objectType?: string;
  objectName?: string;
  cleanCoreLevel?: string;
  state?: string;
  successor?: {
    objects?: Array<{ objectType: string; objectName: string }>;
    conceptName?: string;
  };
}

export interface ComplianceResult {
  targetLevel: string;
  system_type: string;
  version: string;
  totalChecked: number;
  compliant: number;
  nonCompliant: number;
  notFound: number;
  complianceRate: number;
  results: ComplianceEntry[];
}

// ---------------------------------------------------------------------------
// Handler 1: Search Objects
// ---------------------------------------------------------------------------

export async function handleSearchObjects(params: {
  query: string;
  system_type: SystemType;
  clean_core_level: CleanCoreLevel;
  version: string;
  object_type?: string;
  app_component?: string;
  state?: string;
  limit: number;
  offset: number;
}): Promise<SearchObjectsResult | SearchObjectsError> {
  const {
    query, system_type, clean_core_level, version,
    object_type, app_component, state, limit, offset,
  } = params;

  const store = await getStore(system_type, version, clean_core_level);

  const { tokens: queryTokens, mandatoryPrefix } = tokenizeQuery(query);
  const expandedTokens = expandQueryTokens(queryTokens);

  let indexedCandidates: IndexedObject[];
  if (object_type) {
    indexedCandidates = store.indexedByType.get(object_type.toUpperCase()) ?? [];
  } else {
    indexedCandidates = store.allIndexed;
  }

  if (object_type && indexedCandidates.length === 0) {
    const availableTypes = [...store.indexedByType.entries()]
      .map(([type, items]) => ({ type, count: items.length, description: OBJECT_TYPE_DESCRIPTIONS[type] ?? "" }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return {
      error: "unknown_type",
      message: `Object type '${object_type}' does not exist in the loaded dataset (system: ${system_type}, version: ${version}).`,
      availableTypes,
    };
  }

  const allowedLevels = getLevelsUpTo(clean_core_level);
  let filtered = indexedCandidates.filter((idx) => allowedLevels.has(idx.object.cleanCoreLevel));

  if (app_component) {
    const compUpper = app_component.toUpperCase();
    filtered = filtered.filter((idx) => idx.object.applicationComponent.toUpperCase().includes(compUpper));
  }

  if (state) {
    filtered = filtered.filter((idx) => idx.object.state === state);
  }

  if (mandatoryPrefix) {
    filtered = filtered.filter((idx) => idx.object.objectName.toUpperCase().startsWith(mandatoryPrefix!));
  }

  let scored: Array<{ indexed: IndexedObject; score: number; coverage: number }> = [];
  for (const idx of filtered) {
    const { score, coverage } = scoreObject(idx, queryTokens, query, expandedTokens);
    if (score > 0) {
      scored.push({ indexed: idx, score, coverage });
    }
  }

  scored.sort((a, b) => {
    // Sort by score×coverage (consistent with the displayed relevance metric)
    const relA = a.score * a.coverage;
    const relB = b.score * b.coverage;
    if (relB !== relA) return relB - relA;
    if (b.score !== a.score) return b.score - a.score;
    return a.indexed.object.objectName.localeCompare(b.indexed.object.objectName);
  });

  if (scored.length > 0) {
    const topScore = scored[0].score;
    const baseScore = topScore > 1000 ? topScore - 1000 : topScore;
    const threshold = Math.max(Math.round(baseScore * 0.25), 3);
    scored = scored.filter((s) => s.score >= threshold);
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
      error: "no_results",
      message: `No objects found matching '${query}' with the specified filters (system: ${system_type}, level: <=${clean_core_level}, type: ${object_type ?? "all"}, component: ${app_component ?? "all"}).${levelInfo}`,
      suggestions: [
        "Try a broader search term",
        "Increase the Clean Core Level (e.g., from A to B)",
        "Remove object type or component filters",
        "For private/on-premise, ensure the correct version is specified",
      ],
    };
  }

  // Relevance = relative quality (score/maxScore) × coverage (matched tokens ratio).
  // This ensures that unmatched query tokens visibly reduce relevance:
  // "purchase order" (2/2 matched) → top relevance 100
  // "purchase order banana" (2/3 matched) → top relevance ~67
  const maxScore = scored[0].score;
  const objects: ScoredObject[] = paginated.map(({ indexed, score, coverage }) => ({
    objectType: indexed.object.objectType,
    objectName: indexed.object.objectName,
    state: indexed.object.state,
    cleanCoreLevel: indexed.object.cleanCoreLevel,
    applicationComponent: indexed.object.applicationComponent,
    softwareComponent: indexed.object.softwareComponent,
    typeDescription: OBJECT_TYPE_DESCRIPTIONS[indexed.object.objectType] ?? indexed.object.objectType,
    successor: indexed.object.successor
      ? {
          classification: indexed.object.successor.classification,
          objects: indexed.object.successor.objects,
          conceptName: indexed.object.successor.conceptName,
        }
      : undefined,
    relevance: Math.round((score / maxScore) * 100 * coverage),
  }));

  return {
    query,
    system_type,
    clean_core_level,
    version,
    total,
    offset,
    limit,
    hasMore,
    objects,
  };
}

// ---------------------------------------------------------------------------
// Handler 2: Get Object Details
// ---------------------------------------------------------------------------

export async function handleGetObjectDetails(params: {
  object_type: string;
  object_name: string;
  system_type: SystemType;
  version: string;
  clean_core_level: CleanCoreLevel;
}): Promise<ObjectDetailsResult | ObjectNotFoundResult> {
  const { object_type, object_name, system_type, version, clean_core_level } = params;

  const store = await getStore(system_type, version, clean_core_level);
  const key = `${object_type.toUpperCase()}:${object_name.toUpperCase()}`;
  let obj = store.objectsMap.get(key);

  if (!obj) {
    for (const [k, v] of store.objectsMap) {
      if (k.toUpperCase() === key) {
        obj = v;
        break;
      }
    }
  }

  if (!obj) {
    return {
      found: false,
      message:
        `Object ${object_type} ${object_name} was NOT found in the Cloudification Repository ` +
        `for system type '${system_type}' (version: ${version}). ` +
        `The object may not exist, or is likely Level C (internal) or Level D (noAPI). ` +
        `It is NOT available for ABAP Cloud (Level A) development.`,
    };
  }

  let assessment: { level: string; message: string };
  if (obj.cleanCoreLevel === "A" && obj.state === "released") {
    assessment = { level: "A", message: "RELEASED for ABAP Cloud development (Level A). Upgrade-safe with formal stability contract." };
  } else if (obj.cleanCoreLevel === "A" && obj.state === "deprecated") {
    assessment = { level: "A", message: "DEPRECATED. Was previously released but should no longer be used. Check successor information." };
  } else if (obj.cleanCoreLevel === "B") {
    assessment = { level: "B", message: "Classic API (Level B). Upgrade-stable but no formal release contract. Governance sign-off recommended." };
  } else if (obj.cleanCoreLevel === "C") {
    assessment = { level: "C", message: "Internal/unclassified object (Level C). No stability guarantee. Consult SAP changelog." };
  } else if (obj.cleanCoreLevel === "D") {
    assessment = { level: "D", message: "noAPI (Level D). NOT Clean Core. Should be remediated/replaced. Check for successors." };
  } else {
    assessment = { level: obj.cleanCoreLevel, message: `Level ${obj.cleanCoreLevel} object.` };
  }

  return {
    found: true,
    object: {
      objectType: obj.objectType,
      objectName: obj.objectName,
      state: obj.state,
      cleanCoreLevel: obj.cleanCoreLevel,
      applicationComponent: obj.applicationComponent || "N/A",
      softwareComponent: obj.softwareComponent || "N/A",
      typeDescription: OBJECT_TYPE_DESCRIPTIONS[obj.objectType] ?? "",
      source: obj.source === "released" ? "Released APIs (Tier 1)" : "Classic APIs (Tier 2)",
      successor: obj.successor
        ? {
            classification: obj.successor.classification,
            objects: obj.successor.objects?.map((s) => ({
              objectType: s.objectType,
              objectName: s.objectName,
              typeDescription: OBJECT_TYPE_DESCRIPTIONS[s.objectType] ?? "",
            })),
            conceptName: obj.successor.conceptName,
          }
        : undefined,
    },
    assessment,
  };
}

// ---------------------------------------------------------------------------
// Handler 3: Find Successor
// ---------------------------------------------------------------------------

export async function handleFindSuccessor(params: {
  object_name: string;
  object_type?: string;
  system_type: SystemType;
  version: string;
}): Promise<FindSuccessorResult> {
  const { object_name, object_type, system_type, version } = params;

  const store = await getStore(system_type, version, "D");
  const nameUpper = object_name.toUpperCase();
  const typeUpper = object_type?.toUpperCase();

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

  const allResults = [...exactMatches, ...withSuccessors.slice(0, 20)];

  const results: SuccessorEntry[] = allResults.map((obj) => {
    let assessment: string;
    if (!obj.successor) {
      assessment = obj.state === "released"
        ? "This object IS released (Level A). No successor needed."
        : "No successor information available for this object.";
    } else {
      assessment = obj.successor.objects && obj.successor.objects.length > 0
        ? "Successor(s) available."
        : obj.successor.conceptName
          ? "Successor concept available."
          : "Successor classification available but no specific objects listed.";
    }

    return {
      objectType: obj.objectType,
      objectName: obj.objectName,
      state: obj.state,
      cleanCoreLevel: obj.cleanCoreLevel,
      hasSuccessor: !!obj.successor,
      successor: obj.successor
        ? {
            classification: obj.successor.classification,
            objects: obj.successor.objects?.map((s) => {
              const succKey = `${s.objectType}:${s.objectName}`;
              const succObj = store.objectsMap.get(succKey);
              return {
                objectType: s.objectType,
                objectName: s.objectName,
                typeDescription: OBJECT_TYPE_DESCRIPTIONS[s.objectType] ?? "",
                state: succObj?.state ?? "unknown",
                cleanCoreLevel: succObj?.cleanCoreLevel ?? "unknown",
              };
            }),
            conceptName: obj.successor.conceptName,
          }
        : undefined,
      assessment,
    };
  });

  return { query: object_name, object_type, results };
}

// ---------------------------------------------------------------------------
// Handler 4: List Object Types
// ---------------------------------------------------------------------------

export async function handleListObjectTypes(params: {
  system_type: SystemType;
  clean_core_level: CleanCoreLevel;
  version: string;
}): Promise<ListObjectTypesResult> {
  const { system_type, clean_core_level, version } = params;

  const store = await getStore(system_type, version, clean_core_level);
  const allowedLevels = getLevelsUpTo(clean_core_level);

  const typeCounts = new Map<string, { total: number; byLevel: Record<string, number> }>();

  for (const obj of store.objectsMap.values()) {
    if (!allowedLevels.has(obj.cleanCoreLevel)) continue;
    const entry = typeCounts.get(obj.objectType) ?? { total: 0, byLevel: {} };
    entry.total++;
    entry.byLevel[obj.cleanCoreLevel] = (entry.byLevel[obj.cleanCoreLevel] ?? 0) + 1;
    typeCounts.set(obj.objectType, entry);
  }

  const sorted = [...typeCounts.entries()].sort((a, b) => b[1].total - a[1].total);

  const types: ObjectTypeEntry[] = sorted.map(([type, data]) => ({
    type,
    count: data.total,
    description: OBJECT_TYPE_DESCRIPTIONS[type] ?? "",
    byLevel: data.byLevel,
  }));

  return { system_type, clean_core_level, totalTypes: types.length, types };
}

// ---------------------------------------------------------------------------
// Handler 5: Get Statistics
// ---------------------------------------------------------------------------

export async function handleGetStatistics(params: {
  system_type: SystemType;
  clean_core_level: CleanCoreLevel;
  version: string;
}): Promise<StatisticsResult> {
  const { system_type, clean_core_level, version } = params;

  const store = await getStore(system_type, version, clean_core_level);

  const levelCounts: Record<string, number> = {};
  const stateCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const compCounts: Record<string, number> = {};

  for (const obj of store.objectsMap.values()) {
    levelCounts[obj.cleanCoreLevel] = (levelCounts[obj.cleanCoreLevel] ?? 0) + 1;
    stateCounts[obj.state] = (stateCounts[obj.state] ?? 0) + 1;
    typeCounts[obj.objectType] = (typeCounts[obj.objectType] ?? 0) + 1;
    if (obj.applicationComponent) {
      const topComp = obj.applicationComponent.split("-").slice(0, 2).join("-");
      compCounts[topComp] = (compCounts[topComp] ?? 0) + 1;
    }
  }

  const topComps = Object.entries(compCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([component, count]) => ({ component, count }));

  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count, description: OBJECT_TYPE_DESCRIPTIONS[type] ?? "" }));

  const pceVersions = await discoverPCEVersions();

  return {
    source: store.sourceId,
    loadedAt: store.loadedAt.toISOString(),
    totalObjects: store.objectsMap.size,
    byLevel: levelCounts,
    byState: stateCounts,
    topObjectTypes: topTypes,
    topApplicationComponents: topComps,
    availableVersions: pceVersions,
  };
}

// ---------------------------------------------------------------------------
// Handler 6: List Versions
// ---------------------------------------------------------------------------

export async function handleListVersions(): Promise<ListVersionsResult> {
  const versions = await discoverPCEVersions();

  const entries: VersionEntry[] = versions.map((v) => {
    const parts = v.split("_");
    const year = parts[0];
    const fps = parts.length > 1 ? parts[1] : null;
    const label =
      fps !== null
        ? `${year} FPS${fps.padStart(2, "0")} / SP${fps.padStart(2, "0")}`
        : `${year} base release`;
    return { version: v, label };
  });

  return { total: entries.length, versions: entries };
}

// ---------------------------------------------------------------------------
// Handler 7: Check Clean Core Compliance
// ---------------------------------------------------------------------------

export async function handleCheckCompliance(params: {
  object_names: string;
  target_level: "A" | "B";
  system_type: SystemType;
  version: string;
}): Promise<ComplianceResult> {
  const { object_names, target_level, system_type, version } = params;

  const store = await getStore(system_type, version, "D");
  const targetLevels = getLevelsUpTo(target_level);

  const items = object_names
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let compliant = 0;
  let nonCompliant = 0;
  let notFound = 0;

  const results: ComplianceEntry[] = [];

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

    let found: SAPObject | undefined;

    if (searchType) {
      found = store.objectsMap.get(`${searchType}:${searchName}`);
    } else {
      for (const [key, obj] of store.objectsMap) {
        if (key.endsWith(`:${searchName}`)) {
          found = obj;
          break;
        }
      }
    }

    if (!found) {
      notFound++;
      results.push({ input: item, status: "not_found" });
    } else if (targetLevels.has(found.cleanCoreLevel)) {
      compliant++;
      results.push({
        input: item,
        status: "compliant",
        objectType: found.objectType,
        objectName: found.objectName,
        cleanCoreLevel: found.cleanCoreLevel,
        state: found.state,
        successor:
          found.state === "deprecated" && found.successor
            ? { objects: found.successor.objects, conceptName: found.successor.conceptName }
            : undefined,
      });
    } else {
      nonCompliant++;
      results.push({
        input: item,
        status: "non_compliant",
        objectType: found.objectType,
        objectName: found.objectName,
        cleanCoreLevel: found.cleanCoreLevel,
        state: found.state,
        successor: found.successor
          ? { objects: found.successor.objects, conceptName: found.successor.conceptName }
          : undefined,
      });
    }
  }

  return {
    targetLevel: target_level,
    system_type,
    version,
    totalChecked: items.length,
    compliant,
    nonCompliant,
    notFound,
    complianceRate: items.length > 0 ? Math.round((compliant / items.length) * 100) : 0,
    results,
  };
}
