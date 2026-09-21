<?php
declare(strict_types=1);

/**
 * Kiko the Fox — gate configuration.
 *
 * `password` is checked against whatever gets typed into the gate's
 * password prompt. It never reaches the browser — only api/auth.php
 * reads this file, server-side.
 *
 * `redirect_success` / `redirect_fail` are where the gate sends the
 * browser afterwards. A path like "/enter" stays on this site; a full
 * URL (https://...) leaves it. Change either one freely.
 */

return [
    'password'         => 'kikohome',
    'redirect_success' => 'https:/chemheaven.cc',
    'redirect_fail'    => 'https://www.google.com',

    // wrong guesses allowed per browser session before each retry gets
    // an extra, growing delay — light friction, not real rate limiting
    'max_attempts'      => 5,
];
