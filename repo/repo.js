// Renders the Paperback repository page from versioning.json and wires up the
// paperback:// deep links (same URLs the toolchain's default page uses).
const baseUrl = window.location.href
  .split(/[?#]/)[0]
  .replace(/index\.html$/, "")
  .replace(/\/$/, "");

const CAPABILITIES = [
  [1, "Content Provider"],
  [2, "Tracker"],
  [8, "Collections"],
  [16, "Cloudflare"],
];

const RATINGS = { SAFE: "rating-safe", MATURE: "rating-mature", ADULT: "rating-18" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function capabilityLabels(capabilities) {
  const values = Array.isArray(capabilities)
    ? capabilities
    : CAPABILITIES.map(([bit]) => bit).filter((bit) => (capabilities & bit) === bit);
  return CAPABILITIES.filter(([bit]) => values.includes(bit)).map(([, label]) => label);
}

function installUrl(sourceId) {
  return `paperback://installExtensions?data=${btoa(JSON.stringify([[sourceId, baseUrl]]))}`;
}

function renderSource(source) {
  const card = el("li", "repo-card");
  const top = el("div", "repo-top");

  const icon = el("img", "source-logo");
  icon.src = `${baseUrl}/${source.id}/static/${source.icon}`;
  icon.alt = "";
  icon.width = 56;
  icon.height = 56;

  const left = el("div", "repo-left");
  const titleRow = el("div", "repo-title-row");
  titleRow.append(
    el("h2", "repo-name", source.name),
    el("span", "repo-version-badge", `v${source.version}`),
  );
  left.append(titleRow, el("p", "source-description", source.description));

  const chips = el("div", "chip-row");
  for (const label of capabilityLabels(source.capabilities ?? [])) {
    chips.append(el("span", "chip", label));
  }
  if (source.contentRating) {
    const rating = source.contentRating.toUpperCase();
    chips.append(el("span", `chip ${RATINGS[rating] ?? ""}`, rating));
  }
  if (source.language) chips.append(el("span", "chip", source.language.toUpperCase()));
  left.append(chips);

  const actions = el("div", "repo-actions");
  const install = el("a", "repo-add", "Install");
  install.href = installUrl(source.id);
  actions.append(install);

  top.append(icon, left, actions);
  card.append(top);
  return card;
}

async function main() {
  const addButton = document.getElementById("add-repo");
  const list = document.getElementById("sources");
  const error = document.getElementById("error");

  try {
    const response = await fetch(`${baseUrl}/versioning.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Failed to load repository data (HTTP ${response.status}).`);
    const data = await response.json();

    const { name, description } = data.repository;
    document.title = name;
    document.getElementById("repo-name").textContent = name;
    document.getElementById("repo-description").textContent = description;

    addButton.addEventListener("click", () => {
      window.location.href = `paperback://addRepo?displayName=${encodeURIComponent(name)}&url=${encodeURIComponent(baseUrl)}`;
    });

    list.replaceChildren(...data.sources.map(renderSource));

    if (data.buildTime) {
      const built = new Date(data.buildTime).toLocaleString();
      const toolchain = data.builtWith?.toolchain
        ? ` with toolchain ${data.builtWith.toolchain}`
        : "";
      document.getElementById("build-info").textContent = `Built ${built}${toolchain}.`;
    }
  } catch (err) {
    addButton.disabled = true;
    error.hidden = false;
    error.textContent = `⚠️ ${err instanceof Error ? err.message : "Failed to load repository data."}`;
  }
}

void main();
