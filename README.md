# Kiko the Fox

An NES-style side-scrolling platformer that runs in a canvas. PHP serves the
shell, the level data and the high-score board; everything else is plain
HTML, CSS and JavaScript with no build step, no dependencies and no asset
files — every sprite, tile and sound is generated at runtime.

## Running it

```
php -S localhost:8000 router.php
```

Then open <http://localhost:8000>. You'll land on the gate; click the fox
and type the password (see below) to get to the game itself. Click once
inside the game (or press any key) to let the browser start audio, and
you're in.

`router.php` is only there so the built-in server understands the clean
`/enter` URL the gate redirects to — it just hands the request to `enter.php`
and falls through to a real file or `index.php` for everything else. Running
`php -S localhost:8000` without it still works, but `/enter` would need to be
typed as `/enter.php`.

Dropping the folder into an Apache/XAMPP docroot works too — `setup-apache.sh`
writes the equivalent rewrite rule straight into the vhost, since it doesn't
rely on `.htaccess`. PHP 7.4+ is enough (password hashing via `hash_equals`
needs nothing extra).

## The gate

`index.php` is a password gate in front of the game, styled to match it but
built with plain CSS and inline SVG — no `<canvas>`. Click the fox logo to
open the password prompt.

- `config.php` holds the password and the two redirects: `redirect_success`
  (where a right guess goes — `/enter` by default) and `redirect_fail`
  (where a wrong one goes — `https://www.google.com` by default). Edit the
  values there; nothing else needs to change.
- `api/auth.php` checks the password server-side and answers with which
  redirect to use. The password itself is never sent to the browser.
- A right guess also marks the PHP session unlocked, so `enter.php` (the
  game) refuses to render and bounces back to `/` for anyone who tries to
  open it directly without going through the gate first.

## Controls

| Key | Action |
| --- | --- |
| ← → | Move |
| Z / Space | Jump (hold for height) |
| X / Shift | Run, and throw embers when powered up |
| ↓ | Duck (big Kiko only) |
| Enter | Start / confirm / pause |
| P | Pause |
| M | Mute |
| F | Toggle the 8-sprites-per-scanline flicker |
| L | Toggle CRT scanlines |

On a phone or tablet an on-screen pad appears instead.

## How the NES limits are simulated

This is the interesting part, and it is enforced rather than decorated:

- **256 × 240 framebuffer.** Everything renders into an offscreen canvas at
  the console's real resolution, then gets blitted out at an integer scale
  with nearest-neighbour sampling. Nothing is ever drawn at a fractional
  position.
- **The 64-entry system palette.** `assets/js/nes.js` holds the actual NES
  colour table. No colour reaches the screen that is not one of those
  entries — no gradients, no alpha, no blending.
- **Three colours plus transparency per object.** Every art string in
  `assets/js/chr.js` uses only the characters `.`, `1`, `2`, `3`. A palette
  is four entries, exactly like a hardware palette slot. Re-colouring a tile
  for a different level theme is a palette swap on the same pattern data,
  which is how a cartridge would have done it.
- **8 sprites per scanline.** The sprite list is evaluated in 8-pixel bands
  before drawing; anything over the limit is dropped, and which ones lose the
  coin toss rotates every frame. That is the flicker the hardware produced.
  Press **F** to turn it off and see the difference.
- **Palette animation.** The `?` blocks pulse by cycling palettes, not by
  swapping art.
- **Chunked levels.** Levels are lists of 16×15 screens drawn from a shared
  pool, rather than one enormous map — the same trick used to fit a world
  into a few kilobytes.
- **A 2A03-shaped synth.** Two pulse channels with selectable duty, a
  triangle for bass, and a noise channel driven by a 15-bit LFSR so it rasps
  the way the real one did. Music is entered as tracker rows.

## Layout

```
index.php              the gate; a password prompt in front of the game
enter.php               the game shell; injects config and script tags
config.php              gate password + the two redirect targets
router.php              clean-URL router for `php -S`, not needed on Apache
api/auth.php            checks the gate password, never the password itself
api/levels.php         serves the cartridge, or one level plus its chunks
api/scores.php         GET the board, POST a run (file-locked JSON store)
data/levels.json       chunk pool + the three level definitions
data/scores.json       created on first save
assets/css/gate.css    the gate's look — no canvas, just CSS and inline SVG
assets/css/style.css   bezel, integer scaling, scanlines, touch pad
assets/js/gate.js      opens the password prompt, calls api/auth.php
assets/js/nes.js       palette, sprite baking, framebuffer, bitmap font
assets/js/chr.js       all the pixel art
assets/js/audio.js     the synth and the songs
assets/js/input.js     keyboard + touch, with tap-safe edge detection
assets/js/level.js     chunk expansion, tile queries, background rendering
assets/js/entities.js  Kiko, enemies, items, particles, physics
assets/js/game.js      state machine and the fixed-timestep main loop
```

## The game

Kiko is a fox walking home. Three courses:

1. **1-1 Mosswood Trail** — daylight, hills, a gentle introduction.
2. **1-2 Hollow Under the Hill** — a cave with low ceilings and long drops.
3. **1-3 The Long Dusk** — the same tiles under a very different palette.

**Nutlings** are walking acorns; stomp them. **Beetles** retreat into a shell
you can kick down a lane of enemies. **Bats** cross in a sine wave. Golden
acorns make Kiko big, ember berries let him throw fire, and a leaf is an
extra life. 100 coins is also an extra life. The flagpole and the cabin end
the course, and the clock converts to points at 50 each.

## Adding a level

Add a chunk to `chunks` in `data/levels.json` — 16 characters wide, up to 15
rows, aligned to the bottom of the screen — then list it in a level's
`chunks` array. The legend is at the top of that file. No code changes are
needed; `api/levels.php` picks it up on the next reload.

Physics constants live at the top of `assets/js/entities.js` if you want to
make Kiko float more or grip harder.
