# Art review material

Pictures of every model in the game, made automatically each time the art is rebuilt. They are
how the art gets reviewed without opening the game, and they feed the progress slides.

| Folder | What is in it |
| --- | --- |
| `previews/` | One **contact sheet** per model: front, left side, back and a three-quarter view, plus extra views where they matter (the kaiju's first-person view, a building's damaged, rubble and collapse states). |
| `concept/` | One or more **beauty shots** per model: lit, with a sky or studio backdrop and a shadow on the ground. This is the picture to judge "does it look good". |
| `conventions/` | Test pictures that prove the pipeline itself is right (which way is forward, left and right not swapped, joints bend the right way, wall textures the right way up). Not game art. |
| `palette.png` | Every named color the models are painted with. |

## How to read a contact sheet

- The title bar gives the model's name, its real size in meters, and how many triangles it uses
  (the fewer, the faster the game runs; each kind of model has a limit).
- The thin horizontal line is the ground. The small **yellow triangle** marks the point the game
  treats as the model's position: it should sit on the ground under the middle of the model.
- The white bar in the corner shows scale (for example "1 m").
- The small notes in the bottom corners say which side is the model's own left or right, and
  which way it faces.
- **Bright magenta** patches are mistakes: surfaces that would be invisible in the game. A
  finished model has none.

The pictures are produced by the scripts in `tools/art/` (see `tools/art/README.md`). To redo
any of them from a model file: `tools/art/preview.py <model name>`.
