/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import type { Tag } from "@paperback/types";

// Kavita publication status codes mapped to human readable strings.
export const KAVITA_PUBLICATION_STATUS: Record<number, string> = {
  0: "Ongoing",
  1: "Hiatus",
  2: "Completed",
  3: "Cancelled",
  4: "Ended",
};

// Kavita person role ids mapped to the field names used by the Series filter endpoints.
export const KAVITA_PERSON_ROLES: Record<number, string> = {
  1: "other",
  2: "artist",
  3: "writers", // /Series/all uses 'writers' instead of 'writer'
  4: "penciller",
  5: "inker",
  6: "colorist",
  7: "letterer",
  8: "coverArtist",
  9: "editor",
  10: "publisher",
  11: "character",
  12: "translators", // /Series/all uses 'translators' instead of 'translator'
};

// Stored, non secure source options.
export type KavitaOptions = {
  pageSize: number;
  showOnDeck: boolean;
  showRecentlyUpdated: boolean;
  showNewlyAdded: boolean;
  excludeUnsupportedLibrary: boolean;
  enableRecursiveSearch: boolean;
};

export const DEFAULT_OPTIONS: KavitaOptions = {
  pageSize: 40,
  showOnDeck: true,
  showRecentlyUpdated: true,
  showNewlyAdded: true,
  // Hide EPUB/text (Book, Light Novel) libraries by default since Paperback's
  // image reader cannot render them; users can opt back in from settings.
  excludeUnsupportedLibrary: true,
  enableRecursiveSearch: false,
};

// Securely stored credentials and derived authentication material.
export type KavitaCredentials = {
  // Normalized base server URL, e.g. "https://demo.kavitareader.com".
  serverUrl: string;
  username: string;
  password: string;
  // API key returned by /Account/login, used for image URLs and token issuance.
  apiKey: string;
};

// Subset of Kavita's UserDto returned by /Account/login.
export type KavitaUserDto = {
  username?: string;
  email?: string;
  token?: string;
  refreshToken?: string;
  apiKey?: string;
};

// Search metadata flowing between the advanced search form and getSearchResults.
export type KavitaSearchMetadata = {
  page?: number;
  // Tag ids selected in the advanced search form, encoded as "<group>-<id>".
  includedTags?: string[];
};

// Discover/search pagination metadata.
export type KavitaPageMetadata = {
  page: number;
};

export const SORT_FIELD = {
  sortName: 1,
} as const;

// Helper to build a Paperback Tag from a Kavita metadata entry.
export function createTag(id: string, title: string): Tag {
  return { id, title };
}

// Simple in memory cache with a 3 minute TTL, ported from the v0.8 CacheManager.
export class CacheManager {
  private cachedData: Record<number, { time: number; data: unknown }> = {};

  private getHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  get<T>(key: string): T | undefined {
    const now = Date.now();
    // Drop entries older than 180 seconds.
    for (const [hash, value] of Object.entries(this.cachedData)) {
      if (now - value.time >= 180 * 1000) {
        delete this.cachedData[Number(hash)];
      }
    }
    return this.cachedData[this.getHash(key)]?.data as T | undefined;
  }

  set(key: string, data: unknown): void {
    const hash = this.getHash(key);
    const time = this.cachedData[hash]?.time ?? Date.now();
    this.cachedData[hash] = { time, data };
  }
}
