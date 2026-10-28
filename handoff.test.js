// Run: node n8n-handoff/handoff.test.js
const assert = require('node:assert/strict');
const { fromLsq, isTrigger, readyBy, buildTask, mondaySummary } = require('./handoff.js');

const R = (d, t = '2026-10-28T10:00:00+05:30') => readyBy(d, new Date(t));
// working-day rule (received Wed 28 Oct 10:00 IST)
assert.deepEqual(R('2026-11-03'), { readyBy: '2026-10-30 18:00', flag: '' }); // Tue -> prev Fri
assert.deepEqual(R('2026-11-04'), { readyBy: '2026-11-02 18:00', flag: '' }); // Wed -> Mon
assert.deepEqual(R('2026-11-05'), { readyBy: '2026-11-03 18:00', flag: '' }); // Thu -> Tue
assert.deepEqual(R('2026-11-06'), { readyBy: '2026-11-04 18:00', flag: '' }); // Fri -> Wed
assert.deepEqual(R('2026-10-31'), { readyBy: '2026-10-30 12:00', flag: '' }); // Sat -> Fri noon
assert.deepEqual(R('2026-11-02'), { readyBy: '2026-10-30 12:00', flag: '' }); // Mon -> Fri noon
// late rules
assert.deepEqual(R('2026-11-01', '2026-10-30T15:00:00+05:30'), { readyBy: '2026-10-31 12:00', flag: 'Late request → Saturday slot' });
assert.deepEqual(R('2026-10-31', '2026-10-31T13:00:00+05:30'), { readyBy: '2026-10-30 12:00', flag: 'Already late' });
assert.deepEqual(R('2026-10-29'), { readyBy: '2026-10-27 18:00', flag: 'Already late' });
assert.deepEqual(R(''), { readyBy: '', flag: 'No date – chase Sales' });

// fromLsq normalisation
const base = { ProspectID: 'p1', FirstName: 'Priya', LastName: 'S', Phone: '+919800000001', mx_Gender: 'girls', mx_Wing: 'a wing', mx_Flat_No: 'A-204', mx_Room: 'Room 1', mx_Bed: '2', mx_Room_Category: 'Twin Sharing Standard', mx_Move_in_Date: '2026-11-03 00:00:00', OwnerIdName: 'Rohit K', ProspectStage: 'Closed Won' };
const L = fromLsq(base);
assert.equal(L.wing, 'A'); assert.equal(L.room, 'R1'); assert.equal(L.gender, 'Girls'); assert.equal(L.moveIn, '2026-11-03');
assert.equal(L.tenant, 'Priya S');
assert.equal(fromLsq({ ...base, mx_Move_in_Date: '3/11/2026' }).moveIn, '2026-11-03');
assert.equal(fromLsq({ ...base, OwnerIdName: 'N/A' }).owner, '');
assert.equal(fromLsq({ ...base, mx_Wing: 'B Wing', mx_Room: 'R 2' }).wing, 'B');
assert.equal(fromLsq({ ...base, mx_Room: 'R 2' }).room, 'R2');
assert.equal(isTrigger(fromLsq({ ...base, ProspectStage: ' closed won ' }), 'Closed Won'), true);
assert.equal(isTrigger(fromLsq({ ...base, ProspectStage: 'Closed Lost' }), 'Closed Won'), false);

// buildTask
const S = [
  { Role: 'Trigger stage', Wing: '', Name: 'Closed Won', WhatsApp: '' },
  { Role: 'Wing Ops', Wing: 'A', Name: 'Asha', WhatsApp: '+919800000010' },
  { Role: 'Ops Head', Wing: '', Name: 'Head', WhatsApp: '+919800000099' },
];
const now = new Date('2026-10-28T10:00:00+05:30');
const t = buildTask(fromLsq({ ...base, mx_Move_in_Date: '', OwnerIdName: '' }), now, S, null);
assert.equal(t.row.Flags, 'Missing: move-in date, sales owner; No date – chase Sales');
assert.equal(t.row.Status, 'Pending Move In'); assert.equal(t.to, '+919800000010');
assert.match(t.text, /^⚠ Missing: move-in date, sales owner/);
assert.deepEqual(Object.keys(t.row), ['Received at', 'LSQ Lead ID', 'Tenant', 'Phone', 'Gender', 'Wing', 'Flat', 'Room', 'Bed', 'Room Category', 'Move-in date', 'Ready-by', 'Sales owner', 'Status', 'Flags']);
assert.equal(t.row['Received at'], '2026-10-28 10:00');
const ok = buildTask(L, now, S, false);
assert.equal(ok.row.Flags, '');
assert.equal(ok.text, 'New move-in: Priya S (Girls), Wing A A-204 R1 bed 2. Move-in Tue 3 Nov, room Ready by Fri 30 Oct 18:00. Sales: Rohit K.');
assert.equal(buildTask(fromLsq({ ...base, mx_Wing: 'B' }), now, S, false).to, '+919800000099'); // fallback
const none = buildTask(fromLsq({ ...base, mx_Wing: 'B' }), now, [], false);
assert.equal(none.to, null); assert.match(none.row.Flags, /No Ops contact for wing B/);
const prev = { 'Received at': '2026-10-20 09:00', 'LSQ Lead ID': 'p1', Status: 'Ready' };
const up = buildTask(L, now, S, prev);
assert.match(up.text, /^Updated: New move-in/);
assert.equal(up.row.Status, 'Ready'); // Ops' progress is never overwritten by a CRM edit
assert.equal(up.row['Received at'], '2026-10-20 09:00'); // waiting time keeps counting from the first arrival

// mondaySummary: one overdue, one in window, one no-date, one moved in (ignored)
const rows = [
  { 'Received at': '2026-10-20 09:00', Tenant: 'A1', Wing: 'A', 'Move-in date': '2026-10-29', 'Ready-by': '2026-10-27 18:00', Status: 'Pending Move In' },
  { 'Received at': '2026-10-26 09:00', Tenant: 'B1', Wing: 'B', 'Move-in date': '2026-11-06', 'Ready-by': '2026-11-04 18:00', Status: 'Pending Move In' },
  { 'Received at': '2026-10-22 09:00', Tenant: 'C1', Wing: 'A', 'Move-in date': '', 'Ready-by': '', Status: 'Pending Move In' },
  { 'Received at': '2026-10-01 09:00', Tenant: 'D1', Wing: 'A', 'Move-in date': '2026-10-10', 'Ready-by': '2026-10-08 18:00', Status: 'Moved In - Permanent' },
];
const s = mondaySummary(rows, new Date('2026-11-02T09:00:00+05:30'), 'https://sheet');
assert.match(s, /Move-ins next 14 days: 1/); assert.match(s, /Overdue \(not Ready\): 1/);
assert.match(s, /No date – chase Sales: 1/); assert.match(s, /A1 \(Wing A\), 13 days/); assert.doesNotMatch(s, /D1/);
assert.match(s, /https:\/\/sheet/);
// review fixes
// 1. an update judges lateness from the first arrival, not the edit time
const monLead = fromLsq({ ...base, mx_Move_in_Date: '2026-11-02' });
const later = buildTask(monLead, new Date('2026-10-30T15:00:00+05:30'), S, { 'Received at': '2026-10-28 10:00', 'Move-in date': '2026-11-02', Status: 'Pending Move In' });
assert.equal(later.row['Ready-by'], '2026-10-30 12:00'); assert.equal(later.row.Flags, '');
// 3. no lead id: flagged, and a unique key so it can't overwrite another row
const noId = buildTask(fromLsq({ ...base, ProspectID: '' }), now, S, null);
assert.match(noId.row.Flags, /Missing: lead id/); assert.match(noId.row['LSQ Lead ID'], /^no-id-/);
// 4. impossible dates are treated as missing, not rolled over
assert.equal(fromLsq({ ...base, mx_Move_in_Date: '31/2/2026' }).moveIn, '');
assert.equal(fromLsq({ ...base, mx_Move_in_Date: '2026-02-30' }).moveIn, '');
// email channel: a contact with only an Email still counts; alerts carry a subject
const SE = [{ Role: 'Wing Ops', Wing: 'A', Name: 'Asha', WhatsApp: '', Email: 'asha@example.com' }];
const e = buildTask(L, now, SE, null);
assert.equal(e.to, null); assert.equal(e.email, 'asha@example.com'); assert.equal(e.row.Flags, '');
assert.equal(e.subject, 'New move-in: Priya S, Wing A A-204 R1 bed 2 – ready by Fri 30 Oct 18:00');
assert.equal(t.subject, '⚠ New move-in: Priya S, Wing A A-204 R1 bed 2 – no move-in date');
assert.equal(ok.email, '');
console.log('handoff ok');
