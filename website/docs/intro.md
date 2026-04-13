---
sidebar_position: 1
title: Introduction
slug: /intro
---

# Introduction

NOAA Bathymetry UI is a browser-based interface for the [noaabathymetry](https://github.com/noaa-ocs-hydrography/noaabathymetry) Python package. It lets you explore, download, mosaic, and export high-resolution bathymetric data from NOAA's National Bathymetric Source. No Python environment or setup required. Just one app that bundles everything you need.

## What is the National Bathymetric Source?

NOAA's [National Bathymetric Source](https://nauticalcharts.noaa.gov/learn/nbs.html) (NBS) builds and publishes the best available high-resolution bathymetric data of U.S. waters. The program ensures the best bathymetric data is always available to professionals and the public.

This data provides depth measurements nationwide, along with vertical uncertainty estimates and information on the originating survey source. It is available in multiple formats hosted on a public S3 bucket:

| Format | Description |
|--------|-------------|
| **BlueTopo** | GeoTIFF compilations of the best available public bathymetric data |
| **Modeling** | GeoTIFF compilations of the best available public bathymetric data on a low water datum |
| **BAG** | Bathymetric Attributed Grid files |
| **S-102** | IHO S-102 standard (versions 2.1, 2.2, and 3.0) |

:::note
S-102 data are for test and evaluation and should not be used for navigation.
:::

## Workflow

The typical workflow with NOAA Bathymetry UI is:

1. **Explore** — Browse NBS data on the interactive map, switch between data sources, and toggle the NBS Source layer to see what's available
2. **Fetch** — Draw your area of interest and download tiles to a local project folder
3. **Mosaic** — Merge downloaded tiles into per-UTM-zone VRT mosaics
4. **Export** — Package your project as a portable ZIP for sharing with colleagues
