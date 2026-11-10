"""Build out/KDP-upload-pack.zip from the built PDFs.

Run after sudoku_book.py, make_cover.py and (optionally) make_cover_v2.py:

    ../.venv/bin/python make_pack.py                # one cover: style A
    ../.venv/bin/python make_pack.py --alternates   # include style B too

The pack holds exactly the two files KDP asks for -- an interior and one
cover -- plus a read-me that restates the settings the files were built for.
Every number quoted in the read-me is read out of the PDFs at pack time, so
the read-me cannot drift away from the files next to it.
"""

import os
import sys
import zipfile

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

INTERIOR = "large-print-sudoku-for-seniors_interior_8.5x11.pdf"
COVER_A = "cover-8.5x11.pdf"        # cream, drawn grid -- the chosen cover
COVER_B = "cover-navy-8.5x11.pdf"   # navy + gold 9 -- kept as an alternate
PACK = "KDP-upload-pack.zip"

AUTHOR = "Md Shahid Raza"
TITLE = "Large Print Sudoku for Seniors"
PAPER_PPI = 0.002252  # in of spine per page, black ink on white paper


def facts():
    doc = pymupdf.open(os.path.join(OUT, INTERIOR))
    pages = doc.page_count
    w, h = doc[0].rect.width / 72, doc[0].rect.height / 72
    cover = pymupdf.open(os.path.join(OUT, COVER_A))
    cw, ch = cover[0].rect.width / 72, cover[0].rect.height / 72
    return {
        "pages": pages,
        "page_size": f"{w:.4g} x {h:.4g}",
        "spine": round(pages * PAPER_PPI, 4),
        "wrap": f"{cw:.4f} x {ch:.4f}",
    }


def readme(f, covers, alternates=False):
    lines = [
        f"{TITLE.upper()} - upload pack",
        "=" * 52,
        "",
        f"Author: {AUTHOR}",
        "Series: The Large Print Puzzle Series, Volume One",
        "",
        "FILES",
        f"  {INTERIOR}   <- KDP INTERIOR",
    ]
    lines.append(f"  {covers[0]:<52} <- KDP COVER")
    if alternates:
        for c in covers[1:]:
            lines.append(f"  {c:<52} <- alternate, not for upload")
    lines += [
        "",
        "KDP SETTINGS (must match, or the spine will be wrong)",
        f"  Print size ......... {f['page_size']} in",
        "  Bleed .............. No bleed",
        "  Interior ........... Black & white on white paper",
        "  Cover finish ....... Matte",
        f"  Page count ......... {f['pages']}",
        "",
        f"  Interior upload .... {INTERIOR}",
        "  Cover upload ....... the cover PDF, via \"upload a cover\" NOT Cover Creator",
        f"                       (full wrap {f['wrap']} in, spine {f['spine']} in)",
        "",
        "BEFORE YOU PUBLISH",
        "  - Order a printed proof and solve three puzzles with a pencil.",
        "  - Answer KDP's AI-content disclosure question honestly: the text is",
        "    AI-generated and reviewed and edited by the author; the puzzles come",
        "    from a non-AI generator that the author wrote and ran. No AI images",
        "    are used in this book -- the cover is drawn by code from open-licence",
        "    fonts, so the images answer is No. See QC.md.",
        "  - If you change the page count, the cover must be rebuilt. Spine width",
        f"    is page count x {PAPER_PPI} in for black ink on white paper.",
        "",
        "Questions the files answer for themselves",
        "  - Every puzzle has exactly one solution (verified).",
        "  - Every puzzle is solvable by logic alone, no guessing (verified).",
        "  - Printed digits were read back out of the PDF and matched cell by cell.",
        "  See QC.md in the repo for the full check list.",
        "",
    ]
    return "\n".join(lines)


def main():
    alternates = "--alternates" in sys.argv[1:]
    f = facts()
    covers = [c for c in (COVER_A, COVER_B) if os.path.exists(os.path.join(OUT, c))]
    if not alternates:
        covers = covers[:1]
    if not covers:
        raise SystemExit("no cover PDF found; run make_cover.py first")
    with zipfile.ZipFile(os.path.join(OUT, PACK), "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("READ-ME-FIRST.txt", readme(f, covers, alternates))
        z.write(os.path.join(OUT, INTERIOR), INTERIOR)
        for c in covers:
            z.write(os.path.join(OUT, c), c)
    size = os.path.getsize(os.path.join(OUT, PACK))
    print(f"{PACK}  {size:,} B  |  {f['pages']} pp  |  spine {f['spine']} in  |  "
          f"{len(covers)} cover(s)")


if __name__ == "__main__":
    main()
