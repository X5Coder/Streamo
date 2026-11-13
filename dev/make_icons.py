#!/usr/bin/env python3
"""
Regenerates every Streamo icon from the single master SVG (app_icon.svg):
  Android  : adaptive-icon foreground/monochrome, splash icon, mask preview
  Windows  : multi-size .ico + 512px .png master
  Siblings : refresh both projects' icon masters

Run:  python dev/make_icons.py
"""
import io
import os
import struct
import sys

import resvg_py
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER_SVG = os.path.join(ROOT, "app_icon.svg")
WIN_ROOT = os.path.dirname(os.path.dirname(ROOT)) + os.sep + "streamo_win"

# The design is a white tile, so the foreground is a full opaque white square with the
# artwork inside the guaranteed-visible 66dp safe zone of the 108dp adaptive viewport
# (radius 144 viewBox units; safe zone = 88). Any launcher mask â€” circle, squircle,
# teardrop, Realme/Pixel â€” keeps every pixel of the artwork visible.
ARTWORK_TARGET_RADIUS = 56
SPLASH_TARGET_RADIUS = 72
RASTER_SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

TILE_RECT = '<rect width="288" height="288" rx="44" ry="44" fill="#ffffff"/>\n'
ART_OPEN = '<g transform="translate(144 144) scale(1.3) translate(-129.35 -148.35)">'


def read_master() -> str:
    with open(MASTER_SVG, "r", encoding="utf-8") as fh:
        return fh.read()


def art_bbox_1x():
    """Measure the artwork-only bbox at scale 1.0 (pixels)."""
    src = read_master()
    assert TILE_RECT in src, "tile rect not found in master svg"
    art = src.replace(TILE_RECT, "", 1)
    png = resvg_py.svg_to_bytes(svg_string=art, width=288)
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    return img.getbbox()


def artwork_svg(target_radius: float, background: str = None) -> str:
    """Master SVG minus the white tile. The artwork is recentered on the canvas and scaled
    so its bounding circle of `target_radius` viewBox units fits inside the canvas.
    background: None -> transparent canvas; "#ffffff" -> opaque white full-square canvas."""
    src = read_master()
    assert TILE_RECT in src, "tile rect not found in master svg"
    bbox = art_bbox_1x()
    cx, cy = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0
    max_ext = max(cx - bbox[0], bbox[2] - cx, cy - bbox[1], bbox[3] - cy)
    scale = target_radius / max_ext

    art = src.replace(TILE_RECT, "", 1)
    if background:
        # insert a full-square background rect right after the closing </defs>
        defs_end = art.find("</defs>")
        art = art[: defs_end + len("</defs>")] + f'\n  <rect width="288" height="288" fill="{background}"/>' + art[defs_end + len("</defs>"):]
    # wrap the artwork group: recenter on the canvas, then scale to the target radius
    art = art.replace(ART_OPEN, f'<g transform="translate(144 144) scale({scale:.4f}) translate(-{cx} -{cy})">{ART_OPEN}', 1)
    # close the extra group right after the artwork's closing tag (before <metadata> or </svg>)
    meta_idx = art.find("<metadata>")
    insert_at = meta_idx if meta_idx != -1 else art.rfind("</svg>")
    art = art[:insert_at] + "</g>\n" + art[insert_at:]
    return art


def render(svg_text: str, width: int) -> bytes:
    return resvg_py.svg_to_bytes(svg_string=svg_text, width=width)


def save(png_bytes: bytes, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png_bytes)
    print("wrote", os.path.relpath(path, ROOT))


def white_silhouette(png_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = (255, 255, 255, a)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def write_ico(png_entries: list, path: str):
    """Multi-size PNG-compressed ICO."""
    count = len(png_entries)
    header = struct.pack("<HHH", 0, 1, count)
    data = b""
    offset = 6 + 16 * count
    directory = b""
    for size, blob in png_entries:
        w = 0 if size >= 256 else size   # 0 means 256 in ICO
        directory += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(blob), offset)
        data += blob
        offset += len(blob)
    with open(path, "wb") as fh:
        fh.write(header + directory + data)
    print("wrote", os.path.relpath(path, ROOT))


ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]


def main():
    # ---------- Android ----------
    fg_transparent = artwork_svg(ARTWORK_TARGET_RADIUS)                    # transparent canvas (monochrome source)
    fg_svg = artwork_svg(ARTWORK_TARGET_RADIUS, "#ffffff")                  # full white square, like first-party tiles
    splash_svg = artwork_svg(SPLASH_TARGET_RADIUS)

    fg = render(fg_svg, 512)
    save(fg, ROOT + "/app/src/main/res/drawable-nodpi/ic_launcher_artwork.png")

    mono = white_silhouette(render(fg_transparent, 512))
    save(mono, ROOT + "/app/src/main/res/drawable-nodpi/ic_launcher_monochrome.png")

    save(render(splash_svg, 512), ROOT + "/app/src/main/res/drawable/splash_icon.png")

    # ---------- legacy density rasters (full-bleed: opaque white square, no transparency) ----------
    fb_svg = fg_svg
    for density, px in RASTER_SIZES.items():
        save(render(fb_svg, px), f"{ROOT}/app/src/main/res/mipmap-{density}/ic_launcher.png")

    # ---------- mask preview (512, on the white tile color) ----------
    preview = Image.open(io.BytesIO(render(fg_svg, 512))).convert("RGBA")
    bg = Image.new("RGBA", preview.size, (255, 255, 255, 255))
    bg.alpha_composite(preview)
    bg.convert("RGB").save(ROOT + "/dev/icon_mask_preview.png")
    print("wrote dev/icon_mask_preview.png")

    # ---------- Windows + master renders ----------
    master_512 = render(read_master(), 512)
    save(master_512, ROOT + "/app_icon.png")
    win_shared = WIN_ROOT + "/shared/assets/app_icon.png"
    win_renderer = WIN_ROOT + "/windows/renderer/shared/assets/app_icon.png"
    save(master_512, win_shared)
    save(master_512, win_renderer)
    copy_svg = WIN_ROOT + "/shared/assets/app_icon.svg"
    with open(ROOT + "/app_icon.svg", "rb") as src, open(copy_svg, "wb") as dst:
        dst.write(src.read())
    print("wrote", os.path.relpath(copy_svg, ROOT))

    ico_entries = [(size, render(read_master(), size)) for size in ICO_SIZES]
    write_ico(ico_entries, ROOT + "/app_icon.ico")
    write_ico(ico_entries, WIN_ROOT + "/windows/assets/app_icon.ico")

    # ---------- adaptive-layout simulation at the reference density (108dp @ 420dpi = 283px) ----------
    vp = 283
    sim = Image.new("RGBA", (vp, vp), (255, 255, 255, 255))
    layer = Image.open(io.BytesIO(render(fg_svg, vp))).convert("RGBA")
    sim.alpha_composite(layer)
    sim.convert("RGB").save(ROOT + "/dev/mask_sim.png")
    print("wrote dev/mask_sim.png")


if __name__ == "__main__":
    sys.exit(main())
