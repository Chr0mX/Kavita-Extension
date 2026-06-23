/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import {
  BasicRateLimiter,
  ContentRating,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type ChapterReadActionQueueProcessingResult,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type MangaProgress,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
  type TagSection,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import { isServerAvailable } from "./auth";
import { KavitaAdvancedSearchForm, KavitaProgressManagementForm, SettingsForm } from "./forms";
import { CacheManager, KAVITA_PUBLICATION_STATUS, type KavitaSearchMetadata } from "./models";
import { KavitaInterceptor } from "./network";
import type KavitaConfig from "./pbconfig";
import { apiGet, apiPost, imageUrl } from "./requests";
import { defaultSortOptions, performSearch } from "./search";
import { getOptions, isConfigured } from "./settings";

// Sorts chapters by volume then chapter number, keeping insertion order ties.
type ChapterEntry = {
  chapter: Chapter;
  volume: number;
  chapNum: number;
  index: number;
};

function sortChapters(a: ChapterEntry, b: ChapterEntry): number {
  if (a.volume === b.volume) {
    return a.chapNum === b.chapNum ? a.index - b.index : a.chapNum - b.chapNum;
  }
  // Volume 0 (specials / no-volume) sorts last.
  return a.volume === 0 || b.volume === 0 ? b.volume - a.volume : a.volume - b.volume;
}

type KavitaVolume = {
  name: string;
  number: number;
  chapters: KavitaChapter[];
};
type KavitaChapter = {
  id: number;
  number: string;
  range: string;
  titleName?: string;
  isSpecial: boolean;
  pages: number;
  pagesRead: number;
  releaseDate: string;
  created: string;
  lastReadingProgressUtc: string;
};
type KavitaLibrary = { id: number; name: string; type: number };
type KavitaSeriesSummary = {
  id?: number;
  seriesId?: number;
  name?: string;
  seriesName?: string;
  libraryId?: number;
};
type KavitaMetadataItem = { id: number; title: string };
type KavitaPerson = { id: number; name: string; role: number };

export class KavitaExtension implements ExtensionImpl<typeof KavitaConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 8,
    bufferInterval: 1,
    ignoreImages: true,
  });

  interceptor = new KavitaInterceptor("main");

  cache = new CacheManager();

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new SettingsForm();
  }

  // ----- Discover -----

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    if (!isConfigured() || !(await isServerAvailable())) {
      return [];
    }

    const { showOnDeck, showRecentlyUpdated, showNewlyAdded, excludeUnsupportedLibrary } =
      getOptions();
    const sections: DiscoverSection[] = [];

    if (showOnDeck) {
      sections.push({
        id: "ondeck",
        title: "On Deck",
        type: DiscoverSectionType.simpleCarousel,
      });
    }
    if (showRecentlyUpdated) {
      sections.push({
        id: "recentlyupdated",
        title: "Recently Updated",
        type: DiscoverSectionType.simpleCarousel,
      });
    }
    if (showNewlyAdded) {
      sections.push({
        id: "newlyadded",
        title: "Newly Added",
        type: DiscoverSectionType.simpleCarousel,
      });
    }

    const libraries = await apiGet<KavitaLibrary[]>("/Library/libraries");
    for (const library of libraries) {
      if (excludeUnsupportedLibrary && library.type === 2) continue;
      sections.push({
        id: `library-${library.id}`,
        title: library.name,
        type: DiscoverSectionType.simpleCarousel,
      });
    }

    return sections;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: { page: number } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const { pageSize } = getOptions();
    const page = metadata?.page ?? 1;

    let series: KavitaSeriesSummary[];
    if (section.id === "ondeck") {
      series = await apiGet<KavitaSeriesSummary[]>(
        `/Series/on-deck?PageNumber=${page}&PageSize=${pageSize}`,
      );
    } else if (section.id === "newlyadded") {
      series = await apiGet<KavitaSeriesSummary[]>(
        `/Series/recently-added-v2?PageNumber=${page}&PageSize=${pageSize}`,
      );
    } else if (section.id === "recentlyupdated") {
      // Not server paginated; fetch once and slice.
      const all = await apiGet<KavitaSeriesSummary[]>("/Series/recently-updated-series");
      series = all.slice((page - 1) * pageSize, page * pageSize);
    } else {
      // Library section.
      const libraryId = parseInt(section.id.replace("library-", ""), 10);
      series = await apiPost<KavitaSeriesSummary[]>(
        `/Series/v2?PageNumber=${page}&PageSize=${pageSize}`,
        {
          statements: [{ comparison: 0, field: 19, value: `${libraryId}` }],
          combination: 1,
          sortOptions: { sortField: 1, isAscending: true },
          limitTo: 0,
        },
      );
    }

    const items: DiscoverSectionItem[] = series.map((s) => {
      const id = s.seriesId ?? s.id ?? 0;
      return {
        type: "simpleCarouselItem",
        mangaId: `${id}`,
        title: s.seriesName ?? s.name ?? "Unknown Title",
        imageUrl: imageUrl(`/image/series-cover?seriesId=${id}`),
      };
    });

    return {
      items,
      metadata: items.length < pageSize ? undefined : { page: page + 1 },
    };
  }

  // ----- Search -----

  async getAdvancedSearchForm(
    query: SearchQuery<KavitaSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    const selected = query.metadata?.includedTags ?? [];

    const [genres, tags, people] = await Promise.all([
      apiGet<KavitaMetadataItem[]>("/Metadata/genres"),
      apiGet<KavitaMetadataItem[]>("/Metadata/tags"),
      apiGet<KavitaPerson[]>("/Metadata/people"),
    ]);

    const genresSection: TagSection = {
      id: "genres",
      title: "Genres",
      tags: genres.map((g) => ({ id: `genres-${g.id}`, title: g.title })),
    };
    const tagsSection: TagSection = {
      id: "tags",
      title: "Tags",
      tags: tags.map((t) => ({ id: `tags-${t.id}`, title: t.title })),
    };
    const peopleSeen = new Set<string>();
    const peopleTags: Tag[] = [];
    for (const person of people) {
      if (peopleSeen.has(person.name)) continue;
      peopleSeen.add(person.name);
      peopleTags.push({ id: `people-${person.role}.${person.id}`, title: person.name });
    }
    const peopleSection: TagSection = { id: "people", title: "People", tags: peopleTags };

    return new KavitaAdvancedSearchForm(genresSection, tagsSection, peopleSection, selected);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return defaultSortOptions();
  }

  async getSearchResults(
    query: SearchQuery<KavitaSearchMetadata>,
    metadata?: KavitaSearchMetadata,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    void sortingOption;
    return performSearch(query, metadata, this.cache);
  }

  // ----- Manga details -----

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const [series, meta] = await Promise.all([
      apiGet<Record<string, unknown>>(`/Series/${mangaId}`),
      apiGet<Record<string, unknown>>(`/Series/metadata?seriesId=${mangaId}`),
    ]);

    const tagGroups: TagSection[] = [];
    for (const group of ["genres", "tags"] as const) {
      const raw = (meta[group] as KavitaMetadataItem[] | undefined) ?? [];
      tagGroups.push({
        id: group,
        title: group === "genres" ? "Genres" : "Tags",
        tags: raw.map((t) => ({ id: `${group}-${t.id}`, title: t.title })),
      });
    }

    const writers = ((meta.writers as KavitaPerson[] | undefined) ?? []).map((w) => w.name);
    const pencillers = ((meta.pencillers as KavitaPerson[] | undefined) ?? []).map((p) => p.name);
    const summary = (meta.summary as string | undefined) ?? "";
    const status =
      KAVITA_PUBLICATION_STATUS[(meta.publicationStatus as number | undefined) ?? -1] ?? "Unknown";

    const name = (series.name as string | undefined) ?? "Unknown Title";
    const originalName = series.originalName as string | undefined;

    return {
      mangaId,
      mangaInfo: {
        thumbnailUrl: imageUrl(`/image/series-cover?seriesId=${mangaId}`),
        synopsis: summary.replace(/<[^>]+>/g, "") || "No synopsis.",
        primaryTitle: name,
        secondaryTitles: originalName && originalName !== name ? [originalName] : [],
        contentRating: ContentRating.EVERYONE,
        status,
        author: writers.join(", "),
        artist: pencillers.join(", "),
        rating: series.userRating as number | undefined,
        tagGroups,
        artworkUrls: [imageUrl(`/image/series-cover?seriesId=${mangaId}`)],
      },
    };
  }

  // ----- Chapters -----

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    void sinceDate;
    const volumes = await apiGet<KavitaVolume[]>(`/Series/volumes?seriesId=${sourceManga.mangaId}`);

    const regular: ChapterEntry[] = [];
    const specials: ChapterEntry[] = [];

    let index = 0;
    let specialCounter = 1;
    for (const volume of volumes) {
      for (const c of volume.chapters) {
        const isSpecial = c.isSpecial;
        const chapNum =
          c.number === "-100000" ? 1 : isSpecial ? specialCounter++ : parseFloat(c.number);
        const volumeNumber = isSpecial || volume.name === "-100000" ? 0 : parseFloat(volume.name);

        const trimmed = c.range.endsWith(".epub") ? c.range.slice(0, -5) : c.range.slice(0, -4);
        const baseName =
          c.number === c.range
            ? (c.titleName ?? "")
            : `${c.range.replace(`${c.number}-`, "")}${c.titleName ? ` - ${c.titleName}` : ""}`;
        const title = isSpecial ? trimmed : baseName || undefined;

        const chapter: Chapter = {
          chapterId: `${c.id}`,
          sourceManga,
          langCode: "en",
          chapNum: Number.isNaN(chapNum) ? 0 : chapNum,
          title,
          volume: volumeNumber,
        };

        const entry: ChapterEntry = {
          chapter,
          volume: volumeNumber,
          chapNum: chapter.chapNum,
          index: index++,
        };
        (isSpecial ? specials : regular).push(entry);
      }
    }

    regular.sort(sortChapters);
    return regular.concat(specials).map((entry, i) => ({ ...entry.chapter, sortingIndex: i }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const info = await apiGet<{ pages: number }>(`/Series/chapter?chapterId=${chapter.chapterId}`);

    const pages: string[] = [];
    for (let i = 0; i < info.pages; i++) {
      pages.push(
        imageUrl(`/Reader/image?chapterId=${chapter.chapterId}&page=${i}&extractPdf=true`),
      );
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // ----- Reading progress -----

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    const chapters = await this.getChapters(sourceManga);
    const volumes = await apiGet<KavitaVolume[]>(`/Series/volumes?seriesId=${sourceManga.mangaId}`);

    // Map chapterId -> read state and timestamp.
    const readState = new Map<string, { read: boolean; time: Date }>();
    for (const volume of volumes) {
      for (const c of volume.chapters) {
        readState.set(`${c.id}`, {
          read: c.pages > 0 && c.pagesRead === c.pages,
          time: new Date(c.lastReadingProgressUtc),
        });
      }
    }

    let lastReadChapter: Chapter | undefined;
    let lastReadTime: Date | undefined;
    for (const chapter of chapters) {
      const state = readState.get(chapter.chapterId);
      if (state?.read) {
        lastReadChapter = chapter;
        lastReadTime = state.time;
      } else {
        break;
      }
    }

    if (!lastReadChapter) {
      return undefined;
    }
    return { sourceManga, lastReadChapter, lastReadTime };
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    const series = await apiGet<Record<string, unknown>>(`/Series/${sourceManga.mangaId}`);
    return new KavitaProgressManagementForm(sourceManga.mangaId, {
      libraryId: `${(series.libraryId as number | undefined) ?? ""}`,
      pagesRead: (series.pagesRead as number | undefined) ?? 0,
      pages: (series.pages as number | undefined) ?? 0,
      rating: (series.userRating as number | undefined) ?? 0,
      review: (series.userReview as string | undefined) ?? "",
    });
  }

  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    const successfulItems: string[] = [];
    const failedItems: string[] = [];

    for (const action of actions) {
      try {
        const info = await apiGet<{
          volumeId: number;
          seriesId: number;
          libraryId: number;
          pages: number;
        }>(`/Reader/chapter-info?chapterId=${action.chapterId}`);

        await apiPost("/Reader/progress", {
          volumeId: info.volumeId,
          chapterId: parseInt(action.chapterId, 10),
          pageNum: info.pages,
          seriesId: info.seriesId,
          libraryId: info.libraryId,
        });

        successfulItems.push(action.id);
      } catch {
        failedItems.push(action.id);
      }
    }

    return { successfulItems, failedItems };
  }
}

export const Kavita = new KavitaExtension();
