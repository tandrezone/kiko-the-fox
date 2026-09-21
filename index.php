<?php
declare(strict_types=1);

/**
 * Kiko the Fox — an NES-style canvas platformer.
 * PHP serves the shell, the level data and the high-score board.
 *
 * Run with:  php -S localhost:8000 router.php
 *
 * There's a tiny easter egg riveted to the corner of the cabinet
 * bezel below — click it. See assets/js/egg.js, api/auth.php and
 * config.php.
 */

$VERSION = '1.0.0';

$JS = [
    'nes.js',      // palette, framebuffer, sprite baking, bitmap font
    'chr.js',      // hand-authored pixel art ("CHR-ROM")
    'audio.js',    // APU-style chiptune synth
    'input.js',    // keyboard + touch
    'level.js',    // chunk expansion, tilemap, collision queries
    'entities.js', // player, enemies, items, particles
    'game.js',     // state machine + main loop
];

$levelCount = 0;
$raw = @file_get_contents(__DIR__ . '/data/levels.json');
if ($raw !== false) {
    $data = json_decode($raw, true);
    if (is_array($data) && isset($data['levels'])) {
        $levelCount = count($data['levels']);
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#0d0d10">
<title>Kiko the Fox</title>
<link rel="stylesheet" href="assets/css/style.css?v=<?= rawurlencode($VERSION) ?>">
<link rel="stylesheet" href="assets/css/egg.css?v=<?= rawurlencode($VERSION) ?>">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%230d0d10'/><rect x='5' y='4' width='6' height='7' fill='%23fca044'/><rect x='6' y='6' width='1' height='1' fill='%23000'/><rect x='9' y='6' width='1' height='1' fill='%23000'/></svg>">
</head>
<body>

<div id="cab">
  <div id="bezel">
    <canvas id="screen" width="256" height="240"></canvas>
    <div id="scanlines" aria-hidden="true"></div>
    <div id="boot">CLICK OR PRESS ANY KEY</div>

    <!-- the easter egg: a tiny fox rivet on the cabinet frame -->
    <button id="egg" type="button" aria-label="???" aria-haspopup="dialog" aria-expanded="false" aria-controls="term">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon class="fx-head" points="14,4 6,58 50,97 94,58 86,4 50,26"/>
        <polygon class="fx-ear" points="16,10 27,40 36,30"/>
        <polygon class="fx-ear" points="84,10 73,40 64,30"/>
        <ellipse class="fx-muzzle" cx="50" cy="75" rx="22" ry="18"/>
        <circle class="fx-eye" cx="33" cy="54" r="5"/>
        <circle class="fx-eye" cx="67" cy="54" r="5"/>
        <polygon class="fx-nose" points="45,66 55,66 50,75"/>
      </svg>
    </button>
  </div>

  <div id="pad" aria-hidden="true">
    <div class="dpad">
      <button class="k" data-k="left">&#9664;</button>
      <button class="k" data-k="down">&#9660;</button>
      <button class="k" data-k="right">&#9654;</button>
    </div>
    <div class="ab">
      <button class="k round" data-k="b">B</button>
      <button class="k round" data-k="a">A</button>
    </div>
    <div class="se">
      <button class="k wide" data-k="select">SELECT</button>
      <button class="k wide" data-k="start">START</button>
    </div>
  </div>

  <p id="legend">
    <b>&#8592; &#8594;</b> move &nbsp;&middot;&nbsp; <b>Z</b> / <b>Space</b> jump &nbsp;&middot;&nbsp;
    <b>X</b> run &amp; throw &nbsp;&middot;&nbsp; <b>&#8595;</b> duck &nbsp;&middot;&nbsp;
    <b>Enter</b> start &nbsp;&middot;&nbsp; <b>P</b> pause &nbsp;&middot;&nbsp;
    <b>M</b> mute &nbsp;&middot;&nbsp; <b>F</b> sprite flicker &nbsp;&middot;&nbsp; <b>L</b> scanlines
  </p>
</div>

<!-- the egg's password prompt, hidden until #egg is clicked -->
<div id="eggBackdrop" class="hidden"></div>
<div id="term" class="hidden" role="dialog" aria-modal="true" aria-label="Secret access">
  <div class="termhead">// ACCESS<span class="blink">_</span></div>
  <form id="pwform" autocomplete="off">
    <label for="pw">PASSWORD</label>
    <input id="pw" name="password" type="password" autocomplete="off" spellcheck="false" inputmode="text">
    <button type="submit">GO</button>
  </form>
  <p id="msg" aria-live="polite"></p>
  <p class="hint">ESC to close</p>
</div>

<script>
window.KIKO_CONFIG = {
  version: <?= json_encode($VERSION) ?>,
  levelCount: <?= (int)$levelCount ?>,
  api: {
    levels: 'api/levels.php',
    scores: 'api/scores.php'
  }
};
</script>
<?php foreach ($JS as $f): ?>
<script src="assets/js/<?= rawurlencode($f) ?>?v=<?= rawurlencode($VERSION) ?>"></script>
<?php endforeach; ?>
<script>Game.boot(document.getElementById('screen'));</script>
<script src="assets/js/egg.js?v=<?= rawurlencode($VERSION) ?>"></script>
</body>
</html>
