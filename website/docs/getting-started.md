---
sidebar_position: 3
title: Getting Started
---

# Getting Started

## Launching the app

When you run the application, it launches in your default browser. Only one instance can run at a time. If you try to launch a second instance, you'll see a message indicating the app is already running.

## First-time walkthrough

On your first launch, a welcome toast will guide you through the basic workflow:

1. **Set your project folder** — Type or browse to the folder where you'd like your tiles stored. Fetch will create the folder for you if it doesn't exist.
2. **Draw your area of interest** — Use the drawing tool on the map to outline the area you want to fetch data for.
3. **Click Fetch** — Downloads tiles from NBS to your project folder.

## Interface overview

The interface is organized into several areas:

### Top bar

- **Your Project** — Text field with autocomplete for setting the project directory. Type a path, browse for a folder, or select from recent projects. The arrow button (when visible) opens the folder in your file explorer.
- **Data Source** — Dropdown to select which NBS data format to work with: BlueTopo, Modeling, BAG, S102 v2.1, S102 v2.2, or S102 v3.0.

### Map

The central area shows an interactive map powered by MapLibre GL. You can:

- Pan and zoom to navigate
- Use the drawing tool to define areas of interest
- Toggle the NBS Source layer to see available tile coverage
- Toggle the Your Project layer to see the status of your downloaded tiles

### Command bar

Three command buttons at the bottom of the screen:

- **Fetch** — Download tiles from NBS
- **Mosaic** — Build per-UTM-zone VRT mosaics from your tiles
- **Export** — Package your project as a portable ZIP

Each command has configurable options in its row. Hover over any field or button to see a tooltip explaining what it does.

### Output log

Click the output bar to expand the log panel. This shows real-time progress and messages from the currently running command, including download progress and processing status.
