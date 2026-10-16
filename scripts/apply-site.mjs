// Replaces the toolchain's default repository page in bundles/ with the
// styled one from site/repo, plus the shared stylesheet and fonts.
import { cpSync, existsSync } from "node:fs";

if (!existsSync("bundles/versioning.json")) {
  console.error("apply-site: bundles/ not found, run `npm run bundle` first.");
  process.exit(1);
}

cpSync("site/repo/index.html", "bundles/index.html");
cpSync("site/repo/repo.js", "bundles/repo.js");
cpSync("site/styles.css", "bundles/styles.css");
cpSync("site/fonts", "bundles/fonts", { recursive: true });
console.log("apply-site: styled repository page written to bundles/");
