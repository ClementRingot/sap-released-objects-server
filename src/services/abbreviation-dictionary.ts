// ============================================================================
// SAP Abbreviation Dictionary — expansion engine for search
// ============================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpandedToken {
  /** The original query token (lowercase) */
  original: string;
  /** Alternative forms: abbreviations if original is a word, or words if original is an abbreviation */
  alternatives: Set<string>;
}

interface DictionaryJson {
  abbreviation_to_word: Record<string, string>;
  word_to_abbreviations: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Lookup maps (built once at load time)
// ---------------------------------------------------------------------------

/** word (lowercase) → abbreviation(s) (lowercase) */
const wordToAbbreviations = new Map<string, string[]>();

/** abbreviation (lowercase) → word(s) (lowercase) */
const abbreviationToWords = new Map<string, string[]>();

/** compound phrase (lowercase, space-separated) → abbreviation(s) (lowercase) */
const compoundToAbbreviations = new Map<string, string[]>();

/** abbreviation (lowercase) → compound word sequences */
const abbreviationToCompound = new Map<string, string[][]>();

let loaded = false;

// ---------------------------------------------------------------------------
// Dictionary loading
// ---------------------------------------------------------------------------

/**
 * Load the abbreviation dictionary JSON once. Safe to call multiple times.
 * On failure (file not found), logs a warning and leaves maps empty.
 */
export function loadAbbreviationDictionary(): void {
  if (loaded) return;
  loaded = true;

  let json: DictionaryJson | null = null;
  const candidatePaths: string[] = [];

  try {
    // Determine __dirname equivalent for ESM
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);

    // Candidate paths for the JSON file:
    // 1. Project root (dev / test: src/services/ → ../../)
    // 2. Dist folder (dist/services/ → ../../)
    // 3. Bundle folder (bundle/ → ../)
    candidatePaths.push(
      join(thisDir, "..", "..", "sap_abbreviation_dictionary.json"),
      join(thisDir, "..", "sap_abbreviation_dictionary.json"),
      join(thisDir, "sap_abbreviation_dictionary.json"),
    );
  } catch {
    // fileURLToPath may fail in bundled contexts — try __dirname fallback
    try {
      candidatePaths.push(
        join(__dirname, "..", "..", "sap_abbreviation_dictionary.json"),
        join(__dirname, "..", "sap_abbreviation_dictionary.json"),
        join(__dirname, "sap_abbreviation_dictionary.json"),
      );
    } catch {
      // No path resolution possible
    }
  }

  for (const p of candidatePaths) {
    try {
      const raw = readFileSync(p, "utf-8");
      json = JSON.parse(raw) as DictionaryJson;
      break;
    } catch {
      // Try next path
    }
  }

  if (!json) {
    console.warn(
      "[abbreviation-dictionary] Dictionary file not found. Abbreviation expansion disabled.",
    );
    return;
  }

  // Build wordToAbbreviations and abbreviationToWords from word_to_abbreviations
  if (json.word_to_abbreviations) {
    for (const [word, abbrs] of Object.entries(json.word_to_abbreviations)) {
      const wordLower = word.toLowerCase();
      const abbrsLower = abbrs.map((a) => a.toLowerCase());
      wordToAbbreviations.set(wordLower, abbrsLower);

      for (const abbr of abbrsLower) {
        const existing = abbreviationToWords.get(abbr);
        if (existing) {
          if (!existing.includes(wordLower)) existing.push(wordLower);
        } else {
          abbreviationToWords.set(abbr, [wordLower]);
        }
      }
    }
  }

  // Build compound maps from abbreviation_to_word (multi-word values)
  if (json.abbreviation_to_word) {
    for (const [abbr, phrase] of Object.entries(json.abbreviation_to_word)) {
      const abbrLower = abbr.toLowerCase();
      const words = phrase
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0);

      if (words.length >= 2) {
        // This is a compound abbreviation
        const phraseKey = words.join(" ");

        const existing = compoundToAbbreviations.get(phraseKey);
        if (existing) {
          if (!existing.includes(abbrLower)) existing.push(abbrLower);
        } else {
          compoundToAbbreviations.set(phraseKey, [abbrLower]);
        }

        const existingCompound = abbreviationToCompound.get(abbrLower);
        if (existingCompound) {
          existingCompound.push(words);
        } else {
          abbreviationToCompound.set(abbrLower, [words]);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Expansion functions
// ---------------------------------------------------------------------------

/**
 * Expand a list of query tokens with their abbreviation alternatives.
 *
 * For each token:
 * - If it's a known word → add its abbreviations
 * - If it's a known abbreviation → add the full word(s)
 * - Bidirectional: both directions are checked
 */
export function expandQueryTokens(tokens: string[]): ExpandedToken[] {
  loadAbbreviationDictionary();

  return tokens.map((token) => {
    const alternatives = new Set<string>();

    // Word → abbreviations
    const abbrs = wordToAbbreviations.get(token);
    if (abbrs) {
      for (const a of abbrs) alternatives.add(a);
    }

    // Abbreviation → words
    const words = abbreviationToWords.get(token);
    if (words) {
      for (const w of words) alternatives.add(w);
    }

    // Remove the original itself from alternatives (it will be tested separately)
    alternatives.delete(token);

    return { original: token, alternatives };
  });
}

/**
 * Check if a sequence of tokens starting at `startIndex` forms a known
 * compound phrase that has a short abbreviation.
 *
 * Example: tokens ["purchase", "order", "item"], startIndex=0
 *   → "purchase order" is a known compound → returns { length: 2, abbreviations: ["po"] }
 *
 * Returns null if no compound match is found.
 */
export function findCompoundAbbreviation(
  tokens: string[],
  startIndex: number,
): { length: number; abbreviations: string[] } | null {
  loadAbbreviationDictionary();

  if (compoundToAbbreviations.size === 0) return null;

  // Try longest match first (up to 4 tokens)
  const maxLen = Math.min(4, tokens.length - startIndex);
  for (let len = maxLen; len >= 2; len--) {
    const phrase = tokens.slice(startIndex, startIndex + len).join(" ");
    const abbrs = compoundToAbbreviations.get(phrase);
    if (abbrs) {
      return { length: len, abbreviations: [...abbrs] };
    }
  }

  return null;
}

/**
 * Expand a single token that might be a compound abbreviation.
 *
 * Example: "po" → [["purchase", "order"]]
 * Example: "bom" → [["bill", "of", "material"]]
 *
 * Returns null if the token is not a compound abbreviation.
 */
export function expandCompoundAbbreviation(
  token: string,
): string[][] | null {
  loadAbbreviationDictionary();

  const compounds = abbreviationToCompound.get(token);
  if (compounds && compounds.length > 0) {
    return compounds.map((c) => [...c]);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset loaded state (for testing only) */
export function _resetForTesting(): void {
  loaded = false;
  wordToAbbreviations.clear();
  abbreviationToWords.clear();
  compoundToAbbreviations.clear();
  abbreviationToCompound.clear();
}
