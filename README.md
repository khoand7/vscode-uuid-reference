# UUID Reference (VS Code Extension)

Turn cryptic UUIDs into human-readable descriptions. Point the extension at one or more
**JSON definition files**, tell it **which key holds the UUID** and **which key holds the
description**, and it will:

- **Hover** over any known UUID in an editor → description tooltip
- **Select** a UUID → description appears in the **status bar** (click it for full details)
- Run **“UUID Reference: Look Up Selected UUID”** from the command palette or the editor
  right-click menu → QuickPick with *Copy description*, *Copy UUID* and *Open source file*
- Run **“UUID Reference: Browse All UUIDs”** → fuzzy-searchable list of every definition
- Edit a definition file → the index **auto-reloads** (file watcher), or use
  **“UUID Reference: Reload Definition Files”**

Everything is configured through the standard VS Code Settings UI
(`Ctrl/Cmd+,` → search **“uuidReference”**), plus a guided
**“UUID Reference: Add Definition File…”** command that walks you through picking a file
and its keys.

---

## Installation

### From a packaged `.vsix`

```bash
npm install
npm run package        # produces vscode-uuid-reference-0.1.0.vsix
code --install-extension vscode-uuid-reference-0.1.0.vsix
```

(In VS Code: *Extensions* view → `…` menu → *Install from VSIX…*.)

### Run from source (development)

1. Open this folder in VS Code.
2. `npm install`
3. Press `F5` (launches an Extension Development Host with the extension loaded).

---

## Configuration

Open Settings (`Ctrl/Cmd+,`) and search for `uuidReference`:

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `uuidReference.sources` | array | `[]` | One entry **per JSON definition file** (see below) |
| `uuidReference.hover.enabled` | boolean | `true` | Show description on hover |
| `uuidReference.statusBar.enabled` | boolean | `true` | Show description of the selected UUID in the status bar |
| `uuidReference.statusBar.maxLength` | number | `60` | Truncate status-bar description to N characters |

Each item of `uuidReference.sources` has:

| Property | Default | Meaning |
| --- | --- | --- |
| `path` | *(required)* | Path to the JSON file. Supports **absolute paths**, `~/…`, `${workspaceFolder}/…`, or a path **relative to the first workspace folder**. |
| `uuidKey` | `id` | Key that contains the UUID. **Dot paths** supported (e.g. `meta.guid`). |
| `descriptionKey` | `description` | Key that contains the description. **Dot paths** supported (e.g. `details.label`). |

### Example (`settings.json`)

```jsonc
{
  "uuidReference.sources": [
    {
      // default keys: "id" + "description"
      "path": "${workspaceFolder}/data/service-registry.json"
    },
    {
      // custom keys via dot paths
      "path": "~/team/feature-flags.json",
      "uuidKey": "meta.guid",
      "descriptionKey": "details.label"
    },
    {
      "path": "C:/shared/error-codes.json",
      "uuidKey": "code",
      "descriptionKey": "message"
    }
  ]
}
```

If the same UUID appears in several sources, **the first source listed wins**.
Load status and any warnings (missing file, invalid JSON…) are logged to the
**Output panel → “UUID Reference”**.

---

## Supported JSON shapes

The extension is tolerant — all of these work (see the `samples/` folder in the extension source):

**1. Array of objects (anywhere, even nested under wrapper keys)** — uses `uuidKey`/`descriptionKey`:

```json
{
  "services": [
    { "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479", "description": "Auth Service" }
  ]
}
```

**2. Direct `UUID → string` map** (keys are used as-is):

```json
{
  "2f4a9c1e-3b8d-4e5f-9a01-b2c3d4e5f607": "Database connection lost"
}
```

**3. Direct `UUID → object` map** (description read from `descriptionKey`):

```json
{
  "2f4a9c1e-3b8d-4e5f-9a01-b2c3d4e5f607": { "description": "Database connection lost", "severity": "high" }
}
```

Non-string descriptions are JSON-stringified; entries whose key value is not a valid
`8-4-4-4-12` UUID are silently skipped.

---

## Commands

| Command | What it does |
| --- | --- |
| `UUID Reference: Look Up Selected UUID` | Looks up the selection (or the UUID under the cursor) and shows details with copy/open actions |
| `UUID Reference: Browse All UUIDs` | Searchable QuickPick over every indexed definition |
| `UUID Reference: Reload Definition Files` | Re-reads all sources and reports counts/problems |
| `UUID Reference: Add Definition File…` | Guided flow: pick a JSON file → enter its UUID/description keys → choose Workspace or Global scope |
| `UUID Reference: Open Settings` | Jumps to the extension’s settings |

---

## Development

```bash
npm run compile   # tsc → out/
npm run watch     # incremental compile
npm test          # indexer unit tests + extension smoke tests (pure Node, no VS Code needed)
npm run package   # build the .vsix
```

The smoke test (`scripts/smoke-activate.js`) loads the compiled extension against a mock
of the VS Code API and verifies activation, indexing from a real sample file, the status
bar, the hover provider, and every command handler.

Project layout:

```
src/uuid.ts       UUID regex helpers (pure)
src/indexer.ts    JSON → entries extraction (pure, unit-tested)
src/config.ts     settings access + path resolution
src/extension.ts  activation, hover, status bar, commands, watchers
samples/          example definition files for all supported shapes
scripts/          indexer unit tests
```

## License

MIT
