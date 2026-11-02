"""
The ground view's art (#2022, #2027), top-down 2D, seen from above as in a top-down RPG:

- The ground (`tilesets/artificer-ground/ground.png`): the top-down tiles generated with PixelLab
  for #2022 (32 x 32), packed into one atlas in GROUND order, four across.
- What stands on it (`tilesets/artificer-ground/things.png`): the 16 top-down objects generated for
  #2027 (PixelLab 1-direction objects, 48 x 48, in the tiles' colours), four across, in the order
  ground-draw.ts THING_ART reads them.
- The Warden (`characters/mistheim/heroes/warden/warden-ground.png`): the top-down character made for
  #2027 (PixelLab, high top-down, 48 x 48), one row per animation and facing (ANIMS x DIRS, in that
  order), one frame per column. Its frames are named <anim>_<dir>_<n>.png in the folder given.

Run:  python3 scripts/artificer-ground-assets.py <tiles-batch1> <tiles-batch2> <objects-dir> <warden-frames-dir>
      (any trailing folder can be left off to skip that sheet)
Then: npm run assets:sprites
"""
import os, sys
from PIL import Image

ROOT = 'public/assets/sprites/'
ANIMS = [('idle', 4), ('walk', 8), ('pickup', 5), ('pull', 6), ('crouch', 5), ('drink', 6)]
DIRS = ['south', 'north', 'east', 'west']
CELL = 48

def warden(frames):
    cols = max(n for _, n in ANIMS)
    out = Image.new('RGBA', (cols * CELL, len(ANIMS) * len(DIRS) * CELL), (0, 0, 0, 0))
    row = 0
    for anim, n in ANIMS:
        for d in DIRS:
            for c in range(n):
                im = Image.open(f'{frames}/{anim}_{d}_{c}.png').convert('RGBA')
                assert im.size == (CELL, CELL), (anim, d, c, im.size)
                out.paste(im, (c * CELL, row * CELL))
            row += 1
    path = ROOT + 'characters/mistheim/heroes/warden/warden-ground.png'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)
    print(f'warden: {cols} x {row} cells of {CELL} -> {path}')

def things(objects):
    out = Image.new('RGBA', (4 * CELL, 4 * CELL), (0, 0, 0, 0))
    for i in range(16):
        im = Image.open(f'{objects}/obj_{i}.png').convert('RGBA')
        assert im.size == (CELL, CELL), im.size
        out.paste(im, ((i % 4) * CELL, (i // 4) * CELL))
    path = ROOT + 'tilesets/artificer-ground/things.png'
    out.save(path, optimize=True)
    print(f'things: 16 -> {path}')

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
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)
    print(f'ground: {len(GROUND)} tiles -> {path}')

if __name__ == '__main__':
    if len(sys.argv) >= 3: ground(sys.argv[1:3])
    if len(sys.argv) >= 4: things(sys.argv[3])
    if len(sys.argv) >= 5: warden(sys.argv[4])
