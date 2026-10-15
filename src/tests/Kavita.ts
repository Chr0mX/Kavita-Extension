import { type TestLogger } from "@paperback/types";

import { login } from "../Kavita/auth.js";
import { Kavita } from "../Kavita/main.js";
import { isAuthRequest } from "../Kavita/network.js";
import sourceInfo from "../Kavita/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

// Public Kavita demo server used for end to end tests.
const DEMO_URL = "https://demo.kavitareader.com";
const DEMO_USER = "demouser";
const DEMO_PASSWORD = "Demouser64";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Kavita tests", logger);

  await Kavita.initialise();
  try {
    await login(DEMO_URL, DEMO_USER, DEMO_PASSWORD);
  } catch (error) {
    logger.log("login-error", String(error));
  }

  registerDefaultTests(suite, Kavita, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "a" }, undefined, undefined],
    },
  });

  // Exercise every discover section (On Deck / Recently Added / Recently
  // Updated / per-library) to ensure none of them error.
  suite.test("getDiscoverSectionItems", async () => {
    const sections = await Kavita.getDiscoverSections();
    for (const section of sections) {
      await Kavita.getDiscoverSectionItems(section, undefined);
    }
  });

  // Auth endpoints must bypass the interceptor, or token acquisition recurses.
  suite.test("auth requests bypass interceptor", async () => {
    const base = "https://host/api";
    const expectations: [string, boolean][] = [
      [`${base}/Account/login`, true],
      [`${base}/Plugin/authenticate?apiKey=abc&pluginName=x`, true],
      [`${base}/Library/libraries`, false],
      [`${base}/Series/1?next=/Account/login`, false],
    ];
    for (const [url, expected] of expectations) {
      if (isAuthRequest(url) !== expected) {
        throw new Error(`isAuthRequest(${url}) should be ${expected}`);
      }
    }
  });

  await suite.run();
}
