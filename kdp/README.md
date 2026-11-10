# Large-Print Sudoku — KDP production pack

Print-ready interior for a paperback, plus the generator that makes it. Rebuild any
volume in about one second.

```
kdp/
├── sudoku_book.py                 interior generator (puzzles + PDF layout)
├── make_cover.py                  full-wrap cover generator (spine maths)
├── requirements.txt               reportlab
├── README.md                      this file
├── fonts/                         Playfair Display + its OFL licence
└── out/
    ├── large-print-sudoku-for-seniors_interior_8.5x11.pdf
    ├── cover-8.5x11.pdf
    ├── large-print-sudoku-for-seniors_puzzles.json
    └── preview-pages.png
```

---

## What the PDF is

| Spec | Value |
| --- | --- |
| Trim size | 8.5 × 11 in (US Letter) |
| Pages | 126 (even, ends on a blank) |
| Interior | Black & white, white paper |
| Bleed | None — nothing is printed to the page edge |
| Margins | 0.69 in left/right, 1.09 in to the top line, 0.71 in above the bottom edge |
| Fonts | All four DejaVu subsets embedded (no system-font dependency) |
| Puzzles | 100 — 40 Easy, 35 Medium, 25 Hard |
| Puzzle page | One 7.1 in grid per page, 32 pt bold digits (0.32 in tall on paper) |
| Solutions | All 100, six to a page, starting p.109 |

The 0.69 in side margin clears KDP's inside/gutter minimum (0.375 in for books up to
150 pages) with room to spare, so the book works whether or not the printer mirrors
margins.

### Page map

| Pages | Content |
| --- | --- |
| 1 | Title |
| 2 | Copyright |
| 3 | How to Play |
| 4 | How This Book Is Arranged |
| 5 | Divider — Easy |
| 6–45 | Puzzles 1–40 |
| 46 | Divider — Medium |
| 47–81 | Puzzles 41–75 |
| 82 | Divider — Hard |
| 83–107 | Puzzles 76–100 |
| 108 | Divider — Solutions |
| 109–125 | Solutions |
| 126 | Blank (keeps the page count even) |

---

## Puzzle integrity

Every puzzle is generated from a fixed seed and then checked:

- **Exactly one solution** — the solver enumerates up to two solutions and the puzzle
  is rejected if a second exists.
- **Easy tier is logic-gentle by construction** — a puzzle only enters the Easy section
  if it can be finished with naked and hidden singles alone. No guessing required.
- **Symmetric clue patterns** — givens are removed in 180° rotational pairs, which is
  why the printed grids look deliberate rather than ragged.
- **No duplicates** — all 100 grids in a volume are distinct.
- **Same seed, same book** — rebuilds are byte-stable, so you can fix a typo in the
  front matter without silently reshuffling the puzzles.

`out/…puzzles.json` holds every grid and solution, if you ever want to re-verify or
reuse them.

---

## Rebuilding

```bash
python3 -m venv .venv
.venv/bin/pip install -r kdp/requirements.txt

cd kdp
../.venv/bin/python sudoku_book.py \
    --author "Your Name" \
    --out out/large-print-sudoku-for-seniors_interior_8.5x11.pdf \
    --export-json out/large-print-sudoku-for-seniors_puzzles.json
```

Options: `--title`, `--author`, `--year`, `--seed`, `--easy/--medium/--hard` (counts),
`--out`, `--export-json`.

**Before you upload, replace the author.** The default is the literal string
`Your Name Here`, and the script warns you when it uses it. It appears on the title
page and the copyright page.

Make a second volume with a new seed and a new title:

```bash
../.venv/bin/python sudoku_book.py --seed 20261111 --author "Your Name" \
    --title "Large Print Sudoku for Seniors Book 2" \
    --out out/volume-2_interior_8.5x11.pdf
```

---

## Publishing checklist

1. **Print a proof first.** Order one author copy and solve three puzzles with a pencil.
   Check that the digits feel big enough in your hand, that the paper doesn't ghost, and
   that page 109 really is the solution for puzzle 1.
2. **KDP → Create → Paperback.** Enter the title, then set:
   - Print size **8.5 × 11 in**, Bleed **No bleed**, Interior **Black & white on white paper**,
     Cover finish **Matte**, Page count **126**.
   - Upload the interior PDF. Use KDP's previewer and look at the gutter on page 45 —
     nothing should crowd the spine.
3. **Disclose AI / algorithmic content.** KDP asks during publishing whether the book
   contains AI-generated content. These puzzles are machine-generated and machine-verified,
   and the front matter says so plainly. Answer the question honestly and consistently
   with what the book claims. Read the current KDP content guidelines before you publish —
   they change, and the answer is your responsibility, not the tool's.
4. **Don't reuse a cover from another title.** Generic or duplicated covers are one of the
   fastest ways to get a low-content book suppressed.

### Metadata

**Title:** Large Print Sudoku for Seniors
**Subtitle:** 100 Easy to Hard Puzzles with Full Solutions — One Puzzle per Page

Keywords (7 slots):

```
large print sudoku for seniors
easy sudoku puzzle book for adults
sudoku large print easy to hard
brain games for seniors
sudoku puzzle book one puzzle per page
activity books for elderly adults
large print puzzle books for adults
```

Categories:

- Humor & Entertainment → Puzzles & Games → Sudoku
- Humor & Entertainment → Puzzles & Games → Logic & Brain Teasers
- Health, Fitness & Dieting → Aging → Memory Improvement

Description (edit the bracketed bits, keep it honest):

> Big grids. Big numbers. No squinting.
>
> This large-print Sudoku book is printed one puzzle to a page: a seven-inch grid with
> digits a third of an inch tall, so there is plenty of clear space around every number
> for pencil marks — none of the cramped little squares that make ordinary puzzle books
> tiring.
>
> **Inside:**
> - 100 original Sudoku puzzles, verified to have exactly one solution
> - 40 Easy, 35 Medium, 25 Hard — all of them solvable by logic, no guessing
> - A short "how to play" refresher and a three-step method for getting started
> - Full solutions at the back, six to a page
>
> The Easy puzzles are chosen so that simple scanning alone will finish them — a
> comfortable warm-up for anyone coming back to Sudoku after a while, or starting for
> the first time. The Hard section is a genuine step up for experienced solvers.
>
> Printed on white paper in crisp black ink, with nothing running into the fold of the
> page. A quiet half hour, a pencil, and no screen in sight.
>
> [Pick this up for yourself, or as a gift for a parent or grandparent who used to do
> the crossword.]

### Pricing

126 pages at 8.5 × 11 in black-and-white costs roughly **$2.30–2.60** to print in the US.
At **$9.99** you keep about **$3.60** per copy at 60% royalty. Check KDP's own printing-cost
calculator before you commit — rates differ by marketplace and change over time. $9.99 is a
sane opening price for a 100-puzzle large-print book; don't launch above $12.99 without
reviews to justify it.

---

## The cover

`out/cover-8.5x11.pdf` is a full wrap for this exact interior: back cover, spine and
front cover on one sheet, with 0.125 in bleed on the outside edges.

| Spec | Value |
| --- | --- |
| Wrap size | 17.5338 × 11.25 in |
| Spine width | 0.2838 in (126 pages × 0.002252 in, black ink on white paper) |
| Trim | 8.5 × 11 in, 0.125 in bleed top/bottom/outside |
| Panels | back 8.5 in · spine 0.2838 in · front 8.5 in |
| Fonts | Playfair Display (400/700, OFL), DejaVu Sans/Serif — all embedded |
| Safety | no text within 0.25 in of any trim edge; barcode zone left empty |

**The spine is page count × paper thickness. It is not a fixed number.** If you add or
remove a page from the interior, the spine changes and this wrap will be wrong. Always
finish the interior first, then rebuild the cover:

```bash
../.venv/bin/python make_cover.py --out out/cover-8.5x11.pdf --pages 126
```

`--pages` must match the interior. The script prints the spine and wrap size it used —
check them against KDP's own template before uploading.

The barcode area (2.0 × 1.2 in, 0.25 in in from the trim edges, bottom-right of the
back panel) is deliberately left blank. Amazon prints the barcode there; anything you
put in that zone gets a sticker over it.

The grid on the front is puzzle 1 from page 6, read from the built JSON — so the
cover is a real sample of the book, not decoration. If the JSON is missing the cover
still builds; the grid just comes out empty.

### Before uploading the cover

- **Front reads at thumbnail size.** Check it at roughly 200 px wide — that is how it
  appears in search results. Title legibility at that size matters more than detail.
- **Spine text only if 100+ pages.** This book qualifies at 126; KDP requires it stay
  clear of the spine folds by 0.0625 in.
- **Compare against KDP's template** for 8.5 × 11, 126 pages, white paper once more
  before you hit publish. If the page count changed, rebuild.
- **Cream background is a design choice, not a limitation.** If you prefer to save ink
  or want a starker look, the colours are four constants at the top of `make_cover.py`.

---

## Where the real upside is

One book is a test, not a business. The cheap wins from this same generator:

- **Series, not one-offs.** Volume 1/2/3 with matching covers sell each other. A new seed
  is one command.
- **Adjacent formats.** Extra-large print (6 × 9 with fewer, bigger cells), 200-puzzle
  "mega" editions at a higher price, travel size.
- **The companion book.** Large-print *word search* uses almost the same page furniture
  (header rule, footer, divider pages, solution block). The hard part — a validated,
  print-correct interior pipeline — is already done.
- **Volume two onward.** Same cover, new `--volume` and `--seed`. A consistent series
  spine sells the set.
- **Typeface credit.** Playfair Display is used under the SIL Open Font License; the
  licence text ships in `fonts/`. You do not need to credit it on the cover.
