#!/usr/bin/env python3
"""
Large-print Sudoku interior generator for Amazon KDP paperbacks.

Produces a print-ready, single-file PDF: 8.5 x 11 in, one puzzle per page,
large bold digits, sectioned by difficulty, full solutions in the back.

Every puzzle is generated from a fixed seed and is guaranteed to have
exactly one solution, so the same command always produces the same book.

    python sudoku_book.py --author "Your Name" --out out/interior.pdf

Paper stock / margins are chosen to satisfy KDP's trim + gutter rules for a
black-ink interior up to 300 pages (0.75 in side margins vs the 0.50 in
minimum). No bleed is used, because nothing is printed to the page edge.
"""

from __future__ import annotations

import argparse
import os
import random
import sys

from reportlab.lib.colors import Color, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# --------------------------------------------------------------------------
# Page geometry (points; 72 pt = 1 inch)
# --------------------------------------------------------------------------

PAGE_W, PAGE_H = 612.0, 792.0        # 8.5 x 11 in  (US Letter trim, no bleed)
MARGIN = 50.0                        # 0.69 in side margin -> gutter-safe
GRID = 512.0                         # puzzle grid width
CELL = GRID / 9.0
GRID_TOP = 664.0
GRID_BOTTOM = GRID_TOP - GRID        # 152.0
DIGIT_SIZE = 32.0

RULE_Y = 690.0
HEADER_Y = 702.0
FOOTER_Y = 66.0

# Solution mini-grids: 3 across, 2 down
SOL_GRID = 160.0
SOL_CELL = SOL_GRID / 9.0
SOL_DIGIT = 10.5

GREY = Color(0.42, 0.42, 0.45)       # solved-in digits, distinct from givens
HAIR = Color(0.55, 0.55, 0.58)

# --------------------------------------------------------------------------
# Fonts — use a real print typeface when the machine has one, else degrade
# gracefully to a standard PDF font so the script never hard-fails.
# --------------------------------------------------------------------------

FONT_CANDIDATES = {
    "sans": ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
             "/usr/share/fonts/TTF/DejaVuSans.ttf",
             "/Library/Fonts/Arial.ttf"],
    "sans_b": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
               "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
               "/Library/Fonts/Arial Bold.ttf"],
    "serif": ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
              "/usr/share/fonts/TTF/DejaVuSerif.ttf",
              "/Library/Fonts/Times New Roman.ttf"],
    "serif_b": ["/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
                "/usr/share/fonts/TTF/DejaVuSerif-Bold.ttf",
                "/Library/Fonts/Times New Roman Bold.ttf"],
}
FONT_FALLBACK = {"sans": "Helvetica", "sans_b": "Helvetica-Bold",
                 "serif": "Times-Roman", "serif_b": "Times-Bold"}


def register_fonts() -> dict[str, str]:
    fonts = {}
    for key, paths in FONT_CANDIDATES.items():
        chosen = FONT_FALLBACK[key]
        for path in paths:
            if os.path.exists(path):
                name = "KDP-" + key
                pdfmetrics.registerFont(TTFont(name, path))
                chosen = name
                break
        fonts[key] = chosen
    return fonts


# --------------------------------------------------------------------------
# Sudoku engine — bitmask MRV solver, counts solutions (stops at `limit`)
# --------------------------------------------------------------------------

FULL = 0x1FF


def _count_solutions(grid: list[int], limit: int = 2) -> int:
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9
    for idx in range(81):
        v = grid[idx]
        if not v:
            continue
        bit = 1 << (v - 1)
        r, c = divmod(idx, 9)
        b = (r // 3) * 3 + c // 3
        if rows[r] & bit or cols[c] & bit or boxes[b] & bit:
            return 0
        rows[r] |= bit
        cols[c] |= bit
        boxes[b] |= bit

    def rec(found: int) -> int:
        best, best_mask, best_n = -1, 0, 10
        for idx in range(81):
            if grid[idx]:
                continue
            r, c = divmod(idx, 9)
            mask = FULL & ~(rows[r] | cols[c] | boxes[(r // 3) * 3 + c // 3])
            n = mask.bit_count()
            if n == 0:
                return found
            if n < best_n:
                best, best_mask, best_n = idx, mask, n
                if n == 1:
                    break
        if best < 0:
            return found + 1

        r, c = divmod(best, 9)
        b = (r // 3) * 3 + c // 3
        mask = best_mask
        while mask:
            bit = mask & -mask
            mask ^= bit
            grid[best] = bit.bit_length()
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            found = rec(found)
            grid[best] = 0
            rows[r] ^= bit
            cols[c] ^= bit
            boxes[b] ^= bit
            if found >= limit:
                return found
        return found

    return min(rec(0), limit)


def _singles_only_solvable(grid: list[int]) -> bool:
    """True if naked + hidden singles alone finish the puzzle (gentle logic)."""
    g = grid[:]
    while True:
        changed = False
        rows = [0] * 9
        cols = [0] * 9
        boxes = [0] * 9
        for idx, v in enumerate(g):
            if v:
                bit = 1 << (v - 1)
                r, c = divmod(idx, 9)
                rows[r] |= bit
                cols[c] |= bit
                boxes[(r // 3) * 3 + c // 3] |= bit
        # naked singles
        for idx, v in enumerate(g):
            if v:
                continue
            r, c = divmod(idx, 9)
            mask = FULL & ~(rows[r] | cols[c] | boxes[(r // 3) * 3 + c // 3])
            if mask and mask & (mask - 1) == 0:
                g[idx] = mask.bit_length()
                changed = True
        if changed:
            continue
        # hidden singles per unit
        for unit in _iter_units():
            for digit in range(1, 10):
                bit = 1 << (digit - 1)
                spots = [i for i in unit if g[i] == 0 and _cand(g, i) & bit]
                if len(spots) == 1:
                    g[spots[0]] = digit
                    changed = True
            if changed:
                break
        if not changed:
            return all(g)


_UNITS_CACHE: list[list[int]] | None = None


def _iter_units() -> list[list[int]]:
    global _UNITS_CACHE
    if _UNITS_CACHE is None:
        units = []
        for r in range(9):
            units.append([r * 9 + c for c in range(9)])
        for c in range(9):
            units.append([r * 9 + c for r in range(9)])
        for br in range(3):
            for bc in range(3):
                units.append([(br * 3 + dr) * 9 + bc * 3 + dc
                              for dr in range(3) for dc in range(3)])
        _UNITS_CACHE = units
    return _UNITS_CACHE


def _cand(g: list[int], idx: int) -> int:
    r, c = divmod(idx, 9)
    mask = FULL
    for i in range(9):
        for v in (g[r * 9 + i], g[i * 9 + c]):
            if v:
                mask &= ~(1 << (v - 1))
    br, bc = (r // 3) * 3, (c // 3) * 3
    for dr in range(3):
        for dc in range(3):
            v = g[(br + dr) * 9 + bc + dc]
            if v:
                mask &= ~(1 << (v - 1))
    return mask


def _full_grid(rng: random.Random) -> list[int]:
    """Random complete valid grid (backtracking with shuffled candidates)."""
    g = [0] * 81

    def fill(pos: int) -> bool:
        if pos == 81:
            return True
        r, c = divmod(pos, 9)
        mask = FULL
        for i in range(9):
            for v in (g[r * 9 + i], g[i * 9 + c]):
                if v:
                    mask &= ~(1 << (v - 1))
        br, bc = (r // 3) * 3, (c // 3) * 3
        for dr in range(3):
            for dc in range(3):
                v = g[(br + dr) * 9 + bc + dc]
                if v:
                    mask &= ~(1 << (v - 1))
        digits = [d for d in range(1, 10) if mask & (1 << (d - 1))]
        rng.shuffle(digits)
        for d in digits:
            g[pos] = d
            if fill(pos + 1):
                return True
            g[pos] = 0
        return False

    fill(0)
    return g


def _valid_so_far(g: list[int], pos: int) -> bool:
    r, c = divmod(pos, 9)
    v = g[pos]
    if not v:
        return True
    for i in range(9):
        if i != c and g[r * 9 + i] == v:
            return False
        if i != r and g[i * 9 + c] == v:
            return False
    br, bc = (r // 3) * 3, (c // 3) * 3
    for dr in range(3):
        for dc in range(3):
            idx = (br + dr) * 9 + bc + dc
            if idx != pos and g[idx] == v:
                return False
    return True


def make_puzzle(rng: random.Random, clues: int, gentle: bool) -> tuple[list[int], list[int]]:
    """Return (puzzle, solution). Symmetric digging, unique solution."""
    solution = _full_grid(rng)
    puzzle = solution[:]

    pairs = [(i, 80 - i) for i in range(41)]
    rng.shuffle(pairs)
    count = 81
    for a, b in pairs:
        if count <= clues:
            break
        if puzzle[a] == 0 and puzzle[b] == 0:
            continue
        ra, rb = puzzle[a], puzzle[b]
        puzzle[a] = puzzle[b] = 0
        trial = puzzle[:]
        ok = _count_solutions(trial, limit=2) == 1
        if ok and gentle:
            ok = _singles_only_solvable(puzzle)
        if ok:
            count -= 2 if a != b else 1
        else:
            puzzle[a], puzzle[b] = ra, rb
    return puzzle, solution


# --------------------------------------------------------------------------
# Drawing
# --------------------------------------------------------------------------

def draw_grid(c: canvas.Canvas, x: float, y: float, size: float,
              puzzle: list[int], solution: list[int] | None,
              digit_size: float, fonts: dict[str, str],
              show_givens_only: bool = True) -> None:
    cell = size / 9.0

    # Line weights scale with the grid, so a 2 in solution grid does not look
    # like a slab of ink next to a 7 in puzzle grid.
    scale = size / GRID
    hair_w = max(0.30, 0.62 * scale)
    block_w = max(0.55, 2.00 * scale)
    outer_w = max(0.95, 3.00 * scale)

    c.setStrokeColor(black)
    c.setLineWidth(hair_w)
    for i in range(1, 9):
        if i % 3 == 0:
            continue
        c.line(x + i * cell, y, x + i * cell, y + size)
        c.line(x, y + i * cell, x + size, y + i * cell)

    c.setLineWidth(block_w)
    for i in (3, 6):
        c.line(x + i * cell, y, x + i * cell, y + size)
        c.line(x, y + i * cell, x + size, y + i * cell)

    c.setLineWidth(outer_w)
    c.rect(x, y, size, size, stroke=1, fill=0)

    for idx, given in enumerate(puzzle):
        r, col = divmod(idx, 9)
        cx = x + col * cell + cell / 2.0
        cy = y + size - (r * cell) - cell / 2.0
        if given:
            value = given
        elif solution is not None and not show_givens_only:
            value = solution[idx]
        else:
            continue
        c.setFont(fonts["sans_b"], digit_size)
        c.setFillColor(black)
        c.drawCentredString(cx, cy - digit_size * 0.355, str(value))
    c.setFillColor(black)


def draw_puzzle_page(c: canvas.Canvas, number: int, label: str,
                     puzzle: list[int], fonts: dict[str, str],
                     book_title: str, page_no: int) -> None:
    c.setFont(fonts["serif_b"], 15)
    c.setFillColor(black)
    c.drawString(MARGIN, HEADER_Y, f"Puzzle {number}")
    c.setFont(fonts["sans"], 9.5)
    c.setFillColor(GREY)
    c.drawRightString(PAGE_W - MARGIN, HEADER_Y + 1, label.upper())
    c.setStrokeColor(HAIR)
    c.setLineWidth(0.6)
    c.line(MARGIN, RULE_Y, PAGE_W - MARGIN, RULE_Y)

    draw_grid(c, MARGIN, GRID_BOTTOM, GRID, puzzle, None, DIGIT_SIZE, fonts)

    c.setFont(fonts["sans"], 8)
    c.setFillColor(GREY)
    c.drawCentredString(PAGE_W / 2.0, FOOTER_Y, str(page_no))
    c.setFont(fonts["sans"], 7)
    c.drawCentredString(PAGE_W / 2.0, FOOTER_Y - 13, book_title)


def draw_solution_page(c: canvas.Canvas, items: list[tuple[int, list[int], list[int]]],
                       fonts: dict[str, str], book_title: str, page_no: int) -> None:
    first, last = items[0][0], items[-1][0]
    c.setFont(fonts["serif_b"], 15)
    c.setFillColor(black)
    c.drawString(MARGIN, HEADER_Y, "Solutions")
    c.setFont(fonts["sans"], 9.5)
    c.setFillColor(GREY)
    c.drawRightString(PAGE_W - MARGIN, HEADER_Y + 1,
                      f"{first}–{last}" if last > first else str(first))
    c.setStrokeColor(HAIR)
    c.setLineWidth(0.6)
    c.line(MARGIN, RULE_Y, PAGE_W - MARGIN, RULE_Y)

    # Six to a page normally. A short final page of four reads better as a
    # balanced 2 x 2 block than as 3 + 1.
    cols = 2 if len(items) <= 4 else 3
    rows = (len(items) + cols - 1) // cols
    col_gap = (GRID - cols * SOL_GRID) / (cols - 1)
    row_gap = 54.0
    block_h = rows * SOL_GRID + (rows - 1) * row_gap
    top = GRID_TOP - (GRID - block_h) / 2.0

    for i, (number, puzzle, solution) in enumerate(items):
        col = i % cols
        row = i // cols
        x = MARGIN + col * (SOL_GRID + col_gap)
        y = top - row * (SOL_GRID + row_gap) - SOL_GRID
        c.setFont(fonts["sans"], 8.5)
        c.setFillColor(GREY)
        c.drawCentredString(x + SOL_GRID / 2.0, y + SOL_GRID + 10, f"Puzzle {number}")
        draw_grid(c, x, y, SOL_GRID, puzzle, solution, SOL_DIGIT, fonts,
                  show_givens_only=False)

    c.setFont(fonts["sans"], 8)
    c.setFillColor(GREY)
    c.drawCentredString(PAGE_W / 2.0, FOOTER_Y, str(page_no))
    c.setFont(fonts["sans"], 7)
    c.drawCentredString(PAGE_W / 2.0, FOOTER_Y - 13, book_title)


def draw_text_page(c: canvas.Canvas, blocks: list[tuple[str, float, str]],
                   fonts: dict[str, str], page_no: int | None,
                   book_title: str = "") -> None:
    """blocks: (text, font_size, style) where style in {serif_b, serif, sans}."""
    total = sum(size * 1.75 for _text, size, _style in blocks)
    y = PAGE_H / 2.0 + total / 2.0 - 18
    for text, size, style in blocks:
        if "\t" in text:                      # two-column reference row
            label, detail = text.split("\t", 1)
            c.setFont(fonts["sans_b"], size)
            c.setFillColor(black)
            c.drawString(MARGIN + 18, y, label)
            c.setFont(fonts["sans"], size - 1.5)
            c.setFillColor(Color(0.28, 0.28, 0.31))
            c.drawString(MARGIN + 168, y, detail)
        else:
            font = fonts.get(style, fonts["sans"])
            c.setFont(font, size)
            c.setFillColor(black if style.endswith("_b") else Color(0.15, 0.15, 0.17))
            c.drawString(MARGIN + 18, y, text)
        y -= size * 1.75
    if page_no is not None:
        c.setFont(fonts["sans"], 8)
        c.setFillColor(GREY)
        c.drawCentredString(PAGE_W / 2.0, FOOTER_Y, str(page_no))
        c.setFont(fonts["sans"], 7)
        c.drawCentredString(PAGE_W / 2.0, FOOTER_Y - 13, book_title)


def draw_divider(c: canvas.Canvas, title: str, subtitle: str,
                 fonts: dict[str, str], page_no: int, book_title: str) -> None:
    c.setFont(fonts["serif_b"], 44)
    c.setFillColor(black)
    c.drawCentredString(PAGE_W / 2.0, PAGE_H / 2.0 + 24, title)
    c.setStrokeColor(black)
    c.setLineWidth(1.2)
    c.line(PAGE_W / 2.0 - 60, PAGE_H / 2.0 - 6, PAGE_W / 2.0 + 60, PAGE_H / 2.0 - 6)
    c.setFont(fonts["sans"], 12)
    c.setFillColor(GREY)
    c.drawCentredString(PAGE_W / 2.0, PAGE_H / 2.0 - 46, subtitle)
    c.setFont(fonts["sans"], 8)
    c.drawCentredString(PAGE_W / 2.0, FOOTER_Y, str(page_no))
    c.setFont(fonts["sans"], 7)
    c.drawCentredString(PAGE_W / 2.0, FOOTER_Y - 13, book_title)


# --------------------------------------------------------------------------
# Book assembly
# --------------------------------------------------------------------------

def build(args) -> str:
    fonts = register_fonts()
    rng = random.Random(args.seed)

    specs = ([("Easy", args.easy, 41, True),
              ("Medium", args.medium, 33, False),
              ("Hard", args.hard, 28, False)])
    puzzles: list[tuple[int, str, list[int], list[int]]] = []
    number = 1
    for label, qty, clues, gentle in specs:
        for _ in range(qty):
            puzzle, solution = make_puzzle(rng, clues, gentle)
            puzzles.append((number, label, puzzle, solution))
            number += 1

    if args.export_json:
        import json
        payload = {
            "seed": args.seed,
            "count": len(puzzles),
            "puzzles": [
                {"number": n, "difficulty": label,
                 "puzzle": [puzzle[r * 9:(r + 1) * 9] for r in range(9)],
                 "solution": [solution[r * 9:(r + 1) * 9] for r in range(9)]}
                for n, label, puzzle, solution in puzzles
            ],
        }
        with open(args.export_json, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=1)
        print(f"wrote {args.export_json}")

    total = len(puzzles)
    sol_per_page = 6
    sol_pages = (total + sol_per_page - 1) // sol_per_page

    front_pages = 4
    dividers = 3
    first_puzzle_page = front_pages + 1          # 5
    # page of first puzzle of each section
    section_start = {}
    n = 1
    for i, (label, qty, _, _) in enumerate(specs):
        section_start[label] = n
        n += qty
    sol_divider_page = front_pages + dividers + total + 1
    sol_start_page = sol_divider_page + 1

    out_path = args.out
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    # initialFontName matters: without it reportlab leaves an unembedded
    # Helvetica in every page's resource dict, which KDP preflight flags.
    c = canvas.Canvas(out_path, pagesize=(PAGE_W, PAGE_H),
                      initialFontName=fonts["sans"], initialFontSize=10)
    c.setTitle(f"{args.title} — Interior")
    c.setAuthor(args.author)
    c.setSubject("Large-print Sudoku puzzles")
    c.setCreator("kdp/sudoku_book.py")

    # ---- p1 title -------------------------------------------------------
    ty = PAGE_H - 240
    c.setFont(fonts["serif_b"], 40)
    c.setFillColor(black)
    c.drawCentredString(PAGE_W / 2.0, ty, "Large Print")
    c.drawCentredString(PAGE_W / 2.0, ty - 48, "Sudoku")
    c.setStrokeColor(black)
    c.setLineWidth(1.4)
    c.line(PAGE_W / 2.0 - 90, ty - 80, PAGE_W / 2.0 + 90, ty - 80)
    c.setFont(fonts["serif"], 22)
    c.drawCentredString(PAGE_W / 2.0, ty - 112, "for Seniors")
    c.setFont(fonts["sans"], 13)
    c.setFillColor(Color(0.2, 0.2, 0.22))
    c.drawCentredString(PAGE_W / 2.0, ty - 168, f"{total} Easy-to-Hard Puzzles")
    c.drawCentredString(PAGE_W / 2.0, ty - 190, "One Puzzle per Page")
    c.drawCentredString(PAGE_W / 2.0, ty - 212, "Full Solutions Included")

    # small sample grid on the cover-page? keep it clean: skip.
    c.setFont(fonts["sans"], 15)
    c.setFillColor(black)
    c.drawCentredString(PAGE_W / 2.0, 190, args.author)
    c.showPage()

    # ---- p2 copyright / disclosure --------------------------------------
    c.setFont(fonts["sans"], 8.5)
    c.setFillColor(Color(0.35, 0.35, 0.38))
    lines = [
        f"{args.title}",
        f"Copyright © {args.year} {args.author}. All rights reserved.",
        "",
        "No part of this publication may be reproduced, distributed, or transmitted in any",
        "form or by any means, including photocopying, recording, or other electronic or",
        "mechanical methods, without the prior written permission of the publisher, except",
        "in the case of brief quotations embodied in reviews and certain other",
        "non-commercial uses permitted by copyright law.",
        "",
        "The puzzles in this book were generated algorithmically for this volume and each",
        "was verified to have exactly one solution. They are original to this book and do",
        "not reproduce puzzles published elsewhere.",
        "",
        "For personal use. Printed in the United States of America.",
        "",
        f"If you enjoy this book, a review is genuinely appreciated — it helps more",
        "readers find it.",
    ]
    y = PAGE_H - 150
    for line in lines:
        c.drawString(MARGIN, y, line)
        y -= 14 if line else 9
    c.showPage()

    # ---- p3 how to play -------------------------------------------------
    draw_text_page(c, [
        ("How to Play", 26, "serif_b"),
        ("", 6, "sans"),
        ("The goal is simple: fill every empty square so that each row, each", 13, "serif"),
        ("column, and each of the nine 3 × 3 boxes contains the digits 1 to 9,", 13, "serif"),
        ("with no repeats anywhere.", 13, "serif"),
        ("", 6, "sans"),
        ("The starting numbers are printed in heavy black. Everything else is", 13, "serif"),
        ("yours to fill in — in pencil, so you can rub out a wrong guess.", 13, "serif"),
        ("", 6, "sans"),
        ("A way in, if you are new to this", 15, "serif_b"),
        ("", 4, "sans"),
        ("1.   Look for a row, column or box that already holds eight digits.", 13, "serif"),
        ("      The missing digit is the one that has to go in the empty square.", 13, "serif"),
        ("2.   Then look for a digit that can only fit in one square of a box.", 13, "serif"),
        ("      Count where it cannot go, and the answer usually falls out.", 13, "serif"),
        ("3.   Never guess. Every puzzle here has one solution and can be", 13, "serif"),
        ("      reached by logic alone — guessing usually means an earlier", 13, "serif"),
        ("      mistake, so go back and check.", 13, "serif"),
        ("", 6, "sans"),
        ("Full solutions start on page " + str(sol_start_page) + ".", 13, "sans_b"),
    ], fonts, 3, args.title)
    c.showPage()

    # ---- p4 organisation ------------------------------------------------
    draw_text_page(c, [
        ("How This Book Is Arranged", 26, "serif_b"),
        ("", 8, "sans"),
        ("The puzzles get harder as you go, and each section begins on a new", 13, "serif"),
        ("page so it is easy to find your place.", 13, "serif"),
        ("", 12, "sans"),
        (f"Easy\tpuzzles {section_start['Easy']}–"
         f"{section_start['Easy'] + args.easy - 1}", 13, "row"),
        ("\tgenerous starting numbers — a comfortable warm-up", 11.5, "row"),
        ("", 5, "sans"),
        (f"Medium\tpuzzles {section_start['Medium']}–"
         f"{section_start['Medium'] + args.medium - 1}", 13, "row"),
        ("\tfewer numbers, more thinking ahead", 11.5, "row"),
        ("", 5, "sans"),
        (f"Hard\tpuzzles {section_start['Hard']}–"
         f"{section_start['Hard'] + args.hard - 1}", 13, "row"),
        ("\tfor when the first two feel too easy", 11.5, "row"),
        ("", 5, "sans"),
        (f"Solutions\tpage {sol_start_page} onward", 13, "row"),
        ("", 16, "sans"),
        ("Large print, one puzzle to a page", 15, "serif_b"),
        ("", 4, "sans"),
        ("Every puzzle here is printed on its own page, seven inches wide, with", 13, "serif"),
        ("digits over half an inch tall. Nothing is squeezed to fit and no grid", 13, "serif"),
        ("runs into the fold of the page. If your eyes tire easily, this is the", 13, "serif"),
        ("format that helps most.", 13, "serif"),
    ], fonts, 4, args.title)
    c.showPage()

    # ---- sections -------------------------------------------------------
    page_no = 5
    idx = 0
    for label, qty, _, _ in specs:
        draw_divider(c, label, f"Puzzles {section_start[label]}–"
                     f"{section_start[label] + qty - 1}", fonts, page_no, args.title)
        page_no += 1
        c.showPage()
        for _ in range(qty):
            number, lbl, puzzle, _solution = puzzles[idx]
            draw_puzzle_page(c, number, lbl, puzzle, fonts, args.title, page_no)
            page_no += 1
            c.showPage()
            idx += 1

    # ---- solutions ------------------------------------------------------
    draw_divider(c, "Solutions", "Check your answers", fonts, page_no, args.title)
    page_no += 1
    c.showPage()

    for i in range(0, total, sol_per_page):
        chunk = puzzles[i:i + sol_per_page]
        draw_solution_page(c, [(n, p, s) for n, _l, p, s in chunk], fonts,
                           args.title, page_no)
        page_no += 1
        c.showPage()

    # KDP prefers an even page count; pad rather than leave a stray odd page.
    if page_no % 2 == 0:
        c.showPage()
        page_no += 1

    c.save()
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="out/large-print-sudoku-interior.pdf")
    ap.add_argument("--title", default="Large Print Sudoku for Seniors")
    ap.add_argument("--author", default="Your Name Here")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--seed", type=int, default=20261110)
    ap.add_argument("--easy", type=int, default=40)
    ap.add_argument("--medium", type=int, default=35)
    ap.add_argument("--hard", type=int, default=25)
    ap.add_argument("--export-json", default=None,
                    help="also dump every puzzle + solution as JSON")
    args = ap.parse_args()

    if args.author == "Your Name Here":
        print("  note: using the placeholder author. Pass --author \"Your Name\" "
              "before uploading.", file=sys.stderr)

    path = build(args)
    size_kb = os.path.getsize(path) / 1024.0
    print(f"wrote {path}  ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
