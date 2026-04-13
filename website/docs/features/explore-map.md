---
sidebar_position: 1
title: Explore Map
---

# Explore Map

The interactive map is the central element of the application. It lets you browse NBS data coverage, define areas of interest, and visualize the status of your downloaded tiles.

## Data sources

Use the dropdown in the top bar to switch between NBS data formats:

| Source | Description |
|--------|-------------|
| **BlueTopo** | GeoTIFF compilations of the best available public bathymetric data |
| **Modeling** | GeoTIFF compilations of the best available public bathymetric data on a low water datum |
| **BAG** | Bathymetric Attributed Grid files |
| **S102 v2.1** | IHO S-102 version 2.1 |
| **S102 v2.2** | IHO S-102 version 2.2 |
| **S102 v3.0** | IHO S-102 version 3.0 |

:::note
S-102 data are for test and evaluation and should not be used for navigation.
:::

Switching the data source updates which tiles are shown on the map and which tiles will be fetched.

## NBS Source layer

Toggle the **NBS Source** layer from the layer controls in the bottom-left corner of the map. This overlay shows the tile scheme, the grid of available tiles from NBS for the selected data source. It helps you see what data is available before you fetch.

## Drawing tools

Use the drawing controls on the map to define your area of interest:

- **Draw a polygon** on the map to outline the region you want to fetch tiles for
- The drawn geometry is used by the Fetch command to determine which tiles to download
- You can also enter geometry directly in the Geometry field (see [Fetch Tiles](./fetch-tiles.md))

## Click to query

Click on tiles in the NBS Source and Your Project layers to see tile properties.

## Your Project layer

When you have a project directory set and have fetched tiles, the map shows the status of your tiles with color-coded overlays:

| Color | Status | Meaning |
|-------|--------|---------|
| Green | Up to date | Your local tile matches the latest NBS version |
| Yellow | Updates available | A newer version exists on NBS |
| Red | Missing from disk | The tile is tracked but the file is missing locally |
| Gray | Removed from NBS | The tile was removed from NBS since you downloaded it |

The "Your Project" layer refreshes automatically after a fetch completes.
