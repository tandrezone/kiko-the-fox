<?php
declare(strict_types=1);

/**
 * GET  api/scores.php                    -> {"scores":[{name,score,level,date}, ...]}
 * POST api/scores.php  (JSON or form)    -> stores one run, returns the new board
 *
 * Storage is a flat JSON file guarded by an exclusive lock, which is
 * plenty for a high-score board on a local server.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');

const MAX_ENTRIES = 10;

$dir  = __DIR__ . '/../data';
$file = $dir . '/scores.json';

function board(string $file): array
{
    if (!is_file($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return [];
    }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function seeded(): array
{
    return [
        ['name' => 'FOX', 'score' => 12000, 'level' => '1-3', 'date' => '2026-01-01'],
        ['name' => 'KIT', 'score' => 9000,  'level' => '1-2', 'date' => '2026-01-01'],
        ['name' => 'DEN', 'score' => 7000,  'level' => '1-2', 'date' => '2026-01-01'],
        ['name' => 'PAW', 'score' => 5000,  'level' => '1-1', 'date' => '2026-01-01'],
        ['name' => 'NUT', 'score' => 3000,  'level' => '1-1', 'date' => '2026-01-01'],
    ];
}

function sortBoard(array $b): array
{
    usort($b, static fn(array $a, array $c): int => $c['score'] <=> $a['score']);
    return array_slice($b, 0, MAX_ENTRIES);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $b = board($file);
    if (!$b) {
        $b = seeded();
    }
    echo json_encode(['scores' => sortBoard($b)]);
    exit;
}

if ($method !== 'POST') {
    http_response_code(405);
    header('Allow: GET, POST');
    echo json_encode(['error' => 'method not allowed']);
    exit;
}

$body = file_get_contents('php://input');
$in = json_decode((string)$body, true);
if (!is_array($in)) {
    $in = $_POST;
}

$name = strtoupper(trim((string)($in['name'] ?? 'AAA')));
$name = preg_replace('/[^A-Z0-9 ]/', '', $name) ?? '';
$name = substr($name === '' ? 'AAA' : $name, 0, 6);

$score = (int)($in['score'] ?? 0);
if ($score < 0)        { $score = 0; }
if ($score > 99999999) { $score = 99999999; }

$level = preg_replace('/[^0-9A-Za-z\-]/', '', (string)($in['level'] ?? '1-1')) ?? '1-1';
$level = substr($level, 0, 8);

if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
}

$fp = @fopen($file, 'c+');
if ($fp === false) {
    http_response_code(500);
    echo json_encode(['error' => 'score board is not writable', 'scores' => sortBoard(board($file) ?: seeded())]);
    exit;
}

flock($fp, LOCK_EX);
$raw = stream_get_contents($fp);
$b = json_decode((string)$raw, true);
if (!is_array($b) || !$b) {
    $b = seeded();
}

$b[] = [
    'name'  => $name,
    'score' => $score,
    'level' => $level,
    'date'  => date('Y-m-d'),
];
$b = sortBoard($b);

rewind($fp);
ftruncate($fp, 0);
fwrite($fp, json_encode($b, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

$rank = 0;
foreach ($b as $i => $row) {
    if ($row['name'] === $name && $row['score'] === $score) { $rank = $i + 1; break; }
}

echo json_encode(['scores' => $b, 'rank' => $rank]);
