// ============================================================================
// SAP OAuth2 Authorization Code + PKCE
// Authenticates against XSUAA to access api.sap.com protected endpoints.
// Uses only Node.js built-in modules (no external dependencies).
// ============================================================================

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OAUTH_AUTH_ENDPOINT,
  OAUTH_TOKEN_ENDPOINT,
  OAUTH_CLIENT_ID,
  OAUTH_LOGIN_TIMEOUT_MS,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: string;
}

interface PersistedToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let cachedToken: PersistedToken | null = null;
let pendingAuth: Promise<string> | null = null;

const TOKEN_FILE = path.join(os.homedir(), ".sap-api-hub-token.json");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a valid access token for api.sap.com.
 * - Returns cached in-memory token if still valid
 * - Falls back to disk-persisted token
 * - Attempts refresh if a refresh_token is available
 * - Otherwise opens browser for interactive PKCE login
 */
export async function getAccessToken(): Promise<string> {
  // 1. In-memory token still valid?
  if (cachedToken && Date.now() < cachedToken.expires_at - 30_000) {
    return cachedToken.access_token;
  }

  // 2. Disk-persisted token?
  if (!cachedToken) {
    cachedToken = loadTokenFromDisk();
  }
  if (cachedToken && Date.now() < cachedToken.expires_at - 30_000) {
    return cachedToken.access_token;
  }

  // 3. Refresh token available?
  if (cachedToken?.refresh_token) {
    try {
      console.error("[OAuth] Attempting token refresh…");
      const tokenData = await refreshAccessToken(cachedToken.refresh_token);
      cacheAndPersist(tokenData);
      return cachedToken!.access_token;
    } catch (err) {
      console.error(
        `[OAuth] Refresh failed: ${err instanceof Error ? err.message : String(err)}`
      );
      // Fall through to browser auth
    }
  }

  // 4. Browser-based auth (with concurrency guard)
  if (pendingAuth) {
    return pendingAuth;
  }

  pendingAuth = authorizeViaBrowser().finally(() => {
    pendingAuth = null;
  });

  return pendingAuth;
}

/**
 * Clear the cached token (call after a 401 to force re-auth).
 */
export function clearTokenCache(): void {
  cachedToken = null;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ---------------------------------------------------------------------------
// Browser-based Authorization Code + PKCE flow
// ---------------------------------------------------------------------------

async function authorizeViaBrowser(): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");

  return new Promise<string>((resolve, reject) => {
    const server = http.createServer();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("OAuth login timed out. Please try again."));
      }
    }, OAUTH_LOGIN_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Could not start local OAuth callback server"));
        return;
      }

      const port = addr.port;
      const redirectUri = `http://localhost:${port}/callback`;

      const authUrl =
        `${OAUTH_AUTH_ENDPOINT}?` +
        new URLSearchParams({
          response_type: "code",
          client_id: OAUTH_CLIENT_ID,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
        }).toString();

      console.error(`[OAuth] Opening browser for SAP login…`);
      console.error(`[OAuth] If the browser doesn't open, visit: ${authUrl}`);
      openBrowser(authUrl);

      server.on("request", async (req, res) => {
        if (settled) {
          res.writeHead(400).end("Already processed");
          return;
        }

        const url = new URL(req.url ?? "/", `http://localhost:${port}`);

        if (url.pathname !== "/callback") {
          res.writeHead(404).end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          settled = true;
          clearTimeout(timeout);
          const desc = url.searchParams.get("error_description") ?? error;
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<html><body><h2>Authentication failed</h2><p>${desc}</p></body></html>`);
          server.close();
          reject(new Error(`OAuth error: ${desc}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Invalid callback</h2></body></html>");
          return;
        }

        try {
          const tokenData = await exchangeCode(code, redirectUri, codeVerifier);
          cacheAndPersist(tokenData);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body>" +
            "<h2>Authentication successful!</h2>" +
            "<p>You can close this tab and return to your IDE.</p>" +
            "</body></html>"
          );

          settled = true;
          clearTimeout(timeout);
          server.close();
          resolve(cachedToken!.access_token);
        } catch (err) {
          settled = true;
          clearTimeout(timeout);
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Token exchange failed</h2></body></html>");
          server.close();
          reject(err);
        }
      });
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Token exchange & refresh (HTTPS POST)
// ---------------------------------------------------------------------------

function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OAUTH_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  return postToken(body);
}

function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  }).toString();

  return postToken(body);
}

function postToken(body: string): Promise<TokenData> {
  return new Promise((resolve, reject) => {
    const url = new URL(OAUTH_TOKEN_ENDPOINT);
    const options: https.RequestOptions = {
      method: "POST",
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(text) as TokenData);
          } catch {
            reject(new Error(`Invalid token response: ${text.slice(0, 200)}`));
          }
        } else {
          reject(
            new Error(`Token request failed (HTTP ${res.statusCode}): ${text.slice(0, 300)}`)
          );
        }
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function cacheAndPersist(tokenData: TokenData): void {
  cachedToken = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
  };

  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(cachedToken), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (err) {
    console.error(
      `[OAuth] Could not persist token: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function loadTokenFromDisk(): PersistedToken | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    const data = JSON.parse(raw) as PersistedToken;
    if (data.access_token && data.expires_at) {
      return data;
    }
  } catch {
    // ignore corrupt files
  }
  return null;
}

// ---------------------------------------------------------------------------
// Open browser (cross-platform)
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;

  if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.error(`[OAuth] Could not open browser: ${err.message}`);
      console.error(`[OAuth] Please open this URL manually: ${url}`);
    }
  });
}
