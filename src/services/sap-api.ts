// ============================================================================
// SAP API Service
// Fetches object descriptions from api.sap.com OData endpoints
// ============================================================================

import https from "node:https";
import type { SAPApiDescription, SAPApiField, SystemType } from "../types.js";
import {
  SAP_API_ODATA_BASE,
  ODATA_ENTITY_MAP,
  PCE_PREFIX_TYPES,
  CACHE_TTL_MS,
} from "../constants.js";

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const descriptionCache = new Map<string, { data: SAPApiDescription; expiresAt: number }>();

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Apply PCE_ prefix for private_cloud / on_premise lookups.
 * Only applies to object types in PCE_PREFIX_TYPES.
 * Does not double-prefix if already prefixed.
 */
export function getEffectiveName(
  name: string,
  objectType: string,
  systemType: SystemType
): string {
  const upper = name.toUpperCase();
  const typeUpper = objectType.toUpperCase();

  if (
    (systemType === "private_cloud" || systemType === "on_premise") &&
    PCE_PREFIX_TYPES.has(typeUpper) &&
    !upper.startsWith("PCE_")
  ) {
    return `PCE_${upper}`;
  }

  return upper;
}

/**
 * Build the OData URLs for fetching object descriptions.
 * Returns null if the object type is not supported.
 */
export function buildDescriptionUrls(
  objectType: string,
  effectiveName: string
): { valueUrl: string; metadataUrl: string; spaUrl: string } | null {
  const typeUpper = objectType.toUpperCase();
  const mapping = ODATA_ENTITY_MAP[typeUpper];

  if (!mapping) return null;

  const encodedName = encodeURIComponent(effectiveName);
  const entityPath = `${mapping.entitySet}('${encodedName}')`;

  return {
    valueUrl: `${SAP_API_ODATA_BASE}/${entityPath}/$value`,
    metadataUrl: `${SAP_API_ODATA_BASE}/${entityPath}?$format=json`,
    spaUrl: `https://api.sap.com/${mapping.spaPath}/${effectiveName}`,
  };
}

/**
 * Strip HTML tags from a string, collapse whitespace.
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the `/$value` response into SAPApiDescription.
 * The `/$value` response is a JSON object with fields like:
 * ddlsourcename, cdsviewname, cdsviewtitle, status, fields[], etc.
 */
export function parseValueResponse(
  raw: Record<string, unknown>,
  spaUrl: string
): SAPApiDescription {
  const fields: SAPApiField[] = [];

  if (Array.isArray(raw.fields)) {
    for (const f of raw.fields) {
      if (f && typeof f === "object") {
        const fObj = f as Record<string, unknown>;
        fields.push({
          fieldname: String(fObj.fieldname ?? fObj.FIELDNAME ?? ""),
          description: String(fObj.description ?? fObj.DESCRIPTION ?? ""),
          datatype: String(fObj.datatype ?? fObj.DATATYPE ?? ""),
          fieldlength: String(fObj.fieldlength ?? fObj.FIELDLENGTH ?? ""),
          successor: String(fObj.successor ?? fObj.SUCCESSOR ?? ""),
        });
      }
    }
  }

  // Extract capabilities from various possible formats
  const capabilities = extractCapabilities(raw);

  return {
    technicalName: String(raw.ddlsourcename ?? raw.routeId ?? raw.TechnicalName ?? ""),
    displayName: String(raw.cdsviewname ?? raw.DisplayName ?? ""),
    title: String(raw.cdsviewtitle ?? raw.sotname ?? raw.Title ?? ""),
    description: stripHtml(String(raw.description ?? raw.Description ?? "")),
    status: String(raw.status ?? raw.State ?? ""),
    lineOfBusiness: String(raw.lineofbusiness ?? raw.LineOfBusiness ?? ""),
    applicationComponent: String(raw.applicationcomponent ?? raw.ApplicationComponent ?? ""),
    category: String(raw.category ?? raw.Category ?? ""),
    capabilities,
    keyUserExtensibility: String(raw.keyuserext ?? raw.ExtensibleWithKeyUserExtensibility ?? ""),
    developerExtensibility: String(raw.devext ?? raw.ExtensibleWithDeveloperExtensibility ?? ""),
    fields,
    documentationLink: String(raw.cdsdoclink ?? raw.businessdoclink ?? ""),
    spaUrl,
    source: "full",
  };
}

/**
 * Parse the `?$format=json` OData response into SAPApiDescription.
 * The response is wrapped in a `d` object with OData metadata.
 */
export function parseMetadataResponse(
  raw: Record<string, unknown>,
  spaUrl: string
): SAPApiDescription {
  // Unwrap OData `d` wrapper
  const d = (raw.d ?? raw) as Record<string, unknown>;

  const capabilities = extractCapabilities(d);

  return {
    technicalName: String(d.TechnicalName ?? ""),
    displayName: String(d.DisplayName ?? ""),
    title: String(d.Description ?? ""),
    description: String(d.Description ?? ""),
    status: String(d.State ?? ""),
    lineOfBusiness: "",
    applicationComponent: "",
    category: String(d.Category ?? ""),
    capabilities,
    keyUserExtensibility: String(d.ExtensibleWithKeyUserExtensibility ?? ""),
    developerExtensibility: String(d.ExtensibleWithDeveloperExtensibility ?? ""),
    fields: [],
    documentationLink: "",
    spaUrl,
    source: "metadata",
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract capabilities from a response object.
 * Handles both comma-separated strings and arrays.
 */
function extractCapabilities(obj: Record<string, unknown>): string[] {
  const raw = obj.Capabilities ?? obj.capabilities;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }

  if (typeof raw === "string") {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return [];
}

/**
 * Fetch a URL and return the body as a string.
 * Returns null if the response is not JSON (e.g. auth redirect HTML).
 */
function fetchUrl(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      {
        headers: { Accept: "application/json" },
        rejectUnauthorized: false,
      },
      (res) => {
        // Handle redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchUrl(res.headers.location).then(resolve, reject);
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
        res.on("error", reject);
      }
    ).on("error", reject);
  });
}

/**
 * Check if a response body is an HTML auth redirect (not JSON).
 */
function isAuthRedirect(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith("<html") || trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<HTML");
}

// ---------------------------------------------------------------------------
// Main async function
// ---------------------------------------------------------------------------

/**
 * Fetch an object description from api.sap.com.
 * Tries `/$value` first (full data with fields), falls back to `?$format=json`.
 * Results are cached for CACHE_TTL_MS.
 */
export async function fetchObjectDescription(
  objectType: string,
  objectName: string,
  systemType: SystemType
): Promise<SAPApiDescription> {
  const typeUpper = objectType.toUpperCase();
  const effectiveName = getEffectiveName(objectName, typeUpper, systemType);

  const urls = buildDescriptionUrls(typeUpper, effectiveName);
  if (!urls) {
    const supported = Object.keys(ODATA_ENTITY_MAP).join(", ");
    throw new Error(
      `Object type '${typeUpper}' is not supported for description lookup. ` +
      `Supported types: ${supported}.`
    );
  }

  // Check cache
  const cacheKey = `${typeUpper}:${effectiveName}`;
  const cached = descriptionCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // Strategy: try /$value first (full data), fall back to ?$format=json (metadata only)
  let result: SAPApiDescription | null = null;

  // Attempt 1: /$value (full response with fields)
  try {
    console.error(`[SAPApi] Trying /$value: ${urls.valueUrl}`);
    const resp = await fetchUrl(urls.valueUrl);

    if (resp.statusCode >= 200 && resp.statusCode < 300 && !isAuthRedirect(resp.body)) {
      const parsed = JSON.parse(resp.body) as Record<string, unknown>;
      result = parseValueResponse(parsed, urls.spaUrl);
      console.error(`[SAPApi] Got full response for ${effectiveName}`);
    } else {
      console.error(`[SAPApi] /$value returned ${resp.statusCode} or auth redirect, trying metadata`);
    }
  } catch (err) {
    console.error(
      `[SAPApi] /$value failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Attempt 2: ?$format=json (metadata only, no fields)
  if (!result) {
    try {
      console.error(`[SAPApi] Trying metadata: ${urls.metadataUrl}`);
      const resp = await fetchUrl(urls.metadataUrl);

      if (resp.statusCode >= 200 && resp.statusCode < 300 && !isAuthRedirect(resp.body)) {
        const parsed = JSON.parse(resp.body) as Record<string, unknown>;
        result = parseMetadataResponse(parsed, urls.spaUrl);
        console.error(`[SAPApi] Got metadata response for ${effectiveName}`);
      } else {
        throw new Error(
          `API returned status ${resp.statusCode}` +
          (isAuthRedirect(resp.body) ? " (authentication required)" : "")
        );
      }
    } catch (err) {
      throw new Error(
        `Could not fetch description for ${typeUpper} ${effectiveName} from api.sap.com. ` +
        `You can view it manually at: ${urls.spaUrl}\n` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Cache the result
  descriptionCache.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}
