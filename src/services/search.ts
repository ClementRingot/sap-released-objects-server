// ============================================================================
// SAP-aware tokenizer and scoring engine for multi-token search
// ============================================================================

import type { SAPObject, IndexedObject } from "../types.js";

// Known technical prefixes to strip from SAP object names
const TECHNICAL_PREFIXES = new Set([
  "CL", "IF", "I", "C", "A", "D", "E", "R", "P", "ZCL", "ZIF", "X",
]);

// ---------------------------------------------------------------------------
// camelCase splitter
// ---------------------------------------------------------------------------

/**
 * Split a string on camelCase boundaries.
 * "PurchaseOrder" → ["Purchase", "Order"]
 * "XMLParser"     → ["XML", "Parser"]
 * All-uppercase or all-lowercase strings are returned as a single element.
 */
function splitCamelCase(str: string): string[] {
  if (str.length <= 1) return [str];
  if (str === str.toUpperCase() || str === str.toLowerCase()) return [str];

  const result: string[] = [];
  let current = str[0];

  for (let i = 1; i < str.length; i++) {
    const ch = str[i];
    const prev = str[i - 1];

    const isChUpper = ch !== ch.toLowerCase() && ch === ch.toUpperCase();
    const isPrevLower = prev !== prev.toUpperCase() && prev === prev.toLowerCase();

    if (isPrevLower && isChUpper) {
      // lowercase → Uppercase transition: "aB" → split before B
      result.push(current);
      current = ch;
    } else if (
      current.length > 1 &&
      i >= 2 &&
      str[i - 2] !== str[i - 2].toLowerCase() && str[i - 2] === str[i - 2].toUpperCase() &&
      prev !== prev.toLowerCase() && prev === prev.toUpperCase() &&
      ch !== ch.toUpperCase() && ch === ch.toLowerCase()
    ) {
      // Uppercase sequence followed by lowercase: "ABc" → "A" + "Bc"
      result.push(current.slice(0, -1));
      current = prev + ch;
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// SAP object name tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a SAP object name into meaningful lowercase tokens.
 *
 * Examples:
 *   I_PURCHASEORDERITEM         → [purchaseorderitem]
 *   CL_BCS_SEND_REQUEST         → [bcs, send, request]
 *   /SCWM/CL_WM_PACKING         → [scwm, wm, packing]
 *   D_SUPLSTPRPSDCCPRPOSTODELCCP → [suplstprpsdccprpostodelccp]
 */
export function tokenizeSAPName(name: string): string[] {
  const tokens: string[] = [];
  let workingName = name;

  // Extract namespace prefix: /SCWM/... → token "scwm"
  const nsMatch = workingName.match(/^\/([^/]+)\/(.*)/);
  if (nsMatch) {
    const ns = nsMatch[1].toLowerCase();
    if (ns.length > 1) tokens.push(ns);
    workingName = nsMatch[2];
  }

  // Split on underscores and slashes
  const parts = workingName.split(/[_/]/).filter((p) => p.length > 0);

  // Strip known technical prefix (first segment only, only if there are more segments)
  let startIdx = 0;
  if (parts.length > 1 && TECHNICAL_PREFIXES.has(parts[0].toUpperCase())) {
    startIdx = 1;
  }

  for (let i = startIdx; i < parts.length; i++) {
    for (const sub of splitCamelCase(parts[i])) {
      const lower = sub.toLowerCase();
      // Drop single-character and purely numeric tokens
      if (lower.length > 1 && !/^\d+$/.test(lower)) {
        tokens.push(lower);
      }
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Application component tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize an application component string.
 * "MM-PUR-PO" → ["mm", "pur", "po"]
 */
export function tokenizeComponent(component: string): string[] {
  if (!component) return [];
  return component
    .split("-")
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length > 1);
}

// ---------------------------------------------------------------------------
// Query tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a user search query.
 *
 * - Splits on spaces, underscores, and camelCase boundaries
 * - Lowercases everything
 * - Flags "exact mode" when the query looks like a SAP object name
 *   (all uppercase + underscores/digits/slashes)
 */
export function tokenizeQuery(query: string): {
  tokens: string[];
  isExactMode: boolean;
} {
  const trimmed = query.trim();
  const isExactMode = /^[A-Z0-9_/]+$/.test(trimmed) && trimmed.length >= 2;

  const parts = trimmed.split(/[\s_/]+/).filter((p) => p.length > 0);
  const tokens: string[] = [];

  for (const part of parts) {
    for (const sub of splitCamelCase(part)) {
      const lower = sub.toLowerCase();
      if (lower.length > 1 && !/^\d+$/.test(lower)) {
        tokens.push(lower);
      }
    }
  }

  // Fallback: if all tokens were filtered out, use the whole query
  if (tokens.length === 0 && trimmed.length > 0) {
    tokens.push(trimmed.toLowerCase());
  }

  return { tokens, isExactMode };
}

// ---------------------------------------------------------------------------
// Prefix similarity helpers
// ---------------------------------------------------------------------------

/**
 * Return the length of the longest common prefix of two strings.
 */
export function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Compute prefix similarity between two tokens.
 * Returns the common prefix length divided by the shorter token's length,
 * or 0 if the common prefix is fewer than 3 characters.
 */
export function prefixSimilarity(a: string, b: string): number {
  const prefixLen = commonPrefixLength(a, b);
  if (prefixLen < 3) return 0;
  return prefixLen / Math.min(a.length, b.length);
}

// ---------------------------------------------------------------------------
// Scoring algorithm
// ---------------------------------------------------------------------------

/**
 * Score an indexed object against the parsed query.
 *
 * score = exactMatch          × 1000  (full objectName === query)
 *       + tokenMatches        × 10    (query token fully matches a name token)
 *       + partialTokenMatches × 3     (query token ⊂ name token, or name token ⊂ query token if len ≥ 4)
 *       + prefixMatches       × 2     (query token shares a significant prefix with a name token)
 *       + componentMatch      × 5     (query token matches an applicationComponent segment)
 *       + nameContains        × 8     (raw query is a substring of objectName)
 *       + namePrefix          × 20    (objectName starts with the raw query — very strong signal)
 *       + compoundPrefix      × 25    (joined query tokens form a prefix of a name token)
 *       + compoundContains    × 15    (all query tokens found inside one name token, any order)
 *       + compoundPrefixFuzzy × 12    (concatenated prefixes of query tokens match start of a name token)
 */
export function scoreObject(
  indexed: IndexedObject,
  queryTokens: string[],
  rawQuery: string,
): number {
  const { object, nameTokens, componentTokens } = indexed;
  const nameUpper = object.objectName.toUpperCase();
  const queryUpper = rawQuery.toUpperCase();

  // 1. Exact match on full object name
  const exactMatch = nameUpper === queryUpper ? 1 : 0;

  // 2. Token-level matching
  let tokenMatches = 0;
  let partialTokenMatches = 0;
  let prefixMatches = 0;
  let componentMatch = 0;

  for (const qt of queryTokens) {
    let fullMatch = false;
    let partialMatch = false;
    let prefixMatch = false;

    for (const nt of nameTokens) {
      if (nt === qt) {
        fullMatch = true;
        break;
      } else if (nt.includes(qt)) {
        // Name token contains query token (e.g. "handlingunitheader" contains "handlingunit")
        partialMatch = true;
      } else if (qt.includes(nt) && nt.length >= 4) {
        // Query token contains name token, but only if the name token is long enough.
        // This prevents spurious matches like "it" (2 chars) inside "handlingunit".
        partialMatch = true;
      } else if (prefixSimilarity(qt, nt) >= 0.5) {
        // Tokens share a significant prefix (e.g. "physical" / "phys", "purchase" / "purch")
        prefixMatch = true;
      }
    }

    if (fullMatch) {
      tokenMatches++;
    } else if (partialMatch) {
      partialTokenMatches++;
    } else if (prefixMatch) {
      prefixMatches++;
    }

    // Component-level matching (with same length guard for reverse containment)
    for (const ct of componentTokens) {
      if (ct === qt || ct.includes(qt) || (qt.includes(ct) && ct.length >= 4)) {
        componentMatch++;
        break;
      }
    }
  }

  // 3. Raw query substring in object name
  const nameContains = nameUpper.includes(queryUpper) ? 1 : 0;

  // 4. Object name starts with raw query (very strong signal for SAP name queries)
  const namePrefix = nameUpper.startsWith(queryUpper) ? 1 : 0;

  // 5. Compound word matching: query tokens joined together match inside a
  //    single name token. SAP often concatenates words without separators
  //    (e.g. I_HANDLINGUNITHEADER → token "handlingunitheader").
  //    Query "handling unit" → joined "handlingunit" → prefix of "handlingunitheader".
  let compoundPrefix = 0;
  let compoundContains = 0;

  let compoundPrefixFuzzy = 0;

  if (queryTokens.length > 1) {
    const joinedQuery = queryTokens.join("");

    for (const nt of nameTokens) {
      if (nt.startsWith(joinedQuery)) {
        compoundPrefix = 1;
        break;
      }
    }

    // Order-independent: all query tokens found inside one name token
    if (!compoundPrefix) {
      for (const nt of nameTokens) {
        if (queryTokens.every((qt) => nt.includes(qt))) {
          compoundContains = 1;
          break;
        }
      }
    }

    // Fuzzy compound prefix: try concatenating progressively shorter prefixes
    // of each query token and check if a name token starts with the result.
    // Handles SAP abbreviation patterns like PHYSICALINVENTORY → PHYSINVTRY,
    // PURCHASEORDER → PURCHORD.
    if (!compoundPrefix && !compoundContains) {
      outer:
      for (const nt of nameTokens) {
        for (let len1 = queryTokens[0].length; len1 >= 3; len1--) {
          for (let len2 = queryTokens[1].length; len2 >= 3; len2--) {
            const prefix = queryTokens[0].slice(0, len1) + queryTokens[1].slice(0, len2);
            if (nt.startsWith(prefix)) {
              compoundPrefixFuzzy = 1;
              break outer;
            }
          }
        }
      }
    }
  }

  return (
    exactMatch * 1000 +
    tokenMatches * 10 +
    partialTokenMatches * 3 +
    prefixMatches * 2 +
    componentMatch * 5 +
    nameContains * 8 +
    namePrefix * 20 +
    compoundPrefix * 25 +
    compoundContains * 15 +
    compoundPrefixFuzzy * 12
  );
}
