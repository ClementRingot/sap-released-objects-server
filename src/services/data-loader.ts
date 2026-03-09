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
} from "../types.js";

import {
  RELEASED_LATEST_URL,
  RELEASED_PCE_LATEST_URL,
  getReleasedPCEVersionURL,
  CLASSIC_API_SAP_URL,
  STATE_TO_LEVEL,
  DEFAULT_LEVEL,
  CACHE_TTL_MS,
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
    objectType: entry.tadirObject || entry.objectType,
    objectName: entry.tadirObjName || entry.objectKey,
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
        objectType: s.tadirObject || s.objectType,
        objectName: s.tadirObjName || s.objectKey,
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
  const objectsMap = new Map<string, SAPObject>();
  const byType = new Map<string, SAPObject[]>();
  const byLevel = new Map<CleanCoreLevel, SAPObject[]>();
  const byAppComponent = new Map<string, SAPObject[]>();

  for (const obj of objects) {
    const key = `${obj.objectType}:${obj.objectName}`;

    // If duplicate, keep released source over classicApi
    if (objectsMap.has(key)) {
      const existing = objectsMap.get(key)!;
      if (existing.source === "released" && obj.source === "classicApi") {
        continue;
      }
    }

    objectsMap.set(key, obj);

    // Index by type
    const typeArr = byType.get(obj.objectType) ?? [];
    typeArr.push(obj);
    byType.set(obj.objectType, typeArr);

    // Index by level
    const levelArr = byLevel.get(obj.cleanCoreLevel) ?? [];
    levelArr.push(obj);
    byLevel.set(obj.cleanCoreLevel, levelArr);

    // Index by application component
    if (obj.applicationComponent) {
      const compArr = byAppComponent.get(obj.applicationComponent) ?? [];
      compArr.push(obj);
      byAppComponent.set(obj.applicationComponent, compArr);
    }
  }

  return {
    objectsMap,
    byType,
    byLevel,
    byAppComponent,
    loadedAt: new Date(),
    sourceId,
  };
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
