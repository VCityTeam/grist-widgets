# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collection of independent [Grist](https://www.getgrist.com/) custom widgets, one per top-level folder. Each widget is a self-contained pair of static files (`index.html`, `app.js`) with no build step, package manager, or test suite — dependencies are pulled from CDN and the files are loaded directly by Grist as a custom widget. The whole repo is deployed as-is to GitHub Pages (`.github/workflows/static.yml`), so a new widget just needs its own folder plus a line in `README.md`; each widget's URL is `https://vcityteam.github.io/grist-widgets/<folder>/index.html`.

There's no local dev server or build command for any widget. To test changes to a widget:

1. Serve the repo root over HTTP (e.g. `python3 -m http.server`) since Grist widgets must be loaded via URL, not `file://`.
2. In a Grist document, add a Custom Widget pointing at `http://<host>/<folder>/index.html`, and map its declared columns to columns in a table.
3. Verify the widget's read/write sync: editing data in the widget writes back to Grist, and switching the selected record loads that record's data.

For a quick check without a real Grist host, load the widget's `index.html` in a browser (e.g. via Playwright) with the CDN `grist-plugin-api.js` request intercepted/stubbed (a real one installs its own `window.grist` via postMessage RPC and will clobber a plain stub set via `addInitScript`), fire `window.grist`'s `onRecord`/`onRecords`/`onOptions`/`on('message', ...)` handlers manually with fake data, then interact with the DOM directly (set values, dispatch events, click buttons) and assert on both the DOM and any `docApi.applyUserActions` calls captured by the stub.

## Widgets

### markdown-mermaid

A Markdown editor with embedded Mermaid diagram support. It shows a textarea (left, 30% width) for typing Markdown (which may contain ` ```mermaid ` fenced code blocks) and a pan/zoomable rendered canvas (right, 70% width) showing the Markdown as HTML with each Mermaid block replaced by its rendered SVG. Edits are synced live to a Grist table column via the Grist Plugin API. Dependencies: `grist-plugin-api.js`, `mermaid`, and `marked` from jsdelivr.

- **index.html** — layout/styling only (flex split-pane), loads `grist-plugin-api.js`, `mermaid`, and `marked` from CDN, then `app.js` as a module.
- **app.js** — all behavior, in a few small blocks:
  - **Zoom & pan**: mouse wheel scales (`scale`, clamped 0.1–5), drag pans (`translateX`/`translateY`); both are combined into a single CSS transform on `#diagram` via `updateTransform()`.
  - **`renderContent(text)`**: converts the editor text to HTML via `marked.parse()` and sets it as `#diagram`'s content, then calls `renderMermaidBlocks()` to walk the resulting `code.language-mermaid` elements (marked's default class for a ` ```mermaid ` fence) and replace each with its rendered SVG via `mermaid.render()`. Diagrams that fail to render are left in place as their raw source (styled via `.mermaid-error`) rather than the whole render being discarded, and every failing block's error message is collected and shown in `#error` — this preserves the original design's flicker-avoidance while now working per-diagram instead of for the whole document.
  - **Grist sync**: `grist.ready()` declares a required `markdown` column (`columns: [...]`) — this is what lets Grist offer column mapping in the Creator Panel and correctly link the widget to cell/row selection; without it, `mappings` passed to callbacks is never populated. `grist.onRecord()` fires when the selected record changes — it only overwrites the editor's contents if the editor isn't currently focused (`document.activeElement !== editor`), so the widget doesn't clobber in-progress typing. `grist.onRecords()` provides a startup fallback: if no record has arrived via `onRecord` yet (`currentRecordId === null`), it shows the first row whose mapped column isn't empty, so the widget isn't blank before any cell is selected. Both handlers route through `loadRecord()`/`getMappedColumn()` to share this logic. On every editor `input` event, the widget both re-renders locally and pushes the new value back to Grist via `grist.selectedTable.update()`, keyed on `currentRecordId`.

### geocoding-map

Geocodes an `Address` column via the public [Nominatim](https://nominatim.org/) API (`nominatim.openstreetmap.org/search`, `format=jsonv2&extratags=1&polygon_geojson=1`) and visualizes the results live on a [Leaflet](https://leafletjs.com/) map, either as points (`Latitude`/`Longitude`) or as arbitrary GeoJSON geometry (`GeoJson`) — unlike [gristlabs/grist-widget's map widget](https://github.com/gristlabs/grist-widget/tree/master/map), which only supports points and doesn't geocode. Layout is a fixed-width status/log panel (left) and the map (right, `#map-container`).

- **index.html** — panel + map layout/styling only, loads `grist-plugin-api.js` and `leaflet` from CDN, then `app.js` as a module.
- **app.js** — all behavior, in two halves that share `grist.onRecord`/`onRecords` and the `Latitude`/`Longitude`/`GeoJson` fields:
  - **Geocoding half** (ported from the geocoder's original standalone widget): `geocodeQuery(address)` calls Nominatim's `/search` endpoint and returns the top match (or `null`). `AdminLevel` comes from `extratags.admin_level`, an OSM tag that only exists on `boundary=administrative` results (cities, regions, countries) — it's `null` for street addresses and POIs, which is expected, not a bug. `AddressRank` is Nominatim's own `place_rank` field (0–30). `GeoJson` is the feature's `geojson` field (point/line/polygon geometry depending on the matched feature), stringified for storage in a Grist Text column. The "Geocode this record" button always geocodes the currently selected record (`force: true`, bypassing the cache). Auto-scan (`scan`/`scanOnNeed`) mirrors gristlabs' map widget pattern — bulk geocoding only runs if the optional `Geocode` boolean column is mapped (opt-in), and only for records where it's checked; `GeocodedAddress` caches the last address looked up so unchanged records aren't re-geocoded every sync, and requests are throttled to one per second (`REQUEST_DELAY_MS`) per Nominatim's usage policy. `mappedUpdate()` builds the `docApi.applyUserActions` payload using only the output fields actually mapped in the Creator Panel.
  - **Map half** (ported from the map's original standalone widget): `recordToFeature()` turns a mapped record into a GeoJSON Feature, preferring a parsed `GeoJson` field and falling back to a `Latitude`/`Longitude` point; records with neither are skipped (shown in `#status`) rather than erroring. `rebuildLayer()` redraws the whole `L.geoJSON` layer whenever `onRecords` fires and fits the map to its bounds. `selectFeature()` just restyles/pans to the given row's layer without rebuilding, so it doesn't fight the user's pan/zoom; it's used both by `onRecord` (cursor moved in Grist) and by clicking a map feature (`grist.setCursorPos`, gated by `allowSelectBy`).
  - **Why one widget, not two**: a geocoded record's `Latitude`/`Longitude`/`GeoJson` are written back to Grist via `applyUserActions`, which round-trips through `onRecord`/`onRecords` — so the same handlers that redraw the map on a normal Grist edit also redraw it right after a geocode, with no separate "push to map" step needed.

