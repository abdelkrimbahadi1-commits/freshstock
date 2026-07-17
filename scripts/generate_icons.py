"""One-off icon generator for FreshStock PWA/app-store assets.

Not part of the app's runtime — run manually with `python scripts/generate_icons.py`
whenever the brand mark needs regenerating. Requires Pillow (pip install Pillow).
"""

import os

from PIL import Image, ImageDraw

GREEN = (22, 163, 74, 255)  # matches theme_color in app/manifest.ts
WHITE = (255, 255, 255, 255)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def draw_apple_glyph(draw: ImageDraw.ImageDraw, size: int, color=WHITE):
    cx = size / 2
    r = size * 0.27
    body_cy = size / 2 + size * 0.06

    draw.ellipse([cx - r, body_cy - r, cx + r, body_cy + r], fill=color)

    stem_w = max(2, round(size * 0.035))
    stem_top = body_cy - r - size * 0.10
    draw.line(
        [(cx, body_cy - r + size * 0.02), (cx, stem_top)],
        fill=color,
        width=stem_w,
    )

    leaf_w, leaf_h = size * 0.17, size * 0.095
    leaf_cx = cx + size * 0.10
    leaf_cy = stem_top + size * 0.02
    draw.ellipse(
        [leaf_cx - leaf_w / 2, leaf_cy - leaf_h / 2, leaf_cx + leaf_w / 2, leaf_cy + leaf_h / 2],
        fill=color,
    )


def make_icon(size: int, rounded: bool, safe_zone: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if rounded:
        radius = round(size * 0.22)
        draw.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=GREEN)
    else:
        draw.rectangle([(0, 0), (size, size)], fill=GREEN)

    if safe_zone:
        # Maskable icons: keep the glyph inside the ~80% "safe zone" circle
        # since the OS may crop to a circle, squircle, or rounded square.
        scale = 0.62
        glyph_size = round(size * scale)
        glyph_img = Image.new("RGBA", (glyph_size, glyph_size), (0, 0, 0, 0))
        glyph_draw = ImageDraw.Draw(glyph_img)
        draw_apple_glyph(glyph_draw, glyph_size)
        offset = round((size - glyph_size) / 2)
        img.alpha_composite(glyph_img, (offset, offset))
    else:
        draw_apple_glyph(draw, size)

    return img


def main():
    icons_dir = os.path.join(ROOT, "public", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    make_icon(192, rounded=True, safe_zone=False).save(os.path.join(icons_dir, "icon-192.png"))
    make_icon(512, rounded=True, safe_zone=False).save(os.path.join(icons_dir, "icon-512.png"))
    make_icon(512, rounded=False, safe_zone=True).save(
        os.path.join(icons_dir, "icon-512-maskable.png")
    )

    # Next.js file-based metadata icons (auto-wired into <head> by the framework)
    make_icon(512, rounded=True, safe_zone=False).save(os.path.join(ROOT, "app", "icon.png"))
    make_icon(180, rounded=False, safe_zone=False).save(os.path.join(ROOT, "app", "apple-icon.png"))

    print("Icons generated in public/icons/, app/icon.png, app/apple-icon.png")


if __name__ == "__main__":
    main()
