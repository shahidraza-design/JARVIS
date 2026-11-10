#!/usr/bin/env python3
"""
Full-wrap paperback cover for the large-print Sudoku interior.

Geometry follows KDP's published formula:
    width  = 0.125 + trim_w + spine + trim_w + 0.125
    height = 0.125 + trim_h + 0.125
    spine  = pages * 0.002252 in   (black ink on white paper)

126 pages -> 0.2838 in spine -> 17.5338 x 11.25 in.

The spine depends on the *final* page count. If the interior changes, rebuild
the cover with the new --pages or the wrap will be wrong.

    python make_cover.py --out out/cover.pdf
"""

from __future__ import annotations

import argparse
import os

from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------- geometry

TRIM_W, TRIM_H = 8.5, 11.0
BLEED = 0.125
PAPER_PPI = 0.002252          # in per page, black ink on white paper

CREAM = HexColor("#FAF5E9")
NAVY = HexColor("#16243C")
GOLD = HexColor("#A6813F")
MUTED = HexColor("#4A5468")
HAIRLINE = Color(0.62, 0.64, 0.68)


def pt(v: float) -> float:
    return v * 72.0


# ------------------------------------------------------------------- fonts

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")


def register_fonts() -> dict[str, str]:
    out = {}
    playfair = {400: "Playfair-Display", 700: "Playfair-Display-Bold"}
    for weight, name in playfair.items():
        path = os.path.join(FONT_DIR, f"PlayfairDisplay-{weight}.ttf")
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
            out[f"display{weight}"] = name
    dejavu = {
        "sans": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "sans_b": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "serif": "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "serif_b": "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    }
    for key, path in dejavu.items():
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont("CV-" + key, path))
            out[key] = "CV-" + key
    # graceful fallbacks
    out.setdefault("display400", out.get("serif", "Times-Roman"))
    out.setdefault("display700", out.get("serif_b", "Times-Bold"))
    out.setdefault("sans", "Helvetica")
    out.setdefault("sans_b", "Helvetica-Bold")
    out.setdefault("serif", "Times-Roman")
    out.setdefault("serif_b", "Times-Bold")
    return out


def width(text: str, font: str, size: float, tracking: float = 0.0) -> float:
    w = pdfmetrics.stringWidth(text, font, size)
    if tracking and len(text) > 1:
        w += tracking * (len(text) - 1)
    return w


def fit(text: str, font: str, max_w: float, start: float,
        tracking: float = 0.0, floor: float = 10.0) -> float:
    size = start
    while size > floor and width(text, font, size, tracking) > max_w:
        size -= 0.5
    return size


def drawn(c: canvas.Canvas, text: str, x: float, y: float, font: str,
          size: float, colour, tracking: float = 0.0, align: str = "left") -> None:
    """Draw text with optional letterspacing (Canvas has no setCharSpace here,
    so a text object is used instead)."""
    w = width(text, font, size, tracking)
    if align == "center":
        x -= w / 2.0
    elif align == "right":
        x -= w
    to = c.beginText(x, y)
    to.setFont(font, size)
    to.setFillColor(colour)
    # Always set it, even to zero: char spacing lives in the PDF graphics
    # state and survives BT/ET, so a letterspaced line would otherwise leak
    # into every later line of body text.
    to.setCharSpace(tracking)
    to.textOut(text)
    c.drawText(to)


# ------------------------------------------------------------ cover drawing

def build(args) -> str:
    spine = args.pages * PAPER_PPI
    cover_w = BLEED + TRIM_W + spine + TRIM_W + BLEED
    cover_h = BLEED + TRIM_H + BLEED

    f = register_fonts()
    c = canvas.Canvas(args.out, pagesize=(pt(cover_w), pt(cover_h)),
                      initialFontName=f["sans"], initialFontSize=10)
    c.setTitle(f"{args.title} — Cover")
    c.setAuthor(args.author)
    c.setSubject("Paperback cover, 8.5 x 11, 126 pages")

    back_x = BLEED
    spine_x = BLEED + TRIM_W
    front_x = spine_x + spine
    right_x = cover_w - BLEED
    trim_top = cover_h - BLEED
    trim_bottom = BLEED

    # ---- background -----------------------------------------------------
    c.setFillColor(CREAM)
    c.rect(0, 0, pt(cover_w), pt(cover_h), stroke=0, fill=1)

    # =====================================================================
    # FRONT  (local u: 0..8.5 from left, t: 0..11 down from trim top)
    # =====================================================================
    def fx(u):
        return pt(front_x + u)

    def fy(t):
        return pt(trim_top - t)

    cx = fx(TRIM_W / 2.0)

    # eyebrow: the series leads
    drawn(c, args.series, cx, fy(1.16), f["sans"], 9.2, MUTED,
          tracking=3.1, align="center")
    drawn(c, f"VOLUME {args.volume.upper()}", cx, fy(1.40), f["sans"], 8.2,
          GOLD, tracking=2.6, align="center")

    # gold hairline
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(cx - pt(0.5), fy(1.58), cx + pt(0.5), fy(1.58))

    # display title block
    max_w = pt(TRIM_W - 1.1)

    s1 = fit("Large Print", f["display400"], max_w, 46)
    drawn(c, "Large Print", cx, fy(2.62), f["display400"], s1, NAVY, align="center")

    s2 = fit("SUDOKU", f["display700"], max_w, 132, tracking=1.0)
    drawn(c, "SUDOKU", cx, fy(4.16), f["display700"], s2, NAVY,
          tracking=1.0, align="center")

    s3 = fit("for Seniors", f["display400"], pt(6.0), 40)
    drawn(c, "for Seniors", cx, fy(5.02), f["display400"], s3, NAVY, align="center")

    # ---- grid motif ------------------------------------------------------
    gsize = pt(3.15)
    gx = cx - gsize / 2.0
    gy_top = fy(5.62)
    gy = gy_top - gsize
    cell = gsize / 9.0

    c.setStrokeColor(Color(0.80, 0.81, 0.84))
    c.setLineWidth(0.45)
    for i in range(1, 9):
        if i % 3 == 0:
            continue
        c.line(gx + i * cell, gy, gx + i * cell, gy + gsize)
        c.line(gx, gy + i * cell, gx + gsize, gy + i * cell)
    c.setStrokeColor(NAVY)
    c.setLineWidth(1.5)
    for i in (3, 6):
        c.line(gx + i * cell, gy, gx + i * cell, gy + gsize)
        c.line(gx, gy + i * cell, gx + gsize, gy + i * cell)
    c.setLineWidth(2.3)
    c.rect(gx, gy, gsize, gsize, stroke=1, fill=0)

    # The givens of puzzle 1, exactly as printed on page 6 — so the cover is a
    # true sample of the book rather than a decorative grid.
    c.setFont(f["sans_b"], cell * 0.50)
    c.setFillColor(NAVY)
    for r, row in enumerate(args.motif_grid):
        for col, d in enumerate(row):
            if not d:
                continue
            c.drawCentredString(gx + col * cell + cell / 2.0,
                                gy + gsize - r * cell - cell / 2.0 - cell * 0.18,
                                str(d))

    # ---- footer ----------------------------------------------------------
    drawn(c, args.front_note, cx, fy(9.16), f["sans"], 9.4, MUTED,
          tracking=2.0, align="center")

    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(cx - pt(0.35), fy(9.46), cx + pt(0.35), fy(9.46))

    drawn(c, args.author.upper(), cx, fy(10.0), f["sans"], 10.6, NAVY,
          tracking=3.4, align="center")

    # =====================================================================
    # SPINE
    # =====================================================================
    spine_cx = pt(spine_x + spine / 2.0)
    spine_text = "LARGE PRINT SUDOKU FOR SENIORS"
    sp_size = fit(spine_text, f["sans_b"], pt(TRIM_H - 2.6), 8.4, tracking=1.1)
    c.saveState()
    c.translate(spine_cx, pt(trim_bottom + TRIM_H / 2.0))
    c.rotate(90)
    drawn(c, spine_text, 0, -sp_size * 0.35, f["sans_b"], sp_size, NAVY,
          tracking=1.1, align="center")
    c.restoreState()

    # anchored UP from the trim edge, not centred on it: centring put the text
    # 0.14 in from the bottom trim, inside the cutter's tolerance.
    c.saveState()
    c.translate(spine_cx, pt(trim_bottom + 0.45))
    c.rotate(90)
    drawn(c, args.author.upper(), 0, -3, f["sans"], 6.6, MUTED,
          tracking=1.4, align="left")
    c.restoreState()

    # =====================================================================
    # BACK
    # =====================================================================
    bx = pt(back_x + 0.55)
    bw = pt(TRIM_W - 1.1)

    def by(t):
        return pt(trim_top - t)

    drawn(c, args.series, bx, by(0.95), f["sans"], 8.4, MUTED, tracking=2.6)
    drawn(c, "VOLUME " + args.volume.upper(), pt(back_x + TRIM_W - 0.55), by(0.95),
          f["sans"], 8.0, GOLD, tracking=2.2, align="right")

    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(bx, by(1.12), pt(back_x + TRIM_W - 0.55), by(1.12))

    head_size = fit(args.back_headline, f["display700"], bw, 25)
    # wrap the headline on two lines
    drawn(c, args.back_headline, bx, by(1.78), f["display700"], head_size, NAVY)

    INK = Color(0.13, 0.15, 0.19)
    y = 2.50
    for para in args.back_paras:
        for line in para:
            drawn(c, line, bx, by(y), f["serif"], 11.4, INK)
            y += 0.248
        y += 0.24

    y += 0.04
    for bullet in args.bullets:
        c.setFillColor(GOLD)
        c.setFont(f["sans_b"], 11.0)
        c.drawString(bx, by(y), "—")
        drawn(c, bullet, bx + pt(0.28), by(y), f["serif"], 11.4, INK)
        y += 0.335

    y += 0.18
    for para in args.back_tail:
        for line in para:
            drawn(c, line, bx, by(y), f["serif"], 11.4, INK)
            y += 0.248
        y += 0.22

    # closing rule, then the author beneath it. Centred, it clears the barcode
    # block (which starts 6.375 in from the left trim edge) without guessing.
    rule_y = by(TRIM_H - 1.95)
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(bx, rule_y, pt(back_x + TRIM_W - 0.55), rule_y)

    drawn(c, args.author.upper(), pt(back_x + TRIM_W / 2.0), by(TRIM_H - 1.52),
          f["sans"], 8.6, NAVY, tracking=3.0, align="center")

    # Barcode: KDP prints its own in a 2.0 x 1.2 in clear area 0.25 in from the
    # trim edges. Nothing may be drawn there. (Deliberately no placeholder box:
    # a visible box would print.)
    _ = (2.0, 1.2)

    c.showPage()
    c.save()
    return args.out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", default="out/cover-8.5x11.pdf")
    p.add_argument("--pages", type=int, default=126)
    p.add_argument("--title", default="Large Print Sudoku for Seniors")
    p.add_argument("--author", default="Md Shahid Raza")
    p.add_argument("--series", default="THE LARGE PRINT PUZZLE SERIES")
    p.add_argument("--volume", default="One")
    p.add_argument("--front-note", default="100 PUZZLES  ·  EASY TO HARD  ·  FULL SOLUTIONS")
    p.add_argument("--back-headline", default="Big grids. Big numbers.")
    p.add_argument("--puzzles-json",
                   default="out/large-print-sudoku-for-seniors_puzzles.json")
    args = p.parse_args()

    # pull puzzle 1 from the built interior's JSON; fall back to a neutral grid
    args.motif_grid = [[0] * 9 for _ in range(9)]
    try:
        import json
        data = json.load(open(args.puzzles_json))
        args.motif_grid = data["puzzles"][0]["puzzle"]
    except Exception as exc:  # noqa: BLE001 - cover still builds without it
        print(f"  note: could not load {args.puzzles_json} ({exc}); motif left empty")

    args.back_paras = [
        ["100 Sudoku puzzles, printed one per page on a seven-inch grid, with",
         "digits about a third of an inch tall. Room to think, room for pencil",
         "marks, and none of the cramped little squares that make ordinary",
         "puzzle books tiring."],
    ]
    args.bullets = [
        "40 Easy, 35 Medium, 25 Hard — every one solvable by logic alone",
        "Each puzzle checked to have exactly one solution",
        "A how-to-play refresher and a three-step way in",
        "Full solutions at the back, six to a page",
    ]
    args.back_tail = [
        ["The Easy section can be finished by simple scanning, which makes it a",
         "gentle return for anyone coming back to Sudoku. The Hard section is a",
         "genuine step up."],
        ["Large print. One puzzle per page. A quiet half hour and a pencil."],
    ]

    path = build(args)
    spine = args.pages * PAPER_PPI
    print(f"wrote {path}")
    print(f"  spine {spine:.4f} in  |  wrap "
          f"{BLEED + TRIM_W + spine + TRIM_W + BLEED:.4f} x {TRIM_H + 2 * BLEED:.4f} in")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
