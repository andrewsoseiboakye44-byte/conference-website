<?php
// ============================================================
// Local / Apache PHP Proxy: create-usher.php
// Enables server-side usher creation when running locally or on cPanel.
// ============================================================

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$username = strtolower(trim($body['username'] ?? ''));
$password = $body['password'] ?? '';

if (empty($username) || empty($password) || strlen($password) < 6) {
    http_response_code(400);
    echo json_encode(['error' => 'Username and minimum 6-character password are required.']);
    exit;
}

$cleanUsername = preg_replace('/[^a-z0-9_.-]/', '', $username);
$email = "{$cleanUsername}@usher.local";
$supabaseUrl = 'https://rhdqrocagrkogbztwpmg.supabase.co';
$anonKey = 'sb_publishable_rmQ97GXrUaGcsGIIFrdUeg_zj_5gfeI';

// Call Supabase auth signup
$ch = curl_init("{$supabaseUrl}/auth/v1/signup");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'email' => $email,
    'password' => $password,
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    "apikey: {$anonKey}"
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$json = json_decode($response, true);
if ($httpCode >= 200 && $httpCode < 300) {
    echo json_encode(['ok' => true, 'user' => $json]);
} else {
    http_response_code($httpCode ?: 400);
    echo json_encode(['error' => $json['msg'] ?? $json['error_description'] ?? 'Registration failed', 'details' => $json]);
}
