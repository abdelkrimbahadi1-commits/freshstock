"""Generates the Play Store feature graphic (1024x500).

One-off asset generator, not part of the app runtime.
Run with: python scripts/generate_feature_graphic.py
"""

import os

from PIL import Image, ImageDraw, ImageFont

GREEN = (22, 163, 74, 255)  # theme_color
GREEN_DARK = (21, 128, 61, 255)  # green-700
WHITE = (255, 255, 255, 255)
GREEN_100 = (220, 252, 231, 255)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def draw_apple_glyph(draw: ImageDraw.ImageDraw, cx: float, cy: float, scale: float):
    r = 78 * scale
    body_cy = cy + 8 * scale

    draw.ellipse([cx - r, body_cy - r, cx + r, body_cy + r], fill=WHITE)

    stem_w = max(2, round(10 * scale))
    stem_top = body_cy - r - 30 * scale
    draw.line(
        [(cx, body_cy - r + 6 * scale), (cx, stem_top)],
        fill=WHITE,
        width=stem_w,
    )

    leaf_w, leaf_h = 50 * scale, 28 * scale
    leaf_cx = cx + 30 * scale
    leaf_cy = stem_top + 6 * scale
    draw.ellipse(
        [leaf_cx - leaf_w / 2, leaf_cy - leaf_h / 2, leaf_cx + leaf_w / 2, leaf_cy + leaf_h / 2],
        fill=WHITE,
    )


def load_font(size: int, bold: bool = True):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main():
    width, height = 1024, 500
    img = Image.new("RGBA", (width, height), GREEN)
    draw = ImageDraw.Draw(img)

    for x in range(width):
        t = x / width
        r = round(GREEN[0] + (GREEN_DARK[0] - GREEN[0]) * t)
        g = round(GREEN[1] + (GREEN_DARK[1] - GREEN[1]) * t)
        b = round(GREEN[2] + (GREEN_DARK[2] - GREEN[2]) * t)
        draw.line([(x, 0), (x, height)], fill=(r, g, b, 255))

    draw_apple_glyph(draw, cx=140, cy=height / 2, scale=1.35)

    title_font = load_font(64, bold=True)
    subtitle_font = load_font(26, bold=False)

    draw.text((250, 165), "FreshStock", font=title_font, fill=WHITE)
    draw.text(
        (252, 250),
        "Scannez, cuisinez, zéro gaspillage.",
        font=subtitle_font,
        fill=GREEN_100,
    )

    out_dir = os.path.join(ROOT, "public", "store-assets")
    os.makedirs(out_dir, exist_ok=True)
    img.convert("RGB").save(os.path.join(out_dir, "feature-graphic-1024x500.png"))
    print("Saved public/store-assets/feature-graphic-1024x500.png")


if __name__ == "__main__":
    main()
