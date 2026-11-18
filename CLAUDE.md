# CLAUDE.md

Fork of [tchapi/Adafruit-GFX-Font-Customiser](https://github.com/tchapi/Adafruit-GFX-Font-Customiser) (MIT,
remote `upstream`), a web editor for Adafruit_GFX bitmap fonts. The fork adds support for the **segmented UTF-8
fonts** used by [bcp-clock](https://github.com/honzaskypala/bcp-clock) (Ulanzi TC001/TC002 clock firmware), so
fonts can be drawn pixel by pixel instead of by hand. Remote `origin` = `honzaskypala/Adafruit-GFX-Font-Customiser`,
branch `master`, published on GitHub Pages from `master` / root: <https://honzaskypala.github.io/Adafruit-GFX-Font-Customiser/>
(every push to `master` redeploys it).

## General

- The local developer setup is in `CLAUDE.local.md` (gitignored) when it exists.
- Keep the upstream style: UI in `index.html`, 2-space indent, jQuery 3.7.1 + Semantic UI 2.4.2 from CDN,
  no build step. Keep `LICENSE` and the upstream credits in `README.md`.
- `gfxfont.js`: DOM-free font model, parser and generator (`GfxFont.parseFont`, `GfxFont.buildFont`,
  `segmentsOf`); loaded by `index.html` and by the Node test. Font logic goes here, UI stays in `index.html`.
- Run locally: open `index.html` directly (`file://` works, the page fetches nothing itself). Browser tests that
  `fetch('/test/…')` fonts need `python3 -m http.server 8000` in the repo root.
- Test: `node test/roundtrip.js` (round trip of every `test/*.h` + format selection).
- `docs/images/*.png`: README screenshots of `test/f3x5.h` (device scale 2, headless Chrome; glyphs at 1600 px
  page width = 8 glyphs per row, export panel at 1280 px).
- Test fonts: `test/*.h`: upstream fontconvert output, plus bcp-clock's `f3x5.h` (segmented, packed; its second
  font `F3x5_Fixed` removed) and `f4x6.h` (plain `GFXfont`) as references for the new formats.

## Architecture of `index.html`

- State lives in the DOM: each glyph is a `.table.glyph` with `data-cp` (code point), `data-char`, `data-pixels`
  (string of `0`/`1`), `data-w`, `data-h`, `data-adv`, `data-ow`, `data-oh`, `data-dis`, inside a wrapper `div`
  in `#glyphs`, sorted by code point. Font-level values: `window.font` (`preamble`, `bitmapsName`, `glyphsName`,
  `fontName`, `yAdvance`), display globals `maxH`, `maxBaseline`, `glyph_table_width`.
- Segments are not stored: a segment is a run of consecutive code points. `renderSegmentHeaders()` inserts an
  `h3.segment-header` before each run; call it after adding glyphs.
- `extractFont()` → `GfxFont.parseFont`; `#export` collects the DOM glyphs → `GfxFont.buildFont`.
- `#add` inserts the glyph at its place (`insertGlyphItem`); with "Fill the gap" it fills the gap to the nearest
  glyph with disabled glyphs (max `MAX_FILLED_GAP` = 256), otherwise the glyph starts or joins a segment.
- Characters use `codePointAt`/`charFromCodePoint` (full Unicode).
- Upstream behaviour changed by the fork: the font struct is regenerated (text after it, e.g. fontconvert's
  `// Approx. N bytes`, is dropped); only one font per file is imported (others reported as a warning).

## Target formats

- **Plain `GFXfont`** (vanilla Adafruit_GFX): one contiguous range within 0x00–0xFF (`write()` takes single bytes).
  Exported when the font fits; no segments, no UTF-8.
- **Segmented `UTF8_32BitFont[]`** (bcp-clock `lib/gfx/utf832bitfont.h`):
  `struct UTF8_32BitFont { GFXfont gfxFont; uint32_t dFirst; uint32_t dLast; };`
  - One `<name>Bitmaps[]` and one `<name>Glyphs[]`; each segment is
    `{ (uint8_t *) <name>Bitmaps, (GFXglyph *) &<name>Glyphs[idx], first, last, yAdvance, dFirst, dLast }`.
  - Code points > 0xFFFF: `first = last = 0`, range in `dFirst/dLast`; otherwise `dFirst = dLast = 0`.
  - The array ends with an all-null entry `{nullptr, nullptr, 0, 0, 0, 0, 0}`; bcp-clock walks segments until
    `glyph == nullptr` (`lib/gfx/fontsegment.h`, `findFontSegment`).
  - bcp-clock style: bitmap bytes as `0b…` literals, one comment with the character per glyph.
- **Packed bitmaps**: glyph offsets may be non-monotonic and overlap (shared bytes); a glyph's bitmap is
  `ceil(w*h/8)` bytes from its offset. bcp-clock's F3x5 packs 1147 B into 637 B.

## Roadmap

Phase 1 (done)
1. Parser: replace regex+`eval` with a tokenizer for the C subset (dec/hex/`0b` numbers, comments, casts, `&X[n]`,
   `nullptr`, `GFXfont` and `UTF8_32BitFont[]`) producing an explicit model
   `{ name, segments: [{ first, last, glyphs: [{ cp, w, h, adv, xo, yo, pixels, disabled }] }] }`.
   Plain fontconvert files load as one segment.
2. Read each glyph bitmap as `ceil(w*h/8)` bytes from its offset.
3. Code points everywhere: `codePointAt`/`String.fromCodePoint`.
4. UI: glyphs grouped by segment with a header; adding a glyph joins an adjacent segment or creates a new one
   (no 900 disabled filler glyphs); segments kept sorted.
5. Export picks the format automatically (plain `GFXfont` if it fits, else segmented).

Phase 2 (done; `packBitmaps` in `gfxfont.js`, F3x5: 1123 B → 607 B)
6. Checkbox "Pack bitmaps (overlap)" in the export panel: dedupe identical bitmaps, then greedy byte-level
   overlap, for both formats. JavaScript port of the author's earlier Python generator (bcp-clock history,
   `git show e7963fa^:lib/gfx/f3x5.py`: `find_widest`, `find_widest_already_in_bitmap`, `find_starting_with`,
   `find_ending_with`).

Out of scope: several fonts sharing one bitmap array (bcp-clock's `F3x5_Fixed` reuses `F3x5Bitmaps`); such a
font must get its own bitmap array before its file is re-exported.

## Verification

- Round trip `node test/roundtrip.js`: parse → export → parse for every `test/*.h`; per code point
  `w,h,adv,xo,yo` and pixels must match and a second export must be identical; the same with packing on,
  packed never larger than sequential, packed F3x5 ≤ 637 B (the old Python generator's result).
- Browser: load a font, edit a glyph, add a glyph inside and outside existing segments, export.
- In bcp-clock: drop in the exported font, build and run its device test `test_gfx` (see its CLAUDE.md).
