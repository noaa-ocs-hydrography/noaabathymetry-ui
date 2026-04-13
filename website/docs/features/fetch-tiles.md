---
sidebar_position: 2
title: Fetch Tiles
---

# Fetch Tiles

The Fetch command downloads tiles from NBS to your local project folder.

## Setting a project directory

Before fetching, set your project folder in the **Your Project** field in the top bar. You can:

- **Type a path** — autocomplete suggestions appear as you type
- **Browse** — click the Browse button to open a folder picker
- **Select a recent project** — click the field to see your recent projects

The folder will be created automatically during fetch if it doesn't exist.

## Defining your area of interest

The **Geometry** field accepts your area of interest in several ways:

- **Draw on the map** — use the polygon drawing tool; the geometry is filled in automatically
- **Paste a geometry string** — GeoJSON, WKT, or bounding box format
- **Browse for a file** — click the **...** button to select a geometry file (GeoPackage, Shapefile, GeoJSON, or KML)
- **Type a file path** — autocomplete suggestions appear for file paths

## Only Resolution(s)

The **Only Resolution(s)** field lets you limit which tiles are downloaded based on their resolution in meters. Leave it blank to fetch all available resolutions.

To fetch only specific resolutions, enter comma-separated values:

```
4,8
```

This would only download tiles at 4-meter and 8-meter resolution.

## Running a fetch

1. Ensure your project directory is set
2. Define your area of interest (draw on map or enter geometry)
3. Optionally set a resolution filter
4. Click **Fetch**

The output log will open and show real-time progress, including tile count and estimated time remaining. The status bar shows "Fetching..." while the operation is running.

## Canceling

Only one command can run at a time. There is currently no cancel button. If you need to stop a fetch in progress, you can close the app.
