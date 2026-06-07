# Telegram PM Bridge — Setup Instructions

## Step 1: Create the Telegram Bot

1. Open Telegram on your phone
2. Search for **@BotFather** and start a chat
3. Send `/newbot`
4. Choose a name (e.g., `Task Router PM`)
5. Choose a username (must end in `bot`, e.g., `task_router_pm_bot`)
6. BotFather replies with a **token** like `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ` — copy it

## Step 2: Get Your Telegram User ID

1. Search for **@userinfobot** on Telegram and start a chat
2. Send `/start`
3. It replies with your **user ID** (a number like `123456789`) — copy it

## Step 3: Configure the Bridge

From your **workspace root** (the folder that contains `.claude/`):

```powershell
cd .claude/mcp/telegram-bridge
cp .env.example .env
```

(On Windows PowerShell you may use `Copy-Item .env.example .env`.)

Edit `.env` — replace the two placeholder values:

```
TELEGRAM_BOT_TOKEN=<paste token from BotFather>
TELEGRAM_ALLOWED_USER=<paste your user ID>
TASK_ROUTER_URL=http://127.0.0.1:3100
TASK_ROUTER_PROJECT=my-app
POLL_INTERVAL_MS=5000
KEEPALIVE_INTERVAL_MS=60000
```

Use the same project id as your workspace folder name (`TASK_ROUTER_PROJECT` must match task-router registration).

## Step 4: Install Dependencies

```powershell
cd .claude/mcp/telegram-bridge
npm install
```

## Step 5: Start the Task-Router (if not already running)

The task-router must be running first. It auto-starts via Claude Code's SessionStart hook, but to start manually:

```bash
bash .claude/mcp/task-router/start.sh
```

Verify it's running:

```bash
curl http://127.0.0.1:3100/health
```

## Step 6: Start the Telegram Bot

**Option A — Manual (for first test):**

```powershell
cd .claude/mcp/telegram-bridge
node bot.js
```

You should see:

```
[telegram-bridge] Starting...
[telegram-bridge] Router: http://127.0.0.1:3100, Project: my-app
[telegram-bridge] Allowed user: <your ID>
[telegram-bridge] Registered as "telegram" in project "my-app"
[telegram-bridge] Ready. Waiting for Telegram messages...
```

**Option B — Automatic (after first test works):**

The bot auto-starts with `start.sh` if `.env` exists. Next time any Claude Code session starts (triggering the SessionStart hook), both task-router and telegram-bridge launch together.

## Step 7: Start the PM Terminal

Launch PM via VS Code task or command:

```
Ctrl+Shift+P -> "Tasks: Run Task" -> pm
```

Or via command line:

```bash
# macOS/Linux:
TASK_ROUTER_AGENT=pm TASK_ROUTER_PROJECT=my-project claude --agent pm_agent "pm"

# Windows (legacy launcher):
# claude_start.bat pm
```

PM must be running and registered with the task-router for Telegram messages to be processed.

## Step 8: Test End-to-End

1. Open your bot chat on Telegram (search for the username you chose in Step 1)
2. Send `/start` — bot should reply: `PM Bridge connected. Send any message to interact with PM.`
3. Send `/status` — bot should reply with task-router health info (agents online, task counts)
4. Send a PM message, e.g.: `wave status` or `what are the next steps?`
5. Wait 10-20s — the message flows through:
   - Bot -> task-router -> watchdog injects into PM terminal -> PM processes -> PM dispatches response -> bot -> Telegram
6. You should see the PM response appear in Telegram AND in the PM terminal

## Step 9: Latency Tuning (Optional)

The watchdog polls every 10s by default. If you need faster response, reduce further:

```json
"taskRouter.watchdogInterval": 5000
```

## Troubleshooting

| Problem | Check |
|---------|-------|
| Bot doesn't start | Verify `.env` has correct token. Run `node bot.js` manually to see errors |
| `/status` fails | Task-router not running. Run `curl http://127.0.0.1:3100/health` |
| Message sent but no response | PM terminal must be running and registered. Check `curl http://127.0.0.1:3100/health?project=my-app` — `agents_online` should include `pm` |
| Response delayed >60s | Watchdog cooldown (60s per agent). Wait for cooldown to expire. Consider reducing `watchdogInterval` |
| Bot ignores your messages | Your Telegram user ID in `.env` doesn't match. Re-check with @userinfobot |
