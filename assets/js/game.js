/* ==================================================================
   game.js — state machine, world bookkeeping and the main loop.

   The loop runs a fixed 60 Hz simulation regardless of display
   refresh, so the physics feel identical on a 60, 120 or 144 Hz
   screen. Rendering happens once per animation frame.
   ================================================================== */

const Game = (function () {

  'use strict';

  const P = CHR.P;
  const CFG = window.KIKO_CONFIG || { api: { levels: 'api/levels.php', scores: 'api/scores.php' } };

  const STEP = 1 / 60;

  let canvas, view, data = null, err = null;
  let state = 'load', timer = 0, tick = 0;
  let world = null;
  let lives = 3, score = 0, coins = 0, levelIndex = 0, topScore = 0;
  let menuItem = 0, scoreBoard = [], boardLoading = false;
  let entryName = ['A', 'A', 'A'], entryPos = 0, entrySent = false;
  let paused = false, scanlinesOn = true;
  let started = false;

  /* ================================================================
     WORLD
     ================================================================ */
  function makeWorld(levelDef, chunkPool) {
    const level = new Level.Map(levelDef, chunkPool);

    /* find the top of the flagpole for the end-of-level flourish */
    let poleTop = 0;
    for (let ty = 0; ty < ROWS; ty++) {
      if (level.at(level.poleX, ty) === 'F') { poleTop = ty; break; }
    }

    const w = {
      level,
      ents: [],
      particles: [],
      camX: 0, camY: 0, minX: 0,
      player: null,
      time: level.time,
      timeFrac: 0,
      poleTop,
      flagY: poleTop * TILE + 2,
      flagDrop: false,
      bumpList: [],
      hurried: false,
      shake: 0,

      add(e) { this.ents.push(e); },
      addParticle(p) { this.particles.push(p); },

      addScore(n, x, y, popup) {
        score += n;
        if (score > topScore) topScore = score;
        if (popup) this.particles.push(new Ents.FloatText(x, y - 6, n));
      },

      collectCoin(x, y) {
        coins++;
        this.addScore(200, x, y, false);
        this.particles.push(new Ents.Puff(x + 4, y + 4));
        Sound.sfx('coin');
        if (coins >= 100) { coins -= 100; lives++; Sound.sfx('oneup'); }
      },

      popCoin(tx, ty) {
        this.particles.push(new Ents.CoinPop(tx * TILE, (ty - 1) * TILE));
        coins++;
        this.addScore(200, tx * TILE, (ty - 1) * TILE, false);
        Sound.sfx('coin');
        if (coins >= 100) { coins -= 100; lives++; Sound.sfx('oneup'); }
      },

      spawnItem(tx, ty, kind) {
        /* every eighth item block is generous */
        if (kind === 'acorn' && ((tx * 7 + ty * 13) % 11) === 0) kind = 'leaf';
        this.add(new Ents.Item(tx * TILE, (ty - 1) * TILE, kind));
        Sound.sfx('appear');
      },

      bump(tx, ty) {
        this.bumpList.push({ k: tx * ROWS + ty, t: 0 });
      },

      shatter(tx, ty) {
        const x = tx * TILE + 4, y = ty * TILE + 4;
        this.particles.push(new Ents.Shard(x, y, -1.5, -4.2));
        this.particles.push(new Ents.Shard(x + 4, y, 1.5, -4.2));
        this.particles.push(new Ents.Shard(x, y + 4, -1.1, -2.6));
        this.particles.push(new Ents.Shard(x + 4, y + 4, 1.1, -2.6));
        this.shake = 5;
      },

      bumpEnemiesAbove(tx, ty) {
        const bx = tx * TILE, by = (ty - 1) * TILE;
        for (const e of this.ents) {
          if (e.dead || e.type !== 'enemy' || e.flipped) continue;
          if (e.x + e.w > bx && e.x < bx + TILE && Math.abs(e.y + e.h - (by + TILE)) < 8) {
            e.flip(this);
            Sound.sfx('kick');
          }
        }
      },

      onFlagGrab() {
        this.flagDrop = true;
        Sound.stopMusic();
        Sound.sfx('clear');
        this.addScore(1000, this.player.x, this.player.y, false);
      },

      onReachHome() {
        state = 'clear';
        timer = 0;
      },

      onPlayerDeath() {
        Sound.stopMusic();
        state = 'dead';
        timer = 0;
      }
    };

    w.player = new Ents.Player(level.playerStart.x, level.playerStart.y);
    w.player.setPower('small');
    w.player.y = level.playerStart.y + 16 - w.player.h;
    w.camX = Math.max(0, Math.min(w.player.cx - 112, level.pxW - NES.W));
    return w;
  }

  /* ---- enemy streaming ------------------------------------------- */
  function streamSpawns(w) {
    const edge = w.camX + NES.W + 24;
    for (const s of w.level.spawns) {
      if (s.used || s.x > edge) continue;
      s.used = true;
      if (s.kind === 'nutling') w.add(new Ents.Nutling(s.x, s.y));
      else if (s.kind === 'beetle') w.add(new Ents.Beetle(s.x, s.y));
      else w.add(new Ents.Bat(s.x, s.y));
    }
  }

  /* ================================================================
     PLAY UPDATE
     ================================================================ */
  function updatePlay(w) {
    const p = w.player;

    streamSpawns(w);
    p.update(w);

    for (const e of w.ents) if (!e.dead) e.update(w);
    for (const q of w.particles) if (!q.dead) q.update(w);

    if (!p.dying && !p.finish) collide(w);

    w.ents = w.ents.filter(e => !e.dead);
    w.particles = w.particles.filter(q => !q.dead);

    /* block bump animation */
    w.level.bumps.clear();
    w.bumpList = w.bumpList.filter(b => {
      b.t++;
      const off = b.t < 5 ? b.t * 1.6 : (9 - b.t) * 1.6;
      if (b.t >= 9) return false;
      w.level.bumps.set(b.k, Math.round(off));
      return true;
    });

    /* camera */
    const target = p.cx - 112;
    w.camX = Math.max(w.minX, Math.min(target, w.level.pxW - NES.W));
    if (w.shake > 0) w.shake--;

    /* clock */
    if (!p.finish && !p.dying) {
      if (++w.timeFrac >= 24) {
        w.timeFrac = 0;
        w.time--;
        if (w.time === 100 && !w.hurried) {
          w.hurried = true;
          Sound.sfx('hurry');
          Sound.setTempoScale(1.32);
        }
        if (w.time <= 0) { w.time = 0; p.die(w); }
      }
    }

    /* flag slides down while Kiko does */
    if (w.flagDrop) {
      const bottom = (ROWS - 3) * TILE + 6;
      if (w.flagY < bottom) w.flagY = Math.min(bottom, w.flagY + 1.6);
    }
  }

  function collide(w) {
    const p = w.player;
    if (p.morph > 0 || p.dying) return;

    for (const e of w.ents) {
      if (e.dead || !p.hits(e)) continue;

      if (e.type === 'item') {
        if (e.emerge > 0) continue;
        e.dead = true;
        if (e.kind === 'acorn') { p.grow(w, 'big'); w.addScore(1000, e.x, e.y, true); }
        else if (e.kind === 'berry') { p.grow(w, 'ember'); w.addScore(1000, e.x, e.y, true); }
        else { lives++; Sound.sfx('oneup'); w.addParticle(new Ents.FloatText(e.x - 4, e.y - 6, '1UP')); }
        continue;
      }

      if (e.type !== 'enemy' || e.flipped) continue;
      if (e.squashTimer > 0 || e.hitLock > 0) continue;

      const stomping = p.vy > 0 && (p.y + p.h) - e.y <= 12;
      e.hitLock = 12;
      if (stomping) {
        e.stomped(w, p);
        p.stompChain = Math.min(6, p.stompChain + 1);
        const chain = [100, 200, 400, 800, 1000, 2000, 4000][p.stompChain - 1] || 100;
        w.addScore(chain, e.x, e.y, true);
        p.stompBounce(Input.held('a'));
      } else {
        let dmg = true;
        if (e.touchSide) dmg = e.touchSide(w, p);
        if (dmg) p.hurt(w);
      }
    }
    if (p.onGround) p.stompChain = 0;
  }

  /* ================================================================
     DRAW
     ================================================================ */
  function drawPlay(w) {
    const shakeY = w.shake > 0 ? ((w.shake & 1) ? 1 : -1) : 0;
    const camX = Math.round(w.camX);

    w.level.draw(camX, tick);

    /* flag on the pole */
    if (w.level.poleX !== null) {
      NES.tile(CHR.flagCloth, P.flag, w.level.poleX * TILE - 8 - camX, Math.round(w.flagY), true);
      NES.tile(CHR.poleBall, P.pole, w.level.poleX * TILE + 4 - camX, w.poleTop * TILE - 6);
    }

    for (const q of w.particles) q.draw(camX, w.level.theme.brick);
    for (const e of w.ents) if (e.onScreen(camX)) e.draw(camX);
    w.player.draw(camX);

    NES.flush();

    if (shakeY) {
      /* a one-pixel jolt, done by redrawing nothing -- kept cheap */
    }
    drawHUD(w);
  }

  function drawHUD(w) {
    NES.rect(0, 0, NES.W, 24, 0x0F);
    NES.rect(0, 24, NES.W, 1, 0x10);

    NES.text('KIKO', 16, 4, P.hud);
    NES.text(pad(score, 6), 16, 13, P.hud);

    NES.tile(CHR.hudCoin, P.coinHud, 88, 13);
    NES.text('~' + pad(coins, 2), 97, 13, P.hud);
    NES.tile(CHR.hudFox, P.kiko, 88, 4);
    NES.text('~' + pad(Math.max(0, lives), 2), 97, 4, P.hud);

    NES.text('WORLD', 152, 4, P.hud);
    NES.text(w ? w.level.name : '1-1', 160, 13, P.hud);

    NES.text('TIME', 216, 4, P.hud);
    const t = w ? w.time : 0;
    NES.text(pad(t, 3), 216, 13, t <= 100 && (tick >> 3 & 1) ? P.hot : P.hud);
  }

  function pad(n, w) {
    let s = String(Math.max(0, n | 0));
    while (s.length < w) s = '0' + s;
    return s;
  }

  /* ---- title ------------------------------------------------------ */
  function drawTitle() {
    const th = Level.THEMES.forest;
    NES.fill(0x21);

    /* clouds drifting behind the logo */
    for (let i = 0; i < 5; i++) {
      const x = ((i * 61 + (tick >> 3)) % 300) - 32;
      NES.tile(CHR.cloud, P.cloud, x, 26 + (i % 3) * 16);
      NES.tile(CHR.cloud, P.cloud, x + 14, 28 + (i % 3) * 16);
    }

    /* rolling hills, then the ground */
    for (let i = 0; i < 3; i++) hillAt(i * 104 - 24 - ((tick >> 3) % 104), 192, 96, 44, th.hillA);
    for (let i = 0; i < 4; i++) hillAt(i * 86 - 50 - ((tick >> 2) % 86), 192, 60, 22, th.hillB);
    NES.rect(0, 192, NES.W, 48, 0x08);
    NES.rect(0, 192, NES.W, 5, 0x1A);
    NES.rect(0, 197, NES.W, 2, 0x0A);
    for (let i = 0; i < 5; i++) NES.tile(CHR.bush, P.bush, 8 + i * 56, 176);

    /* logo with a hard drop shadow -- two passes, no blending */
    const logoX = (NES.W - 4 * 24) >> 1;
    for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [3, 3], [-3, 3], [3, -3], [-3, -3]]) {
      NES.textScaled('KIKO', logoX + ox, 32 + oy, P.shadow, 3);
    }
    NES.textScaled('KIKO', logoX, 32, P.hot, 3);
    NES.textCenter('THE FOX', 72, P.text);
    NES.textCenter('- AN 8-BIT ROMP -', 88, P.hudDim);

    /* Kiko trots along the ground, chased by nothing in particular */
    const kx = 60 + ((tick >> 1) % 200);
    NES.spr(CHR.kiko.small.run[(tick >> 3) & 3], P.kiko, kx, 176, false, false, 2);
    NES.spr(CHR.nutling[(tick >> 3) & 1], P.nutling, kx + 34, 176, true, false, 1);

    const items = ['START GAME', 'HIGH SCORES'];
    items.forEach((s, i) => {
      const x = (NES.W - s.length * 8) >> 1;
      NES.text(s, x, 120 + i * 16, i === menuItem ? P.text : P.hudDim);
      if (i === menuItem && ((tick >> 3) & 1)) NES.tile(CHR.cursor, P.hot, x - 14, 120 + i * 16);
    });

    NES.textCenter('TOP ' + pad(topScore, 6), 156, P.gold);
    if (Sound.muted) NES.text('MUTED', 8, 228, P.hudDim);
    NES.flush();
  }

  function hillAt(x, baseY, w, h, col) {
    const steps = 6;
    const sh = Math.max(2, (h / steps) | 0);
    const sw = Math.max(2, (w / (steps * 2)) | 0);
    for (let i = 0; i < steps; i++) {
      const ww = w - i * 2 * sw;
      if (ww <= 0) return;
      NES.rect(x + i * sw, baseY - (i + 1) * sh, ww, sh, col);
    }
  }

  function drawScores() {
    NES.fill(0x0F);
    NES.rect(0, 0, NES.W, 3, 0x16);
    NES.textCenter('HIGH SCORES', 16, P.gold);
    if (boardLoading) { NES.textCenter('LOADING', 110, P.hudDim); NES.flush(); return; }
    if (!scoreBoard.length) NES.textCenter('NO RECORDS', 110, P.hudDim);
    scoreBoard.slice(0, 10).forEach((r, i) => {
      const y = 40 + i * 15;
      const pal = i === 0 ? P.gold : P.hud;
      NES.text(pad(i + 1, 2), 20, y, P.hudDim);
      NES.text(String(r.name || 'AAA').slice(0, 4), 44, y, pal);
      NES.text(pad(r.score | 0, 7), 92, y, pal);
      NES.text(String(r.level || '1-1'), 172, y, P.hudDim);
    });
    NES.textCenter('PRESS START', 222, ((tick >> 4) & 1) ? P.text : P.hudDim);
    NES.flush();
  }

  function drawIntro() {
    NES.fill(0x0F);
    const lv = data.levels[levelIndex];
    NES.textCenter('WORLD ' + lv.name, 84, P.text);
    NES.textCenter(lv.title || '', 100, P.hudDim, 8);
    NES.tile(CHR.hudFox, P.kiko, 104, 128);
    NES.text('~  ' + pad(lives, 2), 118, 128, P.text);
    NES.flush();
  }

  function drawClear(w) {
    drawPlay(w);
    NES.rect(28, 84, 200, 60, 0x0F);
    NES.rect(30, 86, 196, 56, 0x16);
    NES.rect(32, 88, 192, 52, 0x0F);
    NES.textCenter('COURSE CLEAR', 98, P.gold);
    NES.textCenter('TIME ~ 50 = ' + pad(w.timeBonusShown | 0, 5), 118, P.text);
    NES.flush();
  }

  function drawDead(w) {
    drawPlay(w);
  }

  function drawGameOver() {
    NES.fill(0x0F);
    NES.textCenter('GAME OVER', 96, P.hot);
    NES.textCenter('SCORE ' + pad(score, 6), 120, P.text);
    NES.flush();
  }

  function drawEnding() {
    NES.fill(0x0F);
    for (let i = 0; i < 12; i++) {
      const x = ((i * 53 + (tick >> 1)) % 280) - 12;
      NES.rect(x, 20 + (i * 17) % 60, 1, 1, 0x30);
    }
    NES.textCenter('KIKO IS HOME', 60, P.gold);
    NES.textCenter('THANK YOU FOR PLAYING', 84, P.text, 8);
    NES.spr(CHR.kiko.big.idle, P.kiko, 120, 110, false, false, 2);
    NES.textCenter('FINAL SCORE', 160, P.hudDim);
    NES.textCenter(pad(score, 7), 176, P.gold);
    NES.textCenter('PRESS START', 210, ((tick >> 4) & 1) ? P.text : P.hudDim);
    NES.flush();
  }

  function drawEntry() {
    NES.fill(0x0F);
    NES.textCenter('NEW RECORD', 46, P.gold);
    NES.textCenter('SCORE ' + pad(score, 6), 70, P.text);
    NES.textCenter('ENTER YOUR NAME', 100, P.hudDim);
    const x0 = (NES.W - 3 * 24) >> 1;
    for (let i = 0; i < 3; i++) {
      const sel = i === entryPos;
      NES.textScaled(entryName[i], x0 + i * 24, 124, sel ? P.hot : P.text, 2);
      if (sel && ((tick >> 3) & 1)) NES.rect(x0 + i * 24, 144, 14, 2, 0x27);
    }
    NES.textCenter('UP DOWN TO CHANGE', 176, P.hudDim);
    NES.textCenter('START TO CONFIRM', 190, P.hudDim);
    if (entrySent) NES.textCenter('SAVING...', 212, P.text);
    NES.flush();
  }

  function drawLoad() {
    NES.fill(0x0F);
    if (err) {
      NES.textCenter('LOAD ERROR', 100, P.hot);
      NES.textCenter(err.slice(0, 30), 120, P.hudDim, 8);
      NES.textCenter('RUN PHP -S LOCALHOST:8000', 140, P.hudDim, 8);
    } else {
      NES.textCenter('LOADING', 112, ((tick >> 3) & 1) ? P.text : P.hudDim);
    }
    NES.flush();
  }

  /* ================================================================
     STATE MACHINE
     ================================================================ */
  function step() {
    tick++;
    NES.tick();
    Input.latch();

    switch (state) {
      case 'load':
        break;

      case 'title':
        if (Input.pressed('down') || Input.pressed('up')) { menuItem ^= 1; Sound.sfx('blip'); }
        if (Input.pressed('start') || Input.pressed('a')) {
          if (menuItem === 0) { newGame(); }
          else { state = 'scores'; timer = 0; fetchScores(); Sound.sfx('blip'); }
        }
        break;

      case 'scores':
        if (Input.pressed('start') || Input.pressed('a') || Input.pressed('b')) { state = 'title'; Sound.sfx('blip'); }
        break;

      case 'intro':
        if (++timer > 120 || Input.pressed('start')) beginLevel();
        break;

      case 'play':
        if (Input.pressed('start')) {
          paused = !paused;
          Sound.sfx('pause');
          if (paused) Sound.stopMusic(); else Sound.play(world.level.music);
        }
        if (!paused) updatePlay(world);
        break;

      case 'dead':
        world.player.update(world);
        for (const q of world.particles) if (!q.dead) q.update(world);
        world.particles = world.particles.filter(q => !q.dead);
        if (++timer > 170) {
          lives--;
          if (lives < 0) { state = 'over'; timer = 0; Sound.sfx('gameover'); }
          else { state = 'intro'; timer = 0; buildLevel(levelIndex); }
        }
        break;

      case 'clear': {
        timer++;
        if (world.timeBonusShown === undefined) world.timeBonusShown = 0;
        if (timer > 30 && world.time > 0 && (timer & 1)) {
          const chunk = Math.min(world.time, 3);
          world.time -= chunk;
          world.timeBonusShown += chunk * 50;
          score += chunk * 50;
          if (score > topScore) topScore = score;
          Sound.sfx('blip');
        }
        if (timer > 30 && world.time <= 0 && timer > 90) {
          levelIndex++;
          if (levelIndex >= data.levels.length) { state = 'ending'; timer = 0; Sound.stopMusic(); }
          else { buildLevel(levelIndex); state = 'intro'; timer = 0; }
        }
        break;
      }

      case 'over':
        if (++timer > 150) { startEntry(); }
        break;

      case 'ending':
        if (++timer > 60 && (Input.pressed('start') || Input.pressed('a'))) startEntry();
        break;

      case 'entry':
        if (!entrySent) {
          if (Input.pressed('left')) { entryPos = (entryPos + 2) % 3; Sound.sfx('blip'); }
          if (Input.pressed('right')) { entryPos = (entryPos + 1) % 3; Sound.sfx('blip'); }
          if (Input.pressed('up') || Input.pressed('down')) {
            const d = Input.pressed('up') ? 1 : -1;
            const c = (entryName[entryPos].charCodeAt(0) - 65 + d + 26) % 26;
            entryName[entryPos] = String.fromCharCode(65 + c);
            Sound.sfx('blip');
          }
          if (Input.pressed('a')) { entryPos = (entryPos + 1) % 3; Sound.sfx('blip'); }
          if (Input.pressed('start')) submitScore();
        }
        break;
    }
  }

  function render() {
    switch (state) {
      case 'load': drawLoad(); break;
      case 'title': drawTitle(); break;
      case 'scores': drawScores(); break;
      case 'intro': drawIntro(); break;
      case 'play':
        drawPlay(world);
        if (paused) {
          NES.rect(88, 104, 80, 26, 0x0F);
          NES.text('PAUSE', 104, 112, P.text);
        }
        break;
      case 'dead': drawDead(world); break;
      case 'clear': drawClear(world); break;
      case 'over': drawGameOver(); break;
      case 'ending': drawEnding(); break;
      case 'entry': drawEntry(); break;
    }
    /* blit the framebuffer to the visible canvas */
    view.drawImage(NES.canvas, 0, 0);
  }

  /* ================================================================
     FLOW
     ================================================================ */
  function newGame() {
    lives = 3; score = 0; coins = 0; levelIndex = 0;
    buildLevel(0);
    state = 'intro'; timer = 0;
    Sound.sfx('blip');
  }

  function buildLevel(i) {
    const lv = data.levels[i];
    world = makeWorld(lv, data.chunks);
    paused = false;
  }

  function beginLevel() {
    state = 'play';
    timer = 0;
    Sound.play(world.level.music);
  }

  function startEntry() {
    state = 'entry';
    entryName = ['A', 'A', 'A'];
    entryPos = 0;
    entrySent = false;
    timer = 0;
  }

  async function submitScore() {
    entrySent = true;
    const name = entryName.join('');
    const lv = data && data.levels[Math.min(levelIndex, data.levels.length - 1)];
    try {
      const r = await fetch(CFG.api.scores, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score, level: lv ? lv.name : '1-1' })
      });
      const j = await r.json();
      scoreBoard = j.scores || scoreBoard;
    } catch (e) {
      scoreBoard = scoreBoard.concat([{ name, score, level: lv ? lv.name : '1-1' }])
        .sort((a, b) => b.score - a.score).slice(0, 10);
    }
    state = 'scores';
    timer = 0;
  }

  async function fetchScores() {
    boardLoading = true;
    try {
      const r = await fetch(CFG.api.scores);
      const j = await r.json();
      scoreBoard = j.scores || [];
    } catch (e) { /* keep whatever we had */ }
    boardLoading = false;
  }

  async function loadData() {
    const tries = [CFG.api.levels, 'data/levels.json'];
    for (const url of tries) {
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) continue;
        const j = await r.json();
        if (j && j.levels && j.chunks) return j;
      } catch (e) { /* try the next source */ }
    }
    return null;
  }

  /* ================================================================
     BOOT
     ================================================================ */
  function fitScreen() {
    const pad = 40;
    const vw = window.innerWidth - pad;
    const vh = window.innerHeight - 150;
    let s = Math.min(Math.floor(vw / NES.W), Math.floor(vh / NES.H));
    if (!isFinite(s) || s < 1) s = 1;
    if (s > 4) s = 4;
    document.documentElement.style.setProperty('--scale', String(s));
  }

  let acc = 0, last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 6) { step(); acc -= STEP; }
    render();
  }

  return {
    async boot(cv) {
      canvas = cv;
      view = cv.getContext('2d');
      view.imageSmoothingEnabled = false;

      Input.init();
      fitScreen();
      window.addEventListener('resize', fitScreen);

      Input.onToggle('KeyP', () => {
        if (state === 'play') { paused = !paused; Sound.sfx('pause'); if (paused) Sound.stopMusic(); else Sound.play(world.level.music); }
      });
      Input.onToggle('KeyM', () => Sound.toggleMute());
      Input.onToggle('KeyF', () => { NES.flicker = !NES.flicker; });
      Input.onToggle('KeyL', () => {
        scanlinesOn = !scanlinesOn;
        const el = document.getElementById('scanlines');
        if (el) el.classList.toggle('off', !scanlinesOn);
      });

      const boot = document.getElementById('boot');
      const go = () => {
        if (started) return;
        started = true;
        if (boot) boot.classList.add('hidden');
        Sound.start();
      };
      if (boot) boot.addEventListener('click', go);
      canvas.addEventListener('click', go);
      Input.onAnyKey(go);

      requestAnimationFrame(frame);

      data = await loadData();
      if (!data) {
        err = 'COULD NOT LOAD LEVELS';
        return;
      }
      state = 'title';
      fetchScores();
    },

    /* handy for poking at things from the console */
    get debug() {
      return { get state() { return state; }, get world() { return world; }, get data() { return data; },
               get score() { return score; }, get lives() { return lives; },
               set state(s) { state = s; }, newGame, buildLevel, beginLevel };
    }
  };
})();
