// ============================================================================
// Unit tests for the SAP abbreviation dictionary module
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  expandQueryTokens,
  findCompoundAbbreviation,
  expandCompoundAbbreviation,
  _resetForTesting,
} from "./abbreviation-dictionary.js";

// Reset dictionary state before each test to ensure clean loading
beforeEach(() => {
  _resetForTesting();
});

// ===========================================================================
// expandQueryTokens
// ===========================================================================

describe("expandQueryTokens", () => {
  it("expands 'billing' to include abbreviations bil, billg, blr", () => {
    const result = expandQueryTokens(["billing"]);
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("billing");
    expect(result[0].alternatives.has("bil")).toBe(true);
    expect(result[0].alternatives.has("billg")).toBe(true);
    expect(result[0].alternatives.has("blr")).toBe(true);
    // Original should not be in alternatives
    expect(result[0].alternatives.has("billing")).toBe(false);
  });

  it("expands abbreviation 'acct' to include the word 'account'", () => {
    const result = expandQueryTokens(["acct"]);
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("acct");
    expect(result[0].alternatives.has("account")).toBe(true);
  });

  it("returns empty alternatives for unknown token", () => {
    const result = expandQueryTokens(["xyzzy"]);
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("xyzzy");
    expect(result[0].alternatives.size).toBe(0);
  });

  it("expands 'account' to include accnt and acct", () => {
    const result = expandQueryTokens(["account"]);
    expect(result).toHaveLength(1);
    expect(result[0].alternatives.has("accnt")).toBe(true);
    expect(result[0].alternatives.has("acct")).toBe(true);
  });

  it("expands 'supplier' to include spl, suplr, suppr", () => {
    const result = expandQueryTokens(["supplier"]);
    expect(result).toHaveLength(1);
    expect(result[0].alternatives.has("spl")).toBe(true);
    expect(result[0].alternatives.has("suplr")).toBe(true);
    expect(result[0].alternatives.has("suppr")).toBe(true);
  });

  it("expands 'material' to include matl and mtrl", () => {
    const result = expandQueryTokens(["material"]);
    expect(result).toHaveLength(1);
    expect(result[0].alternatives.has("matl")).toBe(true);
    expect(result[0].alternatives.has("mtrl")).toBe(true);
  });

  it("handles multiple tokens", () => {
    const result = expandQueryTokens(["billing", "document"]);
    expect(result).toHaveLength(2);
    expect(result[0].original).toBe("billing");
    expect(result[0].alternatives.has("billg")).toBe(true);
    expect(result[1].original).toBe("document");
    expect(result[1].alternatives.has("doc")).toBe(true);
  });
});

// ===========================================================================
// findCompoundAbbreviation
// ===========================================================================

describe("findCompoundAbbreviation", () => {
  it("finds 'purchase order' -> 'po'", () => {
    const result = findCompoundAbbreviation(["purchase", "order"], 0);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result!.abbreviations).toContain("po");
  });

  it("finds compound starting at non-zero index", () => {
    const result = findCompoundAbbreviation(
      ["the", "purchase", "order", "item"],
      1,
    );
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result!.abbreviations).toContain("po");
  });

  it("returns null for non-compound tokens", () => {
    const result = findCompoundAbbreviation(["billing", "document"], 0);
    expect(result).toBeNull();
  });

  it("returns null for single token", () => {
    const result = findCompoundAbbreviation(["purchase"], 0);
    expect(result).toBeNull();
  });

  it("finds 'bill of material' -> 'bom'", () => {
    const result = findCompoundAbbreviation(["bill", "of", "material"], 0);
    expect(result).not.toBeNull();
    expect(result!.abbreviations).toContain("bom");
  });
});

// ===========================================================================
// expandCompoundAbbreviation
// ===========================================================================

describe("expandCompoundAbbreviation", () => {
  it("expands 'po' to [['purchase', 'order']]", () => {
    const result = expandCompoundAbbreviation("po");
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(1);
    expect(result!).toContainEqual(["purchase", "order"]);
  });

  it("expands 'bom' to [['bill', 'of', 'material']]", () => {
    const result = expandCompoundAbbreviation("bom");
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(1);
    expect(result!).toContainEqual(["bill", "of", "material"]);
  });

  it("returns null for non-compound abbreviation", () => {
    const result = expandCompoundAbbreviation("billing");
    expect(result).toBeNull();
  });

  it("returns null for unknown token", () => {
    const result = expandCompoundAbbreviation("xyzzy");
    expect(result).toBeNull();
  });
});
