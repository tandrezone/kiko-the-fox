/* ==================================================================
   input.js — a two-button controller.

   Buttons: left right up down a b start select
   plus a few host-level toggles that were never on a real pad.
   ================================================================== */

const Input = (function () {

  'use strict';

  const KEYS = ['left', 'right', 'up', 'down', 'a', 'b', 'start', 'select'];

  const held = Object.create(null);
  const edge = Object.create(null);
  const prev = Object.create(null);
  const pending = Object.create(null);   // a tap that started and ended inside one frame
  KEYS.forEach(k => { held[k] = false; edge[k] = false; prev[k] = false; pending[k] = false; });

  const MAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    KeyZ: 'a', Space: 'a', KeyK: 'a',
    KeyX: 'b', KeyJ: 'b', ShiftLeft: 'b', ShiftRight: 'b',
    Enter: 'start', NumpadEnter: 'start',
    Backspace: 'select', Tab: 'select'
  };

  const toggleHandlers = Object.create(null);
  let anyKeyHandler = null;

  function set(k, v) {
    if (!(k in held)) return;
    if (v && !held[k]) pending[k] = true;
    held[k] = v;
  }

  window.addEventListener('keydown', e => {
    if (anyKeyHandler) anyKeyHandler();
    const k = MAP[e.code];
    if (k) { if (!e.repeat) set(k, true); e.preventDefault(); return; }
    const t = toggleHandlers[e.code];
    if (t && !e.repeat) { t(); e.preventDefault(); }
  }, { passive: false });

  window.addEventListener('keyup', e => {
    const k = MAP[e.code];
    if (k) { set(k, false); e.preventDefault(); }
  }, { passive: false });

  window.addEventListener('blur', () => KEYS.forEach(k => { held[k] = false; pending[k] = false; }));

  /* ---- touch pad -------------------------------------------------- */
  function bindPad() {
    document.querySelectorAll('[data-k]').forEach(btn => {
      const k = btn.getAttribute('data-k');
      const down = e => { e.preventDefault(); if (anyKeyHandler) anyKeyHandler(); set(k, true); };
      const up = e => { e.preventDefault(); set(k, false); };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', up);
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  return {
    KEYS,
    init() { bindPad(); },
    onAnyKey(fn) { anyKeyHandler = fn; },
    onToggle(code, fn) { toggleHandlers[code] = fn; },

    held(k) { return !!held[k]; },
    pressed(k) { return !!edge[k]; },
    anyPressed() { return KEYS.some(k => edge[k]); },

    /* Call once at the top of each simulated frame. A press that began
       and ended between two frames still registers exactly once, so a
       fast tap is never swallowed. */
    latch() {
      for (const k of KEYS) {
        edge[k] = pending[k] || (held[k] && !prev[k]);
        pending[k] = false;
        prev[k] = held[k];
      }
    },
    clear() { KEYS.forEach(k => { held[k] = false; prev[k] = false; edge[k] = false; pending[k] = false; }); }
  };
})();
