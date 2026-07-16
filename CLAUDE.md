# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page [Grist](https://www.getgrist.com/) custom widget: a Mermaid diagram editor. It shows a textarea (left, 30% width) for typing Mermaid source and a pan/zoomable rendered SVG canvas (right, 70% width). Edits are synced live to a Grist table column via the Grist Plugin API.

There is no build step, package manager, or test suite — it's two static files (`index.html`, `app.js`) loaded directly by Grist as a custom widget, with dependencies pulled from CDN (`grist-plugin-api.js`, `mermaid` from jsdelivr).

## Running / testing changes

There's no local dev server or build command. To test changes:
1. Serve the directory over HTTP (e.g. `python3 -m http.server`) since Grist widgets must be loaded via URL, not `file://`.
2. In a Grist document, add a Custom Widget pointing at that URL (or use "Custom URL" widget type), and map the widget's `mermaid` column to a text column in a table.
3. Verify: typing in the editor re-renders the diagram, writes back to the mapped Grist column, and switching records loads that record's diagram.

## Architecture

- **index.html** — layout/styling only (flex split-pane), loads `grist-plugin-api.js` and `mermaid` from CDN, then `app.js` as a module.
- **app.js** — all behavior, in a few small blocks:
  - **Zoom & pan**: mouse wheel scales (`scale`, clamped 0.1–5), drag pans (`translateX`/`translateY`); both are combined into a single CSS transform on `#diagram` via `updateTransform()`.
  - **`renderMermaid(code)`**: async render of Mermaid source to SVG via `mermaid.render()`. On success, replaces `#diagram` content and reapplies the pan/zoom transform. On failure, shows the error message in `#error` but deliberately leaves the last valid diagram on screen (see comment in code) to avoid flicker while the user is still typing.
  - **Grist sync**: `grist.ready({ requiredAccess: "full" })` initializes the widget. `grist.onRecord()` fires when the selected record changes — it only overwrites the editor's contents if the editor isn't currently focused (`document.activeElement !== editor`), so the widget doesn't clobber in-progress typing. Column mapping is read from the `mermaid` key in the `mappings` argument, defaulting to a column literally named `mermaid` if unmapped. On every editor `input` event, the widget both re-renders locally and pushes the new value back to Grist via `grist.selectedTable.update()`, keyed on `currentRecordId`.

Code comments in `app.js` are in French; keep that in mind when reading/extending them.
