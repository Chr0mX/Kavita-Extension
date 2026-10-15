/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import type { KavitaUserDto } from "./models";
import { apiUrl, getCredentials, setCredentials } from "./settings";

// Plugin name reported to Kavita when exchanging the API key for a JWT.
const PLUGIN_NAME = "Kavita-Paperback";

// The bearer token is cached in shared Application secure state rather than a
// module variable: Paperback runs the extension across multiple JS contexts, so
// a module-level cache is not shared and would cause every request to
// re-authenticate. `inFlight` deduplicates concurrent acquisitions within a
// single context (single-flight).
const TOKEN_KEY = "kavita.bearerToken";
// Records the last failed token acquisition (shared across contexts) so queued
// requests fail fast instead of each re-running the whole login sequence.
const FAILURE_KEY = "kavita.authFailure";
const FAILURE_COOLDOWN_MS = 30_000;
let inFlight: Promise<string> | undefined;

export class AuthError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function decodeBody(data: ArrayBuffer): unknown {
  const text = Application.arrayBufferToUTF8String(data);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getStoredToken(): string | undefined {
  const token = Application.getSecureState(TOKEN_KEY) as string | undefined;
  return token ? token : undefined;
}

function setStoredToken(token: string): void {
  Application.setSecureState(token, TOKEN_KEY);
}

export function clearToken(): void {
  Application.setSecureState("", TOKEN_KEY);
}

function recordFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : "Authentication failed.";
  Application.setSecureState(JSON.stringify({ at: Date.now(), message }), FAILURE_KEY);
}

function clearFailure(): void {
  Application.setSecureState("", FAILURE_KEY);
}

// Throws the last recorded failure while it is still within the cooldown window.
function assertNotCoolingDown(): void {
  const raw = Application.getSecureState(FAILURE_KEY) as string | undefined;
  if (!raw) {
    return;
  }
  try {
    const { at, message } = JSON.parse(raw) as { at: number; message: string };
    if (Date.now() - at < FAILURE_COOLDOWN_MS) {
      throw new AuthError(message);
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    clearFailure();
  }
}

// Performs a username/password login against Kavita, returning the UserDto.
// Persists the normalized server URL, credentials and the returned API key.
export async function login(
  serverUrl: string,
  username: string,
  password: string,
): Promise<KavitaUserDto> {
  const base = apiUrl(serverUrl);

  let response;
  let data;
  try {
    [response, data] = await Application.scheduleRequest({
      url: `${base}/Account/login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new AuthError("Could not reach the Kavita server. Check the server URL and try again.");
  }

  if (response.status === 401 || response.status === 400) {
    throw new AuthError("Invalid username or password.", response.status);
  }
  if (response.status >= 400) {
    throw new AuthError(`Login failed (HTTP ${response.status}).`, response.status);
  }

  const user = decodeBody(data) as KavitaUserDto | undefined;
  if (!user?.apiKey) {
    throw new AuthError("Login succeeded but no API key was returned by the server.");
  }

  setCredentials({ serverUrl, username, password, apiKey: user.apiKey });
  clearFailure();
  // Cache the freshly issued JWT when present; otherwise drop any stale token so
  // the next request mints one from the API key.
  if (user.token) {
    setStoredToken(`Bearer ${user.token}`);
  } else {
    clearToken();
  }
  return user;
}

// Exchanges the stored API key for a bearer token via the Plugin endpoint.
async function authenticateWithApiKey(apiKey: string): Promise<string> {
  const { serverUrl } = getCredentials();
  const base = apiUrl(serverUrl);

  let response;
  let data;
  try {
    [response, data] = await Application.scheduleRequest({
      url: `${base}/Plugin/authenticate?apiKey=${encodeURIComponent(apiKey)}&pluginName=${PLUGIN_NAME}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    throw new AuthError("Could not reach the Kavita server. Check the server URL and try again.");
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers?.["Location"] ?? response.headers?.["location"];
    throw new AuthError(
      `Authentication was redirected (HTTP ${response.status}${location ? ` to ${location}` : ""}). Check the server URL for an http/https or port mismatch.`,
      response.status,
    );
  }
  if (response.status >= 400) {
    throw new AuthError(`Authentication failed (HTTP ${response.status}).`, response.status);
  }

  const result = decodeBody(data) as { token?: string } | undefined;
  if (!result?.token) {
    throw new AuthError("Server did not return an authentication token.");
  }
  return `Bearer ${result.token}`;
}

async function acquireTokenUncached(): Promise<string> {
  const credentials = getCredentials();
  if (!credentials.serverUrl || !credentials.apiKey) {
    throw new AuthError("Kavita is not configured. Open the source settings and log in.");
  }

  try {
    return await authenticateWithApiKey(credentials.apiKey);
  } catch (error) {
    // Only re-login when the server rejected the API key itself (revoked or
    // rotated). Network errors, redirects and 5xx responses are not fixed by a
    // login, so they surface as-is.
    const keyRejected =
      error instanceof AuthError && (error.status === 401 || error.status === 403);
    if (!keyRejected || !credentials.username || !credentials.password) {
      throw error;
    }

    // Single re-login attempt; login() caches the JWT it is given.
    await login(credentials.serverUrl, credentials.username, credentials.password);
    const cached = getStoredToken();
    if (cached) {
      return cached;
    }
    return authenticateWithApiKey(getCredentials().apiKey);
  }
}

// Acquires a token from the API key, falling back to one re-login if the key
// was revoked. The result is written to shared state; failures are remembered
// for a short cooldown.
async function acquireToken(): Promise<string> {
  assertNotCoolingDown();
  try {
    const token = await acquireTokenUncached();
    setStoredToken(token);
    clearFailure();
    return token;
  } catch (error) {
    recordFailure(error);
    throw error;
  }
}

// Ensures a valid bearer token is available, re-authenticating if needed.
// Returns the shared cached token without a network call when one exists.
export async function ensureToken(): Promise<string> {
  const existing = getStoredToken();
  if (existing) {
    return existing;
  }
  // Coalesce concurrent acquisitions so only one Plugin/authenticate is sent.
  inFlight ??= acquireToken().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

// Forces a fresh token to be issued on the next request (used after a 401).
export async function reauthenticate(): Promise<string> {
  clearToken();
  inFlight ??= acquireToken().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

// Lightweight availability probe used by homepage/search which must not throw.
export async function isServerAvailable(): Promise<boolean> {
  try {
    await ensureToken();
    return true;
  } catch {
    return false;
  }
}
