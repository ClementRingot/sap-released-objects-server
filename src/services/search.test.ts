// ============================================================================
// Unit tests for the SAP-aware tokenizer and scoring engine
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  tokenizeSAPName,
  tokenizeComponent,
  tokenizeQuery,
  scoreObject,
} from "./search.js";
import type { SAPObject, IndexedObject } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers — build lightweight IndexedObject fixtures
// ---------------------------------------------------------------------------

function makeSAPObject(
  overrides: Partial<SAPObject> & Pick<SAPObject, "objectName">,
): SAPObject {
  return {
    objectType: "CLAS",
    objectName: overrides.objectName,
    softwareComponent: "S4CORE",
    applicationComponent: "",
    state: "released",
    cleanCoreLevel: "A",
    source: "released",
    ...overrides,
  };
}

function makeIndexed(
  overrides: Partial<SAPObject> & Pick<SAPObject, "objectName">,
): IndexedObject {
  const obj = makeSAPObject(overrides);
  return {
    object: obj,
    nameTokens: tokenizeSAPName(obj.objectName),
    componentTokens: tokenizeComponent(obj.applicationComponent),
  };
}

/** Score helper — tokenize the query then score a single object */
function score(query: string, indexed: IndexedObject): number {
  const { tokens } = tokenizeQuery(query);
  return scoreObject(indexed, tokens, query);
}

// ===========================================================================
// tokenizeSAPName
// ===========================================================================

describe("tokenizeSAPName", () => {
  it("strips technical prefix I_ and keeps the rest as one token (all-uppercase)", () => {
    expect(tokenizeSAPName("I_PURCHASEORDERITEM")).toEqual([
      "purchaseorderitem",
    ]);
  });

  it("strips CL_ prefix and splits on underscores", () => {
    expect(tokenizeSAPName("CL_BCS_SEND_REQUEST")).toEqual([
      "bcs",
      "send",
      "request",
    ]);
  });

  it("extracts namespace prefix", () => {
    expect(tokenizeSAPName("/SCWM/CL_WM_PACKING")).toEqual([
      "scwm",
      "wm",
      "packing",
    ]);
  });

  it("handles single-segment names with technical prefix (no stripping)", () => {
    // Only 1 part after split → prefix not stripped
    expect(tokenizeSAPName("MARA")).toEqual(["mara"]);
  });

  it("drops single-character and numeric-only tokens", () => {
    expect(tokenizeSAPName("CL_A_1_FOO")).toEqual(["foo"]);
  });

  it("splits camelCase when present", () => {
    expect(tokenizeSAPName("CL_PurchaseOrderApi")).toEqual([
      "Purchase",
      "Order",
      "Api",
    ].map((s) => s.toLowerCase()));
  });

  it("handles names with multiple underscores (EDO Italian objects)", () => {
    const tokens = tokenizeSAPName("EDO_IT_ALLEGATI_TYPE_TAB2");
    expect(tokens).toContain("edo");
    expect(tokens).toContain("it");
    expect(tokens).toContain("allegati");
    expect(tokens).toContain("type");
    expect(tokens).toContain("tab2");
  });

  it("handles ZCL_ custom class prefix", () => {
    expect(tokenizeSAPName("ZCL_MY_CUSTOM_CLASS")).toEqual([
      "my",
      "custom",
      "class",
    ]);
  });

  it("handles IF_ interface prefix", () => {
    expect(tokenizeSAPName("IF_ABAP_UNIT_ASSERT")).toEqual([
      "abap",
      "unit",
      "assert",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenizeSAPName("")).toEqual([]);
  });
});

// ===========================================================================
// tokenizeComponent
// ===========================================================================

describe("tokenizeComponent", () => {
  it("splits on dashes and lowercases", () => {
    expect(tokenizeComponent("MM-PUR-PO")).toEqual(["mm", "pur", "po"]);
  });

  it("drops single-char segments", () => {
    expect(tokenizeComponent("A-BC-D")).toEqual(["bc"]);
  });

  it("returns empty for empty string", () => {
    expect(tokenizeComponent("")).toEqual([]);
  });

  it("handles deep component paths", () => {
    expect(tokenizeComponent("CA-GTF-CSC-EDO-IT")).toEqual([
      "ca",
      "gtf",
      "csc",
      "edo",
      "it",
    ]);
  });
});

// ===========================================================================
// tokenizeQuery
// ===========================================================================

describe("tokenizeQuery", () => {
  it("detects exact mode for all-uppercase SAP name", () => {
    const result = tokenizeQuery("I_HANDLINGUNIT");
    expect(result.isExactMode).toBe(true);
    expect(result.tokens).toEqual(["handlingunit"]);
  });

  it("detects exact mode for full object name with underscores", () => {
    const result = tokenizeQuery("CL_BCS_SEND_REQUEST");
    expect(result.isExactMode).toBe(true);
    // tokenizeQuery does NOT strip technical prefixes (unlike tokenizeSAPName)
    // "CL" (2 chars) passes the length > 1 filter
    expect(result.tokens).toEqual(["cl", "bcs", "send", "request"]);
  });

  it("is not exact mode for natural language query", () => {
    const result = tokenizeQuery("purchase order");
    expect(result.isExactMode).toBe(false);
    expect(result.tokens).toEqual(["purchase", "order"]);
  });

  it("splits camelCase in query", () => {
    const result = tokenizeQuery("PurchaseOrder");
    expect(result.tokens).toEqual(["purchase", "order"]);
  });

  it("drops single-char tokens from query", () => {
    const result = tokenizeQuery("I HANDLINGUNIT");
    // "I" dropped (single char)
    expect(result.tokens).toEqual(["handlingunit"]);
  });

  it("falls back to whole query when all tokens are filtered out", () => {
    const result = tokenizeQuery("I");
    expect(result.tokens).toEqual(["i"]);
  });

  it("handles namespace-like query", () => {
    const result = tokenizeQuery("/SCWM/PACKING");
    expect(result.isExactMode).toBe(true);
    expect(result.tokens).toEqual(["scwm", "packing"]);
  });
});

// ===========================================================================
// scoreObject — individual scoring rules
// ===========================================================================

describe("scoreObject", () => {
  // -----------------------------------------------------------------------
  // Exact match
  // -----------------------------------------------------------------------
  describe("exact match", () => {
    it("gives 1000 points for exact name match (case-insensitive)", () => {
      const idx = makeIndexed({ objectName: "I_PRODUCT" });
      const s = score("I_PRODUCT", idx);
      expect(s).toBeGreaterThanOrEqual(1000);
    });

    it("exact match is case-insensitive", () => {
      const idx = makeIndexed({ objectName: "I_PRODUCT" });
      const s1 = score("I_PRODUCT", idx);
      const s2 = score("i_product", idx);
      // Both should contain the 1000 exact-match bonus
      // s2 won't be exact mode but the objectName compare is case-insensitive
      expect(s1).toBeGreaterThanOrEqual(1000);
      expect(s2).toBeGreaterThanOrEqual(1000);
    });
  });

  // -----------------------------------------------------------------------
  // Token-level matching
  // -----------------------------------------------------------------------
  describe("token matching", () => {
    it("scores full token match at 10 points plus nameContains bonus", () => {
      const idx = makeIndexed({ objectName: "CL_BCS_SEND_REQUEST" });
      // query "send" → tokens ["send"], nameTokens ["bcs", "send", "request"]
      // full match on "send" = 10
      // nameContains: "CL_BCS_SEND_REQUEST" contains "SEND" → 8
      const s = score("send", idx);
      expect(s).toBe(10 + 8);
    });

    it("scores partial match (name contains query) at 3 points", () => {
      const idx = makeIndexed({ objectName: "I_HANDLINGUNITHEADER" });
      // nameTokens: ["handlingunitheader"], query token: ["handlingunit"]
      // "handlingunitheader".includes("handlingunit") → partial = 3
      // nameContains: "I_HANDLINGUNITHEADER".includes("I_HANDLINGUNIT") → 8
      // namePrefix: starts with → 20
      const s = score("I_HANDLINGUNIT", idx);
      expect(s).toBe(3 + 8 + 20); // 31
    });

    it("allows reverse partial match when name token is >= 4 chars", () => {
      // Query "purchaseorderitem", name token "order" (5 chars >= 4)
      const idx = makeIndexed({
        objectName: "CL_ORDER_SERVICE",
      });
      // nameTokens: ["order", "service"]
      // "purchaseorderitem".includes("order") → true, "order".length=5 ≥ 4 → partial
      const { tokens } = tokenizeQuery("purchaseorderitem");
      const s = scoreObject(idx, tokens, "purchaseorderitem");
      expect(s).toBeGreaterThan(0);
    });

    it("blocks reverse partial match when name token is < 4 chars", () => {
      // Name token "it" (2 chars) should NOT match inside "handlingunit"
      const idx = makeIndexed({
        objectName: "EDO_IT_ALLEGATI_TYPE_TAB2",
      });
      const s = score("I_HANDLINGUNIT", idx);
      expect(s).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Component matching
  // -----------------------------------------------------------------------
  describe("component matching", () => {
    it("scores component token match", () => {
      const idx = makeIndexed({
        objectName: "SOME_OBJECT",
        applicationComponent: "MM-PUR-PO",
      });
      // query "pur" → tokens ["pur"]
      // componentTokens: ["mm", "pur", "po"] → "pur" === "pur" → 5 pts
      const s = score("pur", idx);
      expect(s).toBe(5);
    });

    it("blocks short component tokens from reverse matching", () => {
      const idx = makeIndexed({
        objectName: "SOME_OBJECT",
        applicationComponent: "CA-GTF-CSC-EDO-IT",
      });
      // query "handlingunit" → tokens ["handlingunit"]
      // "it" (2 chars) inside "handlingunit" → blocked (< 4 chars)
      const s = score("handlingunit", idx);
      expect(s).toBe(0);
    });

    it("allows long component tokens in reverse matching", () => {
      const idx = makeIndexed({
        objectName: "SOME_OBJECT",
        applicationComponent: "LO-SHIP-DELIVERY",
      });
      // query "deliveryprocess" → tokens ["deliveryprocess"]
      // componentTokens: ["lo", "ship", "delivery"]
      // "deliveryprocess".includes("delivery") → true, "delivery".length=8 ≥ 4 → 5 pts
      const s = score("deliveryprocess", idx);
      expect(s).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // nameContains / namePrefix
  // -----------------------------------------------------------------------
  describe("nameContains and namePrefix", () => {
    it("gives 8 points when raw query is a substring of object name", () => {
      const idx = makeIndexed({ objectName: "ZCL_I_PRODUCT_HANDLER" });
      // "I_PRODUCT" is a substring of "ZCL_I_PRODUCT_HANDLER"
      // nameContains = 8, namePrefix = 0 (doesn't start with "I_PRODUCT")
      const s = score("I_PRODUCT", idx);
      // Also token matches may contribute
      expect(s).toBeGreaterThanOrEqual(8);
    });

    it("gives 20 extra points when object name starts with query", () => {
      const idx = makeIndexed({ objectName: "I_PRODUCT" });
      // "I_PROD" is a prefix of "I_PRODUCT"
      // nameContains = 8, namePrefix = 20
      const s = score("I_PROD", idx);
      expect(s).toBeGreaterThanOrEqual(28); // 8 + 20
    });

    it("namePrefix is 0 when query is not a prefix", () => {
      const idx = makeIndexed({ objectName: "XCL_PRODUCT" });
      // "PRODUCT" is contained but not a prefix
      const { tokens } = tokenizeQuery("PRODUCT");
      const s = scoreObject(idx, tokens, "PRODUCT");
      // nameContains = 8, namePrefix = 0
      // Also "product" === "product" (full token match) = 10
      expect(s).toBe(10 + 8); // no prefix bonus
    });
  });

  // -----------------------------------------------------------------------
  // Zero score for irrelevant objects
  // -----------------------------------------------------------------------
  describe("zero score for unrelated objects", () => {
    it("scores near-zero for marginally related object", () => {
      const idx = makeIndexed({
        objectName: "CL_ABAP_UNIT_ASSERT",
        applicationComponent: "BC-DWB",
      });
      // "unit" (4 chars ≥ 4) is inside "handlingunit" → partial match = 3
      // This is technically valid but very low, dwarfed by real matches (31 pts)
      const s = score("I_HANDLINGUNIT", idx);
      expect(s).toBe(3);
    });

    it("scores 0 for completely unrelated object", () => {
      const idx = makeIndexed({
        objectName: "CL_ABAP_REGEX",
        applicationComponent: "BC-DWB",
      });
      const s = score("I_HANDLINGUNIT", idx);
      expect(s).toBe(0);
    });

    it("scores 0 for EDO Italian objects against HANDLINGUNIT query", () => {
      const cases = [
        "EDO_IT_ALLEGATI_TYPE_TAB2",
        "EDO_IT_ALTRI_DATI_GESTION_TAB2",
        "EDO_IT_ANAGRAFICA_TYPE2",
        "EDO_IT_CEDENTE_PRESTATORE_TYP2",
        "EDO_IT_CODICE_ARTICOLO_TYPE2",
        "EDO_IT_CONTATTI_TYPE2",
      ];
      for (const name of cases) {
        const idx = makeIndexed({
          objectName: name,
          applicationComponent: "CA-GTF-CSC-EDO-IT",
        });
        const s = score("I_HANDLINGUNIT", idx);
        expect(s, `${name} should score 0`).toBe(0);
      }
    });
  });
});

// ===========================================================================
// Ranking integration tests — verify relative ordering
// ===========================================================================

describe("search ranking", () => {
  /**
   * Helper: given a query and a list of object names, returns them sorted
   * by score descending (same logic as register-tools.ts).
   */
  function rank(
    query: string,
    objects: Array<Partial<SAPObject> & Pick<SAPObject, "objectName">>,
  ): Array<{ name: string; score: number }> {
    const { tokens } = tokenizeQuery(query);
    return objects
      .map((o) => {
        const idx = makeIndexed(o);
        return {
          name: o.objectName,
          score: scoreObject(idx, tokens, query),
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      });
  }

  // -----------------------------------------------------------------------
  // The original bug: I_HANDLINGUNIT must rank CDS views above EDO objects
  // -----------------------------------------------------------------------
  it("ranks I_HANDLINGUNIT* CDS views above unrelated EDO objects", () => {
    const results = rank("I_HANDLINGUNIT", [
      { objectName: "I_HANDLINGUNITHEADER", objectType: "DDLS", applicationComponent: "LO-HU-VDM" },
      { objectName: "I_HANDLINGUNITITEM", objectType: "DDLS", applicationComponent: "LO-HU-VDM" },
      { objectName: "EDO_IT_ALLEGATI_TYPE_TAB2", objectType: "TTYP", applicationComponent: "CA-GTF-CSC-EDO-IT" },
      { objectName: "EDO_IT_ANAGRAFICA_TYPE2", objectType: "TABL", applicationComponent: "CA-GTF-CSC-EDO-IT" },
      { objectName: "EDO_IT_CONTATTI_TYPE2", objectType: "TABL", applicationComponent: "CA-GTF-CSC-EDO-IT" },
    ]);

    // CDS views must appear, EDO objects must be filtered out (score 0)
    expect(results.length).toBe(2);
    expect(results[0].name).toBe("I_HANDLINGUNITHEADER");
    expect(results[1].name).toBe("I_HANDLINGUNITITEM");
  });

  // -----------------------------------------------------------------------
  // Exact match should always be first
  // -----------------------------------------------------------------------
  it("ranks exact match first", () => {
    const results = rank("I_PRODUCT", [
      { objectName: "I_PRODUCT" },
      { objectName: "I_PRODUCTDESCRIPTION" },
      { objectName: "I_PRODUCTGROUP" },
      { objectName: "CL_PRODUCT_HELPER" },
    ]);

    expect(results[0].name).toBe("I_PRODUCT");
    expect(results[0].score).toBeGreaterThanOrEqual(1000);
  });

  // -----------------------------------------------------------------------
  // Prefix matches should rank above substring matches
  // -----------------------------------------------------------------------
  it("ranks prefix matches above non-prefix substring matches", () => {
    const results = rank("I_PURCHASE", [
      { objectName: "I_PURCHASEORDER" },
      { objectName: "I_PURCHASEORDERITEM" },
      { objectName: "ZCL_I_PURCHASE_HELPER" }, // contains but not prefix
    ]);

    // Both I_PURCHASE* should rank above the ZCL object
    const prefixResults = results.filter((r) => r.name.startsWith("I_PURCHASE"));
    const nonPrefixResults = results.filter((r) => !r.name.startsWith("I_PURCHASE"));

    expect(prefixResults.length).toBe(2);
    if (nonPrefixResults.length > 0) {
      expect(prefixResults[0].score).toBeGreaterThan(nonPrefixResults[0].score);
    }
  });

  // -----------------------------------------------------------------------
  // Multi-token query should match objects with all tokens
  // -----------------------------------------------------------------------
  it("scores higher when more query tokens match", () => {
    const results = rank("BCS SEND", [
      { objectName: "CL_BCS_SEND_REQUEST" }, // matches both "bcs" and "send"
      { objectName: "CL_BCS_MAIL" },         // matches only "bcs"
      { objectName: "CL_SEND_HELPER" },      // matches only "send"
    ]);

    expect(results[0].name).toBe("CL_BCS_SEND_REQUEST");
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].score).toBeGreaterThan(results[2].score);
  });

  // -----------------------------------------------------------------------
  // Namespace query
  // -----------------------------------------------------------------------
  it("finds namespaced objects", () => {
    const results = rank("/SCWM/PACKING", [
      { objectName: "/SCWM/CL_WM_PACKING" },
      { objectName: "CL_PACKING_HELPER" },
    ]);

    // The namespaced object should rank first because it matches both "scwm" and "packing"
    expect(results[0].name).toBe("/SCWM/CL_WM_PACKING");
  });

  // -----------------------------------------------------------------------
  // Natural language query
  // -----------------------------------------------------------------------
  it("handles natural language queries", () => {
    const results = rank("purchase order", [
      { objectName: "I_PURCHASEORDERITEM" },
      { objectName: "CL_ABAP_UNIT_ASSERT" },
    ]);

    // "purchase" and "order" won't token-match I_PURCHASEORDERITEM directly
    // because nameTokens = ["purchaseorderitem"] (single all-uppercase token)
    // But "purchaseorderitem".includes("purchase") and .includes("order") → partial matches
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe("I_PURCHASEORDERITEM");
  });

  // -----------------------------------------------------------------------
  // Component-only matches should rank lower than name matches
  // -----------------------------------------------------------------------
  it("ranks name matches above component-only matches", () => {
    const results = rank("PURCHASE", [
      { objectName: "I_PURCHASEORDER", applicationComponent: "MM-PUR" },
      { objectName: "SOME_RANDOM_OBJ", applicationComponent: "MM-PURCHASE" },
    ]);

    expect(results[0].name).toBe("I_PURCHASEORDER");
  });

  // -----------------------------------------------------------------------
  // Short query tokens should not pollute results
  // -----------------------------------------------------------------------
  it("does not match 2-char name tokens against long query tokens", () => {
    const results = rank("MATERIALMANAGEMENT", [
      { objectName: "CL_MM_UTIL", applicationComponent: "MM" },
      // "mm" (2 chars) should NOT match inside "materialmanagement"
    ]);

    // "mm" is 2 chars → blocked. No name/prefix match either.
    expect(results.length).toBe(0);
  });

  it("does match 4+ char name tokens against long query tokens", () => {
    const results = rank("MATERIALMANAGEMENT", [
      { objectName: "CL_MATERIAL_SERVICE" },
      // nameTokens: ["material", "service"]
      // "materialmanagement".includes("material") → true, length 8 ≥ 4 → partial match
    ]);

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("CL_MATERIAL_SERVICE");
  });
});
