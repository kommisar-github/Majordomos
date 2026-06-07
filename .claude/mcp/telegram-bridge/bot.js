/**
 * Telegram PM Bridge — bot.js
 *
 * Bridges Telegram messages to the PM agent via the task-router REST API.
 * The PM terminal stays running; this bot is a secondary I/O channel.
 *
 * Flow (Telegram -> PM):
 *   User sends Telegram msg -> bot dispatches task to PM -> watchdog injects
 *   -> PM processes -> PM dispatches response to "telegram" agent -> bot sends to user
 *
 * Flow (PM -> Telegram, proactive):
 *   PM dispatches task to "telegram" agent -> bot picks up -> sends to user
 */

import TelegramBot from 'node-telegram-bot-api';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

// v0.6.2: keep-alive agent so /api/inbox polling (every 5s by default) reuses
// one TCP connection instead of accumulating Windows TIME_WAIT sockets.
const httpAgent = new HttpAgent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 4 });
const httpsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 4 });

function kaFetch(url, init = {}) {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? httpsRequest : httpRequest;
  const agent = isHttps ? httpsAgent : httpAgent;
  return new Promise((resolve, reject) => {
    const req = lib({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: init.method || 'GET',
      headers: init.headers,
      agent,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const status = res.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          headers: res.headers,
          json: async () => JSON.parse(buf.toString('utf8')),
          text: async () => buf.toString('utf8'),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (init.body !== undefined) { req.write(init.body); }
    req.end();
  });
}

// --- Config ---

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '.env');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found — rely on environment variables
  }
}

loadEnv();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER = parseInt(process.env.TELEGRAM_ALLOWED_USER, 10);
const ROUTER_URL = process.env.TASK_ROUTER_URL || 'http://127.0.0.1:3100';
const ROUTER_API_KEY = process.env.TASK_ROUTER_API_KEY || '';
const PROJECT = process.env.TASK_ROUTER_PROJECT || 'my-app';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000;
const KEEPALIVE_INTERVAL = parseInt(process.env.KEEPALIVE_INTERVAL_MS, 10) || 60000;

if (!BOT_TOKEN) {
  console.error('[telegram-bridge] TELEGRAM_BOT_TOKEN not set. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (!ALLOWED_USER || isNaN(ALLOWED_USER)) {
  console.error('[telegram-bridge] TELEGRAM_ALLOWED_USER not set or invalid.');
  process.exit(1);
}

// --- State ---

let chatId = null; // Set on first message from allowed user
let registered = false;
let shuttingDown = false;

// v0.4.6: bridge token-claim lease state
const TOKEN_HASH = createHash('sha256').update(BOT_TOKEN).digest('hex');
const CLAIM_HEARTBEAT_MS = 30_000;
let leaseId = null;
let claimHeartbeatTimer = null;

// --- HTTP helpers ---

async function api(method, path, body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (ROUTER_API_KEY) {
    opts.headers['X-Task-Router-Key'] = ROUTER_API_KEY;
  }
  const res = await kaFetch(`${ROUTER_URL}${path}`, opts);
  return res.json();
}

async function register() {
  try {
    await api('POST', '/api/register', {
      name: 'telegram',
      capabilities: ['remote-user', 'notifications'],
      project: PROJECT,
    });
    registered = true;
    console.log(`[telegram-bridge] Registered as "telegram" in project "${PROJECT}"`);
  } catch (err) {
    console.error(`[telegram-bridge] Failed to register: ${err.message}`);
    registered = false;
  }
}

async function unregister() {
  try {
    await api('POST', '/api/unregister', { name: 'telegram', project: PROJECT });
    console.log('[telegram-bridge] Unregistered from task-router');
  } catch {
    // Best effort on shutdown
  }
}

// --- Bridge claim (v0.4.6): single-poller-per-token ---

async function claimBridge() {
  try {
    const res = await kaFetch(`${ROUTER_URL}/bridge/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tokenHash: TOKEN_HASH,
        project: PROJECT,
        pid: process.pid,
        host: hostname(),
      }),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      const h = body.holder || {};
      console.error('[telegram-bridge] Token already claimed by another bridge — exiting cleanly to prevent duplicate-poller bombardment.');
      console.error(`[telegram-bridge]   holder: project=${h.project} pid=${h.pid} host=${h.host} claimedAt=${h.claimedAt ? new Date(h.claimedAt).toISOString() : '?'}`);
      process.exit(0);
    }
    if (!res.ok) {
      // Pre-v0.4.6 server, or server not yet up — soft-fail, behave like old bridge.
      console.warn(`[telegram-bridge] /bridge/claim returned HTTP ${res.status} — proceeding without lease (duplicate-detection disabled).`);
      return;
    }
    const body = await res.json();
    leaseId = body.leaseId;
    console.log(`[telegram-bridge] Bridge claim acquired (lease ${leaseId.slice(0, 8)}..., ttl ${body.ttlSeconds}s)`);
    claimHeartbeatTimer = setInterval(heartbeatClaim, CLAIM_HEARTBEAT_MS);
  } catch (err) {
    // Server unreachable — soft-fail. The bridge still tries to register
    // through /api later; if the server comes up we'll just be running without
    // a lease until next restart.
    console.warn(`[telegram-bridge] Bridge claim failed (server unreachable: ${err.message}) — proceeding without lease.`);
  }
}

async function heartbeatClaim() {
  if (!leaseId) return;
  try {
    const res = await kaFetch(`${ROUTER_URL}/bridge/claim/${leaseId}`, { method: 'PUT' });
    if (res.status === 404) {
      // Lease expired (we missed too many heartbeats, or server restarted).
      // Try to re-claim. If another bridge took it, we'll exit on 409.
      console.warn('[telegram-bridge] Lease not found on server — re-claiming...');
      leaseId = null;
      if (claimHeartbeatTimer) { clearInterval(claimHeartbeatTimer); claimHeartbeatTimer = null; }
      await claimBridge();
    }
  } catch {
    // Transient — retry next heartbeat
  }
}

async function releaseClaim() {
  if (!leaseId) return;
  try {
    await kaFetch(`${ROUTER_URL}/bridge/claim/${leaseId}`, { method: 'DELETE' });
  } catch { /* best effort on shutdown */ }
}

// --- Telegram bot ---

let bot = null; // Constructed after bridge claim succeeds (v0.4.6) so we never start polling before duplicate-detection.

async function handleMessage(msg) {
  // Only accept messages from the allowed user
  if (msg.from.id !== ALLOWED_USER) {
    console.log(`[telegram-bridge] Ignored message from user ${msg.from.id}`);
    return;
  }

  // Remember chat ID for sending responses
  chatId = msg.chat.id;

  // Skip non-text messages
  if (!msg.text) return;

  // Handle /start command
  if (msg.text === '/start') {
    await bot.sendMessage(chatId, 'PM Bridge connected. Send any message to interact with PM.');
    return;
  }

  // Handle /status command — quick health check
  if (msg.text === '/status') {
    try {
      const health = await api('GET', `/health?project=${encodeURIComponent(PROJECT)}`);
      await bot.sendMessage(chatId,
        `*Task Router*\nAgents: ${health.agents_online}\nTasks: ${health.tasks?.pending || 0} pending, ${health.tasks?.active || 0} active`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await bot.sendMessage(chatId, `Task router unreachable: ${err.message}`);
    }
    return;
  }

  // Dispatch message to PM
  if (!registered) {
    await bot.sendMessage(chatId, 'Not connected to task-router. Retrying...');
    await register();
    if (!registered) {
      await bot.sendMessage(chatId, 'Task router unavailable. Is it running?');
      return;
    }
  }

  try {
    const result = await api('POST', '/api/dispatch', {
      to: 'pm',
      from: 'telegram',
      payload: msg.text,
      project: PROJECT,
    });

    if (result.error) {
      await bot.sendMessage(chatId, `Could not reach PM: ${result.error}`);
      return;
    }

    console.log(`[telegram-bridge] Dispatched to PM: task ${result.task_id}`);
  } catch (err) {
    await bot.sendMessage(chatId, `Dispatch failed: ${err.message}`);
  }
}

function handlePollingError(err) {
  if (!shuttingDown) {
    console.error(`[telegram-bridge] Polling error: ${err.message}`);
  }
}

// --- Response poller (PM -> Telegram) ---

async function pollResponses() {
  if (!chatId || !registered) return;

  try {
    const data = await api('GET', `/api/inbox/telegram?project=${encodeURIComponent(PROJECT)}`);

    // Handle pending tasks dispatched TO telegram (PM responses and notifications)
    for (const task of (data.tasks || [])) {
      // Accept the task
      await api('POST', `/api/accept/${task.task_id}?project=${encodeURIComponent(PROJECT)}`);

      // Send to Telegram (split if needed)
      const text = task.payload || '(empty response)';
      const chunks = splitMessage(text, 4096);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(async () => {
          // Retry without Markdown if formatting fails
          await bot.sendMessage(chatId, chunk);
        });
      }

      // Mark complete
      await api('POST', `/api/complete/${task.task_id}?project=${encodeURIComponent(PROJECT)}`, { result: 'delivered to telegram' });
      console.log(`[telegram-bridge] Delivered response: ${task.task_id}`);
    }

    // Handle undelivered results (tasks telegram dispatched to PM, now completed)
    for (const result of (data.results || [])) {
      const text = result.payload || '(empty result)';
      const chunks = splitMessage(text, 4096);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(async () => {
          await bot.sendMessage(chatId, chunk);
        });
      }
      // Mark as delivered
      await api('POST', '/api/deliver', { task_ids: [result.task_id], project: PROJECT });
      console.log(`[telegram-bridge] Delivered result: ${result.task_id}`);
    }
  } catch (err) {
    // Transient errors are OK — will retry on next poll
    if (!shuttingDown) {
      console.error(`[telegram-bridge] Poll error: ${err.message}`);
    }
  }
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.5) splitIdx = maxLen; // No good newline — hard split
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, '');
  }
  return chunks;
}

// --- Lifecycle ---

let pollTimer = null;
let keepaliveTimer = null;

async function startup() {
  console.log('[telegram-bridge] Starting...');
  console.log(`[telegram-bridge] Router: ${ROUTER_URL}, Project: ${PROJECT}`);
  console.log(`[telegram-bridge] Allowed user: ${ALLOWED_USER}`);
  console.log(`[telegram-bridge] Token hash: ${TOKEN_HASH.slice(0, 8)}...`);

  // v0.4.6: claim the bot token BEFORE starting Telegram polling. If another
  // bridge already holds the claim, we exit cleanly inside claimBridge() — never
  // open a second long-poll on the same bot (which would steal each other's
  // updates and bombard the user with duplicates).
  await claimBridge();

  // Now safe to construct the bot and start polling.
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot.on('message', handleMessage);
  bot.on('polling_error', handlePollingError);

  await register();

  // Start polling for PM responses
  pollTimer = setInterval(pollResponses, POLL_INTERVAL);

  // Keepalive: re-register periodically to prevent TTL expiry
  keepaliveTimer = setInterval(register, KEEPALIVE_INTERVAL);

  console.log('[telegram-bridge] Ready. Waiting for Telegram messages...');
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[telegram-bridge] Shutting down...');

  if (pollTimer) clearInterval(pollTimer);
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  if (claimHeartbeatTimer) clearInterval(claimHeartbeatTimer);

  await releaseClaim();
  await unregister();
  if (bot) bot.stopPolling();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start ---
startup();
