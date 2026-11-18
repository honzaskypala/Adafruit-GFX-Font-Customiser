# CLAUDE.md

Fork of [tchapi/Adafruit-GFX-Font-Customiser](https://github.com/tchapi/Adafruit-GFX-Font-Customiser) (MIT,
remote `upstream`), a web editor for Adafruit_GFX bitmap fonts. The fork adds support for the **segmented UTF-8
fonts** used by [bcp-clock](https://github.com/honzaskypala/bcp-clock) (Ulanzi TC001/TC002 clock firmware), so
fonts can be drawn pixel by pixel instead of by hand. Remote `origin` = `honzaskypala/Adafruit-GFX-Font-Customiser`,
branch `master`, published on GitHub Pages.

## General

- The local developer setup is in `CLAUDE.local.md` (gitignored) when it exists.
- Keep the upstream style: the whole app is `index.html`, 2-space indent, jQuery 3.7.1 + Semantic UI 2.4.2 from CDN,
  no build step. Keep `LICENSE` and the upstream credits in `README.md`.
- Run locally: `python3 -m http.server` in the repo root, open `http://localhost:8000/`.
- Test fonts: `test/*.h` (upstream, fontconvert output). bcp-clock's `lib/gfx/f3x5.h` (segmented, packed) and
  `lib/gfx/f4x6.h` (plain `GFXfont`) are the reference fonts for the new formats.

## Architecture of `index.html` (upstream)

- State lives in the DOM: each glyph is a `.table.glyph` with `data-char`, `data-pixels` (string of `0`/`1`),
  `data-w`, `data-h`, `data-adv`, `data-ow`, `data-oh`, `data-dis`; font-level values are globals on `window`
  (`name`, `first`, `last`, `font_def`, `font_preamble`, `maxH`, `maxBaseline`).
- `extractFont()` imports: regexes find `const uint8_t <name>Bitmaps[]` and `const GFXfont…`, the rest is turned
  into JS (`{}`→`[]`) and `eval`ed. Glyph bitmap length = next glyph offset − own offset.
- `#add` extends `first`/`last` and fills the gap with disabled glyphs; `#export` writes sequential hex bitmaps,
  the glyph table and the old `GFXfont` text with `first`/`last` patched.
- Characters use `String.fromCharCode`/`charCodeAt` (BMP only).

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

Phase 1
1. Parser: replace regex+`eval` with a tokenizer for the C subset (dec/hex/`0b` numbers, comments, casts, `&X[n]`,
   `nullptr`, `GFXfont` and `UTF8_32BitFont[]`) producing an explicit model
   `{ name, segments: [{ first, last, glyphs: [{ cp, w, h, adv, xo, yo, pixels, disabled }] }] }`.
   Plain fontconvert files load as one segment.
2. Read each glyph bitmap as `ceil(w*h/8)` bytes from its offset.
3. Code points everywhere: `codePointAt`/`String.fromCodePoint`.
4. UI: glyphs grouped by segment with a header; adding a glyph joins an adjacent segment or creates a new one
   (no 900 disabled filler glyphs); delete empty segments; segments kept sorted.
5. Export picks the format automatically (plain `GFXfont` if it fits, else segmented).

Phase 2
6. Checkbox "Pack bitmaps (overlap)" in the export panel: dedupe identical bitmaps, then greedy byte-level
   overlap, for both formats. JavaScript port of the author's earlier Python generator (bcp-clock history,
   `git show e7963fa^:lib/gfx/f3x5.py`: `find_widest`, `find_widest_already_in_bitmap`, `find_starting_with`,
   `find_ending_with`).

Out of scope: several fonts sharing one bitmap array (bcp-clock's `F3x5_Fixed` reuses `F3x5Bitmaps`); such a
font must get its own bitmap array before its file is re-exported.

## Verification

- Round trip (Node, to be added as `test/roundtrip.js`): parse → export → parse for `test/*.h` and the bcp-clock
  fonts; per code point `w,h,adv,xo,yo` and pixels must match, with packing on and off. Packed F3x5 ≤ 637 B.
- Browser: load a font, edit a glyph, add a glyph inside and outside existing segments, export.
- In bcp-clock: drop in the exported font, build and run its device test `test_gfx` (see its CLAUDE.md).
