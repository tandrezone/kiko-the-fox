/* ==================================================================
   audio.js — a small stand-in for the 2A03 sound chip.

   Five voices, same as the real thing:
     pulse 1, pulse 2  -> square waves with selectable duty cycle
     triangle          -> bass
     noise             -> percussion and impacts
     (dmc is skipped; nobody misses it)

   Music is written as tracker rows, one row per sixteenth note, which
   is how these tunes were actually entered. Everything is synthesised
   at runtime, so the game ships with no audio files at all.
   ================================================================== */

const Sound = (function () {

  'use strict';

  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let muted = false, started = false;

  const waves = {};

  /* ---- note names to frequencies --------------------------------- */
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const freqCache = Object.create(null);
  function freq(name) {
    if (freqCache[name] !== undefined) return freqCache[name];
    const m = /^([A-G])(#|B)?(-?\d)$/.exec(name.toUpperCase());
    if (!m) return (freqCache[name] = 0);
    let s = STEP[m[1]];
    if (m[2] === '#') s++; else if (m[2] === 'B') s--;
    const oct = parseInt(m[3], 10);
    const midi = (oct + 1) * 12 + s;
    return (freqCache[name] = 440 * Math.pow(2, (midi - 69) / 12));
  }

  /* ---- lazily built audio graph ---------------------------------- */
  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.55; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.85; sfxGain.connect(master);
    buildWaves();
    buildNoise();
    return true;
  }

  function buildWaves() {
    [0.125, 0.25, 0.5].forEach(duty => {
      const n = 40;
      const real = new Float32Array(n), imag = new Float32Array(n);
      for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
      waves[duty] = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    });
  }

  let noiseBuf = null;
  function buildNoise() {
    const len = ctx.sampleRate * 1.0;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    /* A 15-bit LFSR, the same shape the NES used, so it rasps rather
       than hisses. */
    let reg = 1;
    let hold = 0, val = 0;
    for (let i = 0; i < len; i++) {
      if (hold-- <= 0) {
        const bit = ((reg ^ (reg >> 1)) & 1);
        reg = (reg >> 1) | (bit << 14);
        val = (reg & 1) ? 0.9 : -0.9;
        hold = 2;
      }
      d[i] = val;
    }
  }

  /* ---- one-shot voices ------------------------------------------- */
  function pulse(t, f, dur, vol, duty, dest, slideTo) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(waves[duty || 0.5]);
    o.frequency.setValueAtTime(Math.max(20, f), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + Math.max(0.008, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function tri(t, f, dur, vol, dest) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(Math.max(20, f), t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, t + Math.max(0.01, dur * 0.7));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(t, dur, vol, rate, dest, hp) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = hp ? 'highpass' : 'lowpass';
    f.frequency.value = hp || 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t); s.stop(t + dur + 0.02);
  }

  /* ================================================================
     SONGS.  '-' holds the previous note, '.' is a rest.
     16 rows per bar (sixteenth notes).
     ================================================================ */
  const R = '.', H = '-';

  const OVERWORLD = {
    bpm: 138,
    duty: [0.5, 0.25],
    p1: [
      'G4', H, 'A4', H, 'B4', H, R, 'D5', H, H, R, 'B4', H, R, R, R,
      'C5', H, 'B4', H, 'A4', H, R, 'G4', H, H, R, 'E4', H, R, R, R,
      'A4', H, 'B4', H, 'C5', H, R, 'E5', H, H, R, 'D5', H, R, R, R,
      'C5', H, H, R, 'G4', H, R, 'C5', H, H, H, H, R, R, R, R,

      'E5', H, R, 'D5', H, R, 'C5', H, R, 'B4', H, R, 'A4', H, R, R,
      'G4', H, R, 'A4', H, R, 'B4', H, R, 'C5', H, H, H, R, R, R,
      'D5', H, R, 'E5', H, R, 'F5', H, R, 'E5', H, R, 'D5', H, R, R,
      'C5', H, H, H, 'E5', H, H, H, 'G5', H, H, H, H, H, R, R
    ],
    p2: [
      'C4', R, 'E4', R, 'G4', R, 'E4', R, 'C4', R, 'E4', R, 'G4', R, 'E4', R,
      'B3', R, 'D4', R, 'G4', R, 'D4', R, 'B3', R, 'D4', R, 'G4', R, 'D4', R,
      'A3', R, 'C4', R, 'F4', R, 'C4', R, 'A3', R, 'C4', R, 'F4', R, 'C4', R,
      'C4', R, 'E4', R, 'G4', R, 'E4', R, 'D4', R, 'G4', R, 'B3', R, 'G4', R,

      'C4', R, 'E4', R, 'G4', R, 'E4', R, 'A3', R, 'C4', R, 'E4', R, 'C4', R,
      'G3', R, 'B3', R, 'D4', R, 'B3', R, 'C4', R, 'E4', R, 'G4', R, 'E4', R,
      'B3', R, 'D4', R, 'G4', R, 'D4', R, 'B3', R, 'D4', R, 'G4', R, 'D4', R,
      'C4', R, 'E4', R, 'G4', R, 'C5', R, 'G4', R, 'E4', R, 'C4', R, 'G3', R
    ],
    tri: [
      'C3', H, R, R, 'G2', H, R, R, 'C3', H, R, R, 'E3', H, R, R,
      'G2', H, R, R, 'D3', H, R, R, 'G2', H, R, R, 'B2', H, R, R,
      'F2', H, R, R, 'C3', H, R, R, 'F2', H, R, R, 'A2', H, R, R,
      'C3', H, R, R, 'G2', H, R, R, 'C3', H, R, R, 'G2', H, R, R,

      'C3', H, R, R, 'C3', H, R, R, 'A2', H, R, R, 'A2', H, R, R,
      'G2', H, R, R, 'G2', H, R, R, 'C3', H, R, R, 'C3', H, R, R,
      'G2', H, R, R, 'G2', H, R, R, 'B2', H, R, R, 'D3', H, R, R,
      'C3', H, R, R, 'E3', H, R, R, 'G3', H, R, R, 'C3', H, R, R
    ],
    noi: [
      'k', R, R, R, 'h', R, 'h', R, 's', R, R, 'h', 'h', R, 'h', R,
      'k', R, R, R, 'h', R, 'h', R, 's', R, R, 'h', 'h', R, 'h', R,
      'k', R, R, R, 'h', R, 'h', R, 's', R, R, 'h', 'h', R, 'h', R,
      'k', R, R, 'k', 'h', R, 'h', R, 's', R, 's', R, 'h', 'h', 'h', R,

      'k', R, R, R, 'h', R, 'h', R, 's', R, R, 'h', 'h', R, 'h', R,
      'k', R, R, R, 'h', R, 'h', R, 's', R, R, 'h', 'h', R, 'h', R,
      'k', R, R, R, 'h', R, 'h', R, 's', R, R, 'h', 'h', R, 'h', R,
      'k', R, R, 'k', 'h', R, 'h', R, 's', R, 's', R, 's', 's', 's', R
    ]
  };

  const CAVERN = {
    bpm: 112,
    duty: [0.25, 0.125],
    p1: [
      'A4', H, H, R, 'C5', H, R, R, 'B4', H, H, R, 'A4', H, R, R,
      'E4', H, H, R, 'G4', H, R, R, 'F4', H, H, H, R, R, R, R,
      'A4', H, H, R, 'C5', H, R, R, 'E5', H, H, R, 'D5', H, R, R,
      'C5', H, H, H, 'B4', H, H, H, 'A4', H, H, H, H, R, R, R
    ],
    p2: [
      'A3', R, R, 'E4', R, R, 'A3', R, 'C4', R, R, 'E4', R, R, 'C4', R,
      'E3', R, R, 'B3', R, R, 'E3', R, 'G3', R, R, 'B3', R, R, 'G3', R,
      'A3', R, R, 'E4', R, R, 'A3', R, 'C4', R, R, 'E4', R, R, 'C4', R,
      'E3', R, R, 'B3', R, R, 'G3', R, 'A3', R, R, 'E4', R, R, 'A3', R
    ],
    tri: [
      'A2', H, H, R, R, R, R, R, 'A2', H, R, R, 'E2', H, R, R,
      'E2', H, H, R, R, R, R, R, 'E2', H, R, R, 'B2', H, R, R,
      'F2', H, H, R, R, R, R, R, 'F2', H, R, R, 'C3', H, R, R,
      'E2', H, H, R, R, R, R, R, 'A2', H, R, R, 'A2', H, R, R
    ],
    noi: [
      'k', R, R, R, R, R, 'h', R, 'k', R, R, R, 's', R, R, R,
      'k', R, R, R, R, R, 'h', R, 'k', R, R, R, 's', R, R, R,
      'k', R, R, R, R, R, 'h', R, 'k', R, R, R, 's', R, R, R,
      'k', R, R, R, R, R, 'h', R, 'k', R, 'k', R, 's', R, 's', R
    ]
  };

  const SUNSET = {
    bpm: 150,
    duty: [0.5, 0.5],
    p1: [
      'D5', H, R, 'D5', H, R, 'F5', H, R, 'E5', H, R, 'D5', H, R, R,
      'C5', H, R, 'C5', H, R, 'E5', H, R, 'D5', H, R, 'C5', H, R, R,
      'A4', H, 'B4', H, 'C5', H, 'D5', H, 'E5', H, 'F5', H, 'G5', H, R, R,
      'F5', H, H, 'E5', H, H, 'D5', H, H, H, H, H, R, R, R, R
    ],
    p2: [
      'D4', R, 'F4', R, 'A4', R, 'F4', R, 'D4', R, 'F4', R, 'A4', R, 'F4', R,
      'C4', R, 'E4', R, 'G4', R, 'E4', R, 'C4', R, 'E4', R, 'G4', R, 'E4', R,
      'A3', R, 'C4', R, 'E4', R, 'C4', R, 'D4', R, 'F4', R, 'A4', R, 'F4', R,
      'D4', R, 'F4', R, 'A4', R, 'D5', R, 'A4', R, 'F4', R, 'D4', R, 'A3', R
    ],
    tri: [
      'D3', H, R, R, 'A2', H, R, R, 'D3', H, R, R, 'F3', H, R, R,
      'C3', H, R, R, 'G2', H, R, R, 'C3', H, R, R, 'E3', H, R, R,
      'A2', H, R, R, 'E3', H, R, R, 'D3', H, R, R, 'A2', H, R, R,
      'D3', H, R, R, 'A2', H, R, R, 'D3', H, R, R, 'D3', H, R, R
    ],
    noi: [
      'k', R, 'h', R, 's', R, 'h', R, 'k', R, 'h', R, 's', R, 'h', 'h',
      'k', R, 'h', R, 's', R, 'h', R, 'k', R, 'h', R, 's', R, 'h', 'h',
      'k', R, 'h', R, 's', R, 'h', R, 'k', R, 'h', R, 's', R, 'h', 'h',
      'k', R, 'h', R, 's', R, 'h', R, 'k', 'k', 's', 's', 's', 's', 's', R
    ]
  };

  const SONGS = { overworld: OVERWORLD, cavern: CAVERN, sunset: SUNSET };

  /* ---- sequencer -------------------------------------------------- */
  let song = null, songName = '', rowDur = 0.1, rowIdx = 0, nextTime = 0, timer = null;

  function rowsOf(s) {
    return Math.max(s.p1.length, s.p2.length, s.tri.length, s.noi.length);
  }

  /* How long a note lasts: until the next event on its own track. */
  function holdLen(track, i) {
    let n = 1;
    while (i + n < track.length && track[i + n] === '-') n++;
    return n;
  }

  function scheduleRow(i, t) {
    const d1 = song.duty[0], d2 = song.duty[1];

    const a = song.p1[i];
    if (a && a !== '-' && a !== '.') pulse(t, freq(a), holdLen(song.p1, i) * rowDur * 0.95, 0.20, d1, musicGain);

    const b = song.p2[i];
    if (b && b !== '-' && b !== '.') pulse(t, freq(b), holdLen(song.p2, i) * rowDur * 0.85, 0.09, d2, musicGain);

    const c = song.tri[i];
    if (c && c !== '-' && c !== '.') tri(t, freq(c), holdLen(song.tri, i) * rowDur * 0.95, 0.26, musicGain);

    const n = song.noi[i];
    if (n === 'k') noise(t, 0.09, 0.30, 0.35, musicGain, 0);
    else if (n === 's') noise(t, 0.11, 0.22, 1.1, musicGain, 0);
    else if (n === 'h') noise(t, 0.035, 0.09, 2.2, musicGain, 6000);
  }

  function pump() {
    if (!song || !ctx) return;
    const len = rowsOf(song);
    while (nextTime < ctx.currentTime + 0.2) {
      if (nextTime > ctx.currentTime - 0.05) scheduleRow(rowIdx % len, nextTime);
      nextTime += rowDur;
      rowIdx++;
    }
  }

  /* ================================================================
     Public API
     ================================================================ */
  const SFX = {
    jump(big) {
      const t = ctx.currentTime;
      pulse(t, big ? 240 : 300, 0.16, 0.22, 0.5, sfxGain, big ? 700 : 900);
    },
    bump() { pulse(ctx.currentTime, 180, 0.07, 0.20, 0.5, sfxGain, 110); },
    coin() {
      const t = ctx.currentTime;
      pulse(t, freq('B5'), 0.06, 0.20, 0.5, sfxGain);
      pulse(t + 0.055, freq('E6'), 0.20, 0.20, 0.5, sfxGain);
    },
    stomp() {
      const t = ctx.currentTime;
      noise(t, 0.10, 0.28, 1.6, sfxGain, 0);
      pulse(t, 420, 0.10, 0.16, 0.25, sfxGain, 120);
    },
    kick() {
      const t = ctx.currentTime;
      noise(t, 0.08, 0.26, 2.4, sfxGain, 3000);
      pulse(t, 700, 0.08, 0.14, 0.125, sfxGain, 260);
    },
    shoot() {
      const t = ctx.currentTime;
      pulse(t, 900, 0.09, 0.16, 0.125, sfxGain, 220);
    },
    brick() {
      const t = ctx.currentTime;
      noise(t, 0.16, 0.30, 1.0, sfxGain, 0);
      noise(t + 0.03, 0.14, 0.20, 1.7, sfxGain, 0);
    },
    powerup() {
      const t = ctx.currentTime;
      const seq = ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'];
      seq.forEach((n, i) => pulse(t + i * 0.045, freq(n), 0.10, 0.18, 0.5, sfxGain));
    },
    appear() {
      const t = ctx.currentTime;
      ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => pulse(t + i * 0.05, freq(n), 0.09, 0.14, 0.25, sfxGain));
    },
    oneup() {
      const t = ctx.currentTime;
      ['E5', 'G5', 'E6', 'C6', 'D6', 'G6'].forEach((n, i) =>
        pulse(t + i * 0.09, freq(n), 0.12, 0.18, 0.5, sfxGain));
    },
    shrink() {
      const t = ctx.currentTime;
      ['G5', 'E5', 'C5', 'G4'].forEach((n, i) => pulse(t + i * 0.05, freq(n), 0.10, 0.18, 0.25, sfxGain));
    },
    die() {
      const t = ctx.currentTime;
      const seq = ['B4', 'F4', 'F4', 'E4', 'D4', 'C4', 'E3', 'C3'];
      seq.forEach((n, i) => pulse(t + 0.1 + i * 0.13, freq(n), 0.16, 0.20, 0.5, sfxGain));
      noise(t, 0.20, 0.20, 0.7, sfxGain, 0);
    },
    clear() {
      const t = ctx.currentTime;
      const mel = ['C5', 'E5', 'G5', 'C6', 'G5', 'E5', 'C5', 'G4', 'C5'];
      mel.forEach((n, i) => pulse(t + i * 0.14, freq(n), 0.18, 0.20, 0.5, sfxGain));
      ['C3', 'C3', 'G2', 'C3'].forEach((n, i) => tri(t + i * 0.31, freq(n), 0.30, 0.24, sfxGain));
    },
    pause() { pulse(ctx.currentTime, 620, 0.09, 0.16, 0.25, sfxGain); },
    blip() { pulse(ctx.currentTime, 880, 0.045, 0.13, 0.25, sfxGain); },
    hurry() {
      const t = ctx.currentTime;
      ['C6', 'C6', 'C6'].forEach((n, i) => pulse(t + i * 0.12, freq(n), 0.09, 0.18, 0.5, sfxGain));
    },
    gameover() {
      const t = ctx.currentTime;
      const seq = ['C5', 'G4', 'E4', 'C4'];
      seq.forEach((n, i) => { pulse(t + i * 0.24, freq(n), 0.30, 0.20, 0.5, sfxGain); tri(t + i * 0.24, freq(n) / 2, 0.30, 0.22, sfxGain); });
    }
  };

  return {
    start() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      started = true;
    },
    get ready() { return started && !!ctx; },
    get muted() { return muted; },

    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },

    play(name) {
      if (!ensure() || !SONGS[name]) return;
      if (songName === name && timer) return;
      this.stopMusic();
      song = SONGS[name];
      songName = name;
      rowDur = 60 / song.bpm / 4;
      rowIdx = 0;
      nextTime = ctx.currentTime + 0.06;
      timer = setInterval(pump, 25);
      pump();
    },

    stopMusic() {
      if (timer) { clearInterval(timer); timer = null; }
      song = null; songName = '';
    },

    get playing() { return !!timer; },

    /* Speed the music up when the clock gets low, like the originals. */
    setTempoScale(mult) {
      if (!song) return;
      rowDur = 60 / (song.bpm * mult) / 4;
    },

    sfx(name, arg) {
      if (!ensure() || muted) return;
      if (ctx.state === 'suspended') ctx.resume();
      const f = SFX[name];
      if (f) { try { f(arg); } catch (e) { /* an SFX is never worth a crash */ } }
    }
  };
})();
