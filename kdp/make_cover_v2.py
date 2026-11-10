#!/usr/bin/env python3
"""
Cover style B — "numeral": navy field, giant gold 9 over an engraved sudoku
grid, cream display type. A vector rebuild of the AI-generated concept, so the
type is sharp, the grid is a real 9x9, nothing overlaps, and the wrap carries
the correct spine for the interior's page count.

Same KDP geometry as make_cover.py:
    width  = 0.125 + 8.5 + spine + 8.5 + 0.125
    height = 11.25
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reportlab.lib.colors import Color, HexColor
from reportlab.pdfgen import canvas

from make_cover import (BLEED, PAPER_PPI, TRIM_H, TRIM_W, drawn, fit,
                        register_fonts, width)

NAVY = HexColor("#18263E")
CREAM = HexColor("#F9F3E3")
GOLD = HexColor("#A6813F")
GOLD_DEEP = HexColor("#8E6C31")

# grid lines: navy blended toward cream, kept as solid colours so the file
# needs no transparency (safer for print preflight)
GRID_FINE = Color(0.271, 0.314, 0.376)      # navy + 20% cream
GRID_BLOCK = Color(0.365, 0.396, 0.451)     # navy + 32% cream
BG = NAVY


def wrap(text: str, font: str, size: float, max_w: float) -> list[str]:
    """Break a paragraph to a measured width."""
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if width(trial, font, size) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def build(args) -> str:
    spine = args.pages * PAPER_PPI
    cover_w = BLEED + TRIM_W + spine + TRIM_W + BLEED
    cover_h = BLEED + TRIM_H + BLEED
    f = register_fonts()

    c = canvas.Canvas(args.out, pagesize=(cover_w * 72, cover_h * 72),
                      initialFontName=f["sans"], initialFontSize=10)
    c.setTitle(f"{args.title} — Cover")
    c.setAuthor(args.author)
    c.setSubject("Paperback cover, 8.5 x 11")

    back_x = BLEED
    spine_x = BLEED + TRIM_W
    front_x = spine_x + spine
    trim_top = cover_h - BLEED

    c.setFillColor(BG)
    c.rect(0, 0, cover_w * 72, cover_h * 72, stroke=0, fill=1)

    # =================================================== FRONT
    def fx(u): return (front_x + u) * 72
    def ft(t): return (trim_top - t) * 72

    cx = fx(TRIM_W / 2)
    INSET = 0.55

    # hairline frame — printed, so it can never be trimmed off
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.8)
    c.rect(fx(INSET), ft(TRIM_H - INSET), (TRIM_W - 2 * INSET) * 72,
           (TRIM_H - 2 * INSET) * 72, stroke=1, fill=0)

    drawn(c, "THE LARGE PRINT PUZZLE SERIES", cx, ft(1.12), f["sans"], 9.0,
          CREAM, tracking=3.0, align="center")
    drawn(c, "VOLUME ONE", cx, ft(1.38), f["sans"], 8.2, GOLD, tracking=2.6,
          align="center")
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(cx - 36, ft(1.56), cx + 36, ft(1.56))

    max_w = (TRIM_W - 1.5) * 72
    s1 = fit("Large Print", f["display400"], max_w, 46)
    drawn(c, "Large Print", cx, ft(2.50), f["display400"], s1, CREAM, align="center")
    s2 = fit("SUDOKU", f["display700"], max_w, 128, tracking=1.0)
    drawn(c, "SUDOKU", cx, ft(3.98), f["display700"], s2, CREAM, tracking=1.0,
          align="center")
    s3 = fit("for Seniors", f["display400"], 6.0 * 72, 38)
    drawn(c, "for Seniors", cx, ft(4.74), f["display400"], s3, CREAM, align="center")

    # ---- engraved grid, then the numeral on top --------------------------
    grid = 3.90 * 72
    gx = cx - grid / 2
    gy_top = ft(5.22)
    gy = gy_top - grid
    cell = grid / 9.0

    c.setStrokeColor(GRID_FINE)
    c.setLineWidth(0.6)
    for i in range(1, 9):
        if i % 3 == 0:
            continue
        c.line(gx + i * cell, gy, gx + i * cell, gy + grid)
        c.line(gx, gy + i * cell, gx + grid, gy + i * cell)

    c.setStrokeColor(GRID_BLOCK)
    c.setLineWidth(1.6)
    for i in (3, 6):
        c.line(gx + i * cell, gy, gx + i * cell, gy + grid)
        c.line(gx, gy + i * cell, gx + grid, gy + i * cell)

    c.setStrokeColor(GRID_BLOCK)
    c.setLineWidth(2.2)
    c.rect(gx, gy, grid, grid, stroke=1, fill=0)

    # The numeral. Playfair's figures are oldstyle: the "9" is 0.531 em above
    # the baseline and 0.152 em below it, total ink 0.683 em. Placing by those
    # numbers is the difference between "centred" and "looks centred".
    INK_TOP, INK_BOTTOM = 5.45, 8.75          # inches from trim top
    em = (INK_BOTTOM - INK_TOP) / 0.683
    baseline_pdf = cover_h - INK_BOTTOM + 0.152 * em
    c.setFont(f["display700"], em * 72)
    c.setFillColor(GOLD)
    c.drawCentredString(cx, baseline_pdf * 72, "9")

    # ---- footer ----------------------------------------------------------
    drawn(c, args.front_note, cx, ft(9.58), f["sans"], 9.2, CREAM, tracking=1.8,
          align="center")
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(cx - 28, ft(9.82), cx + 28, ft(9.82))
    drawn(c, args.author.upper(), cx, ft(10.18), f["sans"], 10.4, CREAM,
          tracking=3.4, align="center")

    # =================================================== SPINE
    spine_cx = (spine_x + spine / 2) * 72
    label = "LARGE PRINT SUDOKU FOR SENIORS"
    sp = fit(label, f["sans_b"], (TRIM_H - 2.8) * 72, 8.2, tracking=1.1)
    c.saveState()
    c.translate(spine_cx, (BLEED + TRIM_H / 2) * 72)
    c.rotate(90)
    drawn(c, label, 0, -sp * 0.35, f["sans_b"], sp, CREAM, tracking=1.1,
          align="center")
    c.restoreState()

    c.saveState()
    c.translate(spine_cx, (BLEED + 0.45) * 72)
    c.rotate(90)
    drawn(c, args.author.upper(), 0, -2.4, f["sans"], 6.4, GOLD, tracking=1.4,
          align="left")
    c.restoreState()

    # =================================================== BACK
    def bt(t): return (trim_top - t) * 72

    PAD = 0.30
    bx = (back_x + INSET + PAD) * 72
    bw = (TRIM_W - 2 * (INSET + PAD)) * 72
    right = (back_x + TRIM_W - INSET - PAD) * 72

    frame_x = (back_x + INSET) * 72
    frame_w = (TRIM_W - 2 * INSET) * 72
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.8)
    c.rect(frame_x, bt(TRIM_H - INSET), frame_w, (TRIM_H - 2 * INSET) * 72,
           stroke=1, fill=0)

    drawn(c, "THE LARGE PRINT PUZZLE SERIES", bx, bt(1.06), f["sans"], 8.2, CREAM,
          tracking=2.6)
    drawn(c, "VOLUME ONE", right, bt(1.06), f["sans"], 7.8, GOLD, tracking=2.2,
          align="right")
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(bx, bt(1.24), right, bt(1.24))

    drawn(c, args.back_headline, bx, bt(1.96), f["display700"], 25, CREAM)

    BODY = 11.3
    y = 2.66
    for para in args.back_paras:
        for line in wrap(para, f["serif"], BODY, bw):
            drawn(c, line, bx, bt(y), f["serif"], BODY, CREAM)
            y += 0.246
        y += 0.24

    y += 0.02
    for bullet in args.bullets:
        c.setFillColor(GOLD)
        c.setFont(f["sans_b"], 11.0)
        c.drawString(bx, bt(y), "—")
        first = True
        for line in wrap(bullet, f["serif"], BODY, bw - 20):
            drawn(c, line, bx + 20, bt(y), f["serif"], BODY, CREAM)
            y += 0.30 if first else 0.246
            first = False
        y += 0.05

    y += 0.18
    for para in args.back_tail:
        for line in wrap(para, f["serif"], BODY, bw):
            drawn(c, line, bx, bt(y), f["serif"], BODY, CREAM)
            y += 0.246
        y += 0.22

    # closing rule + author, centred well clear of the barcode block
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(bx, bt(TRIM_H - 1.95), right, bt(TRIM_H - 1.95))
    drawn(c, args.author.upper(), (back_x + TRIM_W / 2) * 72, bt(TRIM_H - 1.52),
          f["sans"], 8.4, CREAM, tracking=3.0, align="center")

    c.showPage()
    c.save()
    return args.out


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", default="out/cover-navy-8.5x11.pdf")
    p.add_argument("--pages", type=int, default=126)
    p.add_argument("--title", default="Large Print Sudoku for Seniors")
    p.add_argument("--author", default="Md Shahid Raza")
    p.add_argument("--front-note",
                   default="100 PUZZLES  ·  EASY TO HARD  ·  FULL SOLUTIONS")
    p.add_argument("--back-headline", default="Big grids. Big numbers.")
    args = p.parse_args()

    args.back_paras = [
        "100 Sudoku puzzles, printed one per page on a seven-inch grid, with "
        "digits about a third of an inch tall. Room to think, room for pencil "
        "marks, and none of the cramped little squares that make ordinary "
        "puzzle books tiring.",
    ]
    args.bullets = [
        "40 Easy, 35 Medium, 25 Hard — every one solvable by logic alone",
        "Each puzzle checked to have exactly one solution",
        "A how-to-play refresher and a three-step way in",
        "Full solutions at the back, six to a page",
    ]
    args.back_tail = [
        "The Easy section can be finished by simple scanning, which makes it a "
        "gentle return for anyone coming back to Sudoku. The Hard section is a "
        "genuine step up.",
        "Large print. One puzzle per page. A quiet half hour and a pencil.",
    ]

    path = build(args)
    spine = args.pages * PAPER_PPI
    print(f"wrote {path}")
    print(f"  spine {spine:.4f} in  |  wrap {BLEED + TRIM_W + spine + TRIM_W + BLEED:.4f} x {TRIM_H + 2*BLEED:.4f} in")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
