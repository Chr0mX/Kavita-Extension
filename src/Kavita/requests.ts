/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import type { Request } from "@paperback/types";

import { reauthenticate } from "./auth";
import { apiUrl, getCredentials } from "./settings";

// Builds an absolute API URL from a path like "/Series/123".
export function apiPath(path: string): string {
  const { serverUrl } = getCredentials();
  return `${apiUrl(serverUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

// Builds an authenticated image URL (cover / reader page). These authenticate
// purely via the apiKey query parameter, so no bearer token is required.
export function imageUrl(path: string): string {
  const { serverUrl, apiKey } = getCredentials();
  const separator = path.includes("?") ? "&" : "?";
  return `${apiUrl(serverUrl)}${path}${separator}apiKey=${encodeURIComponent(apiKey)}`;
}

function decodeBody(data: ArrayBuffer): unknown {
  const text = Application.arrayBufferToUTF8String(data);
  if (!text) {
    return undefined;
  }
  return JSON.parse(text);
}

// Performs an authenticated API request. The registered interceptor injects the
// bearer token; on a 401 the token is refreshed and the request retried once.
export async function apiRequest<T>(request: Request): Promise<T> {
  let [response, data] = await Application.scheduleRequest(request);

  if (response.status === 401) {
    await reauthenticate();
    [response, data] = await Application.scheduleRequest(request);
  }

  if (response.status >= 400) {
    throw new Error(`Kavita request failed (HTTP ${response.status}): ${request.url}`);
  }

  return (decodeBody(data) ?? []) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>({ url: apiPath(path), method: "GET" });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>({
    url: apiPath(path),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
