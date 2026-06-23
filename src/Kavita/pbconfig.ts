/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Kavita",
  description:
    "Kavita client extension for Paperback. Authenticate with your username and password.",
  version: "1.0.1",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.EVERYONE,
  capabilities: [
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.PROGRESS_PROVIDING,
  ],
  badges: [{ label: "Kavita", textColor: "#ffffff", backgroundColor: "#4ac694" }],
  developers: [
    {
      name: "Kavita Extension Contributors",
      website: "https://www.kavitareader.com",
      github: "https://github.com/chr0mx/kavita-extension",
    },
  ],
} satisfies ExtensionInfo;
