---
sidebar_position: 4
title: Export Projects
---

# Export Projects

The Export command verifies your data integrity and packages your project into a portable ZIP file.

## What export does

1. **Verifies** downloaded tiles by comparing checksums against NBS records
2. **Packages** your project folder into a ZIP file

The output ZIP is named `<foldername>_<datasource>.zip` and saved in your project directory. For example, a project in `~/nyc` using BlueTopo produces `nyc_bluetopo.zip`.

## Options

### Include Mosaics

Toggle **Include Mosaics** to include the built mosaic files in the export ZIP. This is enabled by default.

:::note
Including mosaics is not supported for S102 v2.2 and S102 v3.0 data sources. The toggle is automatically disabled for these sources.
:::

### Flag for Repair

Toggle **Flag for Repair** to mark tiles whose checksums don't match the NBS records. Flagged tiles will be re-downloaded on the next Fetch operation.

## Portability

The exported ZIP is portable. Recipients can simply use the files or even continue the project where you left off by using this app on their own machine and pointing to their unzipped directory as their project directory. This makes it straightforward to share bathymetric data with colleagues.

## Running an export

1. Enter your project directory and select your desired data source
2. Ensure you have fetched tiles
3. Configure the Include Mosaics and Flag for Repair options as needed
4. Click **Export**

The output log shows verification progress and the final ZIP file size on completion. A toast notification appears with the file size and a link to open the project folder.
