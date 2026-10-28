// Business rules for the CRM -> Ops move-in handoff.
// Pure functions; the same text is inlined into the n8n Code nodes by build.js.
// All times are IST wall-clock, held as "fake UTC" Dates (read with getUTC*), so host timezone never matters.

const DAY = 86400000;
const IST_MS = 330 * 60000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPEN = ['Pending Move In', 'Not Ready'];

const ist = (d) => new Date(d.getTime() + IST_MS);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (f) => `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())} ${pad(f.getUTCHours())}:${pad(f.getUTCMinutes())}`;
const nice = (f, time) => `${DOW[f.getUTCDay()]} ${f.getUTCDate()} ${MON[f.getUTCMonth()]}` + (time ? ` ${pad(f.getUTCHours())}:${pad(f.getUTCMinutes())}` : '');
// 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[...]' -> fake-UTC Date, or null
function parseWall(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : null;
}

// Blank everywhere means '', 'NaN', 'N/A' or missing (same rule as the allotment cleaning).
function clean(v) {
  const s = v == null ? '' : String(v).trim();
  return ['', 'nan', 'n/a'].includes(s.toLowerCase()) ? '' : s;
}

function toIsoDate(v) {
  const s = clean(v);
  let y, mo, d, m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) [y, mo, d] = [+m[3], +m[2], +m[1]]; // day-first, as proven on the allotment data
  else return '';
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return ''; // 31/2 etc.: treat as missing, never roll over
  return `${y}-${pad(mo)}-${pad(d)}`; // ponytail: unparseable date is treated as missing and flagged; add a separate "bad date" flag if LSQ ever sends one
}

// The ONLY place that knows LeadSquared field names. Capture one real webhook payload and adjust here.
function fromLsq(body) {
  const b = body || {};
  const wing = clean(b.mx_Wing).match(/^([ab])\b/i);
  const room = clean(b.mx_Room).match(/^(?:r|room)\s*(\d+)$/i);
  const g = clean(b.mx_Gender);
  return {
    leadId: clean(b.ProspectID),
    tenant: [clean(b.FirstName), clean(b.LastName)].filter(Boolean).join(' '),
    phone: clean(b.Phone),
    gender: g ? g[0].toUpperCase() + g.slice(1).toLowerCase() : '',
    wing: wing ? wing[1].toUpperCase() : clean(b.mx_Wing),
    flat: clean(b.mx_Flat_No),
    room: room ? 'R' + room[1] : clean(b.mx_Room),
    bed: clean(b.mx_Bed),
    category: clean(b.mx_Room_Category),
    moveIn: toIsoDate(b.mx_Move_in_Date),
    owner: clean(b.OwnerIdName),
    stage: clean(b.ProspectStage),
  };
}

function isTrigger(lead, stage) {
  return lead.stage.toLowerCase() === String(stage || '').trim().toLowerCase();
}

// Founder's Fix rule: room Ready 2 working days (Mon-Fri) before move-in;
// Sat/Sun/Mon move-ins by Friday 12:00; later requests for those get a Saturday 12:00 slot.
// ponytail: public holidays ignored; add a Holidays tab if Ops asks.
function readyBy(moveIn, receivedAt) {
  const mv = parseWall(moveIn);
  if (!mv) return { readyBy: '', flag: 'No date – chase Sales' };
  const rcv = ist(receivedAt);
  const dow = mv.getUTCDay();
  if (dow === 6 || dow === 0 || dow === 1) {
    const fri = new Date(mv.getTime() - { 6: 1, 0: 2, 1: 3 }[dow] * DAY + 12 * 3600000);
    if (rcv <= fri) return { readyBy: fmt(fri), flag: '' };
    const sat = new Date(fri.getTime() + DAY);
    if (rcv <= sat) return { readyBy: fmt(sat), flag: 'Late request → Saturday slot' };
    return { readyBy: fmt(fri), flag: 'Already late' };
  }
  let d = mv.getTime();
  for (let n = 0; n < 2;) { d -= DAY; const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  const due = new Date(d + 18 * 3600000);
  return { readyBy: fmt(due), flag: rcv <= due ? '' : 'Already late' };
}

function contactFor(wing, settings) {
  const s = settings || [];
  const reachable = (r) => clean(r.WhatsApp) || clean(r.Email);
  const c = s.find((r) => r.Role === 'Wing Ops' && String(r.Wing).trim().toUpperCase() === wing && reachable(r))
    || s.find((r) => r.Role === 'Ops Head' && reachable(r));
  return c ? { Name: c.Name, WhatsApp: clean(c.WhatsApp), Email: clean(c.Email) } : null;
}

const REQUIRED = [['leadId', 'lead id'], ['tenant', 'tenant name'], ['phone', 'phone'], ['wing', 'wing'], ['room', 'room'], ['bed', 'bed'], ['gender', 'gender'], ['moveIn', 'move-in date'], ['owner', 'sales owner']];

// existing = the Ops Queue row already holding this lead, or null. An update keeps Ops' Status and the first arrival time.
function buildTask(lead, receivedAt, settings, existing) {
  const flags = [];
  const missing = REQUIRED.filter(([k]) => !lead[k]).map(([, label]) => label);
  if (missing.length) flags.push('Missing: ' + missing.join(', '));
  // Lateness is judged from when Ops first heard of this move-in date, so a later CRM edit doesn't make it "late".
  const first = existing && existing['Move-in date'] === lead.moveIn && parseWall(existing['Received at']);
  const rb = readyBy(lead.moveIn, first ? new Date(first.getTime() - IST_MS) : receivedAt);
  if (rb.flag) flags.push(rb.flag);
  const c = contactFor(lead.wing, settings);
  if (!c) flags.push(`No Ops contact for wing ${lead.wing || '?'}`);
  const row = {
    'Received at': (existing && existing['Received at']) || fmt(ist(receivedAt)), 'LSQ Lead ID': lead.leadId || `no-id-${receivedAt.getTime()}`, Tenant: lead.tenant, Phone: lead.phone,
    Gender: lead.gender, Wing: lead.wing, Flat: lead.flat, Room: lead.room, Bed: lead.bed, 'Room Category': lead.category,
    'Move-in date': lead.moveIn, 'Ready-by': rb.readyBy, 'Sales owner': lead.owner, Status: (existing && existing.Status) || 'Pending Move In', Flags: flags.join('; '),
  };
  const q = (v) => v || '?';
  const mv = parseWall(lead.moveIn), due = parseWall(rb.readyBy);
  const when = mv ? `Move-in ${nice(mv)}, room Ready by ${nice(due, true)}.` : 'Move-in date not set.';
  let text = `New move-in: ${q(lead.tenant)} (${q(lead.gender)}), Wing ${q(lead.wing)} ${q(lead.flat)} ${q(lead.room)} bed ${q(lead.bed)}. ${when} Sales: ${q(lead.owner)}.`;
  if (row.Flags) text = `⚠ ${row.Flags}. ${text}`;
  let subject = `New move-in: ${q(lead.tenant)}, Wing ${q(lead.wing)} ${q(lead.flat)} ${q(lead.room)} bed ${q(lead.bed)} – ${mv ? `ready by ${nice(due, true)}` : 'no move-in date'}`;
  if (row.Flags) subject = `⚠ ${subject}`;
  if (existing) { text = `Updated: ${text}`; subject = `Updated: ${subject}`; }
  return { row, to: (c && c.WhatsApp) || null, email: c ? c.Email : '', subject, text };
}

// Monday agenda for the 10-minute move-in review.
function mondaySummary(rows, now, sheetUrl) {
  const n = ist(now);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const nowStr = fmt(n);
  const open = (rows || []).filter((r) => OPEN.includes(r.Status));
  const next14 = open.filter((r) => { const m = parseWall(r['Move-in date']); return m && m >= today && m <= today + 14 * DAY; });
  const overdue = open.filter((r) => r['Ready-by'] && String(r['Ready-by']).slice(0, 16) < nowStr);
  const noDate = open.filter((r) => !parseWall(r['Move-in date']));
  const oldest = open.filter((r) => parseWall(r['Received at']))
    .sort((a, b) => parseWall(a['Received at']) - parseWall(b['Received at'])).slice(0, 3)
    .map((r) => `- ${r.Tenant} (Wing ${r.Wing}), ${Math.floor((n - parseWall(r['Received at'])) / DAY)} days`);
  return [
    `Move-in review – ${nice(n)}`,
    `Move-ins next 14 days: ${next14.length}`,
    `Overdue (not Ready): ${overdue.length}`,
    `No date – chase Sales: ${noDate.length}`,
    ...(oldest.length ? ['Waiting longest:', ...oldest] : []),
    `Full list: ${sheetUrl}`,
  ].join('\n');
}

if (typeof module !== 'undefined') module.exports = { fromLsq, isTrigger, readyBy, contactFor, buildTask, mondaySummary };
