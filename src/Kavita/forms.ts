/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  StepperRow,
  ToggleRow,
  type TagSection,
} from "@paperback/types";

import { AuthError, login } from "./auth";
import { DEFAULT_OPTIONS, type KavitaOptions, type KavitaSearchMetadata } from "./models";
import { apiPost } from "./requests";
import { getCredentials, getOptions, setOption } from "./settings";

// Server connection + source option settings.
export class SettingsForm extends Form {
  private serverUrl: string;
  private username: string;
  private password: string;
  private options: KavitaOptions;
  private status = "";

  constructor() {
    super();
    const credentials = getCredentials();
    this.serverUrl = credentials.serverUrl;
    this.username = credentials.username;
    this.password = credentials.password;
    this.options = getOptions();
  }

  override getSections() {
    return [
      Section("demo", [
        LabelRow("demoInfo", {
          title: "Demo Server",
          subtitle:
            "URL: https://demo.kavitareader.com\nUsername: demouser\nPassword: Demouser64\n(values are case-sensitive)",
        }),
      ]),

      Section("connection", [
        InputRow("serverUrl", {
          title: "Server URL",
          value: this.serverUrl,
          onValueChange: Application.Selector(this as SettingsForm, "setServerUrl"),
        }),
        InputRow("username", {
          title: "Username",
          value: this.username,
          onValueChange: Application.Selector(this as SettingsForm, "setUsername"),
        }),
        InputRow("password", {
          title: "Password",
          value: this.password,
          isSecureEntry: true,
          onValueChange: Application.Selector(this as SettingsForm, "setPassword"),
        }),
        ButtonRow("login", {
          title: "Log In / Test Connection",
          onSelect: Application.Selector(this as SettingsForm, "handleLogin"),
        }),
        ...(this.status ? [LabelRow("status", { title: "Status", subtitle: this.status })] : []),
      ]),

      Section("options", [
        ToggleRow("showOnDeck", {
          title: "Show On Deck",
          value: this.options.showOnDeck,
          onValueChange: Application.Selector(this as SettingsForm, "setShowOnDeck"),
        }),
        ToggleRow("showRecentlyUpdated", {
          title: "Show Recently Updated",
          value: this.options.showRecentlyUpdated,
          onValueChange: Application.Selector(this as SettingsForm, "setShowRecentlyUpdated"),
        }),
        ToggleRow("showNewlyAdded", {
          title: "Show Newly Added",
          value: this.options.showNewlyAdded,
          onValueChange: Application.Selector(this as SettingsForm, "setShowNewlyAdded"),
        }),
        ToggleRow("excludeUnsupportedLibrary", {
          title: "Exclude Book & Novel Libraries",
          value: this.options.excludeUnsupportedLibrary,
          onValueChange: Application.Selector(this as SettingsForm, "setExcludeUnsupportedLibrary"),
        }),
        InputRow("pageSize", {
          title: "Page Size",
          value: String(this.options.pageSize),
          onValueChange: Application.Selector(this as SettingsForm, "setPageSize"),
        }),
      ]),

      Section("experimental", [
        ToggleRow("enableRecursiveSearch", {
          title: "Enable Recursive Search",
          value: this.options.enableRecursiveSearch,
          onValueChange: Application.Selector(this as SettingsForm, "setEnableRecursiveSearch"),
        }),
      ]),
    ];
  }

  async setServerUrl(value: string): Promise<void> {
    this.serverUrl = value;
  }

  async setUsername(value: string): Promise<void> {
    this.username = value;
  }

  async setPassword(value: string): Promise<void> {
    this.password = value;
  }

  async handleLogin(): Promise<void> {
    if (!this.serverUrl || !this.username || !this.password) {
      this.status = "Please fill in the server URL, username and password.";
      this.reloadForm();
      return;
    }
    try {
      const user = await login(this.serverUrl, this.username, this.password);
      this.status = `Logged in successfully as ${user.username ?? this.username}.`;
    } catch (error) {
      this.status =
        error instanceof AuthError ? error.message : "Login failed due to an unexpected error.";
    }
    this.reloadForm();
  }

  async setShowOnDeck(value: boolean): Promise<void> {
    this.options.showOnDeck = value;
    setOption("showOnDeck", value);
  }

  async setShowRecentlyUpdated(value: boolean): Promise<void> {
    this.options.showRecentlyUpdated = value;
    setOption("showRecentlyUpdated", value);
  }

  async setShowNewlyAdded(value: boolean): Promise<void> {
    this.options.showNewlyAdded = value;
    setOption("showNewlyAdded", value);
  }

  async setExcludeUnsupportedLibrary(value: boolean): Promise<void> {
    this.options.excludeUnsupportedLibrary = value;
    setOption("excludeUnsupportedLibrary", value);
  }

  async setEnableRecursiveSearch(value: boolean): Promise<void> {
    this.options.enableRecursiveSearch = value;
    setOption("enableRecursiveSearch", value);
  }

  async setPageSize(value: string): Promise<void> {
    const parsed = parseInt(value, 10);
    const pageSize = Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_OPTIONS.pageSize : parsed;
    this.options.pageSize = pageSize;
    setOption("pageSize", pageSize);
  }
}

// Advanced search filters, populated from Kavita metadata (genres, tags, people).
// Kavita exposes a fixed set of filter groups, each gets a dedicated handler.
export class KavitaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private tags: string[];
  private people: string[];

  constructor(
    private genresSection: TagSection,
    private tagsSection: TagSection,
    private peopleSection: TagSection,
    initialSelected: string[],
  ) {
    super();
    const selectedFrom = (section: TagSection) =>
      initialSelected.filter((id) => section.tags.some((tag) => tag.id === id));
    this.genres = selectedFrom(genresSection);
    this.tags = selectedFrom(tagsSection);
    this.people = selectedFrom(peopleSection);
  }

  override getSections() {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: this.genresSection.title,
          value: this.genres,
          options: this.genresSection.tags,
          minItemCount: 0,
          maxItemCount: this.genresSection.tags.length,
          onValueChange: Application.Selector(this as KavitaAdvancedSearchForm, "handleGenres"),
        }),
      ]),
      Section("tags", [
        SelectRow("tags", {
          title: this.tagsSection.title,
          value: this.tags,
          options: this.tagsSection.tags,
          minItemCount: 0,
          maxItemCount: this.tagsSection.tags.length,
          onValueChange: Application.Selector(this as KavitaAdvancedSearchForm, "handleTags"),
        }),
      ]),
      Section("people", [
        SelectRow("people", {
          title: this.peopleSection.title,
          value: this.people,
          options: this.peopleSection.tags,
          minItemCount: 0,
          maxItemCount: this.peopleSection.tags.length,
          onValueChange: Application.Selector(this as KavitaAdvancedSearchForm, "handlePeople"),
        }),
      ]),
    ];
  }

  async handleGenres(value: string[]): Promise<void> {
    this.genres = value;
  }

  async handleTags(value: string[]): Promise<void> {
    this.tags = value;
  }

  async handlePeople(value: string[]): Promise<void> {
    this.people = value;
  }

  override getSearchQueryMetadata(): KavitaSearchMetadata {
    return { includedTags: [...this.genres, ...this.tags, ...this.people] };
  }
}

type ProgressFormState = {
  libraryId: string;
  pagesRead: number;
  pages: number;
  rating: number;
  review: string;
};

// Per-series tracking form: shows progress info and lets the user set a
// rating/review, persisted immediately to Kavita on change.
export class KavitaProgressManagementForm extends Form {
  private rating: number;
  private review: string;

  constructor(
    private mangaId: string,
    private state: ProgressFormState,
  ) {
    super();
    this.rating = state.rating;
    this.review = state.review;
  }

  override getSections() {
    return [
      Section("info", [
        LabelRow("seriesId", { title: "Series ID", value: this.mangaId }),
        LabelRow("libraryId", { title: "Library ID", value: this.state.libraryId }),
        LabelRow("pagesRead", {
          title: "Pages Read",
          value: `${this.state.pagesRead} / ${this.state.pages}`,
        }),
      ]),
      Section("review", [
        StepperRow("rating", {
          title: "Rating",
          value: this.rating,
          minValue: 0,
          maxValue: 5,
          stepValue: 1,
          loopOver: false,
          onValueChange: Application.Selector(this as KavitaProgressManagementForm, "setRating"),
        }),
        InputRow("review", {
          title: "Review",
          value: this.review,
          onValueChange: Application.Selector(this as KavitaProgressManagementForm, "setReview"),
        }),
      ]),
    ];
  }

  async setRating(value: number): Promise<void> {
    this.rating = value;
    await this.persist();
  }

  async setReview(value: string): Promise<void> {
    this.review = value;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await apiPost("/Series/update-rating", {
      seriesId: parseInt(this.mangaId, 10),
      userRating: this.rating,
      userReview: this.review,
    });
  }
}
