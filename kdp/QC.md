# Quality check — large-print Sudoku, volume one

Run `python qc.py` to reproduce everything below. It exits non-zero on any failure.

Last run: **0 failures, 0 warnings** against `out/large-print-sudoku-for-seniors_interior_8.5x11.pdf`
(126 pages) and `out/cover-8.5x11.pdf`.

---

## What is checked, and how

| Area | Check | Method |
| --- | --- | --- |
| Structure | Page count even | 126 |
| | Puzzles numbered 1–100, once each, in order | header text scan |
| | Printed page number = physical page | footer vs index, pages 3–125 |
| | Dividers on 5, 46, 82, 108 | text of page's first line |
| | Difficulty label matches the solver's verdict | label vs JSON + technique depth |
| | Front matter's "page 109" references are true | page 109 opens the solutions |
| Source data | Every puzzle has exactly one solution | solver enumerates ≤2 |
| | No duplicate grids | hash of the 81 cells |
| | Solutions are valid completed grids | all 27 units contain 1–9 |
| | Givens agree with their solution | cell comparison |
| Print fidelity | Printed puzzle digits = source grid | digits read back out of the PDF and mapped to cells by coordinate |
| | Printed solutions = source, 81 digits each | same, per mini-grid |
| | Solution page headers show the right range | e.g. "97–100" |
| Typography | Only embedded font subsets | font inventory |
| | No straight quotes or apostrophes | text scan |
| | No double spaces, trailing spaces, `...` | text scan |
| Geometry | Every page 612 × 792 pt | page box |
| | All ink inside a 0.5 in margin | min distance of any glyph to each edge |
| Claim | "Solvable by logic alone" for all 100 | technique solver: singles → locked candidates → pairs → X-wing |
| Cover | Wrap size matches the interior's page count | 126 × 0.002252 in spine |
| | No text within 0.25 in of a trim edge | glyph boxes vs safe area |
| | Barcode zone (2.0 × 1.2 in, bottom-right of back) empty | glyph boxes vs zone |
| | Spine text clear of the folds | ≥ 0.0625 in |

The technique solver is the important one. It plays the puzzle the way a person does —
naked singles, hidden singles, locked candidates, naked and hidden pairs, X-wing — and
refuses to guess. A puzzle it cannot finish is rejected at generation time, so the claim
in the book is a verified property, not a slogan.

Current grading: Easy 40 (naked/hidden singles), Medium 35 (hidden singles required),
Hard 25 (locked candidates or pairs required, one needs X-wing).

---

## Defects this check has caught

Recorded because they are the reason to run it again.

**Factual claims**

1. *"Printed in the United States of America"* on the copyright page — false for
   print-on-demand, which prints per marketplace. Removed.
2. *"digits over half an inch tall"* — measured ink height is **0.32 in**. Corrected to
   "about a third of an inch" in the book and in the blurb.
3. README margins stated 0.94 in top / 0.92 in bottom; measured **1.09 / 0.71**.
4. *"rebuilds are byte-stable"* — false. Rebuilds are content-identical but the PDF
   carries a creation timestamp, so the files differ.

**Difficulty integrity**

5. Five Hard puzzles could not be finished by the technique ladder, while the book said
   every puzzle is solvable by logic alone.
6. Several Hard puzzles fell to naked singles — labelled hard, played easy. Difficulty
   is now graded by measured technique depth rather than clue count alone.

**Typography and wording**

7. Straight apostrophe in "arm's length" where a typographic `’` belongs.
8. "yours to fill in — in pencil" — two prepositions colliding.
9. "one puzzle to a page" (interior) vs "per page" (cover) — now "per page" throughout.
10. "For personal use." on the copyright page — filler sitting awkwardly against the
    rights notice. Removed.
11. "0.25 in in from the trim edges" — doubled word in the README.

**Cover**

12. Spine author line sat **0.14 in** from the bottom trim edge — inside the cutter's
    tolerance. It was centred on a point rather than anchored upward.
13. Barcode zone had to be checked against text; the first version of the check used
    mixed top-down/bottom-up coordinates and produced false results in both directions.

---

## What this check cannot tell you

- Whether the digits *feel* right in the hand. Order a proof copy.
- How the cream cover stock prints. Colour is screen-decided, not press-decided.
- Whether KDP accepts the files. Their preflight runs against their own template, which
  changes as their paper stock changes. Re-download the template and compare.
- Whether the puzzles are enjoyable. The solver proves they are fair; only a person can
  say they are fun.
