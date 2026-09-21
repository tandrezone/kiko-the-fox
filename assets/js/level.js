/* ==================================================================
   level.js — tilemap, chunk expansion and background rendering.

   Levels are stored as sequences of 16x15 screen-sized chunks, which
   is roughly how cartridges did it: a short list of pointers into a
   pool of reusable screens rather than one enormous map.
   ================================================================== */

const TILE = 16;
const ROWS = 15;

const Level = (function () {

  'use strict';

  const P = CHR.P;

  const SOLID = '#XB?!U[]{}';
  const SEMI = '=';
  const SPAWNS = 'SnbvH';

  const THEMES = {
    forest: {
      sky: 0x21, hillA: 0x0A, hillB: 0x1A, hillTop: 0x2A,
      ground: P.ground, brick: P.brick, log: P.log, bush: P.bush,
      cloud: P.cloud, stone: P.stone, music: 'overworld', clouds: true, stars: false
    },
    cavern: {
      sky: 0x0F, hillA: 0x0C, hillB: 0x00, hillTop: 0x10,
      ground: P.groundCave, brick: P.brickCave, log: P.logCave, bush: P.stalag,
      cloud: P.cloud, stone: P.stone, music: 'cavern', clouds: false, stars: true
    },
    sunset: {
      sky: 0x04, hillA: 0x06, hillB: 0x07, hillTop: 0x17,
      ground: P.groundDusk, brick: P.brickDusk, log: P.logDusk, bush: P.bushDusk,
      cloud: P.cloudDusk, stone: P.stone, music: 'sunset', clouds: true, stars: true
    }
  };

  class LevelMap {
    constructor(def, chunkPool) {
      const cols = [];
      this.spawns = [];
      this.playerStart = { x: 32, y: 176 };
      this.goalX = null;
      this.poleX = null;

      let ox = 0;
      for (const name of def.chunks) {
        const raw = chunkPool[name];
        if (!raw) { console.warn('missing chunk', name); continue; }
        const rows = padChunk(raw);
        const w = rows[0].length;
        for (let x = 0; x < w; x++) {
          const col = new Array(ROWS);
          for (let y = 0; y < ROWS; y++) {
            let ch = rows[y][x] || '.';
            if (SPAWNS.indexOf(ch) >= 0) {
              this.registerSpawn(ch, ox + x, y);
              ch = '.';
            }
            if (ch === 'F' && this.poleX === null) this.poleX = ox + x;
            col[y] = ch;
          }
          cols.push(col);
        }
        ox += w;
      }

      this.cols = cols;
      this.bumps = new Map();   // tiles currently popping up when hit
      this.w = cols.length;
      this.h = ROWS;
      this.pxW = this.w * TILE;
      this.pxH = ROWS * TILE;

      this.name = def.name || '1-1';
      this.time = def.time || 300;
      this.theme = THEMES[def.theme] || THEMES.forest;
      this.music = def.music || this.theme.music;

      if (this.poleX === null) this.poleX = this.w - 6;
      if (this.goalX === null) this.goalX = (this.poleX + 6) * TILE;

      /* deterministic star field / cloud field per level */
      this.deco = [];
      let seed = hash(this.name);
      for (let i = 0; i < 90; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        this.deco.push({
          x: (seed % (this.pxW || 256)),
          y: 16 + ((seed >> 8) % 110),
          t: (seed >> 20) & 3
        });
      }
    }

    registerSpawn(ch, tx, ty) {
      const x = tx * TILE, y = ty * TILE;
      if (ch === 'S') { this.playerStart = { x, y }; return; }
      if (ch === 'H') { this.goalX = x; return; }
      const kind = ch === 'n' ? 'nutling' : ch === 'b' ? 'beetle' : 'bat';
      this.spawns.push({ kind, x, y, used: false });
    }

    at(tx, ty) {
      if (tx < 0 || tx >= this.w) return '#';        // walls at both ends
      if (ty < 0) return '.';
      if (ty >= ROWS) return '.';
      return this.cols[tx][ty];
    }
    set(tx, ty, ch) {
      if (tx < 0 || tx >= this.w || ty < 0 || ty >= ROWS) return;
      this.cols[tx][ty] = ch;
    }
    solidAt(tx, ty) { return SOLID.indexOf(this.at(tx, ty)) >= 0; }
    semiAt(tx, ty) { return this.at(tx, ty) === SEMI; }
    hazardAt(tx, ty) { return this.at(tx, ty) === '^'; }

    /* ---- background ------------------------------------------------ */
    draw(camX, tick) {
      const th = this.theme;
      NES.fill(th.sky);
      this.drawSkyDeco(camX, th, tick);
      this.drawHills(camX, th);
      this.drawTiles(camX, th, tick);
    }

    drawSkyDeco(camX, th, tick) {
      if (th.stars) {
        for (const d of this.deco) {
          if (d.t === 0) continue;
          const x = ((d.x - camX * 0.2) % 272 + 272) % 272 - 8;
          const tw = ((tick >> 4) + d.t) & 3;
          NES.rect(x, d.y * 0.6 + 8, 1, 1, tw === 0 ? 0x30 : 0x10);
        }
      }
      if (th.clouds) {
        for (const d of this.deco) {
          if (d.t !== 1) continue;
          const x = ((d.x - camX * 0.35) % (this.pxW + 320) + (this.pxW + 320)) % (this.pxW + 320) - 32;
          if (x < -32 || x > 260) continue;
          const y = 24 + (d.y % 46);
          NES.tile(CHR.cloud, th.cloud, x, y);
          NES.tile(CHR.cloud, th.cloud, x + 14, y + 2);
        }
      }
    }

    drawHills(camX, th) {
      const base = 208;
      /* far range: tall, dull, slow */
      const p1 = camX * 0.42;
      const sp1 = 152;
      for (let i = -1; i < 4; i++) {
        const hx = Math.round(i * sp1 - (p1 % sp1)) + 12;
        if (hx > NES.W + 8 || hx < -104) continue;
        blockyHill(hx, base, 96, 48, th.hillA, th.hillA);
      }
      /* near range: shorter, brighter, faster */
      const p2 = camX * 0.66;
      const sp2 = 112;
      for (let i = -1; i < 5; i++) {
        const hx = Math.round(i * sp2 - (p2 % sp2)) - 40;
        if (hx > NES.W + 8 || hx < -72) continue;
        blockyHill(hx, base, 64, 24, th.hillB, th.hillTop);
      }
    }

    drawTiles(camX, th, tick) {
      const x0 = Math.max(0, (camX / TILE) | 0);
      const x1 = Math.min(this.w - 1, ((camX + NES.W) / TILE | 0) + 1);
      const qpal = [P.blockDim, P.block, P.blockLit, P.block][(tick >> 3) & 3];

      for (let tx = x0; tx <= x1; tx++) {
        const sx = tx * TILE - camX;
        const col = this.cols[tx];
        for (let ty = 0; ty < ROWS; ty++) {
          const ch = col[ty];
          if (ch === '.') continue;
          const b = this.bumps.get(tx * ROWS + ty);
          const sy = ty * TILE - (b || 0);
          switch (ch) {
            case '#':
              NES.tile(col[ty - 1] === '#' ? CHR.groundFill : CHR.groundTop, th.ground, sx, sy);
              break;
            case 'X': NES.tile(CHR.stone, th.stone, sx, sy); break;
            case 'B': NES.tile(CHR.brick, th.brick, sx, sy); break;
            case 'U': NES.tile(CHR.usedblock, P.used, sx, sy); break;
            case '?': case '!': NES.tile(CHR.qblock, qpal, sx, sy); break;
            case '[': NES.tile(CHR.logTop, th.log, sx, sy, false); break;
            case ']': NES.tile(CHR.logTop, th.log, sx, sy, true); break;
            case '{': NES.tile(CHR.logBody, th.log, sx, sy, false); break;
            case '}': NES.tile(CHR.logBody, th.log, sx, sy, true); break;
            case '=': NES.tile(CHR.plank, P.plank, sx, sy); break;
            case '^': NES.tile(CHR.spikes, P.spike, sx, sy); break;
            case 't': NES.tile(CHR.bush, th.bush, sx, sy); break;
            case 'F': NES.tile(CHR.pole, P.pole, sx, sy); break;
            case 'o': {
              const f = CHR.coin[(tick >> 3) & 3];
              NES.tile(f, P.coin, sx, sy);
              break;
            }
            default: break;
          }
        }
      }

      /* the cabin at the end of the run */
      this.drawCabin(camX, th);
    }

    drawCabin(camX, th) {
      const x = this.goalX - camX;
      if (x < -80 || x > 300) return;
      const y = 208 - 48;
      // walls
      NES.rect(x, y + 16, 64, 32, 0x07);
      NES.rect(x + 2, y + 18, 60, 28, 0x17);
      for (let i = 0; i < 4; i++) NES.rect(x + 2, y + 20 + i * 7, 60, 1, 0x07);
      // roof
      for (let i = 0; i < 8; i++) NES.rect(x - 4 + i * 2, y + 16 - i * 2, 72 - i * 4, 2, i < 2 ? 0x06 : 0x16);
      // door
      NES.rect(x + 24, y + 30, 16, 18, 0x0F);
      NES.rect(x + 26, y + 32, 12, 16, 0x08);
      NES.rect(x + 34, y + 39, 2, 2, 0x28);
      // windows
      NES.rect(x + 8, y + 24, 10, 10, 0x0F);
      NES.rect(x + 9, y + 25, 8, 8, 0x38);
      NES.rect(x + 46, y + 24, 10, 10, 0x0F);
      NES.rect(x + 47, y + 25, 8, 8, 0x38);
    }
  }

  function blockyHill(x, baseY, w, h, col, topCol) {
    const steps = 6;
    const sh = Math.max(2, (h / steps) | 0);
    const sw = Math.max(2, (w / (steps * 2)) | 0);
    for (let i = 0; i < steps; i++) {
      const ww = w - i * 2 * sw;
      if (ww <= 0) return;
      NES.rect(x + i * sw, baseY - (i + 1) * sh, ww, sh, i === steps - 1 ? topCol : col);
    }
  }

  function padChunk(rows) {
    const out = [];
    const pad = ROWS - rows.length;
    const width = rows[0].length;
    for (let i = 0; i < pad; i++) out.push('.'.repeat(width));
    for (const r of rows) out.push(r.length === width ? r : (r + '.'.repeat(width)).slice(0, width));
    return out;
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h & 0x7fffffff;
  }

  return { Map: LevelMap, THEMES, SOLID, SEMI };
})();
