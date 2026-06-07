# federation

## Abstract
**TL;DR:** inter-PM federation client wiring to every project's PM over Tailscale/LAN.
**Load when:** federation, grant_access, revoke_access, trtok, token, RO, RW, RWE, /api/federation, list_agents, request, wait, add-federation, fleet.config, Tailscale, LAN, loopback, G3, second gate, project PM
**Key facts:** Majordomus is the client; each project mints a token granting {pm: RW|RWE}; project PM is the second gate; bind federation endpoints to Tailscale, owner endpoints loopback.
**Owner:** /ops   **Related:** doc/design/host_ops.md, PM SKILL (federation-as-delegation)

---

## Fleet registry

`fleet/fleet.config.json` lists `{ name, url, grant, tokenRef }` per project (tokens resolve from env). Per-project roster + grant levels: **Q-FLEET-ROSTER** (open).
