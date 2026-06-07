#!/usr/bin/env node
// Pre-seed OAuth token for task-router in ~/.claude/.credentials.json
// so Claude Code sessions auto-connect without browser auth.
//
// Uses a lock file to prevent concurrent writes when multiple sessions
// start simultaneously (e.g., "all agents" VS Code task).

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const PORT = process.env.TASK_ROUTER_PORT || '3100';
const SERVER_URL = `http://127.0.0.1:${PORT}/mcp`;
const SERVER_NAME = 'task-router';
const CREDS_FILE = join(process.env.HOME || process.env.USERPROFILE, '.claude', '.credentials.json');
const LOCK_FILE = CREDS_FILE + '.seed-lock';

if (!existsSync(CREDS_FILE)) {
  process.exit(0);
}

// Acquire lock (spin up to 3 seconds)
function acquireLock() {
  for (let i = 0; i < 30; i++) {
    try {
      writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      // Lock exists — wait 100ms and retry
      const start = Date.now();
      while (Date.now() - start < 100) { /* spin */ }
    }
  }
  return false;
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

// Clean up stale lock (older than 10 seconds)
try {
  const { mtimeMs } = await import('node:fs').then(fs => fs.statSync(LOCK_FILE));
  if (Date.now() - mtimeMs > 10000) unlinkSync(LOCK_FILE);
} catch {}

if (!acquireLock()) {
  process.exit(0); // Another process is seeding — skip
}

try {
  let creds;
  try {
    creds = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
  } catch {
    releaseLock();
    process.exit(0);
  }

  // Check if task-router token already exists
  if (creds.mcpOAuth) {
    for (const entry of Object.values(creds.mcpOAuth)) {
      if (entry.serverUrl === SERVER_URL || entry.serverName === SERVER_NAME) {
        releaseLock();
        process.exit(0); // Already seeded
      }
    }
  } else {
    creds.mcpOAuth = {};
  }

  // Add token entry
  const keySuffix = randomBytes(8).toString('hex');
  const key = `${SERVER_NAME}|${keySuffix}`;
  creds.mcpOAuth[key] = {
    serverName: SERVER_NAME,
    serverUrl: SERVER_URL,
    accessToken: 'task-router-no-auth',
    expiresAt: Date.now() + 999999999 * 1000,
    discoveryState: {
      authorizationServerUrl: `http://127.0.0.1:${PORT}/`,
    },
    clientId: 'task-router-local',
    scope: '',
  };

  // Atomic write: write to temp file, then rename
  const tmpFile = CREDS_FILE + '.tmp.' + process.pid;
  writeFileSync(tmpFile, JSON.stringify(creds, null, 2), 'utf8');
  renameSync(tmpFile, CREDS_FILE);
  console.log(`[task-router] OAuth token seeded in ${CREDS_FILE}`);
} finally {
  releaseLock();
}
