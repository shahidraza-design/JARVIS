#!/usr/bin/env python3
"""
make-icons.py — renders the J.A.R.V.I.S. app icons without any image libraries.

Draws the arc reactor in pure Python (supersampled points + PNG written by hand
through zlib), so the icons can be regenerated on any machine with Python 3 and
nothing else:

    python3 tools/make-icons.py

Outputs (into assets/icons/):
    icon-192.png            standard app icon
    icon-512.png            standard app icon, high resolution
    maskable-512.png        Android adaptive icon (art inside the safe zone)
    apple-touch-icon.png    180x180, opaque, for iOS home screens
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"

BG = (0x04, 0x07, 0x0D)
ACCENT = (0x35, 0xE0, 0xFF)

# Ring definition: (radius, stroke width, opacity, dash, gap, rotation degrees)
# Radii/widths are in the 512-unit design space, exactly as in icon.svg.
RINGS = [
    (178, 3, 0.28, None, None, 0),
    (152, 6, 0.55, 34, 26, 0),
    (120, 3, 0.22, None, None, 0),
    (96, 7, 0.85, 150, 452, -38),
    (66, 3, 0.45, None, None, 0),
]
CORE_GLOW_R = 86
CORE_RING_R = 34
CORE_DOT_R = 17

SS = 3  # supersampling factor per axis


def over(dst, src, alpha):
    """Source-over compositing of an (r,g,b) colour onto a mutable pixel."""
    for i in range(3):
        dst[i] = dst[i] * (1 - alpha) + src[i] * alpha


def render(size, scale=1.0, opaque=False):
    """Render one icon. scale shrinks the artwork for maskable safe zones."""
    px = [[0.0, 0.0, 0.0] for _ in range(size * size)]
    c = size / 2.0
    unit = (size / 512.0) * scale  # design units -> pixels

    def bloom(dist):
        """Faint accent halo behind everything."""
        r = dist / (250 * unit) if unit else 0
        return max(0.0, 0.30 * (1 - r)) if r < 1 else 0.0

    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    px_x = x + (sx + 0.5) / SS
                    px_y = y + (sy + 0.5) / SS
                    dx = px_x - c
                    dy = px_y - c
                    dist = math.hypot(dx, dy)
                    col = list(BG)

                    b = bloom(dist)
                    if b > 0:
                        over(col, ACCENT, b)

                    for radius, width, opacity, dash, gap, rot in RINGS:
                        r_px = radius * unit
                        half = (width * unit) / 2.0
                        if abs(dist - r_px) > half + 0.5:
                            continue
                        if dash:
                            circ = 2 * math.pi * r_px
                            period = (dash + gap) * unit
                            ang = (math.degrees(math.atan2(dy, dx)) - rot) % 360
                            along = (ang / 360.0) * circ
                            if along % period > dash * unit:
                                continue
                        # Anti-aliased edge coverage.
                        edge = half + 0.5 - abs(dist - r_px)
                        cov = min(1.0, max(0.0, edge))
                        over(col, ACCENT, opacity * cov)

                    # core: soft cyan bloom, bright ring, white centre
                    cr = CORE_GLOW_R * unit
                    if dist < cr:
                        t = dist / cr
                        a = 0.95 * (1 - t) ** 2.2
                        glow = (255, 255, 255) if t < 0.35 else ACCENT
                        over(col, glow, a)

                    ring_r = CORE_RING_R * unit
                    if abs(dist - ring_r) <= 2.5 * unit + 0.5:
                        over(col, ACCENT, 0.95 * min(1.0, 2.5 * unit + 0.5 - abs(dist - ring_r)))

                    dot = CORE_DOT_R * unit
                    if dist <= dot + 0.5:
                        over(col, (0xEA, 0xFC, 0xFF), min(1.0, dot + 0.5 - dist))

                    for i in range(3):
                        acc[i] += col[i]

            n = SS * SS
            px[y * size + x] = [v / n for v in acc]

    return px


def write_png(path, size, px, alpha_channel=False):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            r, g, b = px[y * size + x]
            raw.extend((int(round(r)), int(round(g)), int(round(b))))
            if alpha_channel:
                raw.append(255)

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6 if alpha_channel else 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("icon-512.png", 512, 1.0, False),
        ("icon-192.png", 192, 1.0, False),
        # Maskable icons are cropped to a circle by Android: keep art in the
        # central 80%, so the rings are scaled down and the background full-bleed.
        ("maskable-512.png", 512, 0.62, False),
        ("apple-touch-icon.png", 180, 1.0, False),
    ]
    for name, size, scale, alpha in jobs:
        write_png(OUT / name, size, render(size, scale), alpha)
        print(f"wrote {OUT / name} ({size}x{size})")


if __name__ == "__main__":
    main()
