# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page [Grist](https://www.getgrist.com/) custom widget: a Markdown editor with embedded Mermaid diagram support. It shows a textarea (left, 30% width) for typing Markdown (which may contain ` ```mermaid ` fenced code blocks) and a pan/zoomable rendered canvas (right, 70% width) showing the Markdown as HTML with each Mermaid block replaced by its rendered SVG. Edits are synced live to a Grist table column via the Grist Plugin API.

There is no build step, package manager, or test suite — it's two static files (`index.html`, `app.js`) loaded directly by Grist as a custom widget, with dependencies pulled from CDN (`grist-plugin-api.js`, `mermaid`, and `marked` from jsdelivr).

## Running / testing changes

There's no local dev server or build command. To test changes:

1. Serve the directory over HTTP (e.g. `python3 -m http.server`) since Grist widgets must be loaded via URL, not `file://`.
2. In a Grist document, add a Custom Widget pointing at that URL (or use "Custom URL" widget type), and map the widget's `markdown` column to a text column in a table.
3. Verify: typing in the editor re-renders the content, writes back to the mapped Grist column, and switching records loads that record's content.

For a quick check without a real Grist host, load `index.html` in a browser (e.g. via Playwright), stub `window.grist` if needed, then set `#editor`'s value and dispatch an `input` event directly — `grist.ready()`/`onRecord()` failing silently (no real Grist parent frame) doesn't block the render path, since the editor's `input` listener is registered before those calls run.

## Architecture

- **index.html** — layout/styling only (flex split-pane), loads `grist-plugin-api.js`, `mermaid`, and `marked` from CDN, then `app.js` as a module.
- **app.js** — all behavior, in a few small blocks:
  - **Zoom & pan**: mouse wheel scales (`scale`, clamped 0.1–5), drag pans (`translateX`/`translateY`); both are combined into a single CSS transform on `#diagram` via `updateTransform()`.
  - **`renderContent(text)`**: converts the editor text to HTML via `marked.parse()` and sets it as `#diagram`'s content, then calls `renderMermaidBlocks()` to walk the resulting `code.language-mermaid` elements (marked's default class for a ` ```mermaid ` fence) and replace each with its rendered SVG via `mermaid.render()`. Diagrams that fail to render are left in place as their raw source (styled via `.mermaid-error`) rather than the whole render being discarded, and every failing block's error message is collected and shown in `#error` — this preserves the original design's flicker-avoidance while now working per-diagram instead of for the whole document.
  - **Grist sync**: `grist.ready()` declares a required `markdown` column (`columns: [...]`) — this is what lets Grist offer column mapping in the Creator Panel and correctly link the widget to cell/row selection; without it, `mappings` passed to callbacks is never populated. `grist.onRecord()` fires when the selected record changes — it only overwrites the editor's contents if the editor isn't currently focused (`document.activeElement !== editor`), so the widget doesn't clobber in-progress typing. `grist.onRecords()` provides a startup fallback: if no record has arrived via `onRecord` yet (`currentRecordId === null`), it shows the first row whose mapped column isn't empty, so the widget isn't blank before any cell is selected. Both handlers route through `loadRecord()`/`getMappedColumn()` to share this logic. On every editor `input` event, the widget both re-renders locally and pushes the new value back to Grist via `grist.selectedTable.update()`, keyed on `currentRecordId`.

Code comments in `app.js` are in French; keep that in mind when reading/extending them.
