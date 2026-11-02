"""
The ground minimap's art (#2022), built from what the repo already has:

- The Warden: a compact sheet cut from the Mistheim hero `loke` (public/assets/sprites/characters/
  mistheim/heroes/loke/loke.png): idle, walk, pickup, pull, crouch and drink, facing south, north,
  east and west. One row per animation and direction (ANIMS x DIRS, in that order), one frame per
  column, every cell the same size: the union of the frames' drawn pixels, so the feet line up.
- The ground: the top-down tiles generated with PixelLab for #2022 (32 x 32), packed into one atlas
  in GROUND order, four across. Pass the folder they were downloaded to (tile_<n>.png, by batch).

Run:  python3 scripts/artificer-ground-assets.py <batch1-dir> <batch2-dir>
Then: npm run assets:sprites
"""
import json, sys
from PIL import Image

ROOT = 'public/assets/sprites/'
HERO = ROOT + 'characters/mistheim/heroes/loke/'
ANIMS = [('idle', 4), ('walk', 8), ('pickup', 5), ('pull', 6), ('crouch', 5), ('drink', 6)]
DIRS = ['south', 'north', 'east', 'west']

def warden():
    sheet = Image.open(HERO + 'loke.png').convert('RGBA')
    frames = {f['filename']: f['frame'] for f in json.load(open(HERO + 'loke.json'))['frames']}
    cells = []
    for anim, n in ANIMS:
        for d in DIRS:
            names = sorted([k for k in frames if k.rsplit('_', 1)[0] == f'{anim}_{d}'], key=lambda k: int(k.rsplit('_', 1)[1]))
            assert len(names) == n, (anim, d, len(names))
            cells.append([sheet.crop((frames[k]['x'], frames[k]['y'], frames[k]['x'] + frames[k]['w'], frames[k]['y'] + frames[k]['h'])) for k in names])
    # The union of every frame's drawn pixels, so each cell is cut the same and the feet stay put.
    boxes = [im.getbbox() for row in cells for im in row if im.getbbox()]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    w, h = x1 - x0, y1 - y0
    cols = max(n for _, n in ANIMS)
    out = Image.new('RGBA', (cols * w, len(cells) * h), (0, 0, 0, 0))
    for r, row in enumerate(cells):
        for c, im in enumerate(row):
            out.paste(im.crop((x0, y0, x1, y1)), (c * w, r * h))
    out.save(HERO + 'loke-ground.png', optimize=True)
    print(f'warden: {w}x{h} cells, {cols} x {len(cells)} -> {HERO}loke-ground.png')

# The ground tiles, in the order ground-view.ts GROUND_TILES reads them: (batch, tile number).
# Batch 1 (PixelLab tiles f2743bd4…) and batch 2 (a50af1be…), 32 x 32, square top-down, in the
# isometric tiles' colours. Tiles that showed seams when repeated were left out.
GROUND = [
    (1, 0), (1, 1),            # 0-1 birch wood
    (2, 0), (2, 1),            # 2-3 pine forest (brown needles; with moss)
    (2, 2), (2, 3), (1, 4),    # 4-6 meadow
    (1, 6), (2, 8),            # 7-8 heath
    (1, 7), (2, 9),            # 9-10 marsh
    (1, 8),                    # 11 scree
    (2, 5),                    # 12 fell
    (1, 10), (1, 11),          # 13-14 snowfield
    (1, 12),                   # 15 river
    (1, 13),                   # 16 lake
    (2, 6), (1, 14),           # 17-18 shore
    (1, 15),                   # 19 camp ground
    (2, 10), (2, 11), (2, 12), (2, 13),  # 20-23 birch, pine, meadow, heath under snow
    (2, 14), (2, 15),          # 24-25 frozen lake, frozen river
]

def ground(dirs):
    across = 4
    rows = (len(GROUND) + across - 1) // across
    out = Image.new('RGBA', (across * 32, rows * 32), (0, 0, 0, 0))
    for i, (batch, n) in enumerate(GROUND):
        im = Image.open(f'{dirs[batch - 1]}/tile_{n}.png').convert('RGBA')
        assert im.size == (32, 32), im.size
        out.paste(im, ((i % across) * 32, (i // across) * 32))
    path = ROOT + 'tilesets/artificer-ground/ground.png'
    import os; os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)
    print(f'ground: {len(GROUND)} tiles -> {path}')

if __name__ == '__main__':
    warden()
    if len(sys.argv) >= 3: ground(sys.argv[1:3])
