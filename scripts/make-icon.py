"""Generate the Aeolia Island cat app icon (PNG + multi-size ICO + MSIX logos).

The app's mascot is the cat from src/settings/assets/robot.svg (ears, capsule
eyes, pink nose, whiskers). The old appicon.png was a robot, which no longer
matches the product. This script draws the cat at 8x and downsamples so every
size stays crisp, with a simplified variant for 16/24/32 px where thin detail
would disappear.

Run: python scripts/make-icon.py
"""
from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

TILE = (43, 30, 26)          # #2b1e1a, same warm dark as the mascot SVG
TILE_TOP = (61, 44, 37)      # subtle top highlight
CREAM = (244, 234, 217)      # #f4ead9
INK = (32, 22, 18)           # eyes / mouth
PINK = (242, 155, 181)       # #f29bb5 nose + inner ears

DESIGN = 1000.0


def _lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_cat(size: int, compact: bool = False) -> Image.Image:
    """Render one square icon at `size` px using 8x supersampling."""
    s = max(size, 32) * 8
    k = s / DESIGN
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def sc(v: float) -> float:
        return v * k

    # Rounded tile with a soft vertical gradient, masked by the rounded rect.
    radius = sc(220)
    grad = Image.new("RGBA", (s, s), TILE + (255,))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / max(1, s - 1)
        gd.line([(0, y), (s, y)], fill=_lerp(TILE_TOP, TILE, min(1.0, t * 1.25)) + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # Geometry: compact icons enlarge the head so it survives 16 px.
    if compact:
        hx0, hx1 = 190.0, 810.0
        hy0, hy1 = 360.0, 820.0
        ear_y, ear_tip = 400.0, 190.0
    else:
        hx0, hx1 = 225.0, 775.0
        hy0, hy1 = 365.0, 805.0
        ear_y, ear_tip = 405.0, 200.0
    head_r = (hx1 - hx0) * 0.28
    cx = (hx0 + hx1) / 2

    # Ears first so the head covers their base (one clean silhouette).
    ear_w = (hx1 - hx0) * 0.34
    d.polygon(
        [(sc(hx0 + 18), sc(ear_y)), (sc(hx0 + 55), sc(ear_tip)), (sc(hx0 + 18 + ear_w), sc(hy0 + 10))],
        fill=CREAM,
    )
    d.polygon(
        [(sc(hx1 - 18), sc(ear_y)), (sc(hx1 - 55), sc(ear_tip)), (sc(hx1 - 18 - ear_w), sc(hy0 + 10))],
        fill=CREAM,
    )
    if not compact:
        d.polygon(
            [(sc(hx0 + 62), sc(ear_y - 8)), (sc(hx0 + 88), sc(ear_tip + 58)), (sc(hx0 + 18 + ear_w - 55), sc(hy0 - 6))],
            fill=PINK,
        )
        d.polygon(
            [(sc(hx1 - 62), sc(ear_y - 8)), (sc(hx1 - 88), sc(ear_tip + 58)), (sc(hx1 - 18 - ear_w + 55), sc(hy0 - 6))],
            fill=PINK,
        )

    d.rounded_rectangle([sc(hx0), sc(hy0), sc(hx1), sc(hy1)], radius=sc(head_r), fill=CREAM)

    # Capsule eyes, wide enough to read at 16 px.
    eye_w = (hx1 - hx0) * (0.155 if compact else 0.125)
    eye_h = (hy1 - hy0) * (0.34 if compact else 0.32)
    eye_y0 = hy0 + (hy1 - hy0) * 0.30
    for ex in (cx - (hx1 - hx0) * 0.19, cx + (hx1 - hx0) * 0.19):
        d.rounded_rectangle(
            [sc(ex - eye_w / 2), sc(eye_y0), sc(ex + eye_w / 2), sc(eye_y0 + eye_h)],
            radius=sc(eye_w / 2),
            fill=INK,
        )
        if not compact:
            d.rounded_rectangle(
                [sc(ex - eye_w * 0.22), sc(eye_y0 + eye_h * 0.10),
                 sc(ex + eye_w * 0.02), sc(eye_y0 + eye_h * 0.34)],
                radius=sc(eye_w * 0.12), fill=(255, 255, 255, 235),
            )

    # Nose + mouth.
    nose_y = hy0 + (hy1 - hy0) * 0.66
    nose_w = (hx1 - hx0) * 0.075
    d.polygon([(sc(cx - nose_w), sc(nose_y)), (sc(cx + nose_w), sc(nose_y)), (sc(cx), sc(nose_y + nose_w * 1.15))], fill=PINK)
    if not compact:
        lw = max(2, round(sc(10)))
        d.line([(sc(cx), sc(nose_y + nose_w * 1.15)), (sc(cx), sc(nose_y + nose_w * 2.1))], fill=INK, width=lw)
        d.arc([sc(cx - nose_w * 2.2), sc(nose_y + nose_w * 1.5), sc(cx), sc(nose_y + nose_w * 3.2)],
              20, 150, fill=INK, width=lw)
        d.arc([sc(cx), sc(nose_y + nose_w * 1.5), sc(cx + nose_w * 2.2), sc(nose_y + nose_w * 3.2)],
              30, 160, fill=INK, width=lw)
        # Whiskers sit on the dark tile, so they use the cream mascot colour.
        wl = max(2, round(sc(11)))
        for dy in (0.0, 0.055):
            d.line([(sc(hx0 + 8), sc(hy0 + (hy1 - hy0) * (0.62 + dy))),
                    (sc(hx0 - 95), sc(hy0 + (hy1 - hy0) * (0.60 + dy)))], fill=CREAM, width=wl)
            d.line([(sc(hx1 - 8), sc(hy0 + (hy1 - hy0) * (0.62 + dy))),
                    (sc(hx1 + 95), sc(hy0 + (hy1 - hy0) * (0.60 + dy)))], fill=CREAM, width=wl)

    # Crisp tile edge: a blurred halo gets clipped at the canvas edge and
    # Windows then draws a feathered square, which looks dirty at 16-32 px.
    return img.resize((size, size), Image.LANCZOS)


def _dib(img: Image.Image) -> bytes:
    """32-bit bottom-up DIB (BITMAPINFOHEADER + BGRA + AND mask).

    NSIS' MUI_ICON and some Windows shell paths do not accept PNG-compressed
    ICO frames, so the installer icon must use plain DIB entries.
    """
    w, h = img.size
    px = img.convert("RGBA").load()
    header = struct.pack(
        "<IiiHHIIiiII",
        40, w, h * 2, 1, 32, 0, w * h * 4, 0, 0, 0, 0,
    )
    rows = []
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    pixels = b"".join(rows)
    # 1bpp AND mask, rows padded to 4 bytes. All zero: alpha decides.
    mask_row = ((w + 31) // 32) * 4
    mask = b"\x00" * (mask_row * h)
    return header + pixels + mask


def write_ico(path: Path, sizes: list[int]) -> None:
    """Write a standard multi-size ICO with DIB frames (NSIS-safe)."""
    frames = [(size, _dib(draw_cat(size, compact=size <= 32))) for size in sizes]

    header = struct.pack("<HHH", 0, 1, len(frames))
    entries = b""
    payload = b""
    offset = 6 + 16 * len(frames)
    for size, blob in frames:
        entries += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0, 0, 1, 32, len(blob), offset,
        )
        offset += len(blob)
        payload += blob
    path.write_bytes(header + entries + payload)


def write_wide(path: Path, width: int, height: int) -> None:
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    side = min(height, width)
    cat = draw_cat(side, compact=False)
    canvas.alpha_composite(cat, ((width - side) // 2, (height - side) // 2))
    canvas.save(path)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)

    master = draw_cat(512)
    master.save(BUILD / "appicon.png")
    master.save(BUILD / "appicon-512.png")
    write_ico(BUILD / "appicon.ico", [16, 24, 32, 48, 64, 128, 256])

    master.resize((44, 44), Image.LANCZOS).save(BUILD / "Square44x44Logo.png")
    master.resize((150, 150), Image.LANCZOS).save(BUILD / "Square150x150Logo.png")
    master.resize((256, 256), Image.LANCZOS).save(BUILD / "Square256x256Logo.png")
    master.resize((50, 50), Image.LANCZOS).save(BUILD / "StoreLogo.png")
    write_wide(BUILD / "Wide310x150Logo.png", 310, 150)

    print("cat icon written:", ", ".join(sorted(p.name for p in BUILD.glob("*Logo.png"))))
    print("appicon.png 512, appicon.ico 16-256")


if __name__ == "__main__":
    main()
