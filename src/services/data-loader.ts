// ============================================================================
// Data Loader Service
// Fetches JSON from GitHub, normalizes objects, builds indexed DataStore
// ============================================================================

import https from "node:https";
import type {
  RawReleaseInfoFile,
  RawClassificationsFile,
  RawObjectEntry,
  SAPObject,
  SuccessorInfo,
  DataStore,
  CacheEntry,
  CleanCoreLevel,
  SystemType,
  GitHubContentEntry,
  IndexedObject,
} from "../types.js";

import { tokenizeSAPName, tokenizeComponent } from "./search.js";

import {
  RELEASED_LATEST_URL,
  RELEASED_BTP_LATEST_URL,
  RELEASED_PCE_LATEST_URL,
  getReleasedPCEVersionURL,
  CLASSIC_API_SAP_URL,
  STATE_TO_LEVEL,
  DEFAULT_LEVEL,
  CACHE_TTL_MS,
  FALLBACK_PCE_VERSIONS,
} from "../constants.js";

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const cache = new Map<string, CacheEntry>();

function getCacheKey(
  systemType: SystemType,
  version: string,
  includeClassicApis: boolean
): string {
  return `${systemType}:${version}:${includeClassicApis}`;
}

// ---------------------------------------------------------------------------
// Fetch JSON from GitHub
// Uses node:https instead of fetch for compatibility with pkg binaries
// ---------------------------------------------------------------------------

async function fetchJSON<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: { Accept: "application/json" },
        // Skip TLS verification: the data is public read-only JSON from GitHub.
        // Corporate proxies often re-sign HTTPS with their own CA, which pkg
        // binaries do not trust. This is safe since no secrets are transmitted.
        rejectUnauthorized: false,
      },
      (res) => {
        // Handle redirects (3xx)
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchJSON<T>(res.headers.location).then(resolve, reject);
          res.resume();
          return;
        }

        // Handle HTTP errors
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(
            new Error(
              `Failed to fetch ${url}: ${res.statusCode} ${res.statusMessage}. ` +
                `Verify the file exists at https://github.com/SAP/abap-atc-cr-cv-s4hc/tree/main/src`
            )
          );
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf-8");
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(
              new Error(
                `Failed to parse JSON from ${url}: ${e instanceof Error ? e.message : String(e)}`
              )
            );
          }
        });
        res.on("error", reject);
      }
    ).on("error", (err) => {
      reject(
        new Error(
          `Failed to fetch ${url}: ${err.message}`
        )
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Determine which Released APIs URL to use
// ---------------------------------------------------------------------------

function getReleasedURL(systemType: SystemType, version: string): string {
  if (systemType === "public_cloud") {
    return RELEASED_LATEST_URL;
  }
  if (systemType === "btp") {
    return RELEASED_BTP_LATEST_URL;
  }
  // private_cloud or on_premise
  if (version === "latest") {
    return RELEASED_PCE_LATEST_URL;
  }
  return getReleasedPCEVersionURL(version);
}

// ---------------------------------------------------------------------------
// Normalize a raw entry into a SAPObject
// ---------------------------------------------------------------------------

function normalizeEntry(
  entry: RawObjectEntry,
  source: "released" | "classicApi"
): SAPObject {
  const level = STATE_TO_LEVEL[entry.state] ?? DEFAULT_LEVEL;

  const obj: SAPObject = {
    objectType: (entry.tadirObject || entry.objectType).toUpperCase(),
    objectName: (entry.tadirObjName || entry.objectKey).toUpperCase(),
    softwareComponent: entry.softwareComponent ?? "",
    applicationComponent: entry.applicationComponent ?? "",
    state: entry.state,
    cleanCoreLevel: level,
    source,
  };

  if (entry.successorClassification) {
    const successor: SuccessorInfo = {
      classification: entry.successorClassification,
    };
    if (entry.successors && entry.successors.length > 0) {
      successor.objects = entry.successors.map((s) => ({
        objectType: (s.tadirObject || s.objectType).toUpperCase(),
        objectName: (s.tadirObjName || s.objectKey).toUpperCase(),
      }));
    }
    if (entry.successorConceptName) {
      successor.conceptName = entry.successorConceptName;
    }
    obj.successor = successor;
  }

  return obj;
}

// ---------------------------------------------------------------------------
// Build indexed DataStore from normalized objects
// ---------------------------------------------------------------------------

function buildStore(objects: SAPObject[], sourceId: string): DataStore {
  // --- Pass 1: deduplicate (released wins over classicApi) ---
  const objectsMap = new Map<string, SAPObject>();

  for (const obj of objects) {
    const key = `${obj.objectType}:${obj.objectName}`;

    if (objectsMap.has(key)) {
      const existing = objectsMap.get(key)!;
      if (existing.source === "released" && obj.source === "classicApi") {
        continue;
      }
    }

    objectsMap.set(key, obj);
  }

  // --- Pass 2: build all indexes from deduplicated objects ---
  const byType = new Map<string, SAPObject[]>();
  const byLevel = new Map<CleanCoreLevel, SAPObject[]>();
  const byAppComponent = new Map<string, SAPObject[]>();
  const allIndexed: IndexedObject[] = [];
  const indexedByType = new Map<string, IndexedObject[]>();

  for (const obj of objectsMap.values()) {
    // Type index
    const typeArr = byType.get(obj.objectType) ?? [];
    typeArr.push(obj);
    byType.set(obj.objectType, typeArr);

    // Level index
    const levelArr = byLevel.get(obj.cleanCoreLevel) ?? [];
    levelArr.push(obj);
    byLevel.set(obj.cleanCoreLevel, levelArr);

    // Component index
    if (obj.applicationComponent) {
      const compArr = byAppComponent.get(obj.applicationComponent) ?? [];
      compArr.push(obj);
      byAppComponent.set(obj.applicationComponent, compArr);
    }

    // Pre-compute token index
    const indexed: IndexedObject = {
      object: obj,
      nameTokens: tokenizeSAPName(obj.objectName),
      componentTokens: tokenizeComponent(obj.applicationComponent),
    };
    allIndexed.push(indexed);

    const typeIdxArr = indexedByType.get(obj.objectType) ?? [];
    typeIdxArr.push(indexed);
    indexedByType.set(obj.objectType, typeIdxArr);
  }

  return {
    objectsMap,
    byType,
    byLevel,
    byAppComponent,
    allIndexed,
    indexedByType,
    loadedAt: new Date(),
    sourceId,
  };
}

// ---------------------------------------------------------------------------
// Discover PCE versions dynamically from GitHub
// ---------------------------------------------------------------------------

const GITHUB_CONTENTS_URL =
  "https://api.github.com/repos/SAP/abap-atc-cr-cv-s4hc/contents/src";

const PCE_VERSIONS_CACHE_KEY = "__pce_versions__";

/** Cached PCE versions with expiry */
let pceVersionsCache: { versions: string[]; expiresAt: number } | null = null;

/**
 * Discover available PCE versions by listing files from the GitHub API.
 * Results are cached for CACHE_TTL_MS (1h). Falls back to FALLBACK_PCE_VERSIONS on error.
 */
export async function discoverPCEVersions(): Promise<string[]> {
  // Check cache
  if (pceVersionsCache && Date.now() < pceVersionsCache.expiresAt) {
    return pceVersionsCache.versions;
  }

  try {
    const entries = await fetchJSON<GitHubContentEntry[]>(GITHUB_CONTENTS_URL);
    const regex = /^objectReleaseInfo_PCE(\d{4})(?:_(\d+))?\.json$/;

    const versions: { year: number; fps: number; label: string }[] = [];

    for (const entry of entries) {
      const match = entry.name.match(regex);
      if (match) {
        const year = parseInt(match[1], 10);
        const fps = match[2] !== undefined ? parseInt(match[2], 10) : -1;
        const label = fps === -1 ? `${year}` : `${year}_${fps}`;
        versions.push({ year, fps, label });
      }
    }

    // Sort by year then FPS
    versions.sort((a, b) => a.year - b.year || a.fps - b.fps);

    const result = versions.map((v) => v.label);

    if (result.length === 0) {
      console.error(
        "[DataLoader] No PCE versions found from GitHub API, using fallback"
      );
      pceVersionsCache = {
        versions: [...FALLBACK_PCE_VERSIONS],
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return pceVersionsCache.versions;
    }

    console.error(
      `[DataLoader] Discovered ${result.length} PCE versions: ${result.join(", ")}`
    );
    pceVersionsCache = {
      versions: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return result;
  } catch (err) {
    console.error(
      `[DataLoader] Failed to discover PCE versions: ${err instanceof Error ? err.message : String(err)}. Using fallback.`
    );
    pceVersionsCache = {
      versions: [...FALLBACK_PCE_VERSIONS],
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return pceVersionsCache.versions;
  }
}

// ---------------------------------------------------------------------------
// Main loader: fetch, normalize, index
// ---------------------------------------------------------------------------

export async function loadData(
  systemType: SystemType,
  version: string = "latest",
  includeClassicApis: boolean = false
): Promise<DataStore> {
  const cacheKey = getCacheKey(systemType, version, includeClassicApis);

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.store;
  }

  const allObjects: SAPObject[] = [];
  const sourceId = `${systemType}/${version}${includeClassicApis ? "+classicApis" : ""}`;

  // 1. Load Released APIs (Level A) — always loaded
  const releasedURL = getReleasedURL(systemType, version);
  console.error(`[DataLoader] Fetching Released APIs from: ${releasedURL}`);

  const releasedData = await fetchJSON<RawReleaseInfoFile>(releasedURL);
  const releasedEntries = releasedData.objectReleaseInfo ?? [];

  for (const entry of releasedEntries) {
    allObjects.push(normalizeEntry(entry, "released"));
  }
  console.error(
    `[DataLoader] Loaded ${releasedEntries.length} released objects`
  );

  // 2. Load Classic APIs (Level B) — only for private_cloud / on_premise
  if (
    includeClassicApis &&
    (systemType === "private_cloud" || systemType === "on_premise")
  ) {
    console.error(
      `[DataLoader] Fetching Classic APIs from: ${CLASSIC_API_SAP_URL}`
    );
    try {
      const classicData =
        await fetchJSON<RawClassificationsFile>(CLASSIC_API_SAP_URL);
      const classicEntries =
        classicData.objectReleaseInfo ??
        classicData.objectClassifications ??
        [];

      for (const entry of classicEntries) {
        allObjects.push(normalizeEntry(entry, "classicApi"));
      }
      console.error(
        `[DataLoader] Loaded ${classicEntries.length} classic API objects`
      );
    } catch (err) {
      console.error(
        `[DataLoader] Warning: Could not load Classic APIs: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 3. Build indexed store
  const store = buildStore(allObjects, sourceId);
  console.error(
    `[DataLoader] DataStore ready: ${store.objectsMap.size} unique objects indexed`
  );

  // 4. Cache
  cache.set(cacheKey, {
    store,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return store;
}

/** Clear all cached data */
export function clearCache(): void {
  cache.clear();
  console.error("[DataLoader] Cache cleared");
}

/** Get cache info for debugging */
export function getCacheInfo(): Array<{
  key: string;
  size: number;
  expiresAt: string;
}> {
  const info: Array<{ key: string; size: number; expiresAt: string }> = [];
  for (const [key, entry] of cache.entries()) {
    info.push({
      key,
      size: entry.store.objectsMap.size,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    });
  }
  return info;
}
