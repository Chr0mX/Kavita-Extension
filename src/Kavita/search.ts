/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import type { PagedResults, SearchQuery, SearchResultItem } from "@paperback/types";

import { isServerAvailable } from "./auth";
import type { CacheManager } from "./models";
import { KAVITA_PERSON_ROLES, type KavitaSearchMetadata, SORT_FIELD } from "./models";
import { apiGet, apiPost, imageUrl } from "./requests";
import { getOptions } from "./settings";

type KavitaLibrary = { id: number; type: number };
type KavitaSeries = { id?: number; seriesId?: number; name?: string; libraryId?: number };
type KavitaSearchResponse = {
  series: { seriesId: number; name: string; libraryId: number }[];
  genres: { id: number }[];
  tags: { id: number }[];
  persons: { id: number; role: number }[];
};
type KavitaPerson = { id: number; name: string; role: number };

function seriesTile(series: KavitaSeries): SearchResultItem {
  const id = series.seriesId ?? series.id ?? 0;
  return {
    mangaId: `${id}`,
    title: series.name ?? "Unknown Title",
    imageUrl: imageUrl(`/image/series-cover?seriesId=${id}`),
  };
}

// Resolves the library ids that should be hidden when "exclude unsupported" is on.
async function getExcludedLibraryIds(exclude: boolean): Promise<Set<number>> {
  const excluded = new Set<number>();
  if (!exclude) {
    return excluded;
  }
  const libraries = await apiGet<KavitaLibrary[]>("/Library/libraries");
  for (const library of libraries) {
    // type 2 = Book, type 4 = Light Novel: unsupported image-less libraries.
    if (library.type === 2 || library.type === 4) {
      excluded.add(library.id);
    }
  }
  return excluded;
}

export async function performSearch(
  query: SearchQuery<KavitaSearchMetadata>,
  metadata: KavitaSearchMetadata | undefined,
  cache: CacheManager,
): Promise<PagedResults<SearchResultItem>> {
  // Called for global search too; must not throw when the server is unavailable.
  if (!(await isServerAvailable())) {
    return { items: [] };
  }

  const { pageSize, excludeUnsupportedLibrary, enableRecursiveSearch } = getOptions();
  const page = metadata?.page ?? 0;
  const includedTags = query.metadata?.includedTags ?? [];
  const excludedLibraries = await getExcludedLibraryIds(excludeUnsupportedLibrary);

  // Empty query with no filters: surface recently added series (server paginated).
  if (!query.title && includedTags.length === 0) {
    const recent = await apiPost<KavitaSeries[]>(
      `/Series/recently-added-v2?PageNumber=${page + 1}&PageSize=${pageSize}`,
      {},
    );
    const items = recent.filter((s) => !excludedLibraries.has(s.libraryId ?? -1)).map(seriesTile);
    return { items, metadata: items.length === 0 ? undefined : { page: page + 1 } };
  }

  const cacheKey = JSON.stringify({ title: query.title, tags: includedTags });
  let combined = cache.get<SearchResultItem[]>(cacheKey);

  if (combined === undefined) {
    const seenIds = new Set<string>();
    const titleTiles: SearchResultItem[] = [];
    const tagTiles: SearchResultItem[] = [];

    if (query.title) {
      const result = await apiGet<KavitaSearchResponse>(
        `/Search/search?queryString=${encodeURIComponent(query.title)}`,
      );

      for (const series of result.series ?? []) {
        if (excludedLibraries.has(series.libraryId)) continue;
        const tile = seriesTile(series);
        seenIds.add(tile.mangaId);
        titleTiles.push(tile);
      }

      // Optional recursive search: also include series sharing a matched tag.
      if (enableRecursiveSearch) {
        await appendRecursiveMatches(result, seenIds, titleTiles);
      }
    }

    if (includedTags.length > 0) {
      const body = await buildTagFilterBody(includedTags);
      const tagged = await apiPost<KavitaSeries[]>("/Series/all", body);
      for (const series of tagged) {
        tagTiles.push(seriesTile(series));
      }
    }

    // When both a title and tags are provided, intersect; otherwise concatenate.
    combined =
      tagTiles.length > 0 && titleTiles.length > 0
        ? tagTiles.filter((t) => titleTiles.some((u) => u.mangaId === t.mangaId))
        : titleTiles.concat(tagTiles);

    cache.set(cacheKey, combined);
  }

  const slice = combined.slice(page * pageSize, (page + 1) * pageSize);
  return { items: slice, metadata: slice.length === 0 ? undefined : { page: page + 1 } };
}

// Expands a title search by querying series that share each matched tag/person.
async function appendRecursiveMatches(
  result: KavitaSearchResponse,
  seenIds: Set<string>,
  tiles: SearchResultItem[],
): Promise<void> {
  const queries: { field: string; id: number }[] = [];
  for (const genre of result.genres ?? []) queries.push({ field: "genres", id: genre.id });
  for (const tag of result.tags ?? []) queries.push({ field: "tags", id: tag.id });
  for (const person of result.persons ?? []) {
    const field = KAVITA_PERSON_ROLES[person.role];
    if (field) queries.push({ field, id: person.id });
  }

  for (const { field, id } of queries) {
    const matches = await apiPost<KavitaSeries[]>("/Series/all", { [field]: [id] });
    for (const series of matches) {
      const tile = seriesTile(series);
      if (!seenIds.has(tile.mangaId)) {
        seenIds.add(tile.mangaId);
        tiles.push(tile);
      }
    }
  }
}

// Builds the /Series/all filter body from selected tag ids.
async function buildTagFilterBody(includedTags: string[]): Promise<Record<string, number[]>> {
  const body: Record<string, number[]> = {};
  const peopleIds: number[] = [];

  for (const encoded of includedTags) {
    const [group, rest] = encoded.split("-", 2);
    if (!group || !rest) continue;
    if (group === "people") {
      // Encoded as "people-<role>.<id>".
      const id = parseInt(rest.split(".")[1] ?? rest, 10);
      if (!Number.isNaN(id)) peopleIds.push(id);
    } else {
      const id = parseInt(rest, 10);
      if (Number.isNaN(id)) continue;
      (body[group] ??= []).push(id);
    }
  }

  // Group selected people by their Kavita role field name.
  if (peopleIds.length > 0) {
    const people = await apiGet<KavitaPerson[]>("/Metadata/people");
    for (const person of people) {
      if (!peopleIds.includes(person.id)) continue;
      const field = KAVITA_PERSON_ROLES[person.role];
      if (!field) continue;
      (body[field] ??= []).push(person.id);
    }
  }

  return body;
}

// Sorting options offered to Paperback's search UI.
export function defaultSortOptions() {
  return [
    { id: `${SORT_FIELD.sortName}-asc`, label: "Name (A-Z)" },
    { id: `${SORT_FIELD.sortName}-desc`, label: "Name (Z-A)" },
  ];
}
