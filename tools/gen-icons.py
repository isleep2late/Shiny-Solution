#!/usr/bin/env python3
"""Writes the web app's icons (webapp/icons/): a four-point spark in the page's accent colour on the
panel colour, the colours of webapp/app.css. icon-192.png and icon-512.png have rounded corners and
are the "any" icons; icon-512-maskable.png is full-bleed with the spark inside the 80 % safe zone the
maskable purpose asks for. Flat colours, palette PNGs: the three files stay under 20 KB together.

  python3 tools/gen-icons.py            # rewrites the three files in place
"""
import os
from PIL import Image, ImageDraw

BG = (26, 32, 39)        # --panel  #1a2027
ACCENT = (245, 197, 66)  # --accent #f5c542
EDGE = (46, 57, 70)      # --edge   #2e3946
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "webapp", "icons")


def spark(draw, cx, cy, r, colour):
    """A four-point star: long arms on the axes, the waist at 22 % of the radius."""
    w = r * 0.22
    pts = [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
           (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]
    draw.polygon(pts, fill=colour)


def icon(size, maskable):
    # drawn at 4x and reduced, so the edges are smooth without any anti-aliasing option
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, s, s], fill=BG)
        r = s * 0.30                     # inside the central 80 % circle
    else:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=BG, outline=EDGE, width=s // 48)
        r = s * 0.36
    spark(d, s / 2, s / 2, r, ACCENT)
    spark(d, s * 0.78, s * 0.24, r * 0.28, ACCENT)
    img = img.resize((size, size), Image.LANCZOS)
    # a palette PNG keeps the files small; the alpha channel is kept for the rounded corners
    return img.quantize(colors=32, method=Image.Quantize.FASTOCTREE)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, maskable in (("icon-192.png", 192, False), ("icon-512.png", 512, False), ("icon-512-maskable.png", 512, True)):
        path = os.path.join(OUT, name)
        icon(size, maskable).save(path, optimize=True)
        print(name, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
