// ============================================================================
// Unit tests for register-tools helper functions
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  normalizeVersion,
  getLevelsUpTo,
  needsClassicApis,
  filterByLevel,
  formatObject,
  truncateIfNeeded,
} from "./register-tools.js";
import type { SAPObject, CleanCoreLevel, SystemType } from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObj(overrides?: Partial<SAPObject>): SAPObject {
  return {
    objectType: "CLAS",
    objectName: "CL_TEST",
    softwareComponent: "S4CORE",
    applicationComponent: "MM-PUR",
    state: "released",
    cleanCoreLevel: "A",
    source: "released",
    ...overrides,
  };
}

// ===========================================================================
// normalizeVersion
// ===========================================================================

describe("normalizeVersion", () => {
  // Already valid formats — pass through
  it("returns 'latest' unchanged", () => {
    expect(normalizeVersion("latest")).toBe("latest");
  });

  it("returns bare year unchanged", () => {
    expect(normalizeVersion("2022")).toBe("2022");
  });

  it("returns YEAR_FPS unchanged", () => {
    expect(normalizeVersion("2023_3")).toBe("2023_3");
  });

  // SP format
  it("normalizes '2022 SP01' to '2022_1'", () => {
    expect(normalizeVersion("2022 SP01")).toBe("2022_1");
  });

  it("normalizes '2023 SP03' to '2023_3'", () => {
    expect(normalizeVersion("2023 SP03")).toBe("2023_3");
  });

  // FPS format
  it("normalizes '2023 FPS03' to '2023_3'", () => {
    expect(normalizeVersion("2023 FPS03")).toBe("2023_3");
  });

  it("normalizes '2022_FPS1' to '2022_1'", () => {
    expect(normalizeVersion("2022_FPS1")).toBe("2022_1");
  });

  // Dot separator
  it("normalizes '2022.1' to '2022_1'", () => {
    expect(normalizeVersion("2022.1")).toBe("2022_1");
  });

  it("normalizes '2023.3' to '2023_3'", () => {
    expect(normalizeVersion("2023.3")).toBe("2023_3");
  });

  // Dash separator
  it("normalizes '2022-1' to '2022_1'", () => {
    expect(normalizeVersion("2022-1")).toBe("2022_1");
  });

  // Space separator (no SP/FPS prefix)
  it("normalizes '2022 1' to '2022_1'", () => {
    expect(normalizeVersion("2022 1")).toBe("2022_1");
  });

  // Strip leading zeros
  it("strips leading zeros from FPS number", () => {
    expect(normalizeVersion("2023 FPS003")).toBe("2023_3");
    expect(normalizeVersion("2022 SP010")).toBe("2022_10");
  });

  // Case insensitive
  it("handles lowercase sp/fps", () => {
    expect(normalizeVersion("2022 sp01")).toBe("2022_1");
    expect(normalizeVersion("2023 fps3")).toBe("2023_3");
  });

  // Whitespace trimming
  it("trims whitespace", () => {
    expect(normalizeVersion("  2022_1  ")).toBe("2022_1");
  });

  // Fallback for unrecognized formats
  it("returns unrecognized formats as-is (trimmed)", () => {
    expect(normalizeVersion("  foobar  ")).toBe("foobar");
  });
});

// ===========================================================================
// getLevelsUpTo
// ===========================================================================

describe("getLevelsUpTo", () => {
  it("Level A returns only {A}", () => {
    const levels = getLevelsUpTo("A");
    expect(levels).toEqual(new Set(["A"]));
  });

  it("Level B returns {A, B}", () => {
    const levels = getLevelsUpTo("B");
    expect(levels).toEqual(new Set(["A", "B"]));
  });

  it("Level C returns {A, B, C}", () => {
    const levels = getLevelsUpTo("C");
    expect(levels).toEqual(new Set(["A", "B", "C"]));
  });

  it("Level D returns {A, B, C, D}", () => {
    const levels = getLevelsUpTo("D");
    expect(levels).toEqual(new Set(["A", "B", "C", "D"]));
  });
});

// ===========================================================================
// needsClassicApis
// ===========================================================================

describe("needsClassicApis", () => {
  // public_cloud and btp never need classic APIs
  it("returns false for public_cloud regardless of level", () => {
    const levels: CleanCoreLevel[] = ["A", "B", "C", "D"];
    for (const level of levels) {
      expect(needsClassicApis(level, "public_cloud"), `public_cloud level ${level}`).toBe(false);
    }
  });

  it("returns false for btp regardless of level", () => {
    const levels: CleanCoreLevel[] = ["A", "B", "C", "D"];
    for (const level of levels) {
      expect(needsClassicApis(level, "btp"), `btp level ${level}`).toBe(false);
    }
  });

  // private_cloud / on_premise: needs classic from level B onwards
  it("returns false for private_cloud level A", () => {
    expect(needsClassicApis("A", "private_cloud")).toBe(false);
  });

  it("returns true for private_cloud level B", () => {
    expect(needsClassicApis("B", "private_cloud")).toBe(true);
  });

  it("returns true for on_premise level C", () => {
    expect(needsClassicApis("C", "on_premise")).toBe(true);
  });

  it("returns true for on_premise level D", () => {
    expect(needsClassicApis("D", "on_premise")).toBe(true);
  });
});

// ===========================================================================
// filterByLevel
// ===========================================================================

describe("filterByLevel", () => {
  const objects: SAPObject[] = [
    makeObj({ objectName: "OBJ_A", cleanCoreLevel: "A" }),
    makeObj({ objectName: "OBJ_B", cleanCoreLevel: "B" }),
    makeObj({ objectName: "OBJ_C", cleanCoreLevel: "C" }),
    makeObj({ objectName: "OBJ_D", cleanCoreLevel: "D" }),
  ];

  it("level A returns only A objects", () => {
    const result = filterByLevel(objects, "A");
    expect(result.map((o) => o.objectName)).toEqual(["OBJ_A"]);
  });

  it("level B returns A and B objects", () => {
    const result = filterByLevel(objects, "B");
    expect(result.map((o) => o.objectName)).toEqual(["OBJ_A", "OBJ_B"]);
  });

  it("level C returns A, B, and C objects", () => {
    const result = filterByLevel(objects, "C");
    expect(result.map((o) => o.objectName)).toEqual([
      "OBJ_A",
      "OBJ_B",
      "OBJ_C",
    ]);
  });

  it("level D returns all objects", () => {
    const result = filterByLevel(objects, "D");
    expect(result.length).toBe(4);
  });

  it("returns empty array when no objects match", () => {
    const onlyD = [makeObj({ cleanCoreLevel: "D" })];
    expect(filterByLevel(onlyD, "A")).toEqual([]);
  });

  it("handles empty input", () => {
    expect(filterByLevel([], "D")).toEqual([]);
  });
});

// ===========================================================================
// formatObject
// ===========================================================================

describe("formatObject", () => {
  it("formats compact output (verbose=false)", () => {
    const obj = makeObj({ objectType: "CLAS", objectName: "CL_FOO", state: "released", cleanCoreLevel: "A" });
    const result = formatObject(obj);
    expect(result).toBe("CLAS CL_FOO [released] (Level A)");
  });

  it("formats verbose output with type and components", () => {
    const obj = makeObj({
      objectType: "DDLS",
      objectName: "I_PRODUCT",
      applicationComponent: "MM-PUR",
      softwareComponent: "S4CORE",
    });
    const result = formatObject(obj, true);
    expect(result).toContain("DDLS I_PRODUCT [released] (Level A)");
    expect(result).toContain("Type: Data Definition Language Source (CDS View)");
    expect(result).toContain("App Component: MM-PUR");
    expect(result).toContain("SW Component: S4CORE");
  });

  it("omits empty application component in verbose mode", () => {
    const obj = makeObj({ applicationComponent: "" });
    const result = formatObject(obj, true);
    expect(result).not.toContain("App Component:");
  });

  it("omits empty software component in verbose mode", () => {
    const obj = makeObj({ softwareComponent: "" });
    const result = formatObject(obj, true);
    expect(result).not.toContain("SW Component:");
  });

  it("shows successor objects in verbose mode", () => {
    const obj = makeObj({
      successor: {
        classification: "successor_available",
        objects: [
          { objectType: "DDLS", objectName: "I_PRODUCT" },
          { objectType: "BDEF", objectName: "I_PRODUCTTP" },
        ],
      },
    });
    const result = formatObject(obj, true);
    expect(result).toContain("Successor(s): DDLS I_PRODUCT, BDEF I_PRODUCTTP");
  });

  it("shows successor concept name in verbose mode", () => {
    const obj = makeObj({
      successor: {
        classification: "concept_available",
        conceptName: "Use RAP-based API",
      },
    });
    const result = formatObject(obj, true);
    expect(result).toContain("Successor Concept: Use RAP-based API");
  });

  it("does not show successor info in compact mode", () => {
    const obj = makeObj({
      successor: {
        classification: "successor_available",
        objects: [{ objectType: "DDLS", objectName: "I_PRODUCT" }],
      },
    });
    const result = formatObject(obj, false);
    expect(result).not.toContain("Successor");
  });

  it("handles unknown object type gracefully in verbose mode", () => {
    const obj = makeObj({ objectType: "ZZZZ" });
    const result = formatObject(obj, true);
    // Falls back to type code itself as description
    expect(result).toContain("Type: ZZZZ");
  });
});

// ===========================================================================
// truncateIfNeeded
// ===========================================================================

describe("truncateIfNeeded", () => {
  it("returns short text unchanged", () => {
    const text = "Hello, world!";
    expect(truncateIfNeeded(text)).toBe(text);
  });

  it("returns text at exactly CHARACTER_LIMIT unchanged", () => {
    const text = "x".repeat(CHARACTER_LIMIT);
    expect(truncateIfNeeded(text)).toBe(text);
  });

  it("truncates text exceeding CHARACTER_LIMIT", () => {
    const text = "x".repeat(CHARACTER_LIMIT + 1000);
    const result = truncateIfNeeded(text);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("... [Response truncated.");
    expect(result).toContain(`${text.length} characters total`);
  });

  it("preserves beginning of text when truncating", () => {
    const text = "START" + "x".repeat(CHARACTER_LIMIT + 1000);
    const result = truncateIfNeeded(text);
    expect(result.startsWith("START")).toBe(true);
  });
});
