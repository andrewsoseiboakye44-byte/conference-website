<?php
// ============================================================
// Local / Apache PHP Proxy: send-sms.php
// Enables seamless server-side SMS dispatching when running
// locally on XAMPP (http://localhost/conference-website).
// Completely eliminates browser CORS restrictions.
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

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true);
if (!$body) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body']);
    exit;
}

$phone = $body['phone'] ?? '';
$message = $body['message'] ?? '';
$gateway = $body['gateway'] ?? null;
$action = $body['action'] ?? 'send';
$campaignType = $body['campaign_type'] ?? 'manual_send';

if (!$phone) {
    http_response_code(400);
    echo json_encode(['error' => 'Phone number is required.']);
    exit;
}

if (!$gateway || empty($gateway['api_key'])) {
    http_response_code(400);
    echo json_encode(['error' => 'No SMS gateway credentials provided. Please save your API key.']);
    exit;
}

function normalizePhone($raw) {
    $trimmed = trim((string)$raw);
    $digits = preg_replace('/\D/', '', $trimmed);
    if (strpos($trimmed, '+') === 0) {
        return $digits;
    }
    if (strpos($digits, '00') === 0) {
        return substr($digits, 2);
    }
    if (strpos($digits, '0') === 0) {
        return '233' . substr($digits, 1);
    }
    if (strpos($digits, '233') !== 0 && strlen($digits) <= 10) {
        return '233' . $digits;
    }
    return $digits;
}

$provider = strtolower(trim($gateway['provider'] ?? 'custom'));
$apiKey = trim($gateway['api_key'] ?? '');
$apiSecret = trim($gateway['api_secret'] ?? '');
$senderId = trim($gateway['sender_id'] ?? 'CONFERENCE');
$normPhone = normalizePhone($phone);

if ($action === 'test' && empty($message)) {
    $message = "Test SMS from {$senderId}! Your SMS gateway is active and working.";
}

$ok = false;
$error = null;
$responseData = null;

if ($provider === 'arkesel') {
    $url = 'https://sms.arkesel.com/api/v2/sms/send';
    $payload = json_encode([
        'sender' => $senderId,
        'message' => $message,
        'recipients' => [$normPhone]
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'api-key: ' . $apiKey,
        'Content-Type: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $json = json_decode($response, true);
    if ($httpCode >= 200 && $httpCode < 300 && isset($json['status']) && $json['status'] !== 'error') {
        $ok = true;
        $responseData = $json;
    } else {
        $error = $json['message'] ?? $response ?? "Arkesel error (HTTP $httpCode)";
    }
} elseif ($provider === 'mnotify') {
    $url = 'https://api.mnotify.com/api/sms/quick';
    $payload = json_encode([
        'recipient' => [$normPhone],
        'sender' => $senderId,
        'message' => $message,
        'is_schedule' => false
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'key: ' . $apiKey,
        'Content-Type: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $json = json_decode($response, true);
    if ($httpCode >= 200 && $httpCode < 300 && isset($json['status']) && $json['status'] !== 'error') {
        $ok = true;
        $responseData = $json;
    } else {
        $error = $json['message'] ?? $response ?? "mNotify error (HTTP $httpCode)";
    }
} elseif ($provider === 'hubtel') {
    $auth = base64_encode("{$apiKey}:{$apiSecret}");
    $params = http_build_query([
        'From' => $senderId,
        'To' => $normPhone,
        'Content' => $message,
        'ClientId' => $apiKey,
        'ClientSecret' => $apiSecret
    ]);
    $url = "https://smsc.hubtel.com/v1/messages/send?{$params}";

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Basic {$auth}"]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 300) {
        $ok = true;
        $responseData = json_decode($response, true) ?: $response;
    } else {
        $json = json_decode($response, true);
        $error = $json['message'] ?? $response ?? "Hubtel error (HTTP $httpCode)";
    }
} elseif ($provider === 'africastalking') {
    $url = 'https://api.africastalking.com/version1/messaging';
    $postData = http_build_query([
        'username' => $apiSecret ?: 'sandbox',
        'to' => '+' . $normPhone,
        'message' => $message,
        'from' => $senderId
    ]);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'apiKey: ' . $apiKey,
        'Content-Type: application/x-www-form-urlencoded',
        'Accept: application/json'
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $json = json_decode($response, true);
    $recip = $json['SMSMessageData']['Recipients'][0] ?? null;
    if ($httpCode >= 200 && $httpCode < 300 && isset($recip['status']) && $recip['status'] === 'Success') {
        $ok = true;
        $responseData = $json;
    } else {
        $error = $recip['status'] ?? $json['SMSMessageData']['Message'] ?? "Africa's Talking error (HTTP $httpCode)";
    }
} else {
    // Custom URL gateway
    $endpoint = $gateway['endpoint_url'] ?? 'https://api.smsghana.com/v1/sms/send';
    $finalUrl = str_replace(
        ['{API_KEY}', '{SENDER_ID}', '{TO}', '{MESSAGE}'],
        [urlencode($apiKey), urlencode($senderId), urlencode($normPhone), urlencode($message)],
        $endpoint
    );
    if (strpos($finalUrl, urlencode($normPhone)) === false) {
        $sep = strpos($finalUrl, '?') !== false ? '&' : '?';
        $finalUrl .= "{$sep}key=" . urlencode($apiKey) . "&sender=" . urlencode($senderId) . "&to=" . urlencode($normPhone) . "&message=" . urlencode($message);
    }

    $ch = curl_init($finalUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 300) {
        $ok = true;
        $responseData = $response;
    } else {
        $error = "Custom Gateway error (HTTP $httpCode): $response";
    }
}

if (!$ok) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'error' => $error, 'provider' => $provider]);
} else {
    echo json_encode(['ok' => true, 'status' => 'sent', 'provider' => $provider, 'response' => $responseData]);
}
