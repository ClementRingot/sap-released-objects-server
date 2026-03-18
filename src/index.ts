#!/usr/bin/env node

// ============================================================================
// SAP Released Objects Server
// Main entry point — supports both stdio and HTTP transports
// Exposes MCP protocol on /mcp and REST API on /api
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { registerTools } from "./tools/register-tools.js";
import { createApiRouter } from "./routes/api-routes.js";

// ---------------------------------------------------------------------------
// Create and configure the MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "sap-released-objects-server",
  version: "1.0.0",
});

// Register all tools
registerTools(server);

// ---------------------------------------------------------------------------
// Transport: stdio (default)
// ---------------------------------------------------------------------------

async function runStdio(): Promise<void> {
  console.error("[SAP Released Objects MCP] Starting in stdio mode...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[SAP Released Objects MCP] Server connected via stdio");
}

// ---------------------------------------------------------------------------
// Transport: Streamable HTTP
// ---------------------------------------------------------------------------

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "sap-released-objects-server" });
  });

  // REST API endpoints
  app.use("/api", createApiRouter());

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3001");
  app.listen(port, () => {
    console.error(
      `[SAP Released Objects MCP] HTTP server running on http://localhost:${port}`
    );
    console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`  REST API:     http://localhost:${port}/api`);
    console.error(`  Health:       http://localhost:${port}/health`);
  });
}

// ---------------------------------------------------------------------------
// Choose transport based on environment
// ---------------------------------------------------------------------------

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
