// Builds workflow.json (importable into n8n) with handoff.js inlined into the Code nodes.
// Run: SHEET_ID=<id> WA_PHONE_ID=<id> node n8n-handoff/build.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const LOGIC = fs.readFileSync(path.join(__dirname, 'handoff.js'), 'utf8');
const SHEET_ID = process.env.SHEET_ID || 'REPLACE_WITH_SHEET_ID';
const WA_PHONE_ID = process.env.WA_PHONE_ID || 'REPLACE_WITH_WHATSAPP_PHONE_NUMBER_ID';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

const doc = { __rl: true, mode: 'id', value: SHEET_ID };
const tab = (name) => ({ __rl: true, mode: 'name', value: name });
const sheetsCred = { googleSheetsOAuth2Api: { id: 'ulGoogleSheets01', name: 'Google Sheets account' } };
const waCred = { whatsAppApi: { id: 'ulWhatsApp000001', name: 'WhatsApp account' } };
let n = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) =>
  ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, name, type: `n8n-nodes-base.${type}`, typeVersion, position, parameters, ...extra });
const sticky = (name, content, position, width, height, color) =>
  node(name, 'stickyNote', 1, position, { content, width, height, color });
const readRows = (name, sheet, position, extra = {}) =>
  node(name, 'googleSheets', 4.7, position, { documentId: doc, sheetName: tab(sheet), options: {} }, { credentials: sheetsCred, alwaysOutputData: true, executeOnce: true, ...extra });
const whatsapp = (name, position, to, text) =>
  node(name, 'whatsApp', 1.1, position, { operation: 'send', phoneNumberId: WA_PHONE_ID, recipientPhoneNumber: to, textBody: text, additionalFields: {} }, { credentials: waCred });

const BUILD_TASK = `${LOGIC}
const lead = fromLsq($('LeadSquared – Lead stage changed').first().json.body);
const settings = $('Read Settings').all().map((i) => i.json);
const stage = (settings.find((s) => s.Role === 'Trigger stage') || {}).Name || 'Closed Won';
if (!isTrigger(lead, stage)) return [];
const existing = lead.leadId ? ($('Read existing task').all().map((i) => i.json).find((r) => String(r['LSQ Lead ID']) === lead.leadId) || null) : null;
const t = buildTask(lead, new Date(), settings, existing);
return [{ json: { ...t.row, _to: t.to || '', _text: t.text } }];`;

const BUILD_SUMMARY = `${LOGIC}
const rows = $('Read Ops Queue').all().map((i) => i.json).filter((r) => r.Status);
const text = mondaySummary(rows, new Date(), '${SHEET_URL}');
return $('Read Settings (Monday)').all().map((i) => i.json)
  .filter((s) => ['Wing Ops', 'Ops Head'].includes(s.Role) && String(s.WhatsApp || '').trim())
  .map((s) => ({ json: { _to: String(s.WhatsApp).trim(), _text: text } }));`;

const nodes = [
  sticky('Note – what this is', '## CRM → Ops move-in handoff\nLeadSquared **Closed Won** → Ops task in the Ops Queue sheet (with Ready-by) → WhatsApp to the wing\'s Ops contact.\nEvery Monday 09:00 IST: the move-in review summary.\nRules live in one place: the Code nodes (source: handoff.js).', [-60, -320], 560, 200, 7),
  sticky('Note – sample payload', '### Sample payload\nRight now `send-test.sh` posts a LeadSquared-shaped sample lead.\nTo go live: in LeadSquared create ONE webhook on **Lead update** pointing here, with custom header `X-Handoff-Secret` (it should also fire on stage changes, and it is how a fixed missing field reaches Ops; two webhooks firing at once can create duplicate rows). Capture one real payload and adjust `fromLsq()` only.', [-60, 190], 460, 220, 3),
  sticky('Note – WhatsApp', '### WhatsApp\nDemo: Meta WhatsApp Cloud API test number (plain text, inside the 24h window).\nProduction: swap for the WATI node (`n8n-nodes-wati` → Send Template Message) with an approved utility template.', [1060, 190], 460, 200, 4),
  sticky('Note – polling', '### Alternative entry (off)\nIf webhooks aren\'t available, poll LeadSquared `Leads.RecentlyModified` every 15 min with your access/secret keys. Map its output to the same fields before **Build Ops task**.', [-60, 590], 460, 180, 5),

  node('LeadSquared – Lead stage changed', 'webhook', 2.2, [0, 0], { httpMethod: 'POST', path: 'lsq-lead-stage', authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    { webhookId: 'a7c1e7c2-1d7e-4c55-9e1a-1a2b3c4d5e6f', credentials: { httpHeaderAuth: { id: 'ulLsqSecret00001', name: 'LeadSquared webhook secret' } } }),
  readRows('Read Settings', 'Settings', [220, 0]),
  readRows('Read existing task', 'Ops Queue', [440, 0], {
    parameters: { documentId: doc, sheetName: tab('Ops Queue'), filtersUI: { values: [{ lookupColumn: 'LSQ Lead ID', lookupValue: "={{ $('LeadSquared – Lead stage changed').first().json.body.ProspectID }}" }] }, options: {} },
  }),
  node('Build Ops task', 'code', 2, [660, 0], { jsCode: BUILD_TASK }),
  node('Ops Queue – add or update', 'googleSheets', 4.7, [880, 0], {
    operation: 'appendOrUpdate', documentId: doc, sheetName: tab('Ops Queue'),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['LSQ Lead ID'], schema: [] },
    options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
  }, { credentials: sheetsCred }),
  node('Has Ops contact?', 'if', 2.2, [1100, 0], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: 'c0ffee00-0000-4000-8000-000000000001', leftValue: "={{ $('Build Ops task').item.json._to }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  }),
  whatsapp('WhatsApp – alert Ops', [1320, -20], "={{ $('Build Ops task').item.json._to }}", "={{ $('Build Ops task').item.json._text }}"),

  node('Every 15 min', 'scheduleTrigger', 1.2, [0, 400], { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }, { disabled: true }),
  node('LeadSquared – Fetch recently modified leads', 'httpRequest', 4.2, [220, 400], {
    method: 'POST', url: 'https://api-in21.leadsquared.com/v2/LeadManagement.svc/Leads.RecentlyModified',
    authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ Parameter: { FromDate: $now.minus({ minutes: 15 }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'), ToDate: $now.toUTC().toFormat('yyyy-MM-dd HH:mm:ss') }, Paging: { PageIndex: 1, PageSize: 100 } }) }}",
    options: {},
  }, { disabled: true, notes: 'Host varies by account region; headers x-LSQ-AccessKey / x-LSQ-SecretKey via a Custom Auth credential.' }),

  node('Monday 09:00', 'scheduleTrigger', 1.2, [0, 900], { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1' }] } }),
  readRows('Read Ops Queue', 'Ops Queue', [220, 900]),
  readRows('Read Settings (Monday)', 'Settings', [440, 900]),
  node('Build Monday summary', 'code', 2, [660, 900], { jsCode: BUILD_SUMMARY }),
  whatsapp('WhatsApp – Monday summary', [880, 900], '={{ $json._to }}', '={{ $json._text }}'),
];

const link = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
const connections = {
  'LeadSquared – Lead stage changed': link('Read Settings'),
  'Read Settings': link('Read existing task'),
  'Read existing task': link('Build Ops task'),
  'Build Ops task': link('Ops Queue – add or update'),
  'Ops Queue – add or update': link('Has Ops contact?'),
  'Has Ops contact?': { main: [[{ node: 'WhatsApp – alert Ops', type: 'main', index: 0 }], []] },
  'Every 15 min': link('LeadSquared – Fetch recently modified leads'),
  'Monday 09:00': link('Read Ops Queue'),
  'Read Ops Queue': link('Read Settings (Monday)'),
  'Read Settings (Monday)': link('Build Monday summary'),
  'Build Monday summary': link('WhatsApp – Monday summary'),
};

const wf = { id: 'ulOpsHandoff0001', name: 'Union Living – CRM to Ops handoff', active: false, nodes, connections, settings: { timezone: 'Asia/Kolkata', executionOrder: 'v1' }, pinData: {} };

// self-check: names wired correctly, logic inlined
const names = new Set(nodes.map((x) => x.name));
for (const [from, c] of Object.entries(connections)) {
  assert(names.has(from), from);
  for (const out of c.main) for (const e of out) assert(names.has(e.node), e.node);
}
for (const x of nodes.filter((x) => x.type.endsWith('.code'))) assert.match(x.parameters.jsCode, /function readyBy/);
// the inlined Code bodies must at least parse
for (const x of nodes.filter((x) => x.type.endsWith('.code'))) new Function('$', x.parameters.jsCode);

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(wf, null, 2));
console.log('build ok');
