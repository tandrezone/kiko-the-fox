<?php
declare(strict_types=1);

/**
 * Kiko the Fox — the secret den.
 *
 * The game (index.php) is public. This page is not linked from it
 * anywhere — the only way in is the password rivet on the cabinet
 * bezel. A browser only lands here after api/auth.php has accepted
 * the password and marked the session unlocked; anyone else gets
 * bounced back to the game.
 */

session_start();
if (empty($_SESSION['kiko_unlocked'])) {
    header('Location: /');
    exit;
}

$VERSION = '1.0.0';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#0d0d10">
<title>Kiko the Fox — Den</title>
<link rel="stylesheet" href="assets/css/secret.css?v=<?= rawurlencode($VERSION) ?>">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%230d0d10'/><rect x='5' y='4' width='6' height='7' fill='%23fca044'/><rect x='6' y='6' width='1' height='1' fill='%23000'/><rect x='9' y='6' width='1' height='1' fill='%23000'/></svg>">
</head>
<body>

<main id="den">
  <svg class="mark" viewBox="0 0 100 100" aria-hidden="true">
    <polygon class="fx-head" points="14,4 6,58 50,97 94,58 86,4 50,26"/>
    <polygon class="fx-ear" points="16,10 27,40 36,30"/>
    <polygon class="fx-ear" points="84,10 73,40 64,30"/>
    <ellipse class="fx-muzzle" cx="50" cy="75" rx="22" ry="18"/>
    <circle class="fx-eye" cx="33" cy="54" r="5"/>
    <circle class="fx-eye" cx="67" cy="54" r="5"/>
    <polygon class="fx-nose" points="45,66 55,66 50,75"/>
  </svg>

  <h1>You found the den.</h1>

  <p>
    Nobody links here. There's no menu item, no trail of breadcrumbs —
    just a tiny rivet on the cabinet bezel and whatever password you
    just typed.
  </p>

  <p class="note">
    This page is a stand-in — swap in whatever the secret is actually
    supposed to be: a devlog, an unlisted build, concept art, a thank
    you note to whoever finds it. Its content lives entirely in
    <code>enter.php</code>.
  </p>

  <a class="back" href="/">&larr; back to the game</a>
</main>

</body>
</html>
