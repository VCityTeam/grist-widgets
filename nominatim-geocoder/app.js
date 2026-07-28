/* global grist */
"use strict";

// Required - address (or free-text query) to look up.
const Address = "Address";
// Optional - boolean column. When mapped, any record with this checked
// (and not yet geocoded for its current Address) is geocoded automatically.
const Geocode = "Geocode";
// Optional - cache of the last address that was looked up, so records
// aren't re-geocoded on every sync, and so edits to Address are detected.
const GeocodedAddress = "GeocodedAddress";
// Output columns - all optional so a document can map only the fields it needs.
const Latitude = "Latitude";
const Longitude = "Longitude";
const OsmType = "OsmType";
const OsmId = "OsmId";
const AdminLevel = "AdminLevel";
const AddressRank = "AddressRank";

const OUTPUT_FIELDS = [Latitude, Longitude, OsmType, OsmId, AdminLevel, AddressRank];

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim's public instance usage policy caps automated use at 1 request/second.
const REQUEST_DELAY_MS = 1000;

let selectedTableId = null;
let lastRecord = null;
let lastMappings = null;
let selectedRecords = null;
let writeAccess = true;
let scanning = null;

const editorEl = {
  addressValue: document.getElementById("address-value"),
  lat: document.getElementById("f-lat"),
  lon: document.getElementById("f-lon"),
  osmType: document.getElementById("f-osm-type"),
  osmId: document.getElementById("f-osm-id"),
  adminLevel: document.getElementById("f-admin-level"),
  addressRank: document.getElementById("f-address-rank"),
  displayName: document.getElementById("display-name"),
  error: document.getElementById("error"),
  log: document.getElementById("log"),
  geocodeBtn: document.getElementById("geocode-btn"),
};

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

// Calls Nominatim's /search endpoint and returns the best match, or null if none found.
async function geocodeQuery(address) {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("extratags", "1");
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

// Geocodes one record and writes the results back through Grist.
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
});

grist.onRecords((data, mappings) => {
  selectedRecords = grist.mapColumnNames(data) || data;
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

grist.ready({
  columns: [
    Address,
    { name: Geocode, type: "Bool", title: "Geocode", optional: true },
    { name: GeocodedAddress, type: "Text", title: "Geocoded Address", optional: true },
    { name: Latitude, type: "Numeric", optional: true },
    { name: Longitude, type: "Numeric", optional: true },
    { name: OsmType, type: "Text", title: "OSM Type", optional: true },
    { name: OsmId, type: "Numeric", title: "OSM ID", optional: true },
    { name: AdminLevel, type: "Numeric", title: "Administration Level", optional: true },
    { name: AddressRank, type: "Numeric", title: "Address Rank", optional: true },
  ],
  allowSelectBy: true,
});

grist.onOptions((_options, interaction) => {
  writeAccess = interaction.accessLevel === "full";
  editorEl.geocodeBtn.disabled = !writeAccess;
});
