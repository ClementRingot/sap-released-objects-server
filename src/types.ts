// ============================================================================
// SAP Cloudification Repository - Type Definitions
// ============================================================================

/** Raw JSON structure from objectReleaseInfoLatest.json and PCE files */
export interface RawReleaseInfoFile {
  formatVersion: string;
  objectReleaseInfo: RawObjectEntry[];
}

/** Raw JSON structure from objectClassifications_SAP.json */
export interface RawClassificationsFile {
  formatVersion: string;
  objectReleaseInfo?: RawObjectEntry[];
  objectClassifications?: RawObjectEntry[];
}

/** Single object entry from SAP JSON files */
export interface RawObjectEntry {
  tadirObject: string;
  tadirObjName: string;
  objectType: string;
  objectKey: string;
  softwareComponent?: string;
  applicationComponent?: string;
  state: string;
  successorClassification?: string;
  successors?: RawSuccessor[];
  successorConceptName?: string;
}

/** Successor reference */
export interface RawSuccessor {
  tadirObject: string;
  tadirObjName: string;
  objectType: string;
  objectKey: string;
}

// ============================================================================
// Clean Core Level Concept (replaces 3-tier model since August 2025)
// ============================================================================

/**
 * Clean Core Level classification:
 * - A: Released APIs only (ABAP Cloud, upgrade-safe)
 * - B: Classic APIs (upgrade-stable, governance recommended)
 * - C: Internal objects, unclassified (risk manageable, changelog needed)
 * - D: noAPI objects (not Clean Core, remediate first)
 */
export type CleanCoreLevel = "A" | "B" | "C" | "D";

/**
 * SAP system type determines which JSON files are available.
 * - public_cloud: S/4HANA Cloud Public Edition (Level A only)
 * - btp: BTP ABAP Environment / Steampunk (Level A only, separate dataset)
 * - private_cloud: S/4HANA Cloud Private Edition (Levels A-D, versioned)
 * - on_premise: S/4HANA on-premise (Levels A-D, versioned)
 */
export type SystemType = "public_cloud" | "btp" | "private_cloud" | "on_premise";

/** Object states as they appear in JSON files, mapped to Clean Core Levels */
export type ObjectState =
  | "released"          // Level A
  | "deprecated"        // Was released, now deprecated (has successor)
  | "notToBeReleased"   // Level C (internal, unclassified)
  | "noAPI"             // Level D
  | "classicAPI"        // Level B
  | "stable";           // Level C (stable but not released)

// ============================================================================
// Normalized internal model
// ============================================================================

/** Normalized object after processing */
export interface SAPObject {
  /** TADIR object type (CLAS, INTF, DTEL, TABL, CDS, BDEF, SRVB, etc.) */
  objectType: string;
  /** Object name */
  objectName: string;
  /** Software component (SAP_BASIS, SAPSCORE, etc.) */
  softwareComponent: string;
  /** Application component (BC-DWB, MM-PUR, etc.) */
  applicationComponent: string;
  /** Raw state from JSON */
  state: string;
  /** Derived Clean Core Level */
  cleanCoreLevel: CleanCoreLevel;
  /** Source file this object came from */
  source: "released" | "classicApi";
  /** Successor info if available */
  successor?: SuccessorInfo;
}

/** Successor information */
export interface SuccessorInfo {
  classification: string;
  objects?: Array<{
    objectType: string;
    objectName: string;
  }>;
  conceptName?: string;
}

// ============================================================================
// Data store - in-memory indexed data
// ============================================================================

/** Pre-computed token index for an object (built once at data-load time) */
export interface IndexedObject {
  object: SAPObject;
  /** Tokens extracted from objectName */
  nameTokens: string[];
  /** Tokens extracted from applicationComponent */
  componentTokens: string[];
}

export interface DataStore {
  /** All objects indexed by "objectType:objectName" */
  objectsMap: Map<string, SAPObject>;
  /** Objects indexed by objectType for filtering */
  byType: Map<string, SAPObject[]>;
  /** Objects indexed by Clean Core Level */
  byLevel: Map<CleanCoreLevel, SAPObject[]>;
  /** Objects indexed by application component */
  byAppComponent: Map<string, SAPObject[]>;
  /** Pre-computed token index — all objects */
  allIndexed: IndexedObject[];
  /** Pre-computed token index — grouped by objectType */
  indexedByType: Map<string, IndexedObject[]>;
  /** Timestamp of last data load */
  loadedAt: Date;
  /** Source file identifier */
  sourceId: string;
}

/** Cache entry for loaded data */
export interface CacheEntry {
  store: DataStore;
  expiresAt: number;
}

/** GitHub Contents API response entry */
export interface GitHubContentEntry {
  name: string;
  type: string;
  size: number;
}

// ============================================================================
// Search/filter result types
// ============================================================================

// ============================================================================
// Search/filter result types
// ============================================================================

export interface SearchResult {
  total: number;
  count: number;
  offset: number;
  objects: SAPObject[];
  hasMore: boolean;
  nextOffset?: number;
  query: string;
  filters: Record<string, string>;
}

export interface ObjectStatistics {
  totalObjects: number;
  byLevel: Record<CleanCoreLevel, number>;
  byObjectType: Record<string, number>;
  byState: Record<string, number>;
  topApplicationComponents: Array<{ component: string; count: number }>;
  sourceFile: string;
}
