#!/usr/bin/env python3
"""
sprite-consistency.py -- palette consistency checker for PixelLab character sprites.

Usage:
    python scripts/sprite-consistency.py <character.zip | unpacked-dir> [--verbose]

Checks:
    1. Cross-direction palette  -- baseline idle palette compared across all directions.
       Colours unique to one direction only are flagged.
    2. Zone analysis            -- bounding-box split into head / torso / legs zones.
       The dominant colour of each zone is compared across directions to catch
       "pants changed colour" style inconsistencies.
    3. Persistent drift         -- colours that appear in EVERY non-idle animation of a
       direction but are absent from idle. Single-frame prop colours are ignored.

Add --verbose to see per-frame detail for check 3.

PixelLab ZIP layout:
    rotations/<direction>.png
    animations/<AnimName-uuid>/<direction>/frame_NNN.png

Requirements:  pip install pillow numpy
"""

import sys
import re
import zipfile
import tempfile
import shutil
from pathlib import Path
from collections import defaultdict

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("ERROR: requires Pillow and numpy -- run: pip install pillow numpy")
    sys.exit(2)

# ── Config ────────────────────────────────────────────────────────────────────

ALPHA_THRESHOLD   = 20    # min alpha to count as opaque
MIN_PIXEL_COUNT   = 6     # min pixels for a colour to count in palette
QUANTISE_STEP     = 16    # per-channel quantisation bucket
OUTLINE_THRESHOLD = 32    # all-channels-below = outline black
# A colour must be absent from idle but present in this fraction of other
# animations to be flagged as "persistent drift" (not just a one-off prop).
PERSISTENT_THRESHOLD = 0.6

BASELINE_ANIMATIONS = [
    "Breathing_Idle", "breathing-idle",
    "Fight_Stance_Idle", "fight-stance-idle-8-frames",
    "walk", "walking", "running-8-frames",
]

ZONE_LABELS  = ["head", "torso", "legs"]
ZONE_FRACS   = [(0.00, 0.33), (0.33, 0.60), (0.60, 1.00)]  # fraction of bounding-box height

# ── Colour helpers ────────────────────────────────────────────────────────────

def quantise(rgb):
    return tuple((c // QUANTISE_STEP) * QUANTISE_STEP for c in rgb)

def is_outline(rgb):
    return all(c < OUTLINE_THRESHOLD for c in rgb)

def fmt(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def load_rgba(path):
    return np.array(Image.open(path).convert("RGBA"))


def opaque_mask(data):
    return data[:, :, 3] >= ALPHA_THRESHOLD


def extract_palette(data):
    """Return {quantised_rgb: count} for opaque, non-outline pixels."""
    mask = opaque_mask(data)
    rgb  = data[:, :, :3][mask]
    counts = defaultdict(int)
    for px in map(tuple, rgb.tolist()):
        q = quantise(px)
        if not is_outline(q):
            counts[q] += 1
    return {c: n for c, n in counts.items() if n >= MIN_PIXEL_COUNT}


def palette_set(palette):
    return frozenset(palette.keys())


def bounding_box(data):
    """(row_min, row_max, col_min, col_max) of non-transparent pixels, or None."""
    mask = opaque_mask(data)
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return None
    row_idx = np.where(rows)[0]
    col_idx = np.where(cols)[0]
    r0, r1 = int(row_idx[0]), int(row_idx[-1])
    c0, c1 = int(col_idx[0]), int(col_idx[-1])
    return r0, r1, c0, c1


def dominant_color(data, r0, r1, c0, c1):
    """Most frequent quantised colour in the crop [r0:r1, c0:c1]."""
    crop = data[r0:r1, c0:c1]
    mask = opaque_mask(crop)
    if not mask.any():
        return None
    rgb = crop[:, :, :3][mask]
    counts = defaultdict(int)
    for px in map(tuple, rgb.tolist()):
        q = quantise(px)
        if not is_outline(q):
            counts[q] += 1
    if not counts:
        return None
    return max(counts, key=counts.__getitem__)


def zone_dominant(path):
    """Return {zone_label: dominant_colour} for head/torso/legs zones."""
    data = load_rgba(path)
    bb   = bounding_box(data)
    if not bb:
        return {}
    r0, r1, c0, c1 = bb
    h = r1 - r0
    result = {}
    for label, (f0, f1) in zip(ZONE_LABELS, ZONE_FRACS):
        zr0 = r0 + int(h * f0)
        zr1 = r0 + int(h * f1)
        result[label] = dominant_color(data, zr0, zr1, c0, c1)
    return result

# ── File discovery ────────────────────────────────────────────────────────────

def discover_frames(root):
    """
    Returns { direction: { clean_anim_name: [Path, ...] } }
    Handles:  animations/<AnimName-uuid>/<direction>/frame_NNN.png
    """
    structure = defaultdict(lambda: defaultdict(list))

    for png in sorted(root.rglob("*.png")):
        rel   = png.relative_to(root)
        parts = rel.parts

        if parts[0] in ("rotations", "rotation"):
            continue

        if parts[0] == "animations" and len(parts) == 4:
            clean = re.sub(r'-[0-9a-f]{8}$', '', parts[1])
            direction = parts[2]
            structure[direction][clean].append(png)
        elif len(parts) >= 3:
            structure[parts[0]][parts[1]].append(png)

    return structure


def pick_baseline(animations):
    for name in BASELINE_ANIMATIONS:
        if name in animations:
            return name, animations[name]
    if animations:
        name = sorted(animations.keys())[0]
        return name, animations[name]
    return None

# ── Checks ────────────────────────────────────────────────────────────────────

def check_cross_direction(structure):
    """Compare idle baseline palettes across directions."""
    dir_baselines = {}
    for direction, animations in structure.items():
        bp = pick_baseline(animations)
        if not bp:
            continue
        _, frames = bp
        colors = frozenset()
        for f in frames:
            colors |= palette_set(extract_palette(load_rgba(f)))
        dir_baselines[direction] = colors

    if not dir_baselines:
        return frozenset(), []

    global_palette = frozenset().union(*dir_baselines.values())
    warnings = []

    if len(dir_baselines) >= 2:
        for direction in sorted(dir_baselines):
            others = frozenset().union(
                *(v for k, v in dir_baselines.items() if k != direction)
            )
            unique = dir_baselines[direction] - others
            if unique:
                cols = ", ".join(fmt(c) for c in sorted(unique))
                warnings.append(
                    f"  [!] {direction:12s} baseline has {len(unique)} colour(s)"
                    f" not in any other direction: {cols}"
                )

    return global_palette, warnings, dir_baselines


def check_zone_consistency(structure):
    """Compare dominant zone colours across directions using the baseline animation."""
    zone_data = {}  # direction -> { zone: dominant_colour }

    for direction, animations in structure.items():
        bp = pick_baseline(animations)
        if not bp:
            continue
        _, frames = bp
        # Use the first frame of the baseline as the reference
        zone_data[direction] = zone_dominant(frames[0])

    warnings = []
    directions = sorted(zone_data.keys())

    for zone in ZONE_LABELS:
        colours_by_dir = {d: zone_data[d].get(zone) for d in directions}
        colours_by_dir = {d: c for d, c in colours_by_dir.items() if c}
        unique_colours  = set(colours_by_dir.values())

        if len(unique_colours) <= 1:
            # All directions agree (or only one exists)
            continue

        # Flag directions whose zone dominant differs from the majority
        from collections import Counter
        majority_colour = Counter(colours_by_dir.values()).most_common(1)[0][0]
        for direction, colour in sorted(colours_by_dir.items()):
            if colour != majority_colour:
                warnings.append(
                    f"  [!] {direction:12s} [{zone}] dominant = {fmt(colour)}"
                    f"  (majority: {fmt(majority_colour)})"
                )

    return warnings


def check_persistent_drift(structure, verbose=False):
    """
    Flag colours absent from idle but present in >= PERSISTENT_THRESHOLD
    fraction of other animations in the same direction.
    Single-frame prop colours are suppressed by this threshold.
    """
    warnings = []

    for direction in sorted(structure):
        animations = structure[direction]
        bp = pick_baseline(animations)
        if not bp:
            continue

        baseline_name, baseline_frames = bp
        idle_colors = frozenset()
        for f in baseline_frames:
            idle_colors |= palette_set(extract_palette(load_rgba(f)))

        other_anims = {k: v for k, v in animations.items() if k != baseline_name}
        if not other_anims:
            continue

        # Count how many animations each non-idle colour appears in
        colour_anim_count = defaultdict(int)
        for anim_frames in other_anims.values():
            anim_colors = frozenset()
            for f in anim_frames:
                anim_colors |= palette_set(extract_palette(load_rgba(f)))
            for c in anim_colors - idle_colors:
                colour_anim_count[c] += 1

        threshold = int(len(other_anims) * PERSISTENT_THRESHOLD)
        persistent = {c: n for c, n in colour_anim_count.items() if n >= max(threshold, 2)}

        if persistent:
            cols = ", ".join(
                f"{fmt(c)} (in {n}/{len(other_anims)} anims)"
                for c, n in sorted(persistent.items())
            )
            warnings.append(
                f"  [!] {direction:12s} has {len(persistent)} colour(s) persistent"
                f" across animations but absent from idle: {cols}"
            )

    return warnings

# ── Entry point ───────────────────────────────────────────────────────────────

def run(source, verbose=False):
    source_path = Path(source)
    tmp_dir = None

    try:
        if source_path.suffix.lower() == ".zip":
            tmp_dir = tempfile.mkdtemp(prefix="sprite_check_")
            print(f"Unpacking {source_path.name} ...")
            with zipfile.ZipFile(source_path) as zf:
                zf.extractall(tmp_dir)
            root = Path(tmp_dir)
        else:
            root = source_path

        if not root.is_dir():
            print(f"ERROR: not a directory: {root}")
            return 2

        structure = discover_frames(root)
        if not structure:
            print("ERROR: no animation frames found")
            return 2

        directions   = sorted(structure.keys())
        total_anims  = sum(len(a) for a in structure.values())
        total_frames = sum(len(f) for a in structure.values() for f in a.values())

        print()
        print("Sprite Consistency Report")
        print(f"Source     : {source_path.name}")
        print(f"Directions : {', '.join(directions)}")
        print(f"Animations : {total_anims}   Frames: {total_frames}")
        print()

        all_warnings = 0

        # ── Check 1: cross-direction palette
        print("-- Check 1: Cross-direction idle palette " + "-" * 28)
        global_palette, cross_warn, _ = check_cross_direction(structure)
        print(f"   Global palette: {len(global_palette)} unique colour(s)")
        if cross_warn:
            all_warnings += len(cross_warn)
            for w in cross_warn:
                print(w)
        else:
            print("   [OK] All direction baselines share a consistent palette")

        # ── Check 2: zone dominant colour
        print()
        print("-- Check 2: Body-zone dominant colour (head / torso / legs) " + "-" * 10)
        zone_warn = check_zone_consistency(structure)
        if zone_warn:
            all_warnings += len(zone_warn)
            for w in zone_warn:
                print(w)
        else:
            print("   [OK] Dominant colour per zone is consistent across directions")

        # ── Check 3: persistent drift
        print()
        print("-- Check 3: Colours persistent across animations but absent from idle " + "-" * 1)
        drift_warn = check_persistent_drift(structure, verbose)
        if drift_warn:
            all_warnings += len(drift_warn)
            for w in drift_warn:
                print(w)
            print()
            print("   Note: persistent colours are often intentional (binoculars, backpack")
            print("   straps showing more in action poses). Review the listed hex values.")
        else:
            print("   [OK] No persistent palette drift detected")

        # ── Summary
        print()
        print("-" * 70)
        if all_warnings == 0:
            print("[OK] Clean -- no palette inconsistencies detected.")
            return 0
        else:
            print(f"[!!] {all_warnings} issue(s) found. See above for details.")
            return 1

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    verbose = "--verbose" in args
    args = [a for a in args if not a.startswith("--")]
    if not args:
        print("Usage: python scripts/sprite-consistency.py <character.zip | dir> [--verbose]")
        sys.exit(2)
    sys.exit(run(args[0], verbose))
