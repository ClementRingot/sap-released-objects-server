// ============================================================================
// Unit tests for constants — mappings and URL generation
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  STATE_TO_LEVEL,
  DEFAULT_LEVEL,
  getReleasedPCEVersionURL,
  OBJECT_TYPE_DESCRIPTIONS,
  FALLBACK_PCE_VERSIONS,
} from "./constants.js";

// ===========================================================================
// STATE_TO_LEVEL mapping
// ===========================================================================

describe("STATE_TO_LEVEL", () => {
  it("maps 'released' to level A", () => {
    expect(STATE_TO_LEVEL["released"]).toBe("A");
  });

  it("maps 'deprecated' to level A", () => {
    expect(STATE_TO_LEVEL["deprecated"]).toBe("A");
  });

  it("maps 'classicAPI' to level B", () => {
    expect(STATE_TO_LEVEL["classicAPI"]).toBe("B");
  });

  it("maps 'stable' to level C", () => {
    expect(STATE_TO_LEVEL["stable"]).toBe("C");
  });

  it("maps 'notToBeReleased' to level C", () => {
    expect(STATE_TO_LEVEL["notToBeReleased"]).toBe("C");
  });

  it("maps 'noAPI' to level D", () => {
    expect(STATE_TO_LEVEL["noAPI"]).toBe("D");
  });

  it("covers exactly 6 known states", () => {
    expect(Object.keys(STATE_TO_LEVEL).length).toBe(6);
  });

  it("has DEFAULT_LEVEL set to C", () => {
    expect(DEFAULT_LEVEL).toBe("C");
  });

  it("unknown states are not in the mapping (will use DEFAULT_LEVEL)", () => {
    expect(STATE_TO_LEVEL["unknownState"]).toBeUndefined();
  });
});

// ===========================================================================
// getReleasedPCEVersionURL
// ===========================================================================

describe("getReleasedPCEVersionURL", () => {
  it("generates URL for base year version", () => {
    const url = getReleasedPCEVersionURL("2022");
    expect(url).toContain("objectReleaseInfo_PCE2022.json");
    expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
  });

  it("generates URL for YEAR_FPS version", () => {
    const url = getReleasedPCEVersionURL("2023_3");
    expect(url).toContain("objectReleaseInfo_PCE2023_3.json");
  });

  it("generates URL for latest version", () => {
    const url = getReleasedPCEVersionURL("latest");
    // This would produce PCElatest.json which is not a real file,
    // but getReleasedURL in data-loader handles "latest" separately
    expect(url).toContain("PCElatest");
  });
});

// ===========================================================================
// OBJECT_TYPE_DESCRIPTIONS
// ===========================================================================

describe("OBJECT_TYPE_DESCRIPTIONS", () => {
  it("describes all commonly used object types", () => {
    const expectedTypes = [
      "BDEF", "CLAS", "DDLS", "DDLX", "DTEL", "DOMA", "FUGR",
      "INTF", "MSAG", "SRVB", "SRVD", "TABL", "TTYP",
    ];
    for (const type of expectedTypes) {
      expect(
        OBJECT_TYPE_DESCRIPTIONS[type],
        `Missing description for ${type}`,
      ).toBeDefined();
    }
  });

  it("has non-empty descriptions", () => {
    for (const [type, desc] of Object.entries(OBJECT_TYPE_DESCRIPTIONS)) {
      expect(desc.length, `Empty description for ${type}`).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// FALLBACK_PCE_VERSIONS
// ===========================================================================

describe("FALLBACK_PCE_VERSIONS", () => {
  it("is a non-empty array", () => {
    expect(FALLBACK_PCE_VERSIONS.length).toBeGreaterThan(0);
  });

  it("contains valid version formats (YEAR or YEAR_FPS)", () => {
    for (const version of FALLBACK_PCE_VERSIONS) {
      expect(version).toMatch(/^\d{4}(_\d+)?$/);
    }
  });

  it("is sorted chronologically", () => {
    for (let i = 1; i < FALLBACK_PCE_VERSIONS.length; i++) {
      expect(
        FALLBACK_PCE_VERSIONS[i] >= FALLBACK_PCE_VERSIONS[i - 1],
        `${FALLBACK_PCE_VERSIONS[i]} should come after ${FALLBACK_PCE_VERSIONS[i - 1]}`,
      ).toBe(true);
    }
  });
});
