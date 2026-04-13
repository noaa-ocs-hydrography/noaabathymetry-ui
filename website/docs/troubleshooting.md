---
sidebar_position: 6
title: Troubleshooting
---

# Troubleshooting

## macOS: App blocked by Gatekeeper

Because the app is unsigned, macOS may prevent it from opening. To resolve, run in Terminal:

```bash
xattr -cr /path/to/noaabathymetry.app
```

## Windows: SmartScreen warning

Windows SmartScreen may block the app because it is unsigned:

- Click **More info** in the SmartScreen dialog
- Click **Run anyway**

## "Already running" message

The app uses instance locking to prevent duplicate launches. If you see this message:

- Check if the app is already open in another browser tab
- If the app crashed previously, the lock file may be stale. Restarting should resolve it.

## App opens but map doesn't load

- Verify your internet connection. The basemap is loaded from CARTO/OpenStreetMap and NBS data is loaded from NOAA's public S3 bucket
- Check that your browser supports WebGL (required by MapLibre GL)
- Try a different browser

## NBS Source layer not showing tiles

- Check your internet connection. The tile scheme is loaded from NOAA's public S3 bucket
- Check the output log for error messages

## Your Project layer not showing tiles

- Ensure you have a project directory set and have fetched tiles
- Ensure the **Data Source** matches what you fetched
- Check that the project folder contains a registry database (e.g. `bluetopo_registry.db`)

## How do I remove a project?

Simply delete the project folder from your file system. The app does not store any project data outside of the project folder itself. The only file stored elsewhere by this app is `~/.noaabathymetry/recents.json`, which holds your last 10 project paths for the recent projects dropdown, which you can also optionally delete.

## Version check

The app checks for updates on startup. If a newer version is available, a toast notification will appear with details. Download the latest version from the [releases page](https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases).

## Reporting bugs

File bug reports on the [GitHub Issues](https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/issues) page.

For security vulnerabilities, follow the instructions in the [Security Policy](https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/blob/main/SECURITY.md).
