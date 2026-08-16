# -*- coding: utf-8 -*-
"""Generate PWA icons for 灵感图库 (PoseBook)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (16, 19, 26, 255)      # deep dark background
GOLD = (255, 209, 102, 255) # accent gold
DARK = (30, 34, 44, 255)    # lens dark


def draw_body(d, size, rounded_bg=True):
    if rounded_bg:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * 0.19, fill=BG)
    # camera top bump
    d.rounded_rectangle([size * 0.41, size * 0.27, size * 0.59, size * 0.35],
                        radius=size * 0.023, fill=GOLD)
    # shutter dots
    d.ellipse([size * 0.645, size * 0.235, size * 0.70, size * 0.29], fill=(120, 130, 148, 255))
    d.ellipse([size * 0.735, size * 0.258, size * 0.77, size * 0.293], fill=(120, 130, 148, 255))
    # camera body
    d.rounded_rectangle([size * 0.1875, size * 0.332, size * 0.8125, size * 0.703],
                        radius=size * 0.055, fill=GOLD)
    # lens outer
    cx, cy = size * 0.5, size * 0.52
    r = size * 0.164
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DARK)
    r2 = size * 0.086
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=GOLD)
    r3 = size * 0.051
    d.ellipse([cx - r3, cy - r3, cx + r3, cy + r3], fill=DARK)


def main():
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_body(ImageDraw.Draw(img), size, rounded_bg=True)
    img.save(os.path.join(OUT, "icon-512.png"))
    img.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, "icon-192.png"))

    # maskable: full-bleed background, same subject
    mask = Image.new("RGBA", (size, size), BG)
    draw_body(ImageDraw.Draw(mask), size, rounded_bg=False)
    mask.save(os.path.join(OUT, "icon-maskable-512.png"))
    print("icons generated:", os.listdir(OUT))


if __name__ == "__main__":
    main()
