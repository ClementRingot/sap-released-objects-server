// ============================================================================
// Unit tests for data-loader — pure functions (no network)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  getCacheKey,
  getReleasedURL,
  normalizeEntry,
  buildStore,
} from "./data-loader.js";
import {
  RELEASED_LATEST_URL,
  RELEASED_BTP_LATEST_URL,
  RELEASED_PCE_LATEST_URL,
  getReleasedPCEVersionURL,
} from "../constants.js";
import type { RawObjectEntry, SAPObject } from "../types.js";

// ===========================================================================
// getCacheKey
// ===========================================================================

describe("getCacheKey", () => {
  it("builds key from all three parameters", () => {
    expect(getCacheKey("public_cloud", "latest", false)).toBe(
      "public_cloud:latest:false",
    );
  });

  it("distinguishes includeClassicApis flag", () => {
    const k1 = getCacheKey("on_premise", "2023_3", false);
    const k2 = getCacheKey("on_premise", "2023_3", true);
    expect(k1).not.toBe(k2);
  });

  it("distinguishes system types", () => {
    const k1 = getCacheKey("public_cloud", "latest", false);
    const k2 = getCacheKey("btp", "latest", false);
    expect(k1).not.toBe(k2);
  });
});

// ===========================================================================
// getReleasedURL
// ===========================================================================

describe("getReleasedURL", () => {
  it("returns public cloud URL for public_cloud", () => {
    expect(getReleasedURL("public_cloud", "latest")).toBe(RELEASED_LATEST_URL);
  });

  it("returns BTP URL for btp", () => {
    expect(getReleasedURL("btp", "latest")).toBe(RELEASED_BTP_LATEST_URL);
  });

  it("returns PCE latest URL for private_cloud with latest version", () => {
    expect(getReleasedURL("private_cloud", "latest")).toBe(
      RELEASED_PCE_LATEST_URL,
    );
  });

  it("returns PCE latest URL for on_premise with latest version", () => {
    expect(getReleasedURL("on_premise", "latest")).toBe(
      RELEASED_PCE_LATEST_URL,
    );
  });

  it("returns versioned PCE URL for on_premise with specific version", () => {
    expect(getReleasedURL("on_premise", "2023_3")).toBe(
      getReleasedPCEVersionURL("2023_3"),
    );
  });

  it("returns versioned PCE URL for private_cloud with specific version", () => {
    expect(getReleasedURL("private_cloud", "2022")).toBe(
      getReleasedPCEVersionURL("2022"),
    );
  });

  it("public_cloud ignores version parameter", () => {
    // Even if a version is passed, public_cloud always returns the latest URL
    expect(getReleasedURL("public_cloud", "2023_3")).toBe(RELEASED_LATEST_URL);
  });
});

// ===========================================================================
// normalizeEntry
// ===========================================================================

describe("normalizeEntry", () => {
  const minimalEntry: RawObjectEntry = {
    tadirObject: "CLAS",
    tadirObjName: "CL_MY_CLASS",
    objectType: "",
    objectKey: "",
    state: "released",
  };

  it("normalizes a minimal released entry", () => {
    const obj = normalizeEntry(minimalEntry, "released");
    expect(obj.objectType).toBe("CLAS");
    expect(obj.objectName).toBe("CL_MY_CLASS");
    expect(obj.state).toBe("released");
    expect(obj.cleanCoreLevel).toBe("A");
    expect(obj.source).toBe("released");
    expect(obj.successor).toBeUndefined();
  });

  it("uppercases object type and name", () => {
    const entry: RawObjectEntry = {
      ...minimalEntry,
      tadirObject: "ddls",
      tadirObjName: "i_product",
    };
    const obj = normalizeEntry(entry, "released");
    expect(obj.objectType).toBe("DDLS");
    expect(obj.objectName).toBe("I_PRODUCT");
  });

  it("falls back to objectType/objectKey when tadirObject/tadirObjName are empty", () => {
    const entry: RawObjectEntry = {
      tadirObject: "",
      tadirObjName: "",
      objectType: "TABL",
      objectKey: "MARA",
      state: "classicAPI",
    };
    const obj = normalizeEntry(entry, "classicApi");
    expect(obj.objectType).toBe("TABL");
    expect(obj.objectName).toBe("MARA");
    expect(obj.source).toBe("classicApi");
  });

  it("maps state to correct Clean Core Level", () => {
    const states: Array<{ state: string; expectedLevel: string }> = [
      { state: "released", expectedLevel: "A" },
      { state: "deprecated", expectedLevel: "A" },
      { state: "classicAPI", expectedLevel: "B" },
      { state: "stable", expectedLevel: "C" },
      { state: "notToBeReleased", expectedLevel: "C" },
      { state: "noAPI", expectedLevel: "D" },
    ];

    for (const { state, expectedLevel } of states) {
      const obj = normalizeEntry({ ...minimalEntry, state }, "released");
      expect(obj.cleanCoreLevel, `state "${state}" → level "${expectedLevel}"`).toBe(
        expectedLevel,
      );
    }
  });

  it("defaults to level C for unknown states", () => {
    const obj = normalizeEntry(
      { ...minimalEntry, state: "unknownState" },
      "released",
    );
    expect(obj.cleanCoreLevel).toBe("C");
  });

  it("preserves software and application component", () => {
    const entry: RawObjectEntry = {
      ...minimalEntry,
      softwareComponent: "S4CORE",
      applicationComponent: "MM-PUR-PO",
    };
    const obj = normalizeEntry(entry, "released");
    expect(obj.softwareComponent).toBe("S4CORE");
    expect(obj.applicationComponent).toBe("MM-PUR-PO");
  });

  it("defaults missing components to empty string", () => {
    const obj = normalizeEntry(minimalEntry, "released");
    expect(obj.softwareComponent).toBe("");
    expect(obj.applicationComponent).toBe("");
  });

  it("builds successor info with objects", () => {
    const entry: RawObjectEntry = {
      ...minimalEntry,
      state: "deprecated",
      successorClassification: "successor_available",
      successors: [
        {
          tadirObject: "DDLS",
          tadirObjName: "I_Product",
          objectType: "",
          objectKey: "",
        },
      ],
    };
    const obj = normalizeEntry(entry, "released");
    expect(obj.successor).toBeDefined();
    expect(obj.successor!.classification).toBe("successor_available");
    expect(obj.successor!.objects).toHaveLength(1);
    expect(obj.successor!.objects![0].objectType).toBe("DDLS");
    expect(obj.successor!.objects![0].objectName).toBe("I_PRODUCT"); // uppercased
  });

  it("builds successor info with concept name", () => {
    const entry: RawObjectEntry = {
      ...minimalEntry,
      state: "deprecated",
      successorClassification: "concept_available",
      successorConceptName: "Use RAP-based API instead",
    };
    const obj = normalizeEntry(entry, "released");
    expect(obj.successor!.conceptName).toBe("Use RAP-based API instead");
    expect(obj.successor!.objects).toBeUndefined();
  });

  it("builds successor with both objects and concept name", () => {
    const entry: RawObjectEntry = {
      ...minimalEntry,
      state: "deprecated",
      successorClassification: "successor_available",
      successors: [
        { tadirObject: "CLAS", tadirObjName: "CL_NEW", objectType: "", objectKey: "" },
      ],
      successorConceptName: "Migration guide available",
    };
    const obj = normalizeEntry(entry, "released");
    expect(obj.successor!.objects).toHaveLength(1);
    expect(obj.successor!.conceptName).toBe("Migration guide available");
  });

  it("does not create successor when no successorClassification", () => {
    const obj = normalizeEntry(minimalEntry, "released");
    expect(obj.successor).toBeUndefined();
  });

  it("handles multiple successors", () => {
    const entry: RawObjectEntry = {
      ...minimalEntry,
      state: "deprecated",
      successorClassification: "successor_available",
      successors: [
        { tadirObject: "DDLS", tadirObjName: "I_PRODUCT", objectType: "", objectKey: "" },
        { tadirObject: "BDEF", tadirObjName: "I_PRODUCTTP", objectType: "", objectKey: "" },
      ],
    };
    const obj = normalizeEntry(entry, "released");
    expect(obj.successor!.objects).toHaveLength(2);
    expect(obj.successor!.objects![0].objectName).toBe("I_PRODUCT");
    expect(obj.successor!.objects![1].objectName).toBe("I_PRODUCTTP");
  });
});

// ===========================================================================
// buildStore
// ===========================================================================

describe("buildStore", () => {
  function makeObj(overrides: Partial<SAPObject>): SAPObject {
    return {
      objectType: "CLAS",
      objectName: "CL_DEFAULT",
      softwareComponent: "S4CORE",
      applicationComponent: "",
      state: "released",
      cleanCoreLevel: "A",
      source: "released",
      ...overrides,
    };
  }

  it("builds objectsMap with correct keys", () => {
    const objects = [
      makeObj({ objectType: "CLAS", objectName: "CL_FOO" }),
      makeObj({ objectType: "DDLS", objectName: "I_PRODUCT" }),
    ];
    const store = buildStore(objects, "test");
    expect(store.objectsMap.size).toBe(2);
    expect(store.objectsMap.has("CLAS:CL_FOO")).toBe(true);
    expect(store.objectsMap.has("DDLS:I_PRODUCT")).toBe(true);
  });

  it("builds byType index", () => {
    const objects = [
      makeObj({ objectType: "CLAS", objectName: "CL_A" }),
      makeObj({ objectType: "CLAS", objectName: "CL_B" }),
      makeObj({ objectType: "DDLS", objectName: "I_X" }),
    ];
    const store = buildStore(objects, "test");
    expect(store.byType.get("CLAS")?.length).toBe(2);
    expect(store.byType.get("DDLS")?.length).toBe(1);
  });

  it("builds byLevel index", () => {
    const objects = [
      makeObj({ objectName: "A1", cleanCoreLevel: "A" }),
      makeObj({ objectName: "A2", cleanCoreLevel: "A" }),
      makeObj({ objectName: "B1", cleanCoreLevel: "B" }),
    ];
    const store = buildStore(objects, "test");
    expect(store.byLevel.get("A")?.length).toBe(2);
    expect(store.byLevel.get("B")?.length).toBe(1);
  });

  it("builds byAppComponent index (skips empty component)", () => {
    const objects = [
      makeObj({ objectName: "A1", applicationComponent: "MM-PUR" }),
      makeObj({ objectName: "A2", applicationComponent: "MM-PUR" }),
      makeObj({ objectName: "A3", applicationComponent: "" }),
    ];
    const store = buildStore(objects, "test");
    expect(store.byAppComponent.get("MM-PUR")?.length).toBe(2);
    expect(store.byAppComponent.has("")).toBe(false);
  });

  it("builds allIndexed with pre-computed tokens", () => {
    const objects = [
      makeObj({ objectName: "CL_BCS_SEND", applicationComponent: "BC-SRV" }),
    ];
    const store = buildStore(objects, "test");
    expect(store.allIndexed.length).toBe(1);

    const indexed = store.allIndexed[0];
    expect(indexed.object.objectName).toBe("CL_BCS_SEND");
    expect(indexed.nameTokens).toContain("bcs");
    expect(indexed.nameTokens).toContain("send");
    expect(indexed.componentTokens).toContain("bc");
    expect(indexed.componentTokens).toContain("srv");
  });

  it("builds indexedByType", () => {
    const objects = [
      makeObj({ objectType: "CLAS", objectName: "CL_A" }),
      makeObj({ objectType: "DDLS", objectName: "I_X" }),
    ];
    const store = buildStore(objects, "test");
    expect(store.indexedByType.get("CLAS")?.length).toBe(1);
    expect(store.indexedByType.get("DDLS")?.length).toBe(1);
  });

  it("sets metadata fields", () => {
    const store = buildStore([], "public_cloud/latest");
    expect(store.sourceId).toBe("public_cloud/latest");
    expect(store.loadedAt).toBeInstanceOf(Date);
  });

  // -----------------------------------------------------------------------
  // Deduplication logic
  // -----------------------------------------------------------------------
  describe("deduplication", () => {
    it("keeps released over classicApi for same key", () => {
      const released = makeObj({
        objectName: "CL_SAME",
        source: "released",
        cleanCoreLevel: "A",
        state: "released",
      });
      const classic = makeObj({
        objectName: "CL_SAME",
        source: "classicApi",
        cleanCoreLevel: "B",
        state: "classicAPI",
      });
      // released is added first, then classicApi tries to overwrite → blocked
      const store = buildStore([released, classic], "test");
      expect(store.objectsMap.size).toBe(1);
      expect(store.objectsMap.get("CLAS:CL_SAME")!.source).toBe("released");
    });

    it("classicApi can overwrite another classicApi", () => {
      const first = makeObj({
        objectName: "CL_SAME",
        source: "classicApi",
        state: "classicAPI",
        applicationComponent: "OLD",
      });
      const second = makeObj({
        objectName: "CL_SAME",
        source: "classicApi",
        state: "classicAPI",
        applicationComponent: "NEW",
      });
      const store = buildStore([first, second], "test");
      expect(store.objectsMap.size).toBe(1);
      expect(store.objectsMap.get("CLAS:CL_SAME")!.applicationComponent).toBe("NEW");
    });

    it("classicApi overwrites released (if classicApi comes first, released can overwrite)", () => {
      // classicApi added first, then released overwrites it
      const classic = makeObj({
        objectName: "CL_SAME",
        source: "classicApi",
        state: "classicAPI",
      });
      const released = makeObj({
        objectName: "CL_SAME",
        source: "released",
        state: "released",
      });
      const store = buildStore([classic, released], "test");
      expect(store.objectsMap.get("CLAS:CL_SAME")!.source).toBe("released");
    });
  });

  it("handles empty input", () => {
    const store = buildStore([], "empty");
    expect(store.objectsMap.size).toBe(0);
    expect(store.allIndexed.length).toBe(0);
  });
});
