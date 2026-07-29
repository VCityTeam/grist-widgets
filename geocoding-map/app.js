/* global grist, L */
"use strict";

// Required - address (or free-text query) to look up.
const Address = "Address";
// Optional - label shown on the map (tooltip/popup). Falls back to Address if unmapped.
const Name = "Name";
// Optional - boolean column. When mapped, any record with this checked
// (and not yet geocoded for its current Address) is geocoded automatically.
const Geocode = "Geocode";
// Optional - cache of the last address that was looked up, so records
// aren't re-geocoded on every sync, and so edits to Address are detected.
const GeocodedAddress = "GeocodedAddress";
// Output columns - all optional so a document can map only the fields it needs.
// Latitude/Longitude/GeoJson double as map input: whichever a record already
// has (from a prior geocode, or entered by hand) is what gets drawn.
const Latitude = "Latitude";
const Longitude = "Longitude";
const OsmType = "OsmType";
const OsmId = "OsmId";
const AdminLevel = "AdminLevel";
const AddressRank = "AddressRank";
// GeoJSON geometry of the matched feature (as returned by Nominatim's
// polygon_geojson=1 param), stringified. Null for results with no boundary
// geometry (e.g. plain address points) or when Nominatim omits it.
const GeoJson = "GeoJson";

const OUTPUT_FIELDS = [Latitude, Longitude, OsmType, OsmId, AdminLevel, AddressRank, GeoJson];

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim's public instance usage policy caps automated use at 1 request/second.
const REQUEST_DELAY_MS = 1000;

const DEFAULT_STYLE = { color: "#3388ff", weight: 2, fillOpacity: 0.2, radius: 6 };
const SELECTED_STYLE = { color: "#ff7800", weight: 4, fillOpacity: 0.4, radius: 8 };

let selectedTableId = null;
let lastRecord = null;
let lastMappings = null;
let selectedRecords = null;
let writeAccess = true;
let scanning = null;

let map = null;
let geoLayer = null;
let layersById = new Map();
let selectedRowId = null;

const statusEl = document.getElementById("status");

const editorEl = {
  addressValue: document.getElementById("address-value"),
  lat: document.getElementById("f-lat"),
  lon: document.getElementById("f-lon"),
  osmType: document.getElementById("f-osm-type"),
  osmId: document.getElementById("f-osm-id"),
  adminLevel: document.getElementById("f-admin-level"),
  addressRank: document.getElementById("f-address-rank"),
  geojson: document.getElementById("f-geojson"),
  displayName: document.getElementById("display-name"),
  error: document.getElementById("error"),
  log: document.getElementById("log"),
  geocodeBtn: document.getElementById("geocode-btn"),
};

const panelEl = document.getElementById("panel");
const panelToggleBtn = document.getElementById("panel-toggle-btn");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  editorEl.log.prepend(line);
  while (editorEl.log.childElementCount > 50) {
    editorEl.log.removeChild(editorEl.log.lastChild);
  }
}

function showError(msg) {
  editorEl.error.textContent = msg || "";
}

function showStatus(msg) {
  statusEl.textContent = msg || "";
  statusEl.style.display = msg ? "block" : "none";
}

// Calls Nominatim's /search endpoint and returns the best match, or null if none found.
async function geocodeQuery(address) {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "1");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Nominatim request failed: HTTP ${response.status}`);
  }
  const results = await response.json();
  return results[0] || null;
}

// Maps a Nominatim result (or null, for "not found") to our logical field names.
// admin_level only exists on administrative boundary results (extratags), so it's
// null for street addresses, POIs, etc.
function resultToFields(result) {
  if (!result) {
    return {
      [Latitude]: null,
      [Longitude]: null,
      [OsmType]: null,
      [OsmId]: null,
      [AdminLevel]: null,
      [AddressRank]: null,
      [GeoJson]: null,
    };
  }
  const adminLevel = result.extratags && Number(result.extratags.admin_level);
  return {
    [Latitude]: Number(result.lat),
    [Longitude]: Number(result.lon),
    [OsmType]: result.osm_type ?? null,
    [OsmId]: result.osm_id ?? null,
    [AdminLevel]: Number.isFinite(adminLevel) ? adminLevel : null,
    [AddressRank]: result.place_rank ?? null,
    [GeoJson]: result.geojson ? JSON.stringify(result.geojson) : null,
  };
}

// Pulls the current output-field values off an already-mapped record, for display.
function fieldsFromRecord(rec) {
  const fields = {};
  for (const field of OUTPUT_FIELDS) {
    fields[field] = rec[field] ?? null;
  }
  return fields;
}

function updatePanel(address, fields, result) {
  editorEl.addressValue.textContent = address || "—";
  editorEl.lat.textContent = fields[Latitude] ?? "—";
  editorEl.lon.textContent = fields[Longitude] ?? "—";
  editorEl.osmType.textContent = fields[OsmType] ?? "—";
  editorEl.osmId.textContent = fields[OsmId] ?? "—";
  editorEl.adminLevel.textContent = fields[AdminLevel] ?? "—";
  editorEl.addressRank.textContent = fields[AddressRank] ?? "—";
  editorEl.geojson.textContent = fields[GeoJson] ? JSON.parse(fields[GeoJson]).type : "—";
  editorEl.displayName.textContent = result ? result.display_name : "";
}

// Builds a {realColumnId: value} update payload, only for fields that are mapped.
function mappedUpdate(mappings, fields) {
  const update = {};
  for (const field of OUTPUT_FIELDS) {
    if (mappings[field]) {
      update[mappings[field]] = fields[field];
    }
  }
  return update;
}

// Geocodes one record and writes the results back through Grist. Grist then pushes
// the updated row back through onRecord/onRecords, which is what drives the map to
// pick up and draw the new Latitude/Longitude/GeoJson - there's no separate local
// "add to map" step.
// `force` bypasses the GeocodedAddress cache (used by the manual button).
async function geocodeRecord(tableId, rowId, address, mappings, { force = false, cachedAddress } = {}) {
  if (!address) {
    return;
  }
  if (!force && cachedAddress && cachedAddress === address) {
    return;
  }

  let result = null;
  let errorMsg = null;
  try {
    result = await geocodeQuery(address);
    if (!result) {
      errorMsg = `No match found for "${address}"`;
    }
  } catch (e) {
    errorMsg = e.message || String(e);
  }

  const fields = resultToFields(result);

  if (writeAccess && tableId && rowId) {
    const update = mappedUpdate(mappings, fields);
    if (mappings[GeocodedAddress]) {
      update[mappings[GeocodedAddress]] = address;
    }
    if (Object.keys(update).length > 0) {
      await grist.docApi.applyUserActions([["UpdateRecord", tableId, rowId, update]]);
    }
  }

  if (errorMsg) {
    log(`✗ ${address}: ${errorMsg}`);
  } else {
    log(`✓ ${address} → ${fields[Latitude]}, ${fields[Longitude]}`);
  }

  return { fields, result, errorMsg };
}

async function scan(tableId, records, mappings) {
  if (!writeAccess || !(Geocode in mappings) || !mappings[Geocode]) {
    return;
  }
  for (const record of records) {
    if (!record[Geocode]) {
      continue;
    }
    const address = record[Address];
    await geocodeRecord(tableId, record.id, address, mappings, {
      cachedAddress: record[GeocodedAddress],
    });
    await delay(REQUEST_DELAY_MS);
  }
}

function scanOnNeed(mappings) {
  if (!scanning && selectedTableId && selectedRecords) {
    scanning = scan(selectedTableId, selectedRecords, mappings)
      .then(() => (scanning = null))
      .catch((e) => {
        console.error(e);
        scanning = null;
      });
  }
}

function ensureMap() {
  if (map) {
    return map;
  }
  map = L.map("map");
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    maxZoom: 19,
  }).addTo(map);
  map.setView([0, 0], 2);
  return map;
}

// Turns a mapped record into a GeoJSON Feature, or null if it has no usable
// geometry (neither a parseable GeoJson field nor a Latitude/Longitude pair).
function recordToFeature(rec) {
  let geometry = null;
  if (rec[GeoJson]) {
    try {
      const parsed = JSON.parse(rec[GeoJson]);
      geometry = parsed && parsed.type === "Feature" ? parsed.geometry : parsed;
    } catch (e) {
      geometry = null;
    }
  }
  if (!geometry && Number.isFinite(rec[Latitude]) && Number.isFinite(rec[Longitude])) {
    geometry = { type: "Point", coordinates: [rec[Longitude], rec[Latitude]] };
  }
  if (!geometry) {
    return null;
  }
  return { type: "Feature", geometry, properties: { id: rec.id, name: rec[Name] || rec[Address] } };
}

function styleFor(id) {
  return id === selectedRowId ? SELECTED_STYLE : DEFAULT_STYLE;
}

function pointToLayer(feature, latlng) {
  return L.circleMarker(latlng, styleFor(feature.properties.id));
}

function style(feature) {
  return styleFor(feature.properties.id);
}

function onEachFeature(feature, layer) {
  const name = feature.properties.name;
  if (name) {
    layer.bindTooltip(String(name));
  }
  layer.on("click", () => selectFeature(feature.properties.id, { fromClick: true }));
  layersById.set(feature.properties.id, layer);
}

function layerBounds(layer) {
  if (layer.getBounds) {
    return layer.getBounds();
  }
  if (layer.getLatLng) {
    return L.latLngBounds([layer.getLatLng(), layer.getLatLng()]);
  }
  return null;
}

function rebuildLayer(records) {
  const m = ensureMap();
  if (geoLayer) {
    m.removeLayer(geoLayer);
  }
  layersById = new Map();

  const features = [];
  let skipped = 0;
  for (const rec of records) {
    const feature = recordToFeature(rec);
    if (feature) {
      features.push(feature);
    } else {
      skipped++;
    }
  }

  geoLayer = L.geoJSON(
    { type: "FeatureCollection", features },
    { style, pointToLayer, onEachFeature }
  ).addTo(m);

  showStatus(skipped > 0 ? `${skipped} record(s) not yet geocoded: no Latitude/Longitude or GeoJSON` : "");

  try {
    const bounds = geoLayer.getBounds();
    if (bounds.isValid()) {
      m.fitBounds(bounds, { maxZoom: 16, padding: [20, 20] });
    }
  } catch (e) {
    // no features to fit
  }
}

// Highlights the layer for `id` and clears the previous highlight, panning/zooming
// it into view if it isn't currently visible. Does not rebuild the map, so this
// preserves the user's current pan/zoom (rebuildLayer is only called when the
// underlying record set changes).
function selectFeature(id, { fromClick = false } = {}) {
  const prevLayer = layersById.get(selectedRowId);
  if (prevLayer && prevLayer.setStyle) {
    prevLayer.setStyle(DEFAULT_STYLE);
  }

  selectedRowId = id;

  const layer = layersById.get(id);
  if (layer) {
    if (layer.setStyle) {
      layer.setStyle(SELECTED_STYLE);
    }
    const m = ensureMap();
    const bounds = layerBounds(layer);
    if (bounds && bounds.isValid() && !m.getBounds().contains(bounds)) {
      m.fitBounds(bounds, { maxZoom: Math.max(m.getZoom(), 15), padding: [40, 40] });
    }
    if (layer.openTooltip) {
      layer.openTooltip();
    }
  }

  if (fromClick) {
    grist.setCursorPos?.({ rowId: id }).catch(() => {});
  }
}

grist.on("message", (e) => {
  if (e.tableId) {
    selectedTableId = e.tableId;
  }
});

grist.onRecord((record, mappings) => {
  lastRecord = grist.mapColumnNames(record) || record;
  lastMappings = mappings;
  showError("");
  updatePanel(lastRecord[Address], fieldsFromRecord(lastRecord), null);
  selectFeature(lastRecord.id);
});

grist.onRecords((data, mappings) => {
  selectedRecords = grist.mapColumnNames(data) || data;
  rebuildLayer(selectedRecords);
  const layer = layersById.get(selectedRowId);
  if (layer && layer.setStyle) {
    layer.setStyle(SELECTED_STYLE);
  }
  scanOnNeed(mappings);
});

editorEl.geocodeBtn.addEventListener("click", async () => {
  if (!lastRecord || !lastMappings) {
    return;
  }
  showError("");
  editorEl.geocodeBtn.disabled = true;
  try {
    const outcome = await geocodeRecord(selectedTableId, lastRecord.id, lastRecord[Address], lastMappings, {
      force: true,
    });
    if (outcome) {
      if (outcome.errorMsg) {
        showError(outcome.errorMsg);
      }
      updatePanel(lastRecord[Address], outcome.fields, outcome.result);
    }
  } finally {
    editorEl.geocodeBtn.disabled = false;
  }
});

panelToggleBtn.addEventListener("click", () => {
  const collapsed = panelEl.classList.toggle("collapsed");
  panelToggleBtn.textContent = collapsed ? "» Show panel" : "« Hide panel";
  // The map's container just resized; Leaflet needs to be told explicitly.
  setTimeout(() => map && map.invalidateSize(), 0);
});

grist.ready({
  columns: [
    Address,
    { name: Name, type: "Text", optional: true },
    { name: Geocode, type: "Bool", title: "Geocode", optional: true },
    { name: GeocodedAddress, type: "Text", title: "Geocoded Address", optional: true },
    { name: Latitude, type: "Numeric", optional: true },
    { name: Longitude, type: "Numeric", optional: true },
    { name: OsmType, type: "Text", title: "OSM Type", optional: true },
    { name: OsmId, type: "Text", title: "OSM ID", optional: true },
    { name: AdminLevel, type: "Numeric", title: "Administration Level", optional: true },
    { name: AddressRank, type: "Numeric", title: "Address Rank", optional: true },
    { name: GeoJson, type: "Text", title: "GeoJSON", optional: true },
  ],
  allowSelectBy: true,
});

grist.onOptions((_options, interaction) => {
  writeAccess = interaction.accessLevel === "full";
  editorEl.geocodeBtn.disabled = !writeAccess;
});
