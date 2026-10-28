# CRM → Ops move-in handoff (n8n)

When Sales closes a booking in LeadSquared, Ops gets a task in a Google Sheet and a WhatsApp message within seconds,
with the date the room has to be ready. Every Monday at 09:00 IST, Ops gets a review of what's coming and what's overdue.

**Docs:** https://dakshvanshaj.com/union-living-ops-handoff/

**Video (2 min):** https://cap.so/s/tf0end6hd2p2b6p

![The workflow in n8n](docs/img/canvas.png)

- [What it does and why](docs/index.md)
- [How it works](docs/how-it-works.md): the flow, the Ready-by rule, flags, updates
- [Set it up](docs/setup.md): run locally, credentials, test payloads, going live

Quick check of the rules: `node handoff.test.js` should print `handoff ok`.
