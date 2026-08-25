# Grist Widgets

There are many [custom Grist widgets](https://support.getgrist.com/widget-custom/) without licenses or from unreliable sources. This repo exists purely to provide stable, FOSS, widgets for use within VCity projects.

## Widgets

1. [Markdown+Mermaid](/markdown-mermaid) : A simple visualizer widget for [Markdown](https://www.markdownguide.org/) with support for [Mermaid](https://mermaid.ai/), [footnotes](https://github.com/markdown-it/markdown-it-footnote), and [alerts](https://mdit-plugins.github.io/alert.html)
   - Widget URL to use in Grist: `https://vcityteam.github.io/grist-widgets/markdown-mermaid`
2. [Geocoding Map](/geocoding-map) : Geocodes an address column using [Nominatim](https://nominatim.org/) (writing back latitude, longitude, OSM type, OSM ID, administration level, address rank, and the matched feature's boundary as GeoJSON) and visualizes the results on a [Leaflet](https://leafletjs.com/) map, either as points or as arbitrary GeoJSON geometry, unlike [gristlabs/grist-widget's map widget](https://github.com/gristlabs/grist-widget/tree/master/map) which only supports points and doesn't geocode
   - Widget URL to use in Grist: `https://vcityteam.github.io/grist-widgets/geocoding-map`
3. [Circle Packing](/circle-packing) : Visualizes a table as a zoomable [d3 circle-packing](https://d3js.org/d3-hierarchy/pack) chart, sizing each leaf circle by a numeric Value column and nesting records into group circles via an optional slash-separated Group path column; click a group to zoom in, click a leaf to select its record in Grist (and vice versa), and click the background to zoom back out
   - Widget URL to use in Grist: `https://vcityteam.github.io/grist-widgets/circle-packing`
4. [Print Labels (HTML)](/print-labels-html) : A fork of [gristlabs/grist-widget's print labels widget](https://github.com/gristlabs/grist-widget/tree/master/printlabels) that renders each label's source column as sanitized HTML ([DOMPurify](https://github.com/cure53/DOMPurify)) instead of escaped plain text, so labels can use rich formatting, images, and line breaks; supports the same sheet templates, optional per-record repeat count, and initial-blanks option as the original
   - Widget URL to use in Grist: `https://vcityteam.github.io/grist-widgets/print-labels-html`
