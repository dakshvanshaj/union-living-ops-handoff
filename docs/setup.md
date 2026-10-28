# Set it up

You need Docker and Node 18+. Node is only used for the tests and `build.js`; n8n itself runs in Docker.

## 1. Run n8n locally

From the repo folder:

```bash
docker run -d --name n8n -p 5678:5678 -e GENERIC_TIMEZONE=Asia/Kolkata -e TZ=Asia/Kolkata -v n8n_data:/home/node/.n8n -v "$PWD:/files" docker.n8n.io/n8nio/n8n
```

Open <http://localhost:5678> and create your login.

## 2. Google Sheet

Create a Sheet with two tabs.

**`Ops Queue`**: row 1 headers, in this order:

```text
Received at, LSQ Lead ID, Tenant, Phone, Gender, Wing, Flat, Room, Bed, Room Category, Move-in date, Ready-by, Sales owner, Status, Flags
```

- Give `Status` a dropdown: `Pending Move In, Not Ready, Ready, Moved In - Permanent, Moved In - Temp`.
- Format `Received at`, `Move-in date` and `Ready-by` as plain text (Format → Number → Plain text). Otherwise dates
  that Ops retypes won't count in the Monday summary.

**`Settings`**: headers `Role, Wing, Name, WhatsApp, Email`:

| Role | Wing | Name | WhatsApp | Email |
|---|---|---|---|---|
| Trigger stage | | Closed Won | | |
| Wing Ops | A | *name* | *number* | *email* |
| Wing Ops | B | *name* | *number* | *email* |
| Ops Head | | *name* | *number* | *email* |

- Format the WhatsApp column as plain text, and write numbers with the country code, e.g. `919800000001`.
- `Ops Head` is the fallback when a wing has no contact.
- `Trigger stage` is the LeadSquared stage that creates a task.

## 3. Credentials in n8n

- **Google Sheets OAuth2 and Gmail OAuth2** (one OAuth client covers both; enable the Sheets, Drive and Gmail APIs):
  1. In Google Cloud, create an OAuth client with redirect URI `http://localhost:5678/rest/oauth2-credential/callback`.
  2. Add the credential in n8n and sign in.
- **WhatsApp:**
  1. On developers.facebook.com, create an app and add WhatsApp.
  2. On API Setup, add and verify your phone as a recipient. Copy the *Phone number ID*, the *WhatsApp Business Account ID* and the access token into an n8n **WhatsApp API** credential.
  3. Send "hi" from your phone to the test number. Plain-text messages only work within 24 hours of a message from your side.
- **Webhook secret:**
  1. Create a **Header Auth** credential named `LeadSquared webhook secret`, with header name `X-Handoff-Secret` and a long random value.
  2. Copy `.env.example` to `.env` and put the same value in it.

## 4. Build, import, publish

```bash
SHEET_ID=<sheet id> WA_PHONE_ID=<phone number id> node build.js
```

```bash
docker exec n8n n8n import:workflow --input=/files/workflow.json && docker exec n8n n8n publish:workflow --id=ulOpsHandoff0001 && docker restart n8n
```

Open the workflow and pick your credentials on the webhook node, every Google Sheets node and both WhatsApp nodes. Then publish.
Re-importing resets the credential picks, so pick them again after every rebuild.

## 5. Try it

```bash
./send-test.sh payloads/closed-won.json
```

| Payload | What should happen |
|---|---|
| `closed-won.json` | New row in Ops Queue, WhatsApp to Wing A's contact |
| same file again | Still one row; the alert starts `Updated:` |
| `missing-fields.json` | Row with Flags `Missing: move-in date, sales owner; No date – chase Sales`, alert starts `⚠` |
| `closed-lost.json` | Nothing: not Closed Won |

To see the Monday summary now, open **Monday 09:00** in the editor and click *Execute workflow*.

To run the rule tests: `node handoff.test.js` should print `handoff ok`.

## Going live with LeadSquared

**Route 1: webhook (recommended).**

1. In LeadSquared, go to My Profile → Settings → API and Webhooks → Webhooks and create **one** webhook on **Lead update**.
   - **Point it at the production webhook URL** and add the custom header `X-Handoff-Secret`.
   - **Lead update** should also fire on stage changes. Confirm this with one real payload; if it doesn't, use **Lead stage change** instead.
   - **Don't subscribe to both events.** One Closed Won could fire both at the same moment and create a duplicate row.
2. n8n must be reachable from the internet: n8n Cloud, or a tunnel.

**Route 2: polling, if webhooks aren't available.**

1. Enable the two greyed-out nodes.
2. Add a Custom Auth credential with the headers `x-LSQ-AccessKey` and `x-LSQ-SecretKey`, and set your account's API host.
3. Map the response to the same fields before **Build Ops task**.

**Production WhatsApp:** swap the WhatsApp nodes for your provider's node (for WATI, `n8n-nodes-wati` → Send Template Message)
with an approved utility template.

**Before going live:** capture one real LeadSquared payload and adjust `fromLsq()` in `handoff.js` to the real field names.
Check the date format too: if LeadSquared sends dates in UTC, a midnight-IST date would read one day early.
