/**
 * Cipher — Password Generator Backend
 * ------------------------------------
 * A single-file Node.js server exposing a REST API for generating
 * cryptographically secure random passwords.
 *
 * No external dependencies — uses only Node's built-in `http` and `crypto`
 * modules, so it runs anywhere Node is installed.
 *
 * RUN:
 *   node password-server.js
 *   (starts on http://localhost:3000 by default; set PORT env var to change)
 *
 * API:
 *   GET /api/generate
 *     Query params (all optional):
 *       length             integer, 4-128        (default 16)
 *       lower              "true" | "false"       (default true)
 *       upper              "true" | "false"       (default true)
 *       numbers            "true" | "false"       (default true)
 *       symbols            "true" | "false"       (default true)
 *       excludeAmbiguous   "true" | "false"       (default false)
 *       count              integer, 1-50          (default 1)
 *
 *     Response 200:
 *       {
 *         "passwords": ["..."],
 *         "length": 16,
 *         "poolSize": 94,
 *         "entropyBits": 105
 *       }
 *
 *     Response 400 (invalid input):
 *       { "error": "message describing what was wrong" }
 *
 *   GET /health
 *     Returns { "status": "ok" } — useful for uptime checks.
 *
 * EXAMPLE:
 *   curl "http://localhost:3000/api/generate?length=20&symbols=false&count=3"
 */

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

const CHAR_SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?/~'
};

const AMBIGUOUS_CHARS = new Set('il1LoO0');

const MIN_LENGTH = 4;
const MAX_LENGTH = 128;
const MIN_COUNT = 1;
const MAX_COUNT = 50;

/** Parses a "true"/"false" query param into a boolean, with a default. */
function parseBool(value, defaultValue) {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null; // signals invalid input
}

/** Parses an integer query param within [min, max], with a default. */
function parseIntInRange(value, defaultValue, min, max) {
  if (value === undefined) return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** Builds the character pool from the requested character sets. */
function buildPool(options) {
  let pool = '';
  if (options.lower) pool += CHAR_SETS.lower;
  if (options.upper) pool += CHAR_SETS.upper;
  if (options.numbers) pool += CHAR_SETS.numbers;
  if (options.symbols) pool += CHAR_SETS.symbols;

  if (options.excludeAmbiguous) {
    pool = pool
      .split('')
      .filter((ch) => !AMBIGUOUS_CHARS.has(ch))
      .join('');
  }

  // De-duplicate while preserving order (defensive, in case of overlaps).
  return [...new Set(pool.split(''))].join('');
}

/** Returns a cryptographically secure random index in [0, max). */
function secureRandomIndex(max) {
  return crypto.randomInt(0, max);
}

/** Generates a single password from the given character pool. */
function generatePassword(pool, length) {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += pool[secureRandomIndex(pool.length)];
  }
  return password;
}

/** Calculates Shannon entropy in bits for a password of given length/pool size. */
function calculateEntropyBits(poolSize, length) {
  if (poolSize <= 1) return 0;
  return Math.round(Math.log2(poolSize) * length);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // Permissive CORS so the companion frontend (opened as a local file,
    // or hosted elsewhere) can call this API directly.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function handleGenerate(query, res) {
  const length = parseIntInRange(query.get('length'), 16, MIN_LENGTH, MAX_LENGTH);
  if (length === null) {
    return sendJson(res, 400, { error: `length must be an integer between ${MIN_LENGTH} and ${MAX_LENGTH}` });
  }

  const count = parseIntInRange(query.get('count'), 1, MIN_COUNT, MAX_COUNT);
  if (count === null) {
    return sendJson(res, 400, { error: `count must be an integer between ${MIN_COUNT} and ${MAX_COUNT}` });
  }

  const options = {
    lower: parseBool(query.get('lower'), true),
    upper: parseBool(query.get('upper'), true),
    numbers: parseBool(query.get('numbers'), true),
    symbols: parseBool(query.get('symbols'), true),
    excludeAmbiguous: parseBool(query.get('excludeAmbiguous'), false)
  };

  for (const [key, value] of Object.entries(options)) {
    if (value === null) {
      return sendJson(res, 400, { error: `${key} must be "true" or "false"` });
    }
  }

  const pool = buildPool(options);
  if (pool.length === 0) {
    return sendJson(res, 400, { error: 'At least one character set (lower, upper, numbers, symbols) must be enabled' });
  }

  const passwords = Array.from({ length: count }, () => generatePassword(pool, length));

  sendJson(res, 200, {
    passwords,
    length,
    poolSize: pool.length,
    entropyBits: calculateEntropyBits(pool.length, length)
  });
}

const server = http.createServer((req, res) => {
  // Handle CORS preflight requests.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/api/generate') {
    return handleGenerate(url.searchParams, res);
  }

  sendJson(res, 404, { error: 'Not found. Try GET /api/generate or GET /health' });
});

server.listen(PORT, () => {
  console.log(`Cipher password generator API listening on http://localhost:${PORT}`);
  console.log(`Try: curl "http://localhost:${PORT}/api/generate?length=20"`);
});
