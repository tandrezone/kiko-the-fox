<?php
declare(strict_types=1);

/**
 * Kiko the Fox — the gate.
 *
 * A password prompt in front of the game. Clicking the logo opens a
 * little terminal; submitting it POSTs to api/auth.php, which checks
 * config.php and answers with where to go next — redirect_success
 * (normally /enter) on a right guess, redirect_fail (normally
 * somewhere else entirely) on a wrong one. This page never sees the
 * real password or decides the outcome itself.
 */

$VERSION = '1.0.1';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#0d0d10">
<title>Kiko the Fox</title>
<link rel="stylesheet" href="assets/css/gate.css?v=<?= rawurlencode($VERSION) ?>">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%230d0d10'/><rect x='5' y='4' width='6' height='7' fill='%23fca044'/><rect x='6' y='6' width='1' height='1' fill='%23000'/><rect x='9' y='6' width='1' height='1' fill='%23000'/></svg>">
</head>
<body>

<div id="gate">
  <div class="field" aria-hidden="true"></div>

  <button id="logo" type="button" aria-expanded="false" aria-controls="term">
    <svg class="mark" viewBox="0 0 100 100" aria-hidden="true">
      <polygon class="fx-head" points="14,4 6,58 50,97 94,58 86,4 50,26"/>
      <polygon class="fx-ear" points="16,10 27,40 36,30"/>
      <polygon class="fx-ear" points="84,10 73,40 64,30"/>
      <ellipse class="fx-muzzle" cx="50" cy="75" rx="22" ry="18"/>
      <circle class="fx-eye" cx="33" cy="54" r="5"/>
      <circle class="fx-eye" cx="67" cy="54" r="5"/>
      <circle class="fx-glint" cx="31.4" cy="52.4" r="1.5"/>
      <circle class="fx-glint" cx="65.4" cy="52.4" r="1.5"/>
      <polygon class="fx-nose" points="45,66 55,66 50,75"/>
    </svg>
    <span class="wordmark">KIKO<em>THE FOX</em></span>
    <span class="cue">CLICK TO ENTER</span>
  </button>

  <div id="term" class="hidden">
    <div class="termhead">// ACCESS<span class="blink">_</span></div>
    <form id="pwform" autocomplete="off">
      <label for="pw">PASSWORD</label>
      <input id="pw" name="password" type="password" autocomplete="off" spellcheck="false" inputmode="text">
      <button type="submit">GO</button>
    </form>
    <p id="msg" aria-live="polite"></p>
    <p class="hint">ESC to close</p>
  </div>
</div>

<script src="assets/js/gate.js?v=<?= rawurlencode($VERSION) ?>"></script>
</body>
</html>
