# SF Translations Manager

VS Code extension for browsing and editing generated translation JSON files from one place.

The extension scans the current workspace for translation files, merges all locale keys into a webview panel, and writes edited values back to the JSON file that owns the edited locale/key entry.

## Features

- Opens a dedicated **SF Translations Manager** panel in VS Code.
- Finds translation files with a configurable glob pattern.
- Merges translations by locale and key.
- Saves edited translation values back to the source JSON file for each locale/key cell.
- Provides a shortcut command for opening the extension settings.

## Translation File Format

Translation files should be JSON objects grouped by locale. Each locale contains key/value pairs where values are strings.

```json
{
  "en": {
    "common.save": "Save",
    "common.cancel": "Cancel"
  },
  "de": {
    "common.save": "Speichern",
    "common.cancel": "Abbrechen"
  }
}
```

Only string values are loaded into the manager. Nested objects, arrays, numbers, booleans, and null values are ignored.

## Default File Lookup

By default, the extension searches for:

```text
**/__generated__/translations*.json
```

That matches files such as:

```text
src/__generated__/translations.json
packages/app/__generated__/translations.de.json
```

## Configuration

You can change where the extension looks for translation files through VS Code settings.

Setting:

```json
{
  "sfTranslationsManager.translationsLocation": "**/__generated__/translations*.json"
}
```

Example for a custom translations folder:

```json
{
  "sfTranslationsManager.translationsLocation": "src/translations/*.json"
}
```

## Usage

1. Open a workspace that contains translation JSON files.
2. Run the command **SF Translations Manager: Open** from the Command Palette.
3. If no files are found, run **SF Translations Manager: Open Settings** and adjust `sfTranslationsManager.translationsLocation`.
4. Edit translation values in the panel.
5. Save changes from the panel. The extension updates the matching JSON file and formats it with two-space indentation.

## Commands

| Command ID | Purpose |
| --- | --- |
| `sfTranslationsManager.open` | Finds translation files and opens the translations manager panel. |
| `sfTranslationsManager.openSettings` | Opens VS Code settings filtered to `sfTranslationsManager`. |

## How Saving Works

When files are loaded, the extension tracks which JSON file each locale/key value came from. When a value is saved, it:

1. Opens the original JSON file.
2. Parses the file.
3. Ensures the selected locale exists.
4. Updates `data[locale][key]`.
5. Writes the file back as formatted JSON.

If a locale/key value already exists in multiple files, the last file found by sorted path order owns that exact cell in the manager. For a missing value, the manager saves to the known file for that locale first, then falls back to the known file for that key.

## Expected Extension Assets

The runtime extension expects a `webview` directory inside the packaged extension:

```text
webview/index.html
webview/script.js
webview/style.css
```

`index.html` may define the panel title with:

```html
<meta name="panel-title" content="SF Translations Manager">
```

If this metadata is missing, the fallback title is `SF Translations Manager`.

## Development

The extension source lives in:

```text
src/extension.ts
webview/index.html
webview/script.js
webview/style.css
```

Compile the extension with:

```text
npm run compile
```

The compiled extension entrypoint is generated in:

```text
dist/extension.js
```

The extension uses the VS Code API at runtime, so it must be run inside VS Code as an extension. The `vscode` module is provided by VS Code and is not installed as a normal runtime dependency.
