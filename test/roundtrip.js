// Round trip test: parse -> build -> parse must keep every glyph unchanged.
// Run: node test/roundtrip.js

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const G = require('../gfxfont.js')

const dir = __dirname
const fonts = fs.readdirSync(dir).filter(f => f.endsWith('.h'))

function key (g) {
  return [g.cp, g.disabled, g.w, g.h, g.adv, g.xo, g.yo, g.pixels.slice(0, g.w * g.h)].join('|')
}

function checkSame (a, b, label) {
  assert.strictEqual(a.glyphs.length, b.glyphs.length, label + ': glyph count')
  a.glyphs.forEach((g, i) => assert.strictEqual(key(b.glyphs[i]), key(g), label + ': glyph 0x' + g.cp.toString(16)))
  assert.strictEqual(b.yAdvance, a.yAdvance, label + ': yAdvance')
  assert.strictEqual(b.fontName, a.fontName, label + ': font name')
}

let failed = 0
for (const f of fonts) {
  try {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const model = G.parseFont(src)
    const built = G.buildFont(model)
    const again = G.parseFont(built.source)
    checkSame(model, again, f)
    // A second build must be byte identical (stable output)
    assert.strictEqual(G.buildFont(again).source, built.source, f + ': stable output')
    console.log('ok  ', f, model.glyphs.length + ' glyphs', built.format, built.bitmapBytes + ' B')
  } catch (e) {
    failed++
    console.log('FAIL', f, e.message)
  }
}

// Format selection
const g = (cp) => ({ cp, w: 1, h: 1, adv: 2, xo: 0, yo: -1, pixels: '10000000', disabled: false })
const base = { preamble: '', bitmapsName: 'TBitmaps', glyphsName: 'TGlyphs', fontName: 'T', yAdvance: 8 }
try {
  assert.strictEqual(G.buildFont({ ...base, glyphs: [g(0x41), g(0x42)] }).format, 'GFXfont')
  assert.strictEqual(G.buildFont({ ...base, glyphs: [g(0x41), g(0x43)] }).format, 'UTF8_32BitFont')
  assert.strictEqual(G.buildFont({ ...base, glyphs: [g(0xFF), g(0x100)] }).format, 'UTF8_32BitFont')
  const wide = G.buildFont({ ...base, glyphs: [g(0x41), g(0x1F1E6), g(0x1F1E7)] })
  const parsed = G.parseFont(wide.source)
  assert.deepStrictEqual(parsed.glyphs.map(x => x.cp), [0x41, 0x1F1E6, 0x1F1E7])
  assert.ok(/0, 0, 8,\n\s+127462, 127463/.test(wide.source), 'dFirst/dLast for code points above 0xFFFF')
  assert.ok(wide.source.startsWith('#include <utf832bitfont.h>'), 'include added for segmented font')
  // Range filter
  assert.strictEqual(G.parseFont(G.buildFont({ ...base, glyphs: [g(0x41), g(0x42), g(0x43)] }, { first: 0x42, last: 0x43 }).source).glyphs.length, 2)
  console.log('ok   format selection')
} catch (e) {
  failed++
  console.log('FAIL format selection', e.message)
}

process.exit(failed ? 1 : 0)
