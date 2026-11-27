# Brand mark

The single brand asset for Chess MCP. `mark-queen.svg` is a 64×64 SVG with the
dark rounded tile built in, used by the favicon, the navbar and the lobby empty
state.

The scene is a robotic arm lowering a board-light queen onto a flat
light–dark–light board line. The queen’s white background was removed from the
supplied JPG, the piece was cropped and recolored, and the PNG is embedded in
the SVG at 136×256; the tile, arm, board and spark are vector.

## Asset wiring

- Favicon: `web/index.html` links directly to `/marks/mark-queen.svg`.
- Navbar and lobby empty state: `BRAND_MARK` in `web/src/lib/brand.ts`.
- There is no separate `favicon.svg` copy to keep in sync. Replacing
  `web/public/marks/mark-queen.svg` updates every use.

## Palette

| Token | Hex |
| --- | --- |
| Tile | `#151a20` (gradient to `#10151a`) |
| Queen | `#ebecd0` |
| Highlight | `#ffffff` |
| Steel (arm) | `#d7dfe4` |
| Joint | `#6d7d89` |
| Spark | `#f0a93b` |
| Board light | `#f0d9b5` |
| Board dark | `#b58863` |

## Drawing notes

- The scene is clipped with a `<clipPath>` matching the 15px tile radius, so the
  arm can enter from the left edge without square corners showing.
- The board is a flat line beneath the queen: three 18×3.4 segments at
  `x=5, 23, 41` and `y=56`, colored light, dark, light. It is clipped by a
  rounded 54×3.4 rect so the outer ends match the plinth line. No lip and no
  shadow.
- The queen `<image>` sits at `x=23.47 y=22 width=18.06 height=34` with
  `preserveAspectRatio="xMidYMax meet"`; that is a 136×256 PNG, so it stays
  sharp through 256px displays.
- The PNG was produced from the supplied JPG by flood-filling the white
  background from the border, keeping only the large connected queen region
  (which drops JPEG speckles), and using luminance as the edge alpha. White
  pixels inside the silhouette are preserved as the original highlights.
- The arm’s wrist sits at `(32.5 12.5)` and the claw tips end at y25, framing
  the crown without covering it.

All artwork is original to this project and uses the repository's Apache-2.0
license.
