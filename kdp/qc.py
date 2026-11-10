#!/usr/bin/env python3
"""
Quality check for the Sudoku interior + cover.

Checks the *printed* result, not the source data: digits are read back out of
the PDF and mapped onto grid cells by coordinate, then compared with the JSON
the book was built from. Also verifies page structure, footer numbering,
margins, typography and the "solvable by logic alone" claim.

    python qc.py --pdf out/large-print-sudoku-for-seniors_interior_8.5x11.pdf \
                 --json out/large-print-sudoku-for-seniors_puzzles.json \
                 --cover out/cover-8.5x11.pdf
"""

from __future__ import annotations

import argparse
import json
import re
import sys

import pymupdf

import sudoku_book as S

FAILS: list[str] = []
WARNS: list[str] = []


def fail(msg: str) -> None:
    FAILS.append(msg)


def warn(msg: str) -> None:
    WARNS.append(msg)


def ok(msg: str) -> None:
    print(f"  ok   {msg}")


# ------------------------------------------------------------------ helpers

def digit_spans(page):
    """(x_center, y_center, digit) for every single-digit span on a page."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                t = span["text"].strip()
                if len(t) == 1 and t.isdigit():
                    x0, y0, x1, y1 = span["bbox"]
                    # flip to book coordinates (origin bottom-left)
                    out.append(((x0 + x1) / 2.0, 792.0 - (y0 + y1) / 2.0, int(t), span["size"]))
    return out


def cell_of(xc, yc, gx, gy_bottom, size):
    """Map a span centre to (row, col) inside a grid whose bottom-left is (gx, gy_bottom)."""
    cell = size / 9.0
    col = int((xc - gx) // cell)
    row = int((gy_bottom + size - yc) // cell)
    return row, col


def read_grid(spans, gx, gy_bottom, size):
    grid = [[0] * 9 for _ in range(9)]
    seen = 0
    for xc, yc, d, _sz in spans:
        if not (gx <= xc <= gx + size and gy_bottom <= yc <= gy_bottom + size):
            continue
        r, c = cell_of(xc, yc, gx, gy_bottom, size)
        if 0 <= r < 9 and 0 <= c < 9:
            if grid[r][c]:
                fail(f"two digits in one cell at row {r} col {c}")
            grid[r][c] = d
            seen += 1
    return grid, seen


# ------------------------------------------------------- structure checks

def check_structure(doc, puzzles):
    n = len(puzzles)
    print("\n[structure]")
    if doc.page_count % 2 != 0:
        fail(f"page count {doc.page_count} is odd (KDP wants an even count)")
    else:
        ok(f"page count {doc.page_count} is even")

    if n != 100:
        warn(f"{n} puzzles, not 100 — front matter copy says 100")

    labels = []
    for i, page in enumerate(doc):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    t = span["text"].strip()
                    if t.startswith("Puzzle ") and "–" not in t:
                        m = re.fullmatch(r"Puzzle (\d+)", t)
                        if m and span["size"] > 10:
                            labels.append((i + 1, int(m.group(1))))

    expected_numbers = list(range(1, n + 1))
    got = [num for _p, num in labels]
    if got != expected_numbers:
        fail(f"puzzle numbering is not 1..{n} in order (first mismatch: "
             f"{next((a for a, b in zip(got, expected_numbers) if a != b), 'length')})")
    else:
        ok(f"puzzle numbers 1..{n} appear once each, in order")

    # footer page number must equal the physical page number
    bad_footers = []
    for i, page in enumerate(doc):
        if i < 2 or i == doc.page_count - 1:
            continue
        text = page.get_text().split("\n")
        nums = [t.strip() for t in text if t.strip().isdigit()]
        if str(i + 1) not in nums:
            bad_footers.append(i + 1)
    if bad_footers:
        fail(f"footer page number != physical page on {bad_footers[:8]}")
    else:
        ok("printed page numbers match physical pages 3..")

    # difficulty labels line up with the JSON
    by_number = {p["number"]: p for p in puzzles}
    wrong = []
    for page_no, num in labels:
        text = doc[page_no - 1].get_text()
        want = by_number[num]["difficulty"].upper()
        if want not in text:
            wrong.append((page_no, num, want))
    if wrong:
        fail(f"difficulty label mismatch on {wrong[:5]}")
    else:
        ok("every puzzle page is labelled with its true difficulty")

    # dividers
    expect = {"Easy": 5, "Medium": 46, "Hard": 82, "Solutions": 108}
    for name, page_no in expect.items():
        head = doc[page_no - 1].get_text().strip().split("\n")[0]
        if head != name:
            fail(f"page {page_no} should open the {name} section, found {head!r}")
    ok("section dividers are on pages 5, 46, 82 and 108")

    # the two page references printed in the front matter
    if "page 109" not in doc[2].get_text():
        fail("How to Play does not say solutions start on page 109")
    if "page 109" not in doc[3].get_text():
        fail("Arrangement page does not say solutions start on page 109")
    if doc[108].get_text().startswith("Solutions"):
        ok("page 109 really is the first solutions page")


def check_printed_digits(doc, puzzles):
    """Read the digits back out of the PDF and compare cell by cell."""
    print("\n[source data]")
    seen, dupes, nonuniq = set(), [], []
    for p in puzzles:
        flat = tuple(v for row in p["puzzle"] for v in row)
        if flat in seen:
            dupes.append(p["number"])
        seen.add(flat)
        if S._count_solutions(list(flat), limit=2) != 1:
            nonuniq.append(p["number"])
        sol = [v for row in p["solution"] for v in row]
        if any(flat[i] and flat[i] != sol[i] for i in range(81)):
            fail(f"puzzle {p['number']}: a given disagrees with its solution")
        if not all(sorted(sol[i] for i in S._iter_units()[u]) == list(range(1, 10))
                   for u in range(27)):
            fail(f"puzzle {p['number']}: solution is not a valid completed grid")
    if dupes:
        fail(f"duplicate puzzles: {dupes}")
    if nonuniq:
        fail(f"puzzles without a unique solution: {nonuniq}")
    if not dupes and not nonuniq:
        ok(f"{len(puzzles)} puzzles: all distinct, all unique-solution, solutions valid")

    print("\n[data integrity: printed digits vs source JSON]")
    page_of = {}
    for page_no, page in enumerate(doc, start=1):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    m = re.fullmatch(r"Puzzle (\d+)", span["text"].strip())
                    if m and span["size"] > 10 and page_no < 109:
                        page_of[int(m.group(1))] = page_no
    bad = 0

    for p in puzzles:
        page = doc[page_of[p["number"]] - 1]
        grid, seen = read_grid(digit_spans(page), S.MARGIN, S.GRID_BOTTOM, S.GRID)
        want = p["puzzle"]
        if grid != want:
            bad += 1
            if bad <= 3:
                diff = [(r, c) for r in range(9) for c in range(9) if grid[r][c] != want[r][c]]
                fail(f"puzzle {p['number']} printed differs from source at {diff[:4]}")
        if seen != sum(1 for row in want for v in row if v):
            fail(f"puzzle {p['number']}: printed {seen} givens, expected "
                 f"{sum(1 for row in want for v in row if v)}")
    if bad == 0:
        ok(f"all {len(puzzles)} puzzle pages match the source grid exactly")

    # solutions: recompute each page's mini-grid origins the way the book lays them out
    SOL, GRID = S.SOL_GRID, S.GRID
    sol_pages = {}
    for a, p in enumerate(puzzles):
        sol_pages.setdefault(a // 6, []).append(p)

    checked = 0
    for page_idx, items in sol_pages.items():
        page = doc[108 + page_idx]
        spans = digit_spans(page)
        cols = 2 if len(items) <= 4 else 3
        rows = (len(items) + cols - 1) // cols
        col_gap = (GRID - cols * SOL) / (cols - 1)
        row_gap = 54.0
        block_h = rows * SOL + (rows - 1) * row_gap
        top = S.GRID_TOP - (GRID - block_h) / 2.0
        for i, p in enumerate(items):
            gx = S.MARGIN + (i % cols) * (SOL + col_gap)
            gy = top - (i // cols) * (SOL + row_gap) - SOL
            grid, seen = read_grid(spans, gx, gy, SOL)
            if grid != p["solution"]:
                fail(f"printed solution for puzzle {p['number']} differs from source")
            if seen != 81:
                fail(f"solution {p['number']} printed {seen} digits, expected 81")
            checked += 1
    if checked == len(puzzles):
        ok(f"all {checked} printed solutions match the source, 81 digits each")

    # header ranges
    for page_idx, items in sol_pages.items():
        page = doc[108 + page_idx]
        first, last = items[0]["number"], items[-1]["number"]
        head = page.get_text()
        want = f"{first}–{last}" if last > first else str(first)
        if want not in head:
            fail(f"solutions page {109 + page_idx} header should read {want}")
    ok("solution page range headers are correct")


def check_typography(doc):
    print("\n[typography]")
    sizes = {}
    fonts = {}
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    sizes[round(span["size"], 1)] = sizes.get(round(span["size"], 1), 0) + 1
                    fonts[span["font"]] = fonts.get(span["font"], 0) + 1
    print(f"       sizes used: {sorted(sizes)}")
    print(f"       fonts used: {sorted(fonts)}")

    if any("Helvetica" in f or "Times" in f for f in fonts):
        fail("an unembedded base-14 font is in use")
    else:
        ok("only embedded fonts are used")

    strays, straight = [], []
    for i, page in enumerate(doc):
        t = page.get_text()
        if "'" in t:
            straight.append(i + 1)
        if '"' in t:
            strays.append(i + 1)
    if straight:
        fail(f"straight apostrophe (should be ’) on pages {straight}")
    if strays:
        fail(f"straight double quote on pages {strays}")
    if not straight and not strays:
        ok("no straight quotes or apostrophes")


def check_geometry(doc):
    print("\n[geometry]")
    bad = [i + 1 for i, p in enumerate(doc)
           if abs(p.rect.width - 612) > 1e-6 or abs(p.rect.height - 792) > 1e-6]
    if bad:
        fail(f"pages not 8.5x11: {bad[:5]}")
    else:
        ok("every page is exactly 612 x 792 pt")

    lefts, rights, tops, bottoms = [], [], [], []
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    x0, y0, x1, y1 = span["bbox"]
                    lefts.append(x0); rights.append(612 - x1)
                    tops.append(y0); bottoms.append(792 - y1)
    print(f"       nearest ink: left {min(lefts):.1f}pt  right {min(rights):.1f}pt "
          f"top {min(tops):.1f}pt  bottom {min(bottoms):.1f}pt")
    if min(lefts) < 36 or min(rights) < 36 or min(tops) < 36 or min(bottoms) < 36:
        fail("ink closer than 0.5 in to a page edge (KDP minimum is 0.25 in outer)")
    else:
        ok("all ink sits inside a 0.5 in safety margin")


# ------------------------------------------------- logic-solvability ladder

def logic_solve(grid):
    """Solve with human techniques only, no guessing.

    Returns (solved, deepest) where deepest is the hardest technique needed:
    1 singles, 2 locked candidates, 3 naked/hidden pairs, 4 X-wing, 0 = stuck.
    """
    g = grid[:]
    cand = [set(range(1, 10)) if not g[i] else set() for i in range(81)]
    for i in range(81):
        if g[i]:
            for p in S._peers(i):
                cand[p].discard(g[i])

    def place(i, d):
        g[i] = d
        cand[i] = set()
        for p in S._peers(i):
            cand[p].discard(d)

    units = S._iter_units()
    deepest = 0
    while True:
        if all(g):
            return True, deepest

        progress = False

        # --- 1. naked singles
        for i in range(81):
            if not g[i] and len(cand[i]) == 1:
                place(i, next(iter(cand[i])))
                progress = True
                deepest = max(deepest, 1)
        if progress:
            continue

        # --- 2. hidden singles
        for unit in units:
            for d in range(1, 10):
                spots = [i for i in unit if not g[i] and d in cand[i]]
                if len(spots) == 1:
                    place(spots[0], d)
                    progress = True
                    deepest = max(deepest, 2)
            if progress:
                break
        if progress:
            continue

        # --- 3. locked candidates (pointing and claiming)
        for unit in units:
            for d in range(1, 10):
                spots = [i for i in unit if not g[i] and d in cand[i]]
                if len(spots) < 2:
                    continue
                rs, cs = {i // 9 for i in spots}, {i % 9 for i in spots}
                if len(rs) == 1:
                    r = next(iter(rs))
                    for c in range(9):
                        i = r * 9 + c
                        if i not in unit and d in cand[i]:
                            cand[i].discard(d)
                            progress = True
                if len(cs) == 1:
                    c = next(iter(cs))
                    for r in range(9):
                        i = r * 9 + c
                        if i not in unit and d in cand[i]:
                            cand[i].discard(d)
                            progress = True
        if progress:
            deepest = max(deepest, 3)
            continue

        # --- 4. naked pairs
        for unit in units:
            pairs = {}
            for i in unit:
                if not g[i] and len(cand[i]) == 2:
                    pairs.setdefault(frozenset(cand[i]), []).append(i)
            for digits, cells in pairs.items():
                if len(cells) == 2:
                    for i in unit:
                        if i not in cells and cand[i] & digits:
                            cand[i] -= digits
                            progress = True
        if progress:
            deepest = max(deepest, 3)
            continue

        # --- 5. hidden pairs
        for unit in units:
            where = {}
            for d in range(1, 10):
                spots = tuple(i for i in unit if not g[i] and d in cand[i])
                if len(spots) == 2:
                    where.setdefault(spots, set()).add(d)
            for spots, digits in where.items():
                if len(digits) == 2:
                    for i in spots:
                        if cand[i] != digits:
                            cand[i] &= digits
                            progress = True
        if progress:
            deepest = max(deepest, 3)
            continue

        # --- 6. X-wing
        for d in range(1, 10):
            rows = {}
            for r in range(9):
                cs = [c for c in range(9) if not g[r * 9 + c] and d in cand[r * 9 + c]]
                if len(cs) == 2:
                    rows[r] = tuple(cs)
            for (r1, c1), (r2, c2) in ((a, b) for a in rows.items() for b in rows.items() if a[0] < b[0]):
                if c1 == c2:
                    for r in range(9):
                        if r in (r1, r2):
                            continue
                        for c in c1:
                            i = r * 9 + c
                            if d in cand[i]:
                                cand[i].discard(d)
                                progress = True
            cols = {}
            for c in range(9):
                rs = [r for r in range(9) if not g[r * 9 + c] and d in cand[r * 9 + c]]
                if len(rs) == 2:
                    cols[c] = tuple(rs)
            for (c1, r1), (c2, r2) in ((a, b) for a in cols.items() for b in cols.items() if a[0] < b[0]):
                if r1 == r2:
                    for c in range(9):
                        if c in (c1, c2):
                            continue
                        for r in r1:
                            i = r * 9 + c
                            if d in cand[i]:
                                cand[i].discard(d)
                                progress = True
        if progress:
            deepest = max(deepest, 4)
            continue

        # nothing left to try: either a contradiction or genuinely hard
        if any(not g[i] and not cand[i] for i in range(81)):
            return False, -1
        return all(g), deepest


# --------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default="out/large-print-sudoku-for-seniors_interior_8.5x11.pdf")
    ap.add_argument("--json", default="out/large-print-sudoku-for-seniors_puzzles.json")
    ap.add_argument("--cover", default="out/cover-8.5x11.pdf")
    ap.add_argument("--pages", type=int, default=None)
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    puzzles = json.load(open(args.json))["puzzles"]

    check_structure(doc, puzzles)
    check_printed_digits(doc, puzzles)
    check_typography(doc)
    check_geometry(doc)

    print("\n[the 'logic alone' claim]")
    by_diff = {}
    for p in puzzles:
        grid = [v for row in p["puzzle"] for v in row]
        solved, depth = logic_solve(grid)
        by_diff.setdefault(p["difficulty"], []).append((p["number"], solved, depth))
    names = {1: "naked singles", 2: "hidden singles",
             3: "locked candidates/pairs", 4: "X-wing"}
    for diff, rows in by_diff.items():
        depths = sorted({d for _n, s, d in rows if s})
        stuck = [n for n, s, _d in rows if not s]
        label = ", ".join(names.get(d, str(d)) for d in depths) or "none"
        print(f"       {diff:7s} {len(rows):3d} puzzles — hardest needed: {label}"
              + (f" | UNSOLVED: {stuck}" if stuck else ""))
        if stuck:
            fail(f"{diff} puzzles needing guesswork: {stuck}")
    if not FAILS:
        ok("every puzzle solves with logic alone (no guessing)")

    print("\n[cover geometry]")
    cov = pymupdf.open(args.cover)
    pages = args.pages or doc.page_count
    spine = pages * 0.002252
    want_w, want_h = 0.125 + 8.5 + spine + 8.5 + 0.125, 11.25
    got_w, got_h = cov[0].rect.width / 72, cov[0].rect.height / 72
    print(f"       interior {pages} pages -> spine {spine:.4f} in, wrap {want_w:.4f} x {want_h:.4f}")
    print(f"       cover is {got_w:.4f} x {got_h:.4f}")
    if abs(got_w - want_w) > 0.002 or abs(got_h - want_h) > 0.002:
        fail(f"cover is {got_w:.4f}x{got_h:.4f} but the interior needs {want_w:.4f}x{want_h:.4f}")
    else:
        ok("cover wrap matches the interior's page count")

    print("\n" + "=" * 70)
    print(f"{len(FAILS)} failures, {len(WARNS)} warnings")
    for f in FAILS:
        print("  FAIL " + f)
    for w in WARNS:
        print("  WARN " + w)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
