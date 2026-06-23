/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import type { KavitaUserDto } from "./models";
import { apiUrl, getCredentials, setCredentials } from "./settings";

// Plugin name reported to Kavita when exchanging the API key for a JWT.
const PLUGIN_NAME = "Kavita-Paperback";

// In memory cache of the current bearer token. Tokens are short lived and are
// transparently re-issued from the stored API key, so they are not persisted.
let cachedToken: string | undefined;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
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

export function clearToken(): void {
  cachedToken = undefined;
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
    throw new AuthError("Invalid username or password.");
  }
  if (response.status >= 400) {
    throw new AuthError(`Login failed (HTTP ${response.status}).`);
  }

  const user = decodeBody(data) as KavitaUserDto | undefined;
  if (!user?.apiKey) {
    throw new AuthError("Login succeeded but no API key was returned by the server.");
  }

  setCredentials({ serverUrl, username, password, apiKey: user.apiKey });
  // Prefer the freshly issued JWT when present.
  cachedToken = user.token ? `Bearer ${user.token}` : undefined;
  return user;
}

// Exchanges the stored API key for a bearer token via the Plugin endpoint.
async function authenticateWithApiKey(apiKey: string): Promise<string> {
  const { serverUrl } = getCredentials();
  const base = apiUrl(serverUrl);

  const [response, data] = await Application.scheduleRequest({
    url: `${base}/Plugin/authenticate?apiKey=${encodeURIComponent(apiKey)}&pluginName=${PLUGIN_NAME}`,
    method: "POST",
  });

  if (response.status >= 400) {
    throw new AuthError(`Authentication failed (HTTP ${response.status}).`);
  }

  const result = decodeBody(data) as { token?: string } | undefined;
  if (!result?.token) {
    throw new AuthError("Server did not return an authentication token.");
  }
  return `Bearer ${result.token}`;
}

// Ensures a valid bearer token is available, re-logging in if the API key was revoked.
export async function ensureToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  const credentials = getCredentials();
  if (!credentials.serverUrl || !credentials.apiKey) {
    throw new AuthError("Kavita is not configured. Open the source settings and log in.");
  }

  try {
    cachedToken = await authenticateWithApiKey(credentials.apiKey);
    return cachedToken;
  } catch (error) {
    // The API key may have been revoked; silently re-login with stored credentials.
    if (credentials.username && credentials.password) {
      await login(credentials.serverUrl, credentials.username, credentials.password);
      const refreshed = getCredentials();
      cachedToken = await authenticateWithApiKey(refreshed.apiKey);
      return cachedToken;
    }
    throw error;
  }
}

// Forces a fresh token to be issued on the next request (used after a 401).
export async function reauthenticate(): Promise<string> {
  clearToken();
  return ensureToken();
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
