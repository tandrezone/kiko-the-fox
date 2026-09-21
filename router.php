<?php
declare(strict_types=1);

/**
 * Clean-URL router for local dev:  php -S localhost:8000 router.php
 *
 * Maps /enter to enter.php so the gate's redirect works the same way
 * here as it will under the Apache vhost. Everything else falls
 * through to a real file, or to index.php (the gate) for anything
 * else unrecognised.
 */

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if ($path === '/enter' || $path === '/enter/') {
    require __DIR__ . '/enter.php';
    return true;
}

$file = __DIR__ . $path;
if ($path !== '/' && file_exists($file) && !is_dir($file)) {
    return false; // let the built-in server serve it as-is
}

require __DIR__ . '/index.php';
