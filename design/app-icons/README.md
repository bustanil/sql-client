# App icons

Chosen direction: **01 · Database rows**.

| File | Purpose |
| --- | --- |
| `icon-01-database-row.svg` | Editable source for the chosen icon |
| `icon-01-database-row.png` | 1024 px transparent preview |
| `icon-02-grid-edit.svg` / `.png` | Alternate candidate, kept for reference |
| `icon-03-sql-prompt.svg` / `.png` | Alternate candidate, kept for reference |
| `contact-sheet.png` | All three at full size and 64/32/16 px |

The packaged app uses `build/icon.icns`. The development app uses
`build/icon.png` for the Dock icon.

## Rebuild the macOS icon

Requires `rsvg-convert` (`brew install librsvg`) and the macOS `iconutil`:

```bash
cd ../..
mkdir -p build/icon.iconset
for spec in \
  "16 icon_16x16" "32 icon_16x16@2x" \
  "32 icon_32x32" "64 icon_32x32@2x" \
  "128 icon_128x128" "256 icon_128x128@2x" \
  "256 icon_256x256" "512 icon_256x256@2x" \
  "512 icon_512x512" "1024 icon_512x512@2x"
do
  set -- $spec
  rsvg-convert -w "$1" -h "$1" design/app-icons/icon-01-database-row.svg -o "build/icon.iconset/$2.png"
done
iconutil -c icns build/icon.iconset -o build/icon.icns
rsvg-convert -w 1024 -h 1024 design/app-icons/icon-01-database-row.svg -o build/icon.png
rm -rf build/icon.iconset
```

`package.json` points `build.mac.icon` at `build/icon.icns`.
