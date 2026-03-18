// ============================================================================
// SAP-aware tokenizer and scoring engine for multi-token search
// ============================================================================

import type { SAPObject, IndexedObject } from "../types.js";
import type { ExpandedToken } from "./abbreviation-dictionary.js";
import { findCompoundAbbreviation } from "./abbreviation-dictionary.js";

// Known technical prefixes to strip from SAP object names
const TECHNICAL_PREFIXES = new Set([
  "CL", "IF", "I", "C", "A", "D", "E", "R", "P", "ZCL", "ZIF", "X",
  "BAPI", "YCL", "YIF",
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
  mandatoryPrefix?: string;
} {
  const trimmed = query.trim();
  const isExactMode = /^[A-Z0-9_/]+$/.test(trimmed) && trimmed.length >= 2;

  // Detect technical prefix: if query starts with a known prefix followed by "_something"
  // or a space-separated equivalent (e.g., "BAPI MESSAGE GETDETAIL")
  // e.g., "BAPI_MATERIAL_GETLIST" → mandatoryPrefix = "BAPI_", scored only on ["material", "getlist"]
  // e.g., "CL_ABAP_REGEX"         → mandatoryPrefix = "CL_",   scored only on ["abap", "regex"]
  // e.g., "BAPI MESSAGE GETDETAIL" → mandatoryPrefix = "BAPI_", scored only on ["message", "getdetail"]
  let mandatoryPrefix: string | undefined;
  const prefixMatch = trimmed.match(/^([A-Za-z]+)[_\s](.+)/);
  if (prefixMatch) {
    const candidate = prefixMatch[1].toUpperCase();
    if (TECHNICAL_PREFIXES.has(candidate)) {
      mandatoryPrefix = candidate + "_";
    }
  }

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

  // Remove the prefix token from scoring — it becomes a mandatory filter instead
  if (mandatoryPrefix) {
    const prefixToken = mandatoryPrefix.slice(0, -1).toLowerCase(); // "BAPI_" → "bapi"
    const idx = tokens.indexOf(prefixToken);
    if (idx !== -1) tokens.splice(idx, 1);
  }

  // Fallback: if all tokens were filtered out, use the whole query
  if (tokens.length === 0 && trimmed.length > 0) {
    tokens.push(trimmed.toLowerCase());
  }

  return { tokens, isExactMode, mandatoryPrefix };
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
 * score = exactMatch            × 1000  (full objectName === query)
 *       + tokenMatches          × 10    (query token fully matches a name token)
 *       + abbreviationMatches   × 7     (query token matches via abbreviation dictionary)
 *       + partialTokenMatches   × 3     (query token ⊂ name token, or name token ⊂ query token if len ≥ 4)
 *       + prefixMatches         × 2     (query token shares a significant prefix with a name token)
 *       + componentMatch        × 5     (query token matches an applicationComponent segment)
 *       + nameContains          × 8     (raw query is a substring of objectName)
 *       + namePrefix            × 20    (objectName starts with the raw query — very strong signal)
 *       + compoundPrefix        × 25    (joined query tokens form a prefix of a name token)
 *       + compoundAbbreviation  × 18    (compound phrase ↔ abbreviation matches a name token)
 *       + compoundContains      × 15    (all query tokens found inside one name token, any order)
 *       + compoundPrefixFuzzy   × 12    (concatenated prefixes of query tokens match start of a name token)
 */
export interface ScoreResult {
  /** Final score after coverage penalty (used for sorting/filtering) */
  score: number;
  /** Ratio of matched query tokens vs total (1.0 = all matched) */
  coverage: number;
}

export function scoreObject(
  indexed: IndexedObject,
  queryTokens: string[],
  rawQuery: string,
  expandedTokens?: ExpandedToken[],
): ScoreResult {
  const { object, nameTokens, componentTokens } = indexed;
  const nameUpper = object.objectName.toUpperCase();
  const queryUpper = rawQuery.toUpperCase();

  // 1. Exact match on full object name (normalize separators: spaces ↔ underscores)
  const queryNormalized = queryUpper.replace(/[\s_/]+/g, "_");
  const nameNormalized = nameUpper.replace(/[\s_/]+/g, "_");
  const exactMatch = nameNormalized === queryNormalized ? 1 : 0;

  // 2. Token-level matching
  let tokenMatches = 0;
  let abbreviationMatches = 0;
  let partialTokenMatches = 0;
  let prefixMatches = 0;
  let componentMatch = 0;
  let matchedQueryTokens = 0;

  for (let qi = 0; qi < queryTokens.length; qi++) {
    const qt = queryTokens[qi];
    let fullMatch = false;
    let abbrMatch = false;
    let partialMatch = false;
    let prefixMatch = false;
    let anyMatch = false;

    for (const nt of nameTokens) {
      if (nt === qt) {
        fullMatch = true;
        anyMatch = true;
        break;
      } else if (nt.includes(qt)) {
        partialMatch = true;
        anyMatch = true;
      } else if (qt.includes(nt) && nt.length >= 4) {
        partialMatch = true;
        anyMatch = true;
      } else if (prefixSimilarity(qt, nt) >= 0.5) {
        prefixMatch = true;
        anyMatch = true;
      }
    }

    // Abbreviation matching: if no fullMatch and we have expanded tokens
    if (!fullMatch && expandedTokens && expandedTokens[qi]) {
      const alts = expandedTokens[qi].alternatives;
      if (alts.size > 0) {
        for (const alt of alts) {
          for (const nt of nameTokens) {
            if (nt === alt) {
              // Exact match via abbreviation
              abbrMatch = true;
              anyMatch = true;
              break;
            } else if (nt.includes(alt) && alt.length >= 3) {
              // Abbreviation contained in a concatenated name token
              abbrMatch = true;
              anyMatch = true;
            } else if (alt.includes(nt) && nt.length >= 4) {
              // Name token contained in the alternative
              abbrMatch = true;
              anyMatch = true;
            }
          }
          if (abbrMatch) break;
        }
      }
    }

    if (fullMatch) {
      tokenMatches++;
    } else if (abbrMatch) {
      abbreviationMatches++;
    } else if (partialMatch) {
      partialTokenMatches++;
    } else if (prefixMatch) {
      prefixMatches++;
    }

    // Component-level matching (with same length guard for reverse containment)
    for (const ct of componentTokens) {
      if (ct === qt || ct.includes(qt) || (qt.includes(ct) && ct.length >= 4)) {
        componentMatch++;
        if (!anyMatch) anyMatch = true;
        break;
      }
    }

    if (anyMatch) matchedQueryTokens++;
  }

  // 3. Raw query substring in object name (normalize separators)
  const nameContains =
    nameUpper.includes(queryUpper) || nameNormalized.includes(queryNormalized)
      ? 1
      : 0;

  // 4. Object name starts with raw query (very strong signal for SAP name queries)
  const namePrefix =
    nameUpper.startsWith(queryUpper) || nameNormalized.startsWith(queryNormalized)
      ? 1
      : 0;

  // 5. Compound word matching
  let compoundPrefix = 0;
  let compoundContains = 0;
  let compoundPrefixFuzzy = 0;
  let compoundAbbreviation = 0;

  if (queryTokens.length > 1) {
    const joinedQuery = queryTokens.join("");

    for (const nt of nameTokens) {
      if (nt.startsWith(joinedQuery)) {
        compoundPrefix = 1;
        break;
      }
    }

    if (!compoundPrefix) {
      for (const nt of nameTokens) {
        if (queryTokens.every((qt) => nt.includes(qt))) {
          compoundContains = 1;
          break;
        }
      }
    }

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

    // 5b. Compound abbreviation matching (requires expanded tokens)
    //     Exclusive with compoundPrefixFuzzy — take the stronger signal, not both.
    //     Without this guard, fuzzy(12) + abbreviation(18) = 30 beats exact compoundPrefix(25),
    //     causing e.g. I_PURCHASEORDITMTRANSPSETTLMT (44) to outrank I_PURCHASEORDERAPI01 (39).
    if (!compoundPrefix && !compoundContains && !compoundPrefixFuzzy && expandedTokens) {
      // Check if query tokens form a known compound phrase → abbreviation
      const compound = findCompoundAbbreviation(queryTokens, 0);
      if (compound) {
        for (const abbr of compound.abbreviations) {
          for (const nt of nameTokens) {
            if (nt === abbr || nt.startsWith(abbr)) {
              compoundAbbreviation = 1;
              break;
            }
          }
          if (compoundAbbreviation) break;
        }
      }

      // Cross-alternative compound: combine alternatives of first 2 tokens
      if (!compoundAbbreviation && expandedTokens.length >= 2) {
        const alts0 = [expandedTokens[0].original, ...expandedTokens[0].alternatives];
        const alts1 = [expandedTokens[1].original, ...expandedTokens[1].alternatives];

        outerAbbr:
        for (const a0 of alts0) {
          for (const a1 of alts1) {
            const combined = a0 + a1;
            for (const nt of nameTokens) {
              if (nt.startsWith(combined)) {
                compoundAbbreviation = 1;
                break outerAbbr;
              }
            }
          }
        }
      }
    }
  }

  // 6. Compound matches imply token coverage — but CORRECTLY:
  //    - compoundPrefix/compoundContains use ALL queryTokens → full coverage
  //    - compoundPrefixFuzzy only uses tokens[0] and tokens[1] → credit only 2
  //    - compoundAbbreviation uses tokens[0] and tokens[1] → credit only 2
  //    - nameContains/namePrefix imply the raw query appears → full coverage
  //
  //    BUG FIX: Previously compoundPrefixFuzzy forced matchedQueryTokens = queryTokens.length
  //    which meant "purchase order banana" vs I_PURORDSCHEDGLINE got 100% coverage
  //    even though "banana" matched nothing.
  if (nameContains || namePrefix || compoundPrefix || compoundContains) {
    matchedQueryTokens = queryTokens.length;
  } else if (compoundPrefixFuzzy || compoundAbbreviation) {
    matchedQueryTokens = Math.max(matchedQueryTokens, 2);
  }

  // 7. Compute raw score
  let rawScore =
    exactMatch * 1000 +
    tokenMatches * 10 +
    abbreviationMatches * 7 +
    partialTokenMatches * 3 +
    prefixMatches * 2 +
    componentMatch * 5 +
    nameContains * 8 +
    namePrefix * 20 +
    compoundPrefix * 25 +
    compoundAbbreviation * 18 +
    compoundContains * 15 +
    compoundPrefixFuzzy * 12;

  // 8. Coverage ratio and penalty
  const coverage =
    queryTokens.length >= 2
      ? matchedQueryTokens / queryTokens.length
      : 1;

  if (coverage < 1) {
    rawScore = Math.round(rawScore * coverage);
  }

  return { score: rawScore, coverage };
}
