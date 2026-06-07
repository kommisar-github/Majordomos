# Telegram PM Bridge

Remote access to the PM agent via Telegram. Seamless transition between local PM terminal and phone.

## Setup

1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram — save the token
2. Get your user ID via [@userinfobot](https://t.me/userinfobot)
3. Configure:

```bash
cd .claude/mcp/telegram-bridge
cp .env.example .env
# Edit .env with your bot token and user ID
npm install
```

4. The bot auto-starts with the task-router (via `start.sh`) if `.env` exists.
   Or start manually: `node bot.js`

## Usage

- Send any message to your bot on Telegram — it reaches PM
- PM responses come back to the chat
- `/start` — connection greeting
- `/status` — quick task-router health check
- All interactions also appear in the PM terminal

## How it works

The bot registers as agent `"telegram"` with the task-router. Messages are dispatched as tasks to PM. The extension watchdog injects them into the PM terminal. PM processes and dispatches responses back to the `"telegram"` agent. The bot picks them up and sends to Telegram.

When connected, PM mirrors all responses to Telegram — including responses to local terminal prompts.

## Latency

Typical round-trip: 10-20s. The extension watchdog polls every 10s by default.
