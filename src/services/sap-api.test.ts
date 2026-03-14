// ============================================================================
// Unit tests for the SAP API service (pure functions only, no network)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  getEffectiveName,
  buildDescriptionUrls,
  stripHtml,
  parseValueResponse,
  parseMetadataResponse,
} from "./sap-api.js";

// ===========================================================================
// getEffectiveName
// ===========================================================================

describe("getEffectiveName", () => {
  it("adds PCE_ prefix for private_cloud with DDLS type", () => {
    expect(getEffectiveName("I_PRODUCT", "DDLS", "private_cloud")).toBe("PCE_I_PRODUCT");
  });

  it("adds PCE_ prefix for on_premise with BDEF type", () => {
    expect(getEffectiveName("I_PRODUCT", "BDEF", "on_premise")).toBe("PCE_I_PRODUCT");
  });

  it("adds PCE_ prefix for on_premise with BADI type", () => {
    expect(getEffectiveName("MY_BADI", "BADI", "on_premise")).toBe("PCE_MY_BADI");
  });

  it("does NOT add PCE_ prefix for public_cloud", () => {
    expect(getEffectiveName("I_PRODUCT", "DDLS", "public_cloud")).toBe("I_PRODUCT");
  });

  it("does NOT add PCE_ prefix for btp", () => {
    expect(getEffectiveName("I_PRODUCT", "DDLS", "btp")).toBe("I_PRODUCT");
  });

  it("does NOT double-prefix if already has PCE_", () => {
    expect(getEffectiveName("PCE_I_PRODUCT", "DDLS", "private_cloud")).toBe("PCE_I_PRODUCT");
  });

  it("does NOT add prefix for non-prefixable types like CLAS", () => {
    expect(getEffectiveName("CL_SOMETHING", "CLAS", "private_cloud")).toBe("CL_SOMETHING");
  });

  it("uppercases the name", () => {
    expect(getEffectiveName("i_product", "DDLS", "public_cloud")).toBe("I_PRODUCT");
  });
});

// ===========================================================================
// buildDescriptionUrls
// ===========================================================================

describe("buildDescriptionUrls", () => {
  it("builds correct URLs for DDLS type", () => {
    const result = buildDescriptionUrls("DDLS", "I_PRODUCT");
    expect(result).not.toBeNull();
    expect(result!.valueUrl).toBe(
      "https://api.sap.com/odata/1.0/catalog.svc/CdsViewsContent.CdsViews('I_PRODUCT')/$value"
    );
    expect(result!.metadataUrl).toBe(
      "https://api.sap.com/odata/1.0/catalog.svc/CdsViewsContent.CdsViews('I_PRODUCT')?$format=json"
    );
    expect(result!.spaUrl).toBe("https://api.sap.com/cdsviews/I_PRODUCT");
  });

  it("builds correct URLs for BDEF type", () => {
    const result = buildDescriptionUrls("BDEF", "I_PURCHASEORDERTP");
    expect(result).not.toBeNull();
    expect(result!.metadataUrl).toContain("BOInterfaceContent.BOInterfaces");
    expect(result!.spaUrl).toBe("https://api.sap.com/bointerface/I_PURCHASEORDERTP");
  });

  it("returns null for unsupported types", () => {
    expect(buildDescriptionUrls("CLAS", "CL_SOMETHING")).toBeNull();
    expect(buildDescriptionUrls("TABL", "MARA")).toBeNull();
  });

  it("is case-insensitive for object type", () => {
    const result = buildDescriptionUrls("ddls", "I_PRODUCT");
    expect(result).not.toBeNull();
    expect(result!.spaUrl).toBe("https://api.sap.com/cdsviews/I_PRODUCT");
  });

  it("encodes special characters in name", () => {
    const result = buildDescriptionUrls("DDLS", "/SCWM/I_PRODUCT");
    expect(result).not.toBeNull();
    expect(result!.metadataUrl).toContain("%2FSCWM%2FI_PRODUCT");
  });
});

// ===========================================================================
// stripHtml
// ===========================================================================

describe("stripHtml", () => {
  it("strips HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("  hello   world  ")).toBe("hello world");
  });

  it("decodes HTML entities", () => {
    expect(stripHtml("A &amp; B &lt; C &gt; D")).toBe("A & B < C > D");
  });

  it("handles complex HTML", () => {
    expect(
      stripHtml('<div class="desc"><p>Product</p><br/><p>Master Data</p></div>')
    ).toBe("Product Master Data");
  });
});

// ===========================================================================
// parseValueResponse
// ===========================================================================

describe("parseValueResponse", () => {
  const spaUrl = "https://api.sap.com/cdsviews/I_PRODUCT";

  it("parses a typical /$value response", () => {
    const raw = {
      ddlsourcename: "I_PRODUCT",
      cdsviewname: "I_Product",
      cdsviewtitle: "Product",
      description: "<p>Product Master Data</p>",
      status: "RELEASED",
      lineofbusiness: "Database & Data Management",
      applicationcomponent: "LO-MD-MM-2CL",
      category: "Basic",
      Capabilities: "SQL,CDS",
      keyuserext: "X",
      devext: "Released",
      cdsdoclink: "https://help.sap.com/doc1",
      fields: [
        {
          fieldname: "Product",
          description: "Product Number",
          datatype: "CHAR",
          fieldlength: "000040",
          successor: "",
        },
        {
          fieldname: "ProductType",
          description: "Product Type",
          datatype: "CHAR",
          fieldlength: "000004",
          successor: "",
        },
      ],
    };

    const result = parseValueResponse(raw, spaUrl);

    expect(result.source).toBe("full");
    expect(result.technicalName).toBe("I_PRODUCT");
    expect(result.displayName).toBe("I_Product");
    expect(result.title).toBe("Product");
    expect(result.description).toBe("Product Master Data");
    expect(result.status).toBe("RELEASED");
    expect(result.lineOfBusiness).toBe("Database & Data Management");
    expect(result.applicationComponent).toBe("LO-MD-MM-2CL");
    expect(result.category).toBe("Basic");
    expect(result.capabilities).toEqual(["SQL", "CDS"]);
    expect(result.keyUserExtensibility).toBe("X");
    expect(result.developerExtensibility).toBe("Released");
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].fieldname).toBe("Product");
    expect(result.fields[0].datatype).toBe("CHAR");
    expect(result.documentationLink).toBe("https://help.sap.com/doc1");
    expect(result.spaUrl).toBe(spaUrl);
  });

  it("handles missing fields array", () => {
    const raw = {
      ddlsourcename: "I_TEST",
      status: "RELEASED",
    };
    const result = parseValueResponse(raw, spaUrl);
    expect(result.fields).toEqual([]);
    expect(result.technicalName).toBe("I_TEST");
  });

  it("handles empty object", () => {
    const result = parseValueResponse({}, spaUrl);
    expect(result.source).toBe("full");
    expect(result.technicalName).toBe("");
    expect(result.fields).toEqual([]);
    expect(result.capabilities).toEqual([]);
  });

  it("strips HTML from description", () => {
    const raw = {
      description: "<div><p>Some <b>rich</b> text</p></div>",
    };
    const result = parseValueResponse(raw, spaUrl);
    expect(result.description).toBe("Some rich text");
  });

  it("handles capabilities as array", () => {
    const raw = {
      Capabilities: ["SQL", "CDS", "Search"],
    };
    const result = parseValueResponse(raw, spaUrl);
    expect(result.capabilities).toEqual(["SQL", "CDS", "Search"]);
  });
});

// ===========================================================================
// parseMetadataResponse
// ===========================================================================

describe("parseMetadataResponse", () => {
  const spaUrl = "https://api.sap.com/cdsviews/I_PRODUCT";

  it("parses a typical OData ?$format=json response", () => {
    const raw = {
      d: {
        __metadata: { type: "CdsViewsContentModel.CDSVIEW" },
        TechnicalName: "I_PRODUCT",
        DisplayName: "Product",
        Description: "I_Product (Basic)",
        State: "RELEASED",
        Capabilities:
          "Data Source for Data Extraction,Data Source in SQL Select,Analytical Dimension",
        ExtensibleWithKeyUserExtensibility: "Yes",
        ExtensibleWithDeveloperExtensibility: "No",
        Category: "Basic",
      },
    };

    const result = parseMetadataResponse(raw, spaUrl);

    expect(result.source).toBe("metadata");
    expect(result.technicalName).toBe("I_PRODUCT");
    expect(result.displayName).toBe("Product");
    expect(result.title).toBe("I_Product (Basic)");
    expect(result.status).toBe("RELEASED");
    expect(result.capabilities).toEqual([
      "Data Source for Data Extraction",
      "Data Source in SQL Select",
      "Analytical Dimension",
    ]);
    expect(result.keyUserExtensibility).toBe("Yes");
    expect(result.developerExtensibility).toBe("No");
    expect(result.category).toBe("Basic");
    expect(result.fields).toEqual([]);
    expect(result.spaUrl).toBe(spaUrl);
  });

  it("handles response without d wrapper", () => {
    const raw = {
      TechnicalName: "I_TEST",
      DisplayName: "Test",
      State: "RELEASED",
      Capabilities: "SQL",
    };
    const result = parseMetadataResponse(raw, spaUrl);
    expect(result.technicalName).toBe("I_TEST");
    expect(result.capabilities).toEqual(["SQL"]);
  });

  it("handles empty capabilities string", () => {
    const raw = {
      d: {
        TechnicalName: "I_TEST",
        Capabilities: "",
      },
    };
    const result = parseMetadataResponse(raw, spaUrl);
    expect(result.capabilities).toEqual([]);
  });

  it("handles null/undefined capabilities", () => {
    const raw = {
      d: {
        TechnicalName: "I_TEST",
      },
    };
    const result = parseMetadataResponse(raw, spaUrl);
    expect(result.capabilities).toEqual([]);
  });

  it("always returns empty fields and lineOfBusiness for metadata source", () => {
    const raw = {
      d: {
        TechnicalName: "I_PRODUCT",
        State: "RELEASED",
      },
    };
    const result = parseMetadataResponse(raw, spaUrl);
    expect(result.fields).toEqual([]);
    expect(result.lineOfBusiness).toBe("");
    expect(result.applicationComponent).toBe("");
    expect(result.documentationLink).toBe("");
  });
});
