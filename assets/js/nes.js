/* ==================================================================
   nes.js — the "PPU".

   Everything the game draws goes through here, and this file is where
   the NES restrictions actually live:

     * 256 x 240 pixel framebuffer, integer-scaled to the window.
     * Colours may only come from the 64-entry NES system palette
       (54 of which are distinct). No blending, no gradients, no alpha.
     * A sprite or background tile carries 4 colours: one transparent
       plus three from a palette entry. That is why every art string in
       chr.js only ever uses the characters . 1 2 3.
     * Sprites are drawn at integer positions. No sub-pixel movement.
     * Optional 8-sprites-per-scanline evaluation, complete with the
       flicker the real hardware produced when you broke it.
   ================================================================== */

const NES = (function () {

  'use strict';

  const W = 256, H = 240;

  /* ---- the system palette ($00-$3F) ------------------------------ */
  const RGB = [
    [124,124,124],[  0,  0,252],[  0,  0,188],[ 68, 40,188],
    [148,  0,132],[168,  0, 32],[168, 16,  0],[136, 20,  0],
    [ 80, 48,  0],[  0,120,  0],[  0,104,  0],[  0, 88,  0],
    [  0, 64, 88],[  0,  0,  0],[  0,  0,  0],[  0,  0,  0],

    [188,188,188],[  0,120,248],[  0, 88,248],[104, 68,252],
    [216,  0,204],[228,  0, 88],[248, 56,  0],[228, 92, 16],
    [172,124,  0],[  0,184,  0],[  0,168,  0],[  0,168, 68],
    [  0,136,136],[  0,  0,  0],[  0,  0,  0],[  0,  0,  0],

    [248,248,248],[ 60,188,252],[104,136,252],[152,120,248],
    [248,120,248],[248, 88,152],[248,120, 88],[252,160, 68],
    [248,184,  0],[184,248, 24],[ 88,216, 84],[ 88,248,152],
    [  0,232,216],[120,120,120],[  0,  0,  0],[  0,  0,  0],

    [252,252,252],[164,228,252],[184,184,248],[216,184,248],
    [248,184,248],[248,164,192],[240,208,176],[252,224,168],
    [248,216,120],[216,248,120],[184,248,184],[184,248,216],
    [  0,252,252],[248,216,248],[  0,  0,  0],[  0,  0,  0]
  ];

  const HEX = RGB.map(c =>
    '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''));

  function hex(i) { return HEX[i & 0x3F]; }

  /* ---- palettes -------------------------------------------------- */
  /* A palette is 4 entries; entry 0 is always transparent for sprites
     and the backdrop colour for background tiles.                    */
  let palSeq = 0;
  function Pal(list) {
    const p = list.slice(0, 4);
    p.key = 'p' + (palSeq++) + ':' + list.join(',');
    return p;
  }

  /* ---- sprite baking --------------------------------------------- */
  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return c;
  }

  function bake(rows, pal, flipX, flipY) {
    const h = rows.length, w = rows[0].length;
    const c = newCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const row = rows[flipY ? (h - 1 - y) : y];
      for (let x = 0; x < w; x++) {
        const ch = row.charCodeAt(flipX ? (w - 1 - x) : x);
        const v = (ch >= 49 && ch <= 51) ? ch - 48 : 0;   // '1'..'3'
        const o = (y * w + x) << 2;
        const p = pal[v];
        if (v === 0 || p === undefined || p === null || p < 0) { d[o + 3] = 0; continue; }
        const col = RGB[p & 0x3F];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* A Spr is a piece of "CHR" art plus a cache of baked palette
     variants, so re-colouring a tile costs nothing at runtime — the
     same trick the hardware used with attribute tables.              */
  class Spr {
    constructor(rows) {
      // Defensive: keep every row exactly as wide as the first one so a
      // stray character in the art can never corrupt the framebuffer.
      const w = rows[0].length;
      this.rows = rows.map(r => r.length === w ? r
        : (r.length > w ? r.slice(0, w) : r + '.'.repeat(w - r.length)));
      this.w = w;
      this.h = rows.length;
      this._c = Object.create(null);
    }
    img(pal, flipX, flipY) {
      const k = pal.key + (flipX ? 'X' : '') + (flipY ? 'Y' : '');
      let c = this._c[k];
      if (!c) { c = bake(this.rows, pal, flipX, flipY); this._c[k] = c; }
      return c;
    }
    /* Grow a sprite vertically by repeating one row. Used to derive
       "big Kiko" from the small frames so both forms stay on-model. */
    stretch(rowIndex, count) {
      const r = this.rows.slice();
      const dup = new Array(count).fill(r[rowIndex]);
      r.splice(rowIndex + 1, 0, ...dup);
      return new Spr(r);
    }
  }

  const S = rows => new Spr(rows);

  /* ---- 5x7 bitmap font in an 8x8 cell ---------------------------- */
  const FONT_SRC = {
    'A': ['.111.', '1...1', '1...1', '11111', '1...1', '1...1', '1...1'],
    'B': ['1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.'],
    'C': ['.1111', '1....', '1....', '1....', '1....', '1....', '.1111'],
    'D': ['1111.', '1...1', '1...1', '1...1', '1...1', '1...1', '1111.'],
    'E': ['11111', '1....', '1....', '1111.', '1....', '1....', '11111'],
    'F': ['11111', '1....', '1....', '1111.', '1....', '1....', '1....'],
    'G': ['.1111', '1....', '1....', '1..11', '1...1', '1...1', '.1111'],
    'H': ['1...1', '1...1', '1...1', '11111', '1...1', '1...1', '1...1'],
    'I': ['.111.', '..1..', '..1..', '..1..', '..1..', '..1..', '.111.'],
    'J': ['....1', '....1', '....1', '....1', '1...1', '1...1', '.111.'],
    'K': ['1...1', '1..1.', '1.1..', '11...', '1.1..', '1..1.', '1...1'],
    'L': ['1....', '1....', '1....', '1....', '1....', '1....', '11111'],
    'M': ['1...1', '11.11', '1.1.1', '1...1', '1...1', '1...1', '1...1'],
    'N': ['1...1', '11..1', '1.1.1', '1..11', '1...1', '1...1', '1...1'],
    'O': ['.111.', '1...1', '1...1', '1...1', '1...1', '1...1', '.111.'],
    'P': ['1111.', '1...1', '1...1', '1111.', '1....', '1....', '1....'],
    'Q': ['.111.', '1...1', '1...1', '1...1', '1.1.1', '1..1.', '.11.1'],
    'R': ['1111.', '1...1', '1...1', '1111.', '1.1..', '1..1.', '1...1'],
    'S': ['.1111', '1....', '1....', '.111.', '....1', '....1', '1111.'],
    'T': ['11111', '..1..', '..1..', '..1..', '..1..', '..1..', '..1..'],
    'U': ['1...1', '1...1', '1...1', '1...1', '1...1', '1...1', '.111.'],
    'V': ['1...1', '1...1', '1...1', '1...1', '1...1', '.1.1.', '..1..'],
    'W': ['1...1', '1...1', '1...1', '1.1.1', '1.1.1', '11.11', '1...1'],
    'X': ['1...1', '1...1', '.1.1.', '..1..', '.1.1.', '1...1', '1...1'],
    'Y': ['1...1', '1...1', '.1.1.', '..1..', '..1..', '..1..', '..1..'],
    'Z': ['11111', '....1', '...1.', '..1..', '.1...', '1....', '11111'],
    '0': ['.111.', '1...1', '1..11', '1.1.1', '11..1', '1...1', '.111.'],
    '1': ['..1..', '.11..', '..1..', '..1..', '..1..', '..1..', '.111.'],
    '2': ['.111.', '1...1', '....1', '..11.', '.1...', '1....', '11111'],
    '3': ['11111', '...1.', '..11.', '....1', '....1', '1...1', '.111.'],
    '4': ['...1.', '..11.', '.1.1.', '1..1.', '11111', '...1.', '...1.'],
    '5': ['11111', '1....', '1111.', '....1', '....1', '1...1', '.111.'],
    '6': ['..11.', '.1...', '1....', '1111.', '1...1', '1...1', '.111.'],
    '7': ['11111', '....1', '...1.', '..1..', '.1...', '.1...', '.1...'],
    '8': ['.111.', '1...1', '1...1', '.111.', '1...1', '1...1', '.111.'],
    '9': ['.111.', '1...1', '1...1', '.1111', '....1', '...1.', '.11..'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '-': ['.....', '.....', '.....', '11111', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.11..', '.11..'],
    ',': ['.....', '.....', '.....', '.....', '.11..', '.11..', '.1...'],
    '!': ['..1..', '..1..', '..1..', '..1..', '..1..', '.....', '..1..'],
    '?': ['.111.', '1...1', '....1', '..11.', '..1..', '.....', '..1..'],
    ':': ['.....', '.11..', '.11..', '.....', '.11..', '.11..', '.....'],
    '/': ['....1', '....1', '...1.', '..1..', '.1...', '1....', '1....'],
    '*': ['.....', '1.1.1', '.111.', '11111', '.111.', '1.1.1', '.....'],
    '+': ['.....', '..1..', '..1..', '11111', '..1..', '..1..', '.....'],
    '<': ['...1.', '..1..', '.1...', '1....', '.1...', '..1..', '...1.'],
    '>': ['.1...', '..1..', '...1.', '....1', '...1.', '..1..', '.1...'],
    '(': ['..11.', '.1...', '.1...', '.1...', '.1...', '.1...', '..11.'],
    ')': ['.11..', '...1.', '...1.', '...1.', '...1.', '...1.', '.11..'],
    "'": ['..1..', '..1..', '.....', '.....', '.....', '.....', '.....'],
    '=': ['.....', '.....', '11111', '.....', '11111', '.....', '.....'],
    '%': ['1...1', '...1.', '..1..', '..1..', '.1...', '1...1', '.....'],
    '~': ['.....', '1...1', '.1.1.', '..1..', '.1.1.', '1...1', '.....']
  };

  const GLYPH = Object.create(null);
  for (const k in FONT_SRC) GLYPH[k] = S(FONT_SRC[k]);

  /* ---- the framebuffer + sprite evaluation ----------------------- */
  const fb = newCanvas(W, H);
  const fx = fb.getContext('2d');
  fx.imageSmoothingEnabled = false;

  /* Deferred sprite list, so we can emulate per-scanline limits. */
  let oam = [];
  let flickerOn = true;
  let frame = 0;

  const api = {
    W, H, RGB, hex, Pal, Spr, S, bake, newCanvas,
    canvas: fb,
    ctx: fx,

    get frame() { return frame; },
    tick() { frame++; },

    get flicker() { return flickerOn; },
    set flicker(v) { flickerOn = !!v; },

    /* -- background layer: drawn immediately, no sprite limits -- */
    fill(colIdx) {
      fx.fillStyle = hex(colIdx);
      fx.fillRect(0, 0, W, H);
    },
    rect(x, y, w, h, colIdx) {
      fx.fillStyle = hex(colIdx);
      fx.fillRect(x | 0, y | 0, w | 0, h | 0);
    },
    /* Background tile — immediate, unaffected by sprite limits. */
    tile(spr, pal, x, y, flipX, flipY) {
      fx.drawImage(spr.img(pal, flipX, flipY), x | 0, y | 0);
    },

    /* -- sprite layer: queued, then evaluated in flush() -- */
    spr(sprite, pal, x, y, flipX, flipY, priority) {
      if (oam.length >= 128) return;
      x |= 0; y |= 0;
      if (x <= -sprite.w || x >= W || y <= -sprite.h || y >= H) return;
      oam.push({ s: sprite, p: pal, x, y, fx: !!flipX, fy: !!flipY, pr: priority || 0 });
    },

    /* Real hardware evaluated at most 8 sprites per scanline and
       dropped the rest; games cycled which ones they dropped, which is
       the flicker everybody remembers. We do the same in 8px bands. */
    flush() {
      let list = oam;
      if (flickerOn && list.length > 8) {
        const bands = new Map();
        const rot = frame & 7;
        // stable rotation so different sprites lose the coin toss each frame
        const ordered = list.slice();
        for (let i = 0; i < ordered.length; i++) {
          ordered[i]._o = (i + rot * 3) % ordered.length;
        }
        ordered.sort((a, b) => (b.pr - a.pr) || (a._o - b._o));
        const keep = [];
        for (const s of ordered) {
          const b0 = s.y >> 3, b1 = (s.y + s.s.h - 1) >> 3;
          let ok = true;
          for (let b = b0; b <= b1; b++) if ((bands.get(b) || 0) >= 8) { ok = false; break; }
          if (!ok) continue;
          for (let b = b0; b <= b1; b++) bands.set(b, (bands.get(b) || 0) + 1);
          keep.push(s);
        }
        list = keep;
      }
      list.sort((a, b) => a.pr - b.pr);
      for (const s of list) fx.drawImage(s.s.img(s.p, s.fx, s.fy), s.x, s.y);
      oam = [];
    },

    /* -- text ------------------------------------------------------ */
    text(str, x, y, pal, spacing) {
      const step = spacing === undefined ? 8 : spacing;
      str = String(str).toUpperCase();
      let cx = x | 0;
      for (let i = 0; i < str.length; i++) {
        const g = GLYPH[str[i]];
        if (g) fx.drawImage(g.img(pal, false, false), cx, y | 0);
        cx += step;
      }
      return cx;
    },
    textW(str, spacing) {
      return String(str).length * (spacing === undefined ? 8 : spacing);
    },
    textCenter(str, y, pal, spacing) {
      const step = spacing === undefined ? 8 : spacing;
      api.text(str, (W - String(str).length * step) >> 1, y, pal, step);
    },

    /* Integer-scaled text. Still hard pixels aligned to the grid --
       the same thing a game did with dedicated double-height tiles. */
    textScaled(str, x, y, pal, scale, spacing) {
      const sc = scale || 2;
      const step = (spacing === undefined ? 8 : spacing) * sc;
      str = String(str).toUpperCase();
      let cx = x | 0;
      for (let i = 0; i < str.length; i++) {
        const g = GLYPH[str[i]];
        if (g) fx.drawImage(g.img(pal, false, false), cx, y | 0, g.w * sc, g.h * sc);
        cx += step;
      }
      return cx;
    },
    textScaledCenter(str, y, pal, scale, spacing) {
      const sc = scale || 2;
      const step = (spacing === undefined ? 8 : spacing) * sc;
      api.textScaled(str, (W - String(str).length * step) >> 1, y, pal, sc, spacing);
    },
    glyph(ch) { return GLYPH[String(ch).toUpperCase()]; },

    clearOAM() { oam = []; }
  };

  return api;
})();
