/* Tests for the internal chat's pure logic.
   The anchor case is the one the spec is emphatic about (§8): clicking
   Message twice on the same business must open ONE conversation. */
const C = require('./chat-core.js');
let pass = 0, fail = 0; const bad = [];
const ok = (m, c) => { if (c) pass++; else { fail++; bad.push(m); } };

/* ── SUBJECT IDENTITY — no duplicate conversations ───────────────────────── */
{
  const biz = { kind: 'business', id: 'ChIJplace123', name: 'Bhogawati Cooperative Sugar Factory Ltd' };
  ok('SUBJECT · the same business yields the same key every time',
     C.subjectKey(biz).key === C.subjectKey(biz).key && C.subjectKey(biz).key === 'business:ChIJplace123');
  ok('SUBJECT · the id is preferred over the name', C.subjectKey(biz).how === 'id');

  /* Two sugar mills genuinely share a name; the id is what tells them apart. */
  const a = C.subjectKey({ kind: 'business', id: 'P1', name: 'Bhogawati Sugar' });
  const b = C.subjectKey({ kind: 'business', id: 'P2', name: 'Bhogawati Sugar' });
  ok('SUBJECT · two businesses with the SAME NAME get different keys', a.key !== b.key);

  const n1 = C.subjectKey({ kind: 'business', name: 'GALAXY SUGAR' });
  const n2 = C.subjectKey({ kind: 'business', name: '  galaxy   sugar ' });
  ok('SUBJECT · with no id it falls back to the normalised name', n1.key === n2.key && n1.how === 'name');
  ok('SUBJECT · and says the match was by name, not by id', n1.how === 'name');
  ok('SUBJECT · nothing identifiable yields no key at all', C.subjectKey({ kind: 'business' }) === null);

  /* A DM is identified by the PAIR, so A→B and B→A are one thread. */
  const ab = C.subjectKey({ kind: 'dm', me: 'u_haji', user: 'u_sales' });
  const ba = C.subjectKey({ kind: 'dm', me: 'u_sales', user: 'u_haji' });
  ok('SUBJECT · a DM is the same thread whichever side opens it', ab.key === ba.key);
  ok('SUBJECT · a DM with only one party is not a conversation',
     C.subjectKey({ kind: 'dm', me: 'u_haji' }) === null);

  /* A lead and a business with the same id are different subjects. */
  ok('SUBJECT · kind is part of the identity',
     C.subjectKey({ kind: 'lead', id: 'X' }).key !== C.subjectKey({ kind: 'customer', id: 'X' }).key);
}

/* ── HEADER ──────────────────────────────────────────────────────────────── */
{
  const t = C.threadTitle({ name: 'Bhogawati Cooperative Sugar Factory Ltd', industry: 'Sugar Mills', city: 'Maharashtra' });
  ok('HEADER · the business name is the title', t.title === 'Bhogawati Cooperative Sugar Factory Ltd');
  ok('HEADER · industry and place form the subtitle — how you tell four sugar mills apart',
     t.subtitle === 'Sugar Mills · Maharashtra');
  ok('HEADER · a missing place does not leave a dangling separator',
     C.threadTitle({ name: 'X', industry: 'Sugar Mills' }).subtitle === 'Sugar Mills');
}

/* ── DATE GROUPING ───────────────────────────────────────────────────────── */
{
  const NOW = '2026-08-22T10:00:00Z';
  ok('DAY · today reads Today', C.dayLabel('2026-08-22 09:12:00', NOW) === 'Today');
  ok('DAY · yesterday reads Yesterday', C.dayLabel('2026-08-21 18:00:00', NOW) === 'Yesterday');
  ok('DAY · older reads as a date', /2026/.test(C.dayLabel('2026-07-04 08:00:00', NOW)));
  ok('DAY · a month boundary is still yesterday', C.dayLabel('2026-07-31 10:00:00', '2026-08-01T10:00:00Z') === 'Yesterday');
  ok('DAY · junk yields nothing rather than "Invalid Date"', C.dayLabel('', NOW) === '');

  const msgs = [
    { created_at: '2026-08-21 09:00:00', user_id: 'a' },
    { created_at: '2026-08-22 09:00:00', user_id: 'a' },
    { created_at: '2026-08-22 09:02:00', user_id: 'a' }
  ];
  const g = C.groupByDay(msgs, NOW);
  ok('GROUP · one bucket per day, in order', g.length === 2 && g[0].day === 'Yesterday' && g[1].day === 'Today');
  ok('GROUP · every message lands in exactly one bucket',
     g.reduce((a, x) => a + x.messages.length, 0) === 3);

  ok('RUN · two messages from one person two minutes apart are one turn',
     C.isRun(msgs[1], msgs[2]));
  ok('RUN · a different sender breaks the run',
     !C.isRun({ created_at: '2026-08-22 09:00:00', user_id: 'a' }, { created_at: '2026-08-22 09:01:00', user_id: 'b' }));
  ok('RUN · an hour apart is not a run',
     !C.isRun({ created_at: '2026-08-22 09:00:00', user_id: 'a' }, { created_at: '2026-08-22 10:00:00', user_id: 'a' }));
  ok('RUN · an internal note never joins a run of normal messages',
     !C.isRun({ created_at: '2026-08-22 09:00:00', user_id: 'a', kind: 'text' },
              { created_at: '2026-08-22 09:01:00', user_id: 'a', kind: 'note' }));
}

/* ── THREAD LIST ─────────────────────────────────────────────────────────── */
{
  const T = [
    { kind: 'business', title: 'Bhogawati Cooperative Sugar Factory Ltd', subtitle: 'Sugar Mills · Maharashtra', last_body: 'Can you share your latest quotation?', unread: 3 },
    { kind: 'dm', title: 'Haji Kayyum', last_body: 'ok', unread: 0 },
    { kind: 'customer', title: 'ARIF CHEMICAL LIME', last_body: 'Payment done', unread: 1 },
    { kind: 'group', title: 'Sales Team', last_body: 'Standup at 10', unread: 0 },
    { kind: 'supplier', title: 'Indian Oil', last_body: 'Bill attached', unread: 0 }
  ];
  ok('FILTER · All shows everything', C.filterThreads(T, 'all').length === 5);
  ok('FILTER · Unread shows only threads with unread messages', C.filterThreads(T, 'unread').length === 2);
  ok('FILTER · Internal means direct messages', C.filterThreads(T, 'dm').length === 1);
  ok('FILTER · Leads covers both lead and business threads', C.filterThreads(T, 'lead').length === 1);
  ok('FILTER · Groups are their own filter', C.filterThreads(T, 'group').length === 1);
  ok('SEARCH · matches the conversation name', C.filterThreads(T, 'all', 'bhogawati').length === 1);
  ok('SEARCH · matches the last message text', C.filterThreads(T, 'all', 'quotation').length === 1);
  ok('SEARCH · matches the subtitle', C.filterThreads(T, 'all', 'maharashtra').length === 1);
  ok('SEARCH · is case and space insensitive', C.filterThreads(T, 'all', '  ARIF ').length === 1);
  ok('SEARCH · combines with the filter rather than replacing it',
     C.filterThreads(T, 'unread', 'arif').length === 1 && C.filterThreads(T, 'unread', 'sales team').length === 0);
  ok('UNREAD · the global badge is the sum of the threads', C.totalUnread(T) === 4);
  ok('UNREAD · an empty list is zero, not NaN', C.totalUnread([]) === 0);
  ok('PREVIEW · a thread with no messages says so, rather than showing blank',
     C.previewOf({ last_body: '' }) === 'No messages yet');
}

/* ── AVATARS ─────────────────────────────────────────────────────────────── */
{
  ok('AVATAR · two words give two initials', C.initials('Haji Kayyum') === 'HK');
  ok('AVATAR · one word gives two letters', C.initials('GALAXY') === 'GA');
  ok('AVATAR · a long name uses first and last', C.initials('Bhogawati Cooperative Sugar Factory Ltd') === 'BL');
  ok('AVATAR · nothing gives a placeholder, not a crash', C.initials('') === '?');
  ok('AVATAR · the colour is stable for a name', C.avatarTint('GALAXY SUGAR') === C.avatarTint('GALAXY SUGAR'));
  ok('AVATAR · and differs between names', C.avatarTint('A') !== C.avatarTint('B'));
}

/* ── ERP CARDS: a summary, never a database row ──────────────────────────── */
{
  const invoice = { id: 'INV-2026-00451', ref: 'INV-2026-00451', party: 'ABC Industries',
    amount: 245600, status: 'Pending', date: '2026-08-01',
    /* fields that must NOT travel */
    cost_price: 111111, margin: 42, internal_note: 'squeeze them', gstin_password: 'secret' };
  const card = C.cardSummary('invoice', invoice);
  ok('CARD · carries the fields a person needs to recognise it',
     card.ref === 'INV-2026-00451' && card.party === 'ABC Industries' && card.amount === 245600);
  ok('CARD · carries NOTHING else — no cost, no margin, no internal note',
     card.cost_price === undefined && card.margin === undefined &&
     card.internal_note === undefined && card.gstin_password === undefined);
  ok('CARD · every key on the card is on the allow-list',
     Object.keys(card).every(k => k === 'type' || k === 'id' || C.CARD_FIELDS.invoice.includes(k)));
  ok('CARD · an unknown record type is not shareable at all', C.cardSummary('payroll', invoice) === null);
  ok('CARD · a missing field is omitted, not sent as empty',
     C.cardSummary('invoice', { id: 'X', ref: 'X' }).party === undefined);

  /* Permission to OPEN is by role, and it is checked again server-side. */
  ok('PERM · a sales user may open an invoice card', C.canOpenCard('sales', 'invoice'));
  ok('PERM · a sales user may NOT open a purchase bill', !C.canOpenCard('sales', 'bill'));
  ok('PERM · a purchase user may open a bill but not an invoice',
     C.canOpenCard('purchase', 'bill') && !C.canOpenCard('purchase', 'invoice'));
  ok('PERM · accounts may open a payment', C.canOpenCard('accountant', 'payment'));
  ok('PERM · sales may NOT open a payment', !C.canOpenCard('sales', 'payment'));
  ok('PERM · the owner may open anything', C.canOpenCard('owner', 'payment') && C.canOpenCard('owner', 'bill'));
  ok('PERM · an unknown role is granted nothing', !C.canOpenCard('intern', 'invoice'));
  ok('PERM · an unknown card type is never openable', !C.canOpenCard('owner', 'payroll'));
  ok('PERM · the client map matches the roles the server enforces',
     C.roleCan('accountant', 'finance') && !C.roleCan('sales', 'finance'));
}

console.log('\n════ chat-core (one conversation per subject) ════');
console.log('  Passed: ' + pass + '   Failed: ' + fail);
bad.forEach(b => console.log('    ✗ ' + b));
console.log(fail === 0 ? '\n✅ ALL ' + pass + ' CHAT-CORE TESTS PASSED\n' : '\n❌ FAILED\n');
process.exit(fail === 0 ? 0 : 1);
