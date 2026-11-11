# UI pictogram tools

The icons themselves are hand-written SVG (Scalable Vector Graphics) files in
`client/public/assets/ui/`. Nothing here generates them; this folder only checks them and takes
their picture.

```bash
node tools/art/ui/preview.cjs            # check every icon, then write the sheets to docs/art/previews/
node tools/art/ui/preview.cjs --check    # check only
node tools/art/ui/preview.cjs --out /tmp/mb-scratch/ui-icons --only kaiju   # one group, to scratch
```

The list of names (the contract from `docs/ASSETS.md` section 5), the one stroke weight and the
checks all live at the top of `preview.cjs`. What each icon means, the style rules, where the
letter goes on a keycap and how the skyline crumbles are in `docs/art/UI_ICONS.md`.
