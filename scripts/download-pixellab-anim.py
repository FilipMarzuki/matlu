#!/usr/bin/env python3
"""Download a PixelLab animation's SE-direction frames and assemble into a horizontal spritestrip.

Usage:
  python scripts/download-pixellab-anim.py <base_url> <frame_count> <output_path>

Example:
  python scripts/download-pixellab-anim.py \
    "https://backblaze.pixellab.ai/file/pixellab-characters/.../animations/.../south-east" \
    8 \
    "public/assets/sprites/wildlife/wolf/walk.png"
"""

import sys
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    base_url = sys.argv[1].rstrip('/')
    frame_count = int(sys.argv[2])
    output_path = Path(sys.argv[3])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    frames = []
    for i in range(frame_count):
        url = f"{base_url}/{i}.png"
        tmp = output_path.parent / f"_tmp_frame_{i}.png"
        print(f"  Downloading frame {i}...")
        urllib.request.urlretrieve(url, tmp)
        frames.append(Image.open(tmp))

    w, h = frames[0].size
    strip = Image.new('RGBA', (w * len(frames), h))
    for i, img in enumerate(frames):
        strip.paste(img, (i * w, 0))
    strip.save(output_path)
    print(f"Created {output_path}: {w * len(frames)}x{h} ({len(frames)} frames)")

    # Clean up temp files
    for i in range(frame_count):
        tmp = output_path.parent / f"_tmp_frame_{i}.png"
        tmp.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
