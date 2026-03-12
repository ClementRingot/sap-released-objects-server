// ============================================================================
// SAP Cloudification Repository - Constants
// ============================================================================

/** Base URL for raw GitHub content */
const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src";

// ---------------------------------------------------------------------------
// Level A - Released APIs
// ---------------------------------------------------------------------------

/** Public Cloud / BTP - always uses latest */
export const RELEASED_LATEST_URL = `${GITHUB_RAW_BASE}/objectReleaseInfoLatest.json`;

/** Private Cloud / On-Premise - latest version */
export const RELEASED_PCE_LATEST_URL = `${GITHUB_RAW_BASE}/objectReleaseInfo_PCELatest.json`;

/**
 * Build URL for a specific Private Cloud / On-Premise version.
 * Format: objectReleaseInfo_PCE{year}_{fps}.json
 * Examples: PCE2022, PCE2023_0, PCE2023_3, PCE2025
 */
export function getReleasedPCEVersionURL(version: string): string {
  return `${GITHUB_RAW_BASE}/objectReleaseInfo_PCE${version}.json`;
}

// ---------------------------------------------------------------------------
// Level B - Classic APIs (Private Cloud / On-Premise only)
// ---------------------------------------------------------------------------

/** New format for ATC check 3565942 */
export const CLASSIC_API_SAP_URL = `${GITHUB_RAW_BASE}/objectClassifications_SAP.json`;

/** Legacy format (still valid for older ATC checks) */
export const CLASSIC_API_3TIER_URL = `${GITHUB_RAW_BASE}/objectClassifications_3TierModel.json`;

/** Original legacy format */
export const CLASSIC_API_LEGACY_URL = `${GITHUB_RAW_BASE}/objectClassifications.json`;

// ---------------------------------------------------------------------------
// Known PCE versions available in the repository
// ---------------------------------------------------------------------------

export const FALLBACK_PCE_VERSIONS = [
  "2022",
  "2022_1",
  "2022_2",
  "2023_0",
  "2023_1",
  "2023_2",
  "2023_3",
  "2025_0",
  "2025_1",
] as const;

export type PCEVersion = (typeof FALLBACK_PCE_VERSIONS)[number] | "latest";

// ---------------------------------------------------------------------------
// State → Clean Core Level mapping
// ---------------------------------------------------------------------------

import type { CleanCoreLevel } from "./types.js";

/**
 * Maps raw object states from JSON to Clean Core Levels.
 * - released → A (publicly released, upgrade-safe)
 * - deprecated → A (was released, has successor — still Level A context)
 * - classicAPI → B (classic but upgrade-stable)
 * - stable → C (stable but not released, no formal contract)
 * - notToBeReleased → C (internal, unclassified)
 * - noAPI → D (not recommended, not Clean Core)
 */
export const STATE_TO_LEVEL: Record<string, CleanCoreLevel> = {
  released: "A",
  deprecated: "A",
  classicAPI: "B",
  stable: "C",
  notToBeReleased: "C",
  noAPI: "D",
};

/** Default level for unknown states */
export const DEFAULT_LEVEL: CleanCoreLevel = "C";

// ---------------------------------------------------------------------------
// Known TADIR object types with descriptions
// ---------------------------------------------------------------------------

export const OBJECT_TYPE_DESCRIPTIONS: Record<string, string> = {
  BDEF: "Behavior Definition (RAP)",
  CLAS: "ABAP Class",
  CDS: "CDS Entity (Core Data Services)",
  DDLS: "Data Definition Language Source (CDS View)",
  DDLX: "CDS Metadata Extension",
  DTEL: "Data Element",
  DOMA: "Domain",
  ENHO: "Enhancement Implementation",
  ENHS: "Enhancement Spot",
  FUGR: "Function Group",
  FUNC: "Function Module",
  INTF: "ABAP Interface",
  MSAG: "Message Class",
  NROB: "Number Range Object",
  PARA: "SPA/GPA Parameter",
  PROG: "ABAP Program",
  SMIM: "MIME Object",
  SRVB: "Service Binding",
  SRVD: "Service Definition",
  SUSO: "Authorization Object",
  TABL: "Database Table / Structure",
  TTYP: "Table Type",
  TYPE: "Type Group",
  XSLT: "XSLT Transformation",
  CHKV: "ATC Check Variant",
  AUTH: "Authorization Field",
  SCP1: "Business Configuration Object",
  DEVC: "Package",
  NSPC: "Namespace",
  SAJC: "Application Job Catalog Entry",
  SAJT: "Application Job Template",
  EVTB: "RAP Business Event Binding",
  SMBC: "Business Configuration Maintenance Object",
};

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

/** Cache TTL in milliseconds (1 hour) */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/** Maximum results per search query */
export const MAX_RESULTS = 100;

/** Default results per search query */
export const DEFAULT_LIMIT = 25;

/** Character limit for text responses */
export const CHARACTER_LIMIT = 50000;
