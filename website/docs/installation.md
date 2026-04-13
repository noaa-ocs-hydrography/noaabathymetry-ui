---
sidebar_position: 2
title: Installation
---

# Installation

Download the latest release for your platform. No installation or Python environment required.

| Platform | Link |
|----------|------|
| macOS (Apple Silicon) | [Download](https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest/download/noaabathymetry-macOS-ARM.zip) |
| macOS (Intel) | [Download](https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest/download/noaabathymetry-macOS-Intel.zip) |
| Windows | [Download](https://github.com/noaa-ocs-hydrography/noaabathymetry-ui/releases/latest/download/noaabathymetry.exe) |

## macOS

1. Download the ZIP for your Mac (Apple Silicon or Intel)
2. Unzip the archive. You'll get a `noaabathymetry.app` bundle
3. On first launch, macOS Gatekeeper may block the app because it is unsigned. To open it, run the following in Terminal:
   ```bash
   xattr -cr /path/to/noaabathymetry.app
   ```
4. The app will launch in your default browser

## Windows

1. Download `noaabathymetry.exe`
2. On first run, Windows SmartScreen may show a warning because the app is unsigned:
   - Click **More info**
   - Click **Run anyway**
3. The app will launch in your default browser

## Verifying downloads

Each release includes SHA-256 checksum files (`.sha256`) alongside the downloads. To verify, compute the hash of your downloaded file and compare it to the contents of the corresponding `.sha256` file on the release page.

**macOS/Linux:**
```bash
shasum -a 256 noaabathymetry-macOS-ARM.zip
```

**Windows (PowerShell):**
```powershell
Get-FileHash noaabathymetry.exe -Algorithm SHA256
```
