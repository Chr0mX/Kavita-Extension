/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import { DEFAULT_OPTIONS, type KavitaCredentials, type KavitaOptions } from "./models";

// Secure storage keys (credentials + derived auth material).
const SECURE_KEYS = {
  serverUrl: "kavita.serverUrl",
  username: "kavita.username",
  password: "kavita.password",
  apiKey: "kavita.apiKey",
} as const;

// Non secure storage keys (display options).
const STATE_KEYS = {
  pageSize: "kavita.pageSize",
  showOnDeck: "kavita.showOnDeck",
  showRecentlyUpdated: "kavita.showRecentlyUpdated",
  showNewlyAdded: "kavita.showNewlyAdded",
  excludeUnsupportedLibrary: "kavita.excludeUnsupportedLibrary",
  enableRecursiveSearch: "kavita.enableRecursiveSearch",
} as const;

// Normalizes a user provided server URL into a base URL without a trailing slash.
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  while (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  // Strip a trailing /api if the user pasted the API root.
  if (url.toLowerCase().endsWith("/api")) {
    url = url.slice(0, -4);
  }
  return url;
}

// Returns the API root, e.g. "https://host/api".
export function apiUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/api`;
}

export function getCredentials(): KavitaCredentials {
  return {
    serverUrl: (Application.getSecureState(SECURE_KEYS.serverUrl) as string | undefined) ?? "",
    username: (Application.getSecureState(SECURE_KEYS.username) as string | undefined) ?? "",
    password: (Application.getSecureState(SECURE_KEYS.password) as string | undefined) ?? "",
    apiKey: (Application.getSecureState(SECURE_KEYS.apiKey) as string | undefined) ?? "",
  };
}

export function setCredentials(credentials: Partial<KavitaCredentials>): void {
  if (credentials.serverUrl !== undefined) {
    Application.setSecureState(normalizeServerUrl(credentials.serverUrl), SECURE_KEYS.serverUrl);
  }
  if (credentials.username !== undefined) {
    Application.setSecureState(credentials.username, SECURE_KEYS.username);
  }
  if (credentials.password !== undefined) {
    Application.setSecureState(credentials.password, SECURE_KEYS.password);
  }
  if (credentials.apiKey !== undefined) {
    Application.setSecureState(credentials.apiKey, SECURE_KEYS.apiKey);
  }
}

export function getOptions(): KavitaOptions {
  return {
    pageSize:
      (Application.getState(STATE_KEYS.pageSize) as number | undefined) ?? DEFAULT_OPTIONS.pageSize,
    showOnDeck:
      (Application.getState(STATE_KEYS.showOnDeck) as boolean | undefined) ??
      DEFAULT_OPTIONS.showOnDeck,
    showRecentlyUpdated:
      (Application.getState(STATE_KEYS.showRecentlyUpdated) as boolean | undefined) ??
      DEFAULT_OPTIONS.showRecentlyUpdated,
    showNewlyAdded:
      (Application.getState(STATE_KEYS.showNewlyAdded) as boolean | undefined) ??
      DEFAULT_OPTIONS.showNewlyAdded,
    excludeUnsupportedLibrary:
      (Application.getState(STATE_KEYS.excludeUnsupportedLibrary) as boolean | undefined) ??
      DEFAULT_OPTIONS.excludeUnsupportedLibrary,
    enableRecursiveSearch:
      (Application.getState(STATE_KEYS.enableRecursiveSearch) as boolean | undefined) ??
      DEFAULT_OPTIONS.enableRecursiveSearch,
  };
}

export function setOption<K extends keyof KavitaOptions>(key: K, value: KavitaOptions[K]): void {
  Application.setState(value, STATE_KEYS[key]);
}

// True when the user has completed the login flow at least once.
export function isConfigured(): boolean {
  const { serverUrl, apiKey } = getCredentials();
  return serverUrl !== "" && apiKey !== "";
}
