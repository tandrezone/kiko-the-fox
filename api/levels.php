<?php
declare(strict_types=1);

/**
 * GET api/levels.php            -> the whole cartridge (chunk pool + level list)
 * GET api/levels.php?id=0       -> one level plus only the chunks it uses
 * GET api/levels.php?index=1    -> same thing, alias
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');

$path = __DIR__ . '/../data/levels.json';
$raw = @file_get_contents($path);

if ($raw === false) {
    http_response_code(500);
    echo json_encode(['error' => 'levels.json is missing']);
    exit;
}

$data = json_decode($raw, true);
if (!is_array($data) || !isset($data['levels'], $data['chunks'])) {
    http_response_code(500);
    echo json_encode(['error' => 'levels.json is malformed']);
    exit;
}

unset($data['_comment']);

$id = $_GET['id'] ?? $_GET['index'] ?? null;

if ($id === null) {
    echo json_encode($data);
    exit;
}

$i = (int)$id;
if (!isset($data['levels'][$i])) {
    http_response_code(404);
    echo json_encode(['error' => 'no such level', 'count' => count($data['levels'])]);
    exit;
}

$level = $data['levels'][$i];
$used = [];
foreach ($level['chunks'] as $name) {
    if (isset($data['chunks'][$name])) {
        $used[$name] = $data['chunks'][$name];
    }
}

echo json_encode([
    'index'  => $i,
    'count'  => count($data['levels']),
    'level'  => $level,
    'chunks' => $used,
], JSON_UNESCAPED_SLASHES);
