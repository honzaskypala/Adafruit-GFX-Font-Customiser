// Parsing and generation of Adafruit GFX font sources: plain GFXfont and segmented UTF8_32BitFont[]
// Used by index.html in the browser and by test/roundtrip.js in Node.

(function (root) {
  'use strict'

  // ---- Tokenizer for the C subset used by font headers ----

  function tokenize (src) {
    const tokens = []
    let i = 0
    while (i < src.length) {
      const c = src[i]
      if (/\s/.test(c)) { i++; continue }
      if (src.startsWith('//', i)) { i = src.indexOf('\n', i); if (i < 0) break; continue }
      if (src.startsWith('/*', i)) { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue }
      if (c === '#') { i = src.indexOf('\n', i); if (i < 0) break; continue } // preprocessor line
      let m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)[uUlL]*/.exec(src.slice(i, i + 80))
      if (m) {
        const text = m[1]
        let value
        if (/^0[bB]/.test(text)) value = parseInt(text.slice(2), 2)
        else if (/^0[xX]/.test(text)) value = parseInt(text.slice(2), 16)
        else value = parseInt(text, 10)
        tokens.push({ t: 'num', v: value })
        i += m[0].length
        continue
      }
      m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256))
      if (m) { tokens.push({ t: 'id', v: m[0] }); i += m[0].length; continue }
      if (c === '\'') { // character literal
        m = /^'(\\x[0-9a-fA-F]+|\\.|[^\\'])'/.exec(src.slice(i, i + 16))
        if (m) {
          const body = m[1]
          let value = body.codePointAt(0)
          if (body.startsWith('\\x')) value = parseInt(body.slice(2), 16)
          else if (body.startsWith('\\')) value = { n: 10, t: 9, r: 13, '0': 0 }[body[1]] ?? body.codePointAt(1)
          tokens.push({ t: 'num', v: value })
          i += m[0].length
          continue
        }
      }
      if (c === '"') { // string literal, skipped
        let j = i + 1
        while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
        tokens.push({ t: 'str' })
        i = j + 1
        continue
      }
      tokens.push({ t: 'p', v: c })
      i++
    }
    return tokens
  }

  // ---- Initializer parser: nested { } lists of numbers, references and nullptr ----

  function parseInitializer (tokens, pos) {
    const tok = tokens[pos]
    if (tok && tok.t === 'p' && tok.v === '{') {
      const list = []
      pos++
      while (pos < tokens.length) {
        const cur = tokens[pos]
        if (cur.t === 'p' && cur.v === '}') return { value: list, pos: pos + 1 }
        if (cur.t === 'p' && cur.v === ',') { pos++; continue }
        const r = parseInitializer(tokens, pos)
        list.push(r.value)
        pos = r.pos
      }
      throw new Error('Unterminated { in initializer')
    }
    return parseExpression(tokens, pos)
  }

  // Expression up to the next ',' or '}' at depth 0: number, -number, nullptr/NULL, X, &X[n], X + n, with casts
  function parseExpression (tokens, pos) {
    const expr = []
    let depth = 0
    while (pos < tokens.length) {
      const tok = tokens[pos]
      if (depth === 0 && tok.t === 'p' && (tok.v === ',' || tok.v === '}' || tok.v === ';')) break
      if (tok.t === 'p' && (tok.v === '(' || tok.v === '[')) depth++
      if (tok.t === 'p' && (tok.v === ')' || tok.v === ']')) depth--
      expr.push(tok)
      pos++
    }
    return { value: evaluate(expr), pos }
  }

  function evaluate (expr) {
    // Drop casts like (uint8_t *) or (const GFXglyph *)
    const toks = []
    for (let i = 0; i < expr.length; i++) {
      if (expr[i].t === 'p' && expr[i].v === '(') {
        let j = i + 1
        while (j < expr.length && (expr[j].t === 'id' || (expr[j].t === 'p' && expr[j].v === '*'))) j++
        if (j < expr.length && expr[j].t === 'p' && expr[j].v === ')' && j > i + 1) { i = j; continue }
      }
      toks.push(expr[i])
    }
    if (toks.length === 1 && toks[0].t === 'num') return toks[0].v
    if (toks.length === 2 && toks[0].t === 'p' && toks[0].v === '-' && toks[1].t === 'num') return -toks[1].v
    if (toks.length === 1 && toks[0].t === 'id') {
      if (toks[0].v === 'nullptr' || toks[0].v === 'NULL') return null
      return { ref: toks[0].v, index: 0 }
    }
    // &X[n]
    if (toks.length === 5 && toks[0].v === '&' && toks[1].t === 'id' && toks[2].v === '[' && toks[3].t === 'num' && toks[4].v === ']') {
      return { ref: toks[1].v, index: toks[3].v }
    }
    // X + n
    if (toks.length === 3 && toks[0].t === 'id' && toks[1].v === '+' && toks[2].t === 'num') {
      return { ref: toks[0].v, index: toks[2].v }
    }
    if (toks.length === 0) return 0
    throw new Error('Unsupported expression: ' + toks.map(t => t.v).join(' '))
  }

  // ---- Declarations ----

  const DECL_RE = /\bconst\s+(uint8_t|GFXglyph|GFXfont|UTF8_32BitFont)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\[\s*\d*\s*\])?\s*(PROGMEM)?\s*=/g

  function parseDeclarations (src) {
    const decls = []
    let m
    DECL_RE.lastIndex = 0
    while ((m = DECL_RE.exec(src)) !== null) {
      const start = m.index
      const tokens = tokenize(src.slice(m.index + m[0].length))
      const r = parseInitializer(tokens, 0)
      decls.push({ type: m[1], name: m[2], isArray: !!m[3], value: r.value, start })
    }
    return decls
  }

  // ---- Font model ----
  // { preamble, bitmapsName, glyphsName, fontName, yAdvance,
  //   glyphs: [{ cp, w, h, adv, xo, yo, pixels, disabled }] }   (pixels: string of '0'/'1', w*h used)

  function bitsOf (bytes, offset, count) {
    let bits = ''
    const nBytes = Math.ceil(count / 8)
    for (let k = 0; k < nBytes; k++) {
      const b = bytes[offset + k]
      if (b === undefined) throw new Error('Bitmap offset ' + (offset + k) + ' out of range')
      bits += ('00000000' + b.toString(2)).slice(-8)
    }
    return bits
  }

  function glyphFromEntry (entry, cp, bitmaps, bitmapBase) {
    const [offset, w, h, adv, xo, yo] = entry
    const disabled = (w === 0 || h === 0) && adv === 0
    const pixels = disabled ? '' : bitsOf(bitmaps, bitmapBase + offset, w * h)
    return { cp, w, h, adv, xo, yo, pixels, disabled }
  }

  // Parses a .h font source; throws Error with a readable message on failure
  function parseFont (src) {
    const decls = parseDeclarations(src)
    if (decls.length === 0) throw new Error('No font declarations found (const uint8_t / GFXglyph / GFXfont / UTF8_32BitFont).')
    const byName = {}
    decls.forEach(d => { byName[d.name] = d })
    const warnings = []

    const utf8Fonts = decls.filter(d => d.type === 'UTF8_32BitFont')
    const gfxFonts = decls.filter(d => d.type === 'GFXfont' && !d.isArray)
    const font = utf8Fonts[0] || gfxFonts[0]
    if (!font) throw new Error('No GFXfont or UTF8_32BitFont declaration found.')
    decls.filter(d => (d.type === 'GFXfont' || d.type === 'UTF8_32BitFont') && d !== font)
      .forEach(d => warnings.push('Only font "' + font.name + '" is edited; font "' + d.name + '" is ignored and will not be exported.'))

    // Segments as { bitmapRef, glyphRef, first, last, yAdvance }
    let segments
    if (font.type === 'UTF8_32BitFont') {
      segments = []
      for (const e of font.value) {
        if (!Array.isArray(e)) throw new Error('Unexpected entry in ' + font.name)
        const flat = e.length === 3 && Array.isArray(e[0]) ? e[0].concat(e.slice(1)) : e // {{gfx}, dFirst, dLast}
        const [bitmapRef, glyphRef, first, last, yAdvance, dFirst = 0, dLast = 0] = flat
        if (glyphRef === null || glyphRef === 0) break // terminator
        segments.push({ bitmapRef, glyphRef, first: dFirst || first, last: dLast || last, yAdvance })
      }
    } else {
      const [bitmapRef, glyphRef, first, last, yAdvance] = font.value
      segments = [{ bitmapRef, glyphRef, first, last, yAdvance }]
    }
    if (segments.length === 0) throw new Error('Font "' + font.name + '" has no segments.')

    const glyphs = []
    const seen = new Set()
    let bitmapsName = null
    let glyphsName = null
    for (const seg of segments) {
      const bitmapDecl = seg.bitmapRef && byName[seg.bitmapRef.ref]
      const glyphDecl = seg.glyphRef && byName[seg.glyphRef.ref]
      if (!bitmapDecl || bitmapDecl.type !== 'uint8_t') throw new Error('Bitmap array of font "' + font.name + '" not found.')
      if (!glyphDecl || glyphDecl.type !== 'GFXglyph') throw new Error('Glyph array of font "' + font.name + '" not found.')
      bitmapsName = bitmapsName || bitmapDecl.name
      glyphsName = glyphsName || glyphDecl.name
      if (seg.last < seg.first) throw new Error('Segment 0x' + seg.first.toString(16) + '–0x' + seg.last.toString(16) + ' has last < first.')
      for (let cp = seg.first; cp <= seg.last; cp++) {
        const entry = glyphDecl.value[seg.glyphRef.index + cp - seg.first]
        if (!entry) throw new Error('Glyph for 0x' + cp.toString(16).toUpperCase() + ' missing in ' + glyphDecl.name + '.')
        if (seen.has(cp)) { warnings.push('Duplicate glyph 0x' + cp.toString(16).toUpperCase() + ' ignored.'); continue }
        seen.add(cp)
        glyphs.push(glyphFromEntry(entry, cp, bitmapDecl.value, seg.bitmapRef.index))
      }
    }
    glyphs.sort((a, b) => a.cp - b.cp)

    const yAdvance = segments[0].yAdvance
    if (segments.some(s => s.yAdvance !== yAdvance)) warnings.push('Segments have different yAdvance; ' + yAdvance + ' is used for all.')

    const preamble = src.slice(0, Math.min(...decls.map(d => d.start)))
    return { preamble, bitmapsName, glyphsName, fontName: font.name, yAdvance, glyphs, warnings }
  }

  // ---- Generation ----

  // Runs of consecutive code points: [{ first, last, start }] (start = index into glyphs)
  function segmentsOf (glyphs) {
    const runs = []
    glyphs.forEach((g, i) => {
      const run = runs[runs.length - 1]
      if (run && g.cp === run.last + 1) run.last = g.cp
      else runs.push({ first: g.cp, last: g.cp, start: i })
    })
    return runs
  }

  // A plain GFXfont is possible when the font is one contiguous range within 0x00–0xFF
  function isPlainFont (glyphs) {
    const runs = segmentsOf(glyphs)
    return runs.length === 1 && runs[0].last <= 0xFF
  }

  function hex (n, digits) {
    return '0x' + n.toString(16).toUpperCase().padStart(digits || 2, '0')
  }

  function charComment (cp) {
    let display
    if (cp < 0x20 || (cp >= 0x7F && cp <= 0xA0) || cp === 0xAD) display = cp <= 0xFF ? '\\x' + cp.toString(16) : '\\u' + cp.toString(16)
    else if (cp === 0x27) display = '"\'"'
    else if (cp === 0x5C) display = '\'\\\\\''
    else display = '\'' + String.fromCodePoint(cp) + '\''
    if (display.startsWith('\\')) display = '\'' + display + '\''
    return '// ' + hex(cp) + ' ' + display
  }

  // Sequential bitmaps; returns { bytes, offsets } (offset per glyph, 0 for disabled)
  function layoutBitmaps (glyphs) {
    const bytes = []
    const offsets = glyphs.map(g => {
      if (g.disabled) return 0
      const offset = bytes.length
      const n = g.w * g.h
      const bits = (g.pixels.slice(0, n) + '0'.repeat(8)).slice(0, Math.ceil(n / 8) * 8)
      for (let k = 0; k < bits.length; k += 8) bytes.push(parseInt(bits.slice(k, k + 8), 2))
      return offset
    })
    return { bytes, offsets }
  }

  function glyphRow (g, offset, pad) {
    const vals = g.disabled ? [0, 0, 0, 0, 0, 0] : [offset, g.w, g.h, g.adv, g.xo, g.yo]
    const widths = [5, 3, 3, 3, 4, 4]
    return pad + '{ ' + vals.map((v, i) => String(v).padStart(widths[i])).join(', ') + ' }'
  }

  function plainSource (font, glyphs, layout) {
    let out = 'const uint8_t ' + font.bitmapsName + '[] PROGMEM = {\n'
    for (let k = 0; k < layout.bytes.length; k += 12) {
      const line = layout.bytes.slice(k, k + 12).map(b => hex(b)).join(', ')
      out += '  ' + line + (k + 12 < layout.bytes.length ? ',' : '') + '\n'
    }
    out += '};\n\n'
    out += 'const GFXglyph ' + font.glyphsName + '[] PROGMEM = {\n'
    out += glyphs.map((g, i) => glyphRow(g, layout.offsets[i], '  ') + (i < glyphs.length - 1 ? ',' : ' ') + '   ' + charComment(g.cp)).join('\n')
    out += '\n};\n\n'
    out += 'const GFXfont ' + font.fontName + ' PROGMEM = {\n'
    out += '  (uint8_t  *)' + font.bitmapsName + ',\n'
    out += '  (GFXglyph *)' + font.glyphsName + ',\n'
    out += '  ' + hex(glyphs[0].cp) + ', ' + hex(glyphs[glyphs.length - 1].cp) + ', ' + font.yAdvance + ' };\n'
    return out
  }

  function segmentedSource (font, glyphs, layout) {
    let out = 'const uint8_t ' + font.bitmapsName + '[] PROGMEM = {\n'
    for (let k = 0; k < layout.bytes.length; k += 8) {
      const chunk = layout.bytes.slice(k, k + 8)
      const line = chunk.map(b => '0b' + b.toString(2).padStart(8, '0')).join(', ')
      out += '    ' + line + ',   // ' + k + ' to ' + (k + chunk.length - 1) + '\n'
    }
    out += '};\n\n'
    out += 'const GFXglyph ' + font.glyphsName + '[] PROGMEM = {\n'
    out += glyphs.map((g, i) => glyphRow(g, layout.offsets[i], '    ') + ',   ' + charComment(g.cp)).join('\n')
    out += '\n};\n\n'
    out += 'const UTF8_32BitFont ' + font.fontName + '[] PROGMEM = {\n'
    for (const run of segmentsOf(glyphs)) {
      const wide = run.last > 0xFFFF
      out += '    {\n'
      out += '        (uint8_t  *) ' + font.bitmapsName + ',\n'
      out += '        (GFXglyph *) &' + font.glyphsName + '[' + run.start + '],\n'
      out += '        ' + (wide ? '0, 0' : run.first + ', ' + run.last) + ', ' + font.yAdvance + ',\n'
      out += '        ' + (wide ? run.first + ', ' + run.last : '0, 0') + '\n'
      out += '    },\n'
    }
    out += '    {nullptr, nullptr, 0, 0, 0, 0, 0}\n'
    out += '};\n'
    return out
  }

  // Generates the .h source; glyphs outside [first, last] are left out. Returns { source, format }.
  function buildFont (font, range) {
    let glyphs = font.glyphs.slice().sort((a, b) => a.cp - b.cp)
    if (range) glyphs = glyphs.filter(g => g.cp >= range.first && g.cp <= range.last)
    if (glyphs.length === 0) throw new Error('No glyphs to export.')
    const layout = layoutBitmaps(glyphs)
    const plain = isPlainFont(glyphs)
    let preamble = font.preamble || ''
    if (!plain && !/utf832bitfont\.h/.test(preamble)) {
      preamble += (preamble === '' || preamble.endsWith('\n') ? '' : '\n') + '#include <utf832bitfont.h>\n\n'
    }
    const body = plain ? plainSource(font, glyphs, layout) : segmentedSource(font, glyphs, layout)
    return { source: preamble + body, format: plain ? 'GFXfont' : 'UTF8_32BitFont', bitmapBytes: layout.bytes.length }
  }

  const api = { tokenize, parseDeclarations, parseFont, buildFont, segmentsOf, isPlainFont, charComment }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.GfxFont = api
})(this)
