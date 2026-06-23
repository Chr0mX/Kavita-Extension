# Kavita Extension for Paperback

A [Paperback](https://paperback.moe) 0.9 extension that turns your
[Kavita](https://www.kavitareader.com) server into a content source. Browse your
libraries, search your collection, read chapters, and sync reading progress —
all from inside Paperback.

You sign in with your **server URL, username and password**. No API key needs to
be generated or copied by hand: the extension logs in for you, retrieves the
required token automatically, and re-authenticates transparently when it expires.

## Features

- Username / password login (no manual API key)
- Discover sections: On Deck, Recently Updated, Newly Added, and one per library
- Title search + advanced filtering by genres, tags and people
- Series details, metadata and cover art
- Volume / chapter browsing with images
- Reading progress sync and per-series rating / review
- Optional recursive search and the ability to hide book / novel libraries

## Installation

1. Open Paperback and go to **Settings → Extensions → Add Repository**.
2. Add the GitHub Pages URL for this repository:

   ```
   https://chr0mx.github.io/kavita-extension/0.9/stable
   ```

3. Install the **Kavita** extension from the list.
4. Open the extension settings, enter your **Server URL**, **Username** and
   **Password**, then tap **Log In / Test Connection**.

> Demo server you can try: URL `https://demo.kavitareader.com`, username
> `demouser`, password `Demouser64` (values are case-sensitive).

## Building from source

Requirements: Node.js 24+.

```bash
npm ci               # install dependencies
npm run conformance  # type-check, lint and format checks
npm run bundle       # produce the installable bundle in ./bundles
npm test             # run the test suite against the public demo server
```

`npm run bundle` writes the Paperback registry (`versioning.json`), an
`index.html` landing page, and the compiled extension into `./bundles`. The
contents of that directory are what gets published to GitHub Pages.

## Deployment (GitHub Pages)

Deployment is automated by `.github/workflows/bundle-deploy.yaml`:

- On every push to a branch matching `MAJOR.MINOR/*` (e.g. `0.9/stable`) the
  workflow bundles the extension and publishes `./bundles` to the `gh-pages`
  branch under a folder named after the branch.
- Enable GitHub Pages for the repository with **Source: Deploy from a branch**,
  branch `gh-pages`, folder `/ (root)`.
- The published registry is then available at
  `https://<user>.github.io/<repo>/<branch>` — for this repository,
  `https://chr0mx.github.io/kavita-extension/0.9/stable`.

`conformance.yaml` runs type / lint / format checks on pull requests, and
`test.yaml` runs the extension test suite.

## How authentication works

1. You provide the server URL, username and password in the settings form.
2. The extension calls `POST /api/Account/login`, which returns a JWT plus a
   long-lived **API key**. The API key and credentials are stored in Paperback's
   secure storage.
3. For data requests the interceptor obtains a bearer token by exchanging the
   API key via `POST /api/Plugin/authenticate`, caching it in memory.
4. On a `401`, the token is refreshed; if the API key itself was revoked, the
   extension silently logs in again with your stored credentials.
5. Cover and page images authenticate with the API key as a query parameter, so
   they load without a bearer token.

## License

GPL-3.0-or-later.
