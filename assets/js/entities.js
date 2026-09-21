/* ==================================================================
   entities.js — Kiko, the wildlife, the items and the debris.

   Physics runs on a fixed 60 Hz step in whole pixels: positions are
   floats internally but everything is floored before it reaches the
   framebuffer, so nothing ever lands between two pixels.
   ================================================================== */

(function () {

  'use strict';

  const P = CHR.P;

  /* ---- tuning ---------------------------------------------------- */
  const GRAV        = 0.42;
  const GRAV_HOLD   = 0.17;   // while the jump button is still down
  const MAX_FALL    = 7.2;
  const ACC_WALK    = 0.105;
  const ACC_RUN     = 0.155;
  const MAX_WALK    = 1.55;
  const MAX_RUN     = 2.70;
  const FRICTION    = 0.095;
  const SKID_DEC    = 0.28;
  const JUMP_V      = 5.05;
  const JUMP_BONUS  = 0.62;   // extra height carried by running speed
  const AIR_ACC     = 0.085;

  /* ================================================================ */
  class Ent {
    constructor(x, y, w, h) {
      this.x = x; this.y = y; this.w = w; this.h = h;
      this.vx = 0; this.vy = 0;
      this.dead = false;
      this.onGround = false;
      this.facing = 1;
      this.type = 'ent';
      this.usesSemi = true;
      this.gravity = GRAV;
      this.active = true;
    }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get left() { return this.x; }
    get right() { return this.x + this.w; }
    get top() { return this.y; }
    get bottom() { return this.y + this.h; }
    hits(o) {
      return this.x < o.x + o.w && this.x + this.w > o.x &&
             this.y < o.y + o.h && this.y + this.h > o.y;
    }
    onScreen(camX, pad) {
      pad = pad || 32;
      return this.x + this.w > camX - pad && this.x < camX + NES.W + pad;
    }

    moveX(world) {
      const lvl = world.level;
      this.x += this.vx;
      this.wall = 0;
      const y0 = Math.floor(this.y / TILE), y1 = Math.floor((this.y + this.h - 1) / TILE);
      if (this.vx > 0) {
        const tx = Math.floor((this.x + this.w - 1) / TILE);
        for (let ty = y0; ty <= y1; ty++) {
          if (lvl.solidAt(tx, ty)) { this.x = tx * TILE - this.w; this.vx = 0; this.wall = 1; break; }
        }
      } else if (this.vx < 0) {
        const tx = Math.floor(this.x / TILE);
        for (let ty = y0; ty <= y1; ty++) {
          if (lvl.solidAt(tx, ty)) { this.x = (tx + 1) * TILE; this.vx = 0; this.wall = -1; break; }
        }
      }
    }

    moveY(world) {
      const lvl = world.level;
      const prevBottom = this.y + this.h;
      this.y += this.vy;
      const x0 = Math.floor(this.x / TILE), x1 = Math.floor((this.x + this.w - 1) / TILE);
      this.onGround = false;
      if (this.vy > 0) {
        /* Test the tile the feet are entering, not the one they are
           inside. Resting exactly on a tile boundary is the common
           case, and using (bottom - 1) there reads the empty tile
           above -- which makes a grounded entity flicker between
           airborne and landed, and eats jump presses. */
        const ty = Math.floor((this.y + this.h) / TILE);
        for (let tx = x0; tx <= x1; tx++) {
          const solid = lvl.solidAt(tx, ty);
          const semi = this.usesSemi && lvl.semiAt(tx, ty) && prevBottom <= ty * TILE + 0.01 && !this.duckThrough;
          if (solid || semi) { this.y = ty * TILE - this.h; this.vy = 0; this.onGround = true; break; }
        }
      } else if (this.vy < 0) {
        const ty = Math.floor(this.y / TILE);
        for (let tx = x0; tx <= x1; tx++) {
          if (lvl.solidAt(tx, ty)) {
            this.y = (ty + 1) * TILE; this.vy = 0;
            if (this.headBump) this.headBump(world, tx, ty);
            break;
          }
        }
      }
    }

    applyGravity() {
      this.vy = Math.min(MAX_FALL, this.vy + this.gravity);
    }
  }

  /* ================================================================
     KIKO
     ================================================================ */
  class Player extends Ent {
    constructor(x, y) {
      super(x, y, 12, 14);
      this.type = 'player';
      this.power = 'small';       // small | big | ember
      this.anim = 0;
      this.jumping = false;
      this.ducking = false;
      this.invuln = 0;
      this.morph = 0;             // freeze frames while growing/shrinking
      this.morphTo = null;
      this.dying = false;
      this.deathTimer = 0;
      this.starTimer = 0;
      this.embers = 0;
      this.throwAnim = 0;
      this.finish = 0;            // 0 playing, 1 on pole, 2 walking home, 3 done
      this.finishTimer = 0;
      this.stompChain = 0;
      this.skidding = false;
    }

    get big() { return this.power !== 'small'; }

    resize(big, keepFeet) {
      const nh = big ? 22 : 14;
      if (keepFeet !== false) this.y += this.h - nh;
      this.h = nh;
    }

    setPower(p) {
      const wasBig = this.big;
      this.power = p;
      const nowBig = this.big;
      if (wasBig !== nowBig) this.resize(nowBig);
    }

    update(world) {
      if (this.dying) return this.updateDying(world);
      if (this.finish) return this.updateFinish(world);

      if (this.morph > 0) {
        this.morph--;
        if (this.morph === 0 && this.morphTo) { this.setPower(this.morphTo); this.morphTo = null; }
        this.applyGravity();
        this.moveY(world);
        return;
      }

      if (this.invuln > 0) this.invuln--;
      if (this.starTimer > 0) this.starTimer--;
      if (this.throwAnim > 0) this.throwAnim--;

      const left = Input.held('left'), right = Input.held('right');
      const run = Input.held('b');
      const wantDuck = Input.held('down') && this.big && this.onGround;

      if (wantDuck !== this.ducking) {
        this.ducking = wantDuck;
        this.resize(!wantDuck && this.big);
      }

      /* -- horizontal -- */
      const maxSpd = run ? MAX_RUN : MAX_WALK;
      const acc = this.onGround ? (run ? ACC_RUN : ACC_WALK) : AIR_ACC;
      const dir = (right ? 1 : 0) - (left ? 1 : 0);

      this.skidding = false;
      if (dir !== 0 && !this.ducking) {
        if (this.onGround && this.vx !== 0 && Math.sign(this.vx) !== dir) {
          this.vx += dir * SKID_DEC;
          this.skidding = true;
        } else {
          this.vx += dir * acc;
        }
        this.facing = dir;
      } else if (this.onGround) {
        if (Math.abs(this.vx) <= FRICTION) this.vx = 0;
        else this.vx -= Math.sign(this.vx) * FRICTION;
      }
      if (this.vx > maxSpd) this.vx = Math.max(maxSpd, this.vx - 0.12);
      if (this.vx < -maxSpd) this.vx = Math.min(-maxSpd, this.vx + 0.12);

      /* -- jump -- */
      if (Input.pressed('a') && this.onGround && !this.ducking) {
        this.vy = -(JUMP_V + Math.abs(this.vx) * JUMP_BONUS / MAX_RUN * 1.6);
        this.jumping = true;
        this.onGround = false;
        Sound.sfx('jump', this.big);
      }
      if (this.jumping && (!Input.held('a') || this.vy >= 0)) this.jumping = false;
      this.gravity = (this.jumping && this.vy < 0) ? GRAV_HOLD : GRAV;

      /* -- throw -- */
      if (this.power === 'ember' && Input.pressed('b') && !this.ducking) {
        if (world.ents.filter(e => e.type === 'ember').length < 2) {
          world.add(new Ember(this.facing > 0 ? this.right - 2 : this.left - 6,
                              this.y + (this.big ? 8 : 3), this.facing));
          this.throwAnim = 10;
          Sound.sfx('shoot');
        }
      }

      this.applyGravity();
      this.moveX(world);
      this.moveY(world);

      /* -- world edges -- */
      if (this.x < world.minX) { this.x = world.minX; this.vx = 0; }
      if (this.x + this.w > world.level.pxW) { this.x = world.level.pxW - this.w; this.vx = 0; }

      /* -- coins and spikes -- */
      this.checkTiles(world);

      /* -- animation -- */
      if (!this.onGround) this.anim = 0;
      else if (Math.abs(this.vx) > 0.15) this.anim += Math.abs(this.vx) * 0.28;
      else this.anim = 0;

      /* -- flagpole -- */
      if (world.level.poleX !== null && this.right > world.level.poleX * TILE + 6 && this.finish === 0) {
        this.grabPole(world);
      }

      if (this.y > world.level.pxH + 24) this.die(world, true);
    }

    checkTiles(world) {
      const lvl = world.level;
      const x0 = Math.floor(this.x / TILE), x1 = Math.floor((this.x + this.w - 1) / TILE);
      const y0 = Math.floor(this.y / TILE), y1 = Math.floor((this.y + this.h - 1) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          const ch = lvl.at(tx, ty);
          if (ch === 'o') {
            lvl.set(tx, ty, '.');
            world.collectCoin(tx * TILE, ty * TILE);
          } else if (ch === '^' && this.invuln <= 0) {
            this.hurt(world);
          }
        }
      }
    }

    headBump(world, tx, ty) {
      const lvl = world.level;
      const ch = lvl.at(tx, ty);
      if (ch === '?' ) {
        lvl.set(tx, ty, 'U');
        world.bump(tx, ty);
        world.popCoin(tx, ty);
      } else if (ch === '!') {
        lvl.set(tx, ty, 'U');
        world.bump(tx, ty);
        world.spawnItem(tx, ty, this.power === 'small' ? 'acorn' : 'berry');
      } else if (ch === 'B') {
        if (this.big) {
          lvl.set(tx, ty, '.');
          world.shatter(tx, ty);
          world.addScore(50, tx * TILE, ty * TILE, true);
          Sound.sfx('brick');
        } else {
          world.bump(tx, ty);
          Sound.sfx('bump');
        }
      } else if (ch === 'X' || ch === 'U') {
        Sound.sfx('bump');
      }
      /* an enemy standing on the block gets flipped */
      world.bumpEnemiesAbove(tx, ty);
    }

    grabPole(world) {
      this.finish = 1;
      this.finishTimer = 0;
      this.vx = 0; this.vy = 1.6;
      this.x = world.level.poleX * TILE + 4;
      this.facing = 1;
      world.onFlagGrab();
    }

    updateFinish(world) {
      const lvl = world.level;
      if (this.finish === 1) {
        this.y += this.vy;
        this.anim += 0.4;
        const floorY = lvl.pxH - 2 * TILE - this.h;
        if (this.y >= floorY) { this.y = floorY; this.finish = 2; this.finishTimer = 24; }
      } else if (this.finish === 2) {
        if (this.finishTimer > 0) { this.finishTimer--; return; }
        this.vx = 1.3;
        this.facing = 1;
        this.applyGravity();
        this.moveX(world);
        this.moveY(world);
        this.anim += 0.35;
        if (this.x > lvl.goalX + 22) { this.finish = 3; world.onReachHome(); }
      }
    }

    hurt(world) {
      if (this.invuln > 0 || this.morph > 0 || this.dying) return;
      if (this.power === 'small') { this.die(world); return; }
      this.morphTo = 'small';
      this.morph = 40;
      this.invuln = 110;
      Sound.sfx('shrink');
    }

    grow(world, to) {
      if (to === 'big' && this.power !== 'small') return;
      this.morphTo = to;
      this.morph = 34;
      Sound.sfx('powerup');
    }

    die(world, silent) {
      if (this.dying) return;
      this.dying = true;
      this.deathTimer = 0;
      this.vx = 0; this.vy = 0;
      this.ducking = false;
      if (!silent) Sound.sfx('die'); else Sound.sfx('die');
      world.onPlayerDeath();
    }

    updateDying(world) {
      this.deathTimer++;
      if (this.deathTimer === 26) this.vy = -6.4;
      if (this.deathTimer > 26) { this.vy = Math.min(MAX_FALL, this.vy + 0.32); this.y += this.vy; }
    }

    stompBounce(strong) {
      this.vy = strong ? -6.0 : -4.2;
      this.jumping = Input.held('a');
    }

    sprite() {
      const set = this.big ? CHR.kiko.big : CHR.kiko.small;
      if (this.dying) return CHR.kiko.small.dead;
      if (this.ducking && this.big) return set.duck;
      if (this.finish === 1) return set.run[(this.anim | 0) % 4];
      if (!this.onGround) return set.jump;
      if (this.skidding) return set.skid;
      if (Math.abs(this.vx) > 0.15) return set.run[(this.anim | 0) % 4];
      return set.idle;
    }

    palette() {
      if (this.morph > 0) return (this.morph >> 2) & 1 ? P.kikoFlash : P.kiko;
      if (this.invuln > 0 && (this.invuln >> 1) & 1) return P.kikoHurt;
      if (this.power === 'ember') return ((NES.frame >> 3) & 1) ? P.kikoFlash : P.kiko;
      return P.kiko;
    }

    draw(camX) {
      if (this.invuln > 0 && !this.morph && (this.invuln & 2)) return;   // blink
      const s = this.sprite();
      const x = Math.round(this.x) - 2 - camX;
      const y = Math.round(this.y) + this.h - s.h;
      NES.spr(s, this.palette(), x, y, this.facing < 0, false, 2);
    }
  }

  /* ================================================================
     ENEMIES
     ================================================================ */
  class Enemy extends Ent {
    constructor(x, y, w, h) {
      super(x, y, w, h);
      this.type = 'enemy';
      this.anim = 0;
      this.squashTimer = 0;
      this.flipped = false;
      this.score = 100;
      this.hitLock = 0;   // frames of contact immunity after being hit
    }
    tickLock() { if (this.hitLock > 0) this.hitLock--; }
    stomped(world, player) { this.kill(world); }
    flip(world) {
      this.flipped = true;
      this.vy = -4.2;
      this.vx = 0.6 * (Math.random() < 0.5 ? -1 : 1);
      world.addScore(this.score, this.x, this.y, true);
    }
    kill(world) { this.dead = true; }

    baseUpdate(world) {
      if (this.flipped) {
        this.applyGravity();
        this.x += this.vx; this.y += this.vy;
        if (this.y > world.level.pxH + 32) this.dead = true;
        return true;
      }
      return false;
    }

    patrol(world, speed) {
      this.vx = speed * this.facing;
      this.applyGravity();
      this.moveX(world);
      if (this.wall) this.facing *= -1;
      this.moveY(world);
      /* turn around at ledges so they stay on their platform */
      if (this.onGround) {
        const ahead = Math.floor((this.facing > 0 ? this.x + this.w + 1 : this.x - 1) / TILE);
        const below = Math.floor((this.y + this.h + 2) / TILE);
        if (!world.level.solidAt(ahead, below) && !world.level.semiAt(ahead, below)) this.facing *= -1;
      }
      if (this.y > world.level.pxH + 32) this.dead = true;
    }
  }

  class Nutling extends Enemy {
    constructor(x, y) { super(x + 2, y + 2, 12, 14); this.facing = -1; }
    update(world) {
      this.tickLock();
      if (this.squashTimer > 0) {
        if (--this.squashTimer <= 0) this.dead = true;
        return;
      }
      if (this.baseUpdate(world)) return;
      this.anim += 0.12;
      this.patrol(world, 0.48);
    }
    stomped(world, player) {
      this.squashTimer = 26;
      this.h = 6; this.y += 8;
      Sound.sfx('stomp');
    }
    draw(camX) {
      const x = Math.round(this.x) - 2 - camX;
      if (this.squashTimer > 0) { NES.spr(CHR.nutlingFlat, P.nutling, x, Math.round(this.y) - 8, false, false, 1); return; }
      const s = CHR.nutling[(this.anim | 0) & 1];
      NES.spr(s, P.nutling, x, Math.round(this.y) - 2, this.facing > 0, this.flipped, 1);
    }
  }

  class Beetle extends Enemy {
    constructor(x, y) {
      super(x + 2, y + 5, 12, 11);
      this.facing = -1;
      this.mode = 'walk';       // walk | shell | slide
      this.shellTimer = 0;
      this.score = 100;
    }
    update(world) {
      this.tickLock();
      if (this.baseUpdate(world)) return;
      if (this.mode === 'walk') {
        this.anim += 0.11;
        this.patrol(world, 0.55);
      } else if (this.mode === 'shell') {
        this.vx = 0;
        this.applyGravity();
        this.moveY(world);
        if (++this.shellTimer > 420) {
          this.mode = 'walk';
          this.h = 11; this.y -= 0;
          this.shellTimer = 0;
        }
      } else {
        this.anim += 0.5;
        this.vx = 3.4 * this.facing;
        this.applyGravity();
        this.moveX(world);
        if (this.wall) { this.facing *= -1; Sound.sfx('bump'); }
        this.moveY(world);
        /* a rolling shell clears everything in its path */
        for (const e of world.ents) {
          if (e === this || e.dead || e.type !== 'enemy') continue;
          if (this.hits(e)) { e.flip(world); Sound.sfx('kick'); }
        }
        if (this.y > world.level.pxH + 32) this.dead = true;
      }
    }
    stomped(world, player) {
      if (this.mode === 'walk') {
        this.mode = 'shell'; this.shellTimer = 0;
        this.h = 11; this.y += 0;
        Sound.sfx('stomp');
      } else if (this.mode === 'slide') {
        this.mode = 'shell'; this.shellTimer = 0; this.vx = 0;
        Sound.sfx('stomp');
      } else {
        this.mode = 'slide';
        this.facing = player.cx < this.cx ? 1 : -1;
        Sound.sfx('kick');
      }
    }
    touchSide(world, player) {
      if (this.mode === 'shell') {
        this.mode = 'slide';
        this.facing = player.cx < this.cx ? 1 : -1;
        this.x += this.facing * 3;
        Sound.sfx('kick');
        world.addScore(100, this.x, this.y, true);
        return false;   // no damage
      }
      return true;
    }
    draw(camX) {
      const x = Math.round(this.x) - 2 - camX;
      if (this.mode === 'walk') {
        NES.spr(CHR.beetle[(this.anim | 0) & 1], P.beetle, x, Math.round(this.y) - 5, this.facing > 0, this.flipped, 1);
      } else {
        const f = this.mode === 'slide' ? ((this.anim | 0) & 1) : 0;
        NES.spr(CHR.shell[f], P.beetle, x, Math.round(this.y) - 5, false, this.flipped, 1);
      }
    }
  }

  class Bat extends Enemy {
    constructor(x, y) {
      super(x + 2, y + 4, 12, 8);
      this.homeY = this.y;
      this.t = Math.random() * 6.28;
      this.gravity = 0;
      this.usesSemi = false;
      this.score = 200;
    }
    update(world) {
      this.tickLock();
      if (this.baseUpdate(world)) return;
      this.t += 0.055;
      this.anim += 0.14;
      this.x -= 0.62;
      this.y = this.homeY + Math.sin(this.t) * 26;
      if (this.x < world.camX - 48) this.dead = true;
    }
    stomped(world, player) { this.dead = true; Sound.sfx('stomp'); }
    draw(camX) {
      const s = CHR.bat[(this.anim | 0) & 1];
      NES.spr(s, P.bat, Math.round(this.x) - 2 - camX, Math.round(this.y) - 4, false, this.flipped, 1);
    }
  }

  /* ================================================================
     ITEMS
     ================================================================ */
  class Item extends Ent {
    constructor(x, y, kind) {
      super(x + 2, y, 12, 14);
      this.type = 'item';
      this.kind = kind;
      this.emerge = 16;         // pixels still to rise out of the block
      this.vx = 0;
      this.facing = 1;
    }
    update(world) {
      if (this.emerge > 0) {
        this.emerge--;
        this.y -= 1;
        if (this.emerge === 0) {
          this.vx = this.kind === 'leaf' ? 0.9 : 0.85;
          if (this.kind === 'berry') this.vy = -2.2;
        }
        return;
      }
      if (this.kind === 'leaf') {
        this.vy = Math.min(MAX_FALL, this.vy + GRAV);
        this.moveX(world);
        if (this.wall) this.vx *= -1;
        this.moveY(world);
        if (this.onGround) this.vy = -4.4;
      } else if (this.kind === 'berry') {
        this.vy = Math.min(MAX_FALL, this.vy + GRAV);
        this.moveX(world);
        if (this.wall) this.vx *= -1;
        this.moveY(world);
        if (this.onGround) this.vy = -3.6;
      } else {
        this.vy = Math.min(MAX_FALL, this.vy + GRAV);
        this.moveX(world);
        if (this.wall) this.vx *= -1;
        this.moveY(world);
      }
      if (this.y > world.level.pxH + 32) this.dead = true;
    }
    draw(camX) {
      const s = this.kind === 'acorn' ? CHR.acorn : this.kind === 'berry' ? CHR.berry : CHR.leaf;
      const pal = this.kind === 'acorn' ? P.acorn : this.kind === 'berry' ? P.berry : P.leaf;
      NES.spr(s, pal, Math.round(this.x) - 2 - camX, Math.round(this.y) - 2, false, false, this.emerge > 0 ? -1 : 1);
    }
  }

  class Ember extends Ent {
    constructor(x, y, dir) {
      super(x, y, 8, 8);
      this.type = 'ember';
      this.vx = 3.3 * dir;
      this.vy = 1.4;
      this.bounces = 0;
      this.anim = 0;
      this.usesSemi = false;
    }
    update(world) {
      this.anim += 0.4;
      this.vy = Math.min(6, this.vy + 0.34);
      this.moveX(world);
      if (this.wall) { this.burst(world); return; }
      this.moveY(world);
      if (this.onGround) { this.vy = -3.6; if (++this.bounces > 6) this.burst(world); }
      if (this.x < world.camX - 24 || this.x > world.camX + NES.W + 24) this.dead = true;
      if (this.y > world.level.pxH + 16) this.dead = true;

      for (const e of world.ents) {
        if (e.dead || e.type !== 'enemy' || e.flipped) continue;
        if (this.hits(e)) { e.flip(world); Sound.sfx('kick'); this.burst(world); return; }
      }
    }
    burst(world) {
      this.dead = true;
      world.addParticle(new Puff(this.x, this.y));
    }
    draw(camX) {
      NES.spr(CHR.ember[(this.anim | 0) & 1], P.ember, Math.round(this.x) - camX, Math.round(this.y), false, false, 1);
    }
  }

  /* ================================================================
     PARTICLES
     ================================================================ */
  class Particle {
    constructor(x, y) { this.x = x; this.y = y; this.dead = false; }
  }

  class Shard extends Particle {
    constructor(x, y, vx, vy) { super(x, y); this.vx = vx; this.vy = vy; this.rot = 0; }
    update(world) {
      this.vy += 0.4;
      this.x += this.vx; this.y += this.vy;
      this.rot += 0.3;
      if (this.y > world.camY + NES.H + 32) this.dead = true;
    }
    draw(camX, pal) {
      NES.spr(CHR.shard, pal || P.brick, Math.round(this.x) - camX, Math.round(this.y), false, ((this.rot | 0) & 1) === 1, 1);
    }
  }

  class Puff extends Particle {
    constructor(x, y) { super(x, y); this.t = 0; }
    update() { if (++this.t > 12) this.dead = true; }
    draw(camX) {
      const f = Math.min(2, this.t / 5 | 0);
      NES.spr(CHR.sparkle[f], P.white, Math.round(this.x) - camX, Math.round(this.y), false, false, 1);
    }
  }

  class CoinPop extends Particle {
    constructor(x, y) { super(x, y); this.t = 0; this.vy = -5.2; }
    update() {
      this.t++;
      this.vy += 0.44;
      this.y += this.vy;
      if (this.t > 22) this.dead = true;
    }
    draw(camX) {
      NES.spr(CHR.coin[(this.t >> 1) & 3], P.coin, Math.round(this.x) - camX, Math.round(this.y), false, false, 1);
    }
  }

  class FloatText extends Particle {
    constructor(x, y, text) { super(x, y); this.text = String(text); this.t = 0; }
    update() { this.y -= 0.6; if (++this.t > 46) this.dead = true; }
    draw(camX) {
      if ((this.t & 1) && this.t > 34) return;
      NES.text(this.text, Math.round(this.x) - camX, Math.round(this.y), P.text, 6);
    }
  }

  /* export */
  window.Ents = {
    Ent, Player, Enemy, Nutling, Beetle, Bat,
    Item, Ember, Shard, Puff, CoinPop, FloatText,
    K: { GRAV, MAX_FALL }
  };
})();
