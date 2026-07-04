# scriptable

Personal collection of scripts, widgets and helpers for [Scriptable](https://scriptable.app) on iOS, kept in sync with this GitHub repository through a small home-grown `push` / `pull` workflow.

Scriptable runs every script from a single flat iCloud folder. This repo organises the same files into folders (`widgets/`, `scripts/`, `helpers/`, `config/`) for readability and diffing; the sync tooling maps each file's base name to its type folder automatically.

## Repository layout

```
.
├── config/
│   ├── config.json          # GitHub user / repo / branch settings
│   ├── scripts-meta.json     # per-script version, type, hash, lastUpdated
│   └── update-meta.js        # pre-commit helper (keeps scripts-meta.json in sync)
├── helpers/
│   ├── Git.js               # GitHub sync helpers + content hash
│   ├── SetWidgetBackground.js
│   └── CountryEmojis.js
├── scripts/
│   ├── Pull.js              # GitHub → device sync
│   ├── Push.js              # device → GitHub sync
│   ├── McParking.js         # nearest MC parking finder (Oslo), run from Shortcuts
│   └── OnCall.js            # on-call shift / Focus mode helper, run from Shortcuts
├── widgets/
│   ├── Servers healthz.js   # server health status widget
│   ├── Shopping list.js     # Home Assistant shopping list widget
│   └── Countries a year.js  # countries visited this year widget
└── .githooks/
    └── pre-commit           # runs config/update-meta.js before every commit
```

`type` maps to a folder by pluralising it: `widget → widgets/`, `helper → helpers/`, `script → scripts/`.

## Contents

### Widgets

| Widget | What it does |
| --- | --- |
| **Servers healthz** | Checks a list of servers (`ServersList.js`, device-only) and shows each one's status with a colour-coded icon. Loads all servers in parallel with a short request timeout so a slow/timing-out server never blocks rendering on the Home Screen, and can send a notification when a server is down. |
| **Shopping list** | Fetches the shopping list from Home Assistant and displays it; falls back to the last stored list with an offline indicator when there's no connection. |
| **Countries a year** | Tracks the countries you've visited during the current year (stored in iCloud so it's shared across devices) and renders them with flag emojis. |

### Scripts

| Script | What it does |
| --- | --- |
| **Pull** | Syncs the device *from* GitHub. See [Sync workflow](#sync-workflow). |
| **Push** | Syncs the device *to* GitHub. See [Sync workflow](#sync-workflow). |
| **McParking** | MC parking finder for Oslo, triggered from iOS Shortcuts with `{ lat, lng }` to find the nearest spots, or `{ action: "update" }` to refresh its cache from the Oslo geodata API. |
| **OnCall** | Manages on-call shifts. Called from Shortcuts with the current Focus mode; checks the calendar for on-call events and returns the Focus mode to activate. |

### Helpers

| Helper | What it does |
| --- | --- |
| **Git** | Shared helpers used by Push/Pull: `computeHash`, `loadFmJSON`, `errorAlert`, `fetchGitHubFile`, `fetchGitHubJSON`. |
| **SetWidgetBackground** | Sets a widget's background from its widget parameter (a `Backgrounds/…` image path or a colour), falling back to a default colour. |
| **CountryEmojis** | Country name → ISO code → flag emoji lookup table, used by *Countries a year*. |

## Sync workflow

The device and this repo are kept in sync by two Scriptable scripts and a single manifest, `config/scripts-meta.json`, which records for every script:

```json
"Servers healthz": {
  "version": "1.1.2",
  "type": "widget",
  "lastUpdated": "2026-07-04T17:11:08.947Z",
  "hash": "5ec75303"
}
```

- **`version`** — semantic version, bumped on each meaningful change.
- **`hash`** — content hash (`helpers/Git.js` → `computeHash`), used to detect whether a file's contents actually changed.
- **`lastUpdated`** — ISO timestamp of the last change.
- **`type`** — `widget` | `script` | `helper`, which also determines the GitHub folder.

### Push (device → GitHub)

Run `Push` inside Scriptable to upload files. It:

1. Recomputes the hash of every local `.js` and refreshes `scripts-meta.json`.
2. Lets you multi-select which scripts to upload.
3. Asks for the `type` (first time only) and a version bump (major / minor / patch).
4. Uploads the selected files and the updated `scripts-meta.json` to GitHub.

### Pull (GitHub → device)

Run `Pull` inside Scriptable to download changes. For each script it compares local vs remote **version** and **content hash** and classifies it as:

- **New** — not present locally → offered for download.
- **Update** — remote version is newer and you have no local edits → offered for download.
- **Conflict** — remote is newer but you have local edits, or versions differ with mismatched content → reported, not auto-applied.
- **Skipped** — content already identical, or your local copy is newer.

When the content is already identical but the local metadata has drifted (e.g. a file was copied over manually, or pushed to GitHub outside of `Push`), Pull now **reconciles the local `scripts-meta.json` in place** without re-downloading, and lists the affected scripts in its summary (`🔧 Metadata synced: …`). This prevents stale metadata from causing false "local edits" conflicts on later pulls.

### Setup (on device)

1. Install [Scriptable](https://scriptable.app) and let it sync with iCloud.
2. Save a GitHub token once, from any script or the console:
   ```js
   Keychain.set("github_scriptable_token", "ghp_xxx")
   ```
3. Create `config/config.json` in your Scriptable folder:
   ```json
   {
     "GITHUB_USER": "YourUser",
     "GITHUB_REPO": "scriptable",
     "BRANCH": "main",
     "META_FILE": "config/scripts-meta.json"
   }
   ```
4. Add `Git.js`, `Push.js` and `Pull.js`, then run `Pull` to fetch everything else.

> **Device-only files.** Some entries in `scripts-meta.json` (e.g. `ServersList`, `Translate`, `Widget template`) live only on the device and aren't tracked as files in this repo. The tooling leaves them untouched.

## Local development (this repo)

When you edit files here on your machine, a **pre-commit hook** keeps `config/scripts-meta.json` consistent so a commit never leaves the sync state stale.

On every commit, for each staged `.js` under `widgets/`, `scripts/` or `helpers/`, `config/update-meta.js`:

- recomputes the content hash (same algorithm as `helpers/Git.js`),
- if the hash changed, bumps the version and updates `hash` + `lastUpdated`,
- creates a fresh entry (`v1.0.0`, `type` inferred from the folder) for new files,
- re-stages `config/scripts-meta.json` so it lands in the same commit.

### Enabling the hook

The hook is versioned in `.githooks/`, so enable it once per clone:

```sh
git config core.hooksPath .githooks
```

If `node` isn't on your `PATH`, the hook prints a warning and skips the update rather than blocking the commit.

### Version bump level

The bump defaults to **patch**. Override it per commit for a feature or breaking change:

```sh
META_BUMP=minor git commit -m "feat: ..."
META_BUMP=major git commit -m "feat!: ..."
```

Since this hook and `Push` both bump versions, prefer editing a script in one place at a time (here *or* on the device) to avoid double bumps.
