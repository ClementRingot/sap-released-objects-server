// ============================================================================
// Shared Zod Schemas for MCP Tools
// ============================================================================

import { z } from "zod";

/**
 * System type determines data source and available Clean Core Levels.
 */
export const SystemTypeSchema = z
  .enum(["public_cloud", "btp", "private_cloud", "on_premise"])
  .default("public_cloud")
  .describe(
    "SAP system type. " +
      "'public_cloud' = S/4HANA Cloud Public Edition (Level A Released APIs only). " +
      "'btp' = BTP ABAP Environment / Steampunk (Level A Released APIs only, separate dataset from public_cloud). " +
      "'private_cloud' = S/4HANA Cloud Private Edition (Levels A-D, version-specific files available). " +
      "'on_premise' = S/4HANA on-premise (Levels A-D, version-specific files available). " +
      "Default: public_cloud."
  );

/**
 * Clean Core Level target (A/B/C/D).
 * Replaces the 3-tier extensibility model since August 2025.
 * The filter is cumulative: Level B includes A+B, Level C includes A+B+C, etc.
 */
export const CleanCoreLevelSchema = z
  .enum(["A", "B", "C", "D"])
  .default("A")
  .describe(
    "Maximum Clean Core Level to include in results (cumulative). " +
      "Replaces the 3-tier extensibility model since August 2025. " +
      "Level A: Released APIs only (ABAP Cloud, fully upgrade-safe). " +
      "Level B: + Classic APIs (upgrade-stable, governance recommended). " +
      "Level C: + Internal/unclassified objects (manageable risk, consult changelog). " +
      "Level D: + noAPI objects (not Clean Core, should be remediated). " +
      "For public_cloud and btp systems, only Level A is available. " +
      "Default: A."
  );

/**
 * PCE version for Private Cloud / On-Premise systems.
 */
export const VersionSchema = z
  .string()
  .default("latest")
  .describe(
    "S/4HANA version for Private Cloud or On-Premise systems. " +
      "Use 'latest' for the most recent version. " +
      "Format: YEAR for base release, or YEAR_FPS where FPS is the Feature Pack Stack / SP number. " +
      "IMPORTANT: '2022_1' = FPS01/SP01, '2023_3' = FPS03/SP03, etc. " +
      "Always use the YEAR_N format when a specific SP/FPS is requested. " +
      "Use sap_list_versions to see all currently available versions. " +
      "Ignored for public_cloud and btp systems. Default: latest."
  );

/**
 * Search query string.
 */
export const QuerySchema = z
  .string()
  .min(1, "Query must not be empty")
  .max(200, "Query must not exceed 200 characters")
  .describe(
    "Search string to match against object names (case-insensitive). " +
      "Examples: 'I_PRODUCT', 'CL_ABAP', 'MARA', 'BAPI_MATERIAL'."
  );

/**
 * Optional object type filter.
 */
export const ObjectTypeFilterSchema = z
  .string()
  .optional()
  .describe(
    "Filter by TADIR object type. " +
      "Common types: CLAS (Class), INTF (Interface), DDLS (CDS View), " +
      "TABL (Table/Structure), DTEL (Data Element), FUGR (Function Group), " +
      "BDEF (RAP Behavior Definition), SRVB (Service Binding), SRVD (Service Definition), " +
      "DDLX (Metadata Extension), EVTB (RAP Event Binding). " +
      "Leave empty to search all types."
  );

/**
 * Optional application component filter.
 */
export const AppComponentFilterSchema = z
  .string()
  .optional()
  .describe(
    "Filter by SAP application component prefix (case-insensitive, partial match). " +
      "Examples: 'MM-PUR' (Purchasing), 'FI-GL' (General Ledger), 'SD-SLS' (Sales), " +
      "'BC-SRV' (Basis Services), 'EWM' (Extended Warehouse Management). " +
      "Leave empty to search all components."
  );

/**
 * Pagination: limit.
 */
export const LimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe("Maximum number of results to return (1-100). Default: 25.");

/**
 * Pagination: offset.
 */
export const OffsetSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Number of results to skip for pagination. Default: 0.");

/**
 * State filter.
 */
export const StateFilterSchema = z
  .enum(["released", "deprecated", "classicAPI", "notToBeReleased", "noAPI", "stable"])
  .optional()
  .describe(
    "Filter by specific object state. " +
      "'released' = Level A, publicly released APIs. " +
      "'deprecated' = Was released, now deprecated (usually has a successor). " +
      "'classicAPI' = Level B, classic but upgrade-stable. " +
      "'notToBeReleased' = Level C, internal object. " +
      "'noAPI' = Level D, not recommended. " +
      "'stable' = Level C, stable but without release contract. " +
      "Leave empty to include all states within the selected Clean Core Level."
  );
