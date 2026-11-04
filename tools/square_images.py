#!/usr/bin/env python3
"""
square_images.py — make every image a square JPG, ready for public/images/<category>/

  python square_images.py INPUT_FOLDER OUTPUT_FOLDER [options]

  · Works on one folder or a folder with subfolders (e.g. students/, inventions/, konzerne/):
    the subfolders are recreated in OUTPUT_FOLDER.
  · The file name is kept (only the ending becomes .jpg), because the file name is the
    name shown on the tierlist and in the feed headlines: "Lena_Petrovic.png" → "Lena_Petrovic.jpg".
  · Your originals are never changed.

Names from a list (names.txt)
  Put a file called names.txt into a folder with photos, one name per line:
      Léna Aebi
      Vivienne Anne Siegenthaler
      Hans-Peter Müller
  Every photo in that folder then gets one of these names (randomly assigned) as its file name:
  "Léna_Aebi.jpg", "Vivienne_Anne_Siegenthaler.jpg", … The original photo names don't matter.
  Empty lines and lines starting with # are ignored.
  More photos than names → the extra photos are left out. More names than photos → the extra names are listed.

Options
  --size 600        side length in pixels (default 600)
  --mode crop       crop:  cut the longer side to a square (good for photos, default)
         pad        pad:   keep the whole picture and fill the rest with --bg (good for logos)
  --bg white        fill colour for --mode pad and for transparent images (name or #hex)
  --focus 0.4       crop only: where to cut tall pictures, 0 = keep the top, 0.5 = middle, 1 = bottom.
                    0.4 keeps faces in portrait photos. Wide pictures are always cut in the middle.
  --quality 85      JPG quality (default 85)
  --names list.txt  use this name list instead of a names.txt in the folder
  --in-order        names.txt: give the names to the photos in alphabetical photo order, not randomly

Needs Pillow:  pip install pillow      (iPhone .heic files also need: pip install pillow-heif)
"""

import argparse
import random
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps, ImageColor
except ImportError:
    sys.exit("Pillow is missing. Install it with:  pip install pillow")

try:  # optional: iPhone photos
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif"}


def flatten(img, bg):
    """Turn transparent images into RGB on the background colour."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        base = Image.new("RGB", img.size, bg)
        base.paste(img, mask=img.split()[-1])
        return base
    return img.convert("RGB")


def square(img, size, mode, bg, focus):
    w, h = img.size
    if mode == "pad":
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), bg)
        canvas.paste(img, ((side - w) // 2, (side - h) // 2))
        img = canvas
    else:
        side = min(w, h)
        left = (w - side) // 2
        top = round((h - side) * focus) if h > w else (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
    return img.resize((size, size), Image.LANCZOS)


def read_names(path):
    """One name per line. Works with UTF-8 (Mac, modern Windows) and old Windows encodings."""
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):  # saved as "Unicode" in Windows Notepad
        text = raw.decode("utf-16")
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:  # old Windows encoding
            text = raw.decode("cp1252", errors="replace")
    names = []
    for line in text.splitlines():
        n = " ".join(line.split())
        if n and not n.startswith("#"):
            names.append(n)
    return names


def file_name(name):
    """'Vivienne Anne Siegenthaler' → 'Vivienne_Anne_Siegenthaler' (characters files can't have are removed)."""
    n = re.sub(r'[\\/:*?"<>|]', "", name).strip().strip(".")
    return n.replace(" ", "_")


def plan(files, a):
    """Decide the output path of every photo. Folders with a names.txt get names from the list."""
    jobs, notes = [], []
    by_dir = {}
    for f in files:
        by_dir.setdefault(f.parent, []).append(f)
    for d, photos in sorted(by_dir.items()):
        rel_dir = d.relative_to(a.input)
        list_file = a.names if a.names else next((p for p in d.iterdir() if p.name.lower() == "names.txt"), None)
        if not list_file:
            jobs += [(p, rel_dir / (p.stem + ".jpg")) for p in photos]
            continue
        names = read_names(list_file)
        if not a.in_order:
            photos = photos[:]
            random.shuffle(photos)
        taken = {}
        for p, n in zip(photos, names):
            base = file_name(n)
            if not base:
                continue
            if base.lower() in taken:  # same name twice in the list
                taken[base.lower()] += 1
                notes.append(f"'{n}' is twice in {list_file.name}, the second one is called '{n} {taken[base.lower()]}'")
                base += f"_{taken[base.lower()]}"
            else:
                taken[base.lower()] = 1
            jobs.append((p, rel_dir / (base + ".jpg")))
        where = rel_dir if str(rel_dir) != "." else a.input.name
        notes.append(f"{where}: {min(len(photos), len(names))} photos named from {list_file.name}")
        if len(photos) > len(names):
            notes.append(f"  {len(photos) - len(names)} photos had no name left and were left out")
        if len(names) > len(photos):
            notes.append(f"  {len(names) - len(photos)} names had no photo left: " + ", ".join(names[len(photos):]))
    return jobs, notes


def main():
    ap = argparse.ArgumentParser(description="Make every image a square JPG.")
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--size", type=int, default=600)
    ap.add_argument("--mode", choices=["crop", "pad"], default="crop")
    ap.add_argument("--bg", default="white")
    ap.add_argument("--focus", type=float, default=0.4)
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--names", type=Path, help="name list to use (default: names.txt in each folder)")
    ap.add_argument("--in-order", action="store_true", help="assign names in photo order instead of randomly")
    a = ap.parse_args()
    if a.names and not a.names.is_file():
        sys.exit(f"Name list not found: {a.names}")

    if not a.input.is_dir():
        sys.exit(f"Input folder not found: {a.input}")
    if a.output.resolve() == a.input.resolve():
        sys.exit("Please choose a different OUTPUT_FOLDER, so your originals stay untouched.")
    bg = ImageColor.getrgb(a.bg)
    focus = min(1.0, max(0.0, a.focus))

    files = sorted(p for p in a.input.rglob("*") if p.is_file() and p.suffix.lower() in EXTS and not p.name.startswith("."))
    if not files:
        sys.exit(f"No images found in {a.input}")

    jobs, notes = plan(files, a)
    done, small, failed, seen = 0, [], [], {}
    for src, rel in jobs:
        dst = a.output / rel
        if rel in seen:
            print(f"  ! skipped {src.name}: same name as {seen[rel].name}")
            failed.append(src)
            continue
        seen[rel] = src
        try:
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im)  # phone photos: fix rotation
                if (max(im.size) if a.mode == "pad" else min(im.size)) < a.size:
                    small.append(f"{rel} ({im.size[0]}×{im.size[1]})")
                out = square(flatten(im, bg), a.size, a.mode, bg, focus)
            dst.parent.mkdir(parents=True, exist_ok=True)
            out.save(dst, "JPEG", quality=a.quality, optimize=True, progressive=True)
            done += 1
            print(f"  ✓ {rel}")
        except Exception as e:  # broken or unsupported file
            print(f"  ✗ {src.name}: {e}")
            failed.append(src)

    print(f"\n{done} images saved to {a.output}  ({a.size}×{a.size}, mode: {a.mode})")
    if small:
        print(f"{len(small)} were smaller than {a.size} px and got enlarged (may look soft):")
        for s in small:
            print("   ", s)
    if failed:
        print(f"{len(failed)} could not be converted (see above).")
    for n in notes:
        print(n)


if __name__ == "__main__":
    main()
