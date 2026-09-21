<?php
declare(strict_types=1);

/**
 * Kiko the Fox — gate password check.
 *
 * POST { "password": "..." } as JSON. Always answers 200 with
 * { ok, redirect } — the gate just follows `redirect`, it never
 * has to know *why*.
 */

session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store');

$config = require __DIR__ . '/../config.php';

// Light throttle: after a few wrong guesses in this session, each
// further retry gets a growing delay. Not real rate limiting, just
// friction against a script hammering the endpoint.
$attempts = (int)($_SESSION['kiko_gate_attempts'] ?? 0);
$maxAttempts = (int)($config['max_attempts'] ?? 5);
if ($attempts > $maxAttempts) {
    usleep(min(3_000_000, ($attempts - $maxAttempts) * 400_000));
}

$raw = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
$submitted = is_array($body) ? (string)($body['password'] ?? '') : '';

$correct = $submitted !== '' && hash_equals((string)$config['password'], $submitted);

if ($correct) {
    $_SESSION['kiko_gate_attempts'] = 0;
    $_SESSION['kiko_unlocked'] = true;
    echo json_encode([
        'ok'       => true,
        'redirect' => (string)$config['redirect_success'],
    ]);
} else {
    $_SESSION['kiko_gate_attempts'] = $attempts + 1;
    echo json_encode([
        'ok'       => false,
        'redirect' => (string)$config['redirect_fail'],
    ]);
}
