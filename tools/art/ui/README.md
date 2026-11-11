# UI pictogram tools

The user interface (UI) icons themselves are hand-written SVG (Scalable Vector Graphics) files
in `client/public/assets/ui/`. Nothing here generates them: the files are the source of truth,
and this folder only checks them and takes their picture.

```bash
node tools/art/ui/preview.cjs            # check every icon, then write the sheets to docs/art/previews/
node tools/art/ui/preview.cjs --check    # check only
node tools/art/ui/preview.cjs --out /tmp/mb-scratch/ui-icons --only kaiju   # one group, to scratch
```

The list of names (the contract from `docs/ASSETS.md` section 5), the one stroke weight, the
2-unit margin and the checks all live at the top of `preview.cjs`. What each icon means, the
style rules, where the letter goes on a keycap and how the skyline crumbles are in
`docs/art/UI_ICONS.md`.

Sheets worth knowing:

- `ui_icons_real_sizes.png`: every icon at the sizes and in the colors the client really uses
  (18 to 52 pixels, taken from `client/src/styles.css`), over afternoon, sunset and night skies,
  true pixels and enlarged. Judge legibility here, not on the large sheets. If the client's
  sizes change, change them in `sheetRealSizes()`.
- `ui_skyline.png`: `skyline.svg` stretched into the client's 560 x 46 pixel bar (`BAR_BOX`),
  whole and crumbling.
- `ui_icons_client_fixes.png`: before and after pictures for the notes in
  `docs/art/client-notes-ui-icons.md` (changes that can only be made in the client's code).

Adding an icon: write the file, add its name to `GROUPS` in `preview.cjs` and to
`docs/ASSETS.md` section 5, describe it in `docs/art/UI_ICONS.md`, run the script, look at the
sheets, then run `npm run assets:manifest`.
