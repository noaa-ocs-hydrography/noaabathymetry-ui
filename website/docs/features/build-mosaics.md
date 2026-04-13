---
sidebar_position: 3
title: Build Mosaics
---

# Build Mosaics

The Mosaic command merges your downloaded tiles into per-UTM-zone VRT mosaics.

## What is a mosaic?

After fetching individual tiles, you may want a single continuous raster for your area of interest. The mosaic operation merges tiles that share the same UTM zone into a VRT mosaic. If your area spans multiple UTM zones, a separate mosaic is created for each zone.

## Options

### Hillshade

Toggle **Hillshade** to generate a 16-meter resolution hillshade overlay from the mosaic. This provides a shaded relief visualization useful for terrain analysis.

### Resolution

By default, the mosaic uses the finest (smallest) resolution among your downloaded tiles. Enter a value in meters to override this with a specific resolution.

### Workers

Controls how many UTM zones are processed in parallel. Each worker handles one UTM zone at a time.

- The default is 1 worker
- Additional workers beyond the number of UTM zones in your project have no effect
- Each worker increases memory usage, so consider your system resources when increasing this value

## Running a mosaic

1. Enter your project directory and select your desired data source
2. Ensure you have fetched tiles
3. Optionally configure hillshade, resolution, and workers
4. Click **Mosaic**

The output log shows processing progress for each UTM zone. Mosaics are saved to your project directory.
