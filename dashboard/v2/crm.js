/* ═══════════════════════════════════════════════════════════════════════
   crm.js — Sales Pipeline.

   Rules: crm-core.js (pure, 73 tests). Scoring: icp-core.js (learned from your
   own invoices). Storage: /api/crm. This file only renders and asks.

   Two things it refuses to do:
     • flatter the forecast — gross, weighted AND unpriced are always shown
       together, because showing one of them is how a pipeline lies
     • let you message someone you have no lawful basis to message
   ═══════════════════════════════════════════════════════════════════════ */
const Q = window.QLD, CC = window.CRMCore, IC2 = window.ICPCore;
const esc = QLX.esc, IC = QLX.icons;
const toast = (m, t) => QLX.toast(m, t);
const fC = n => '₹' + (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-IN'));

let DATA = { companies: [], contacts: [], leads: [] };

function api(body) {
  const p = JSON.parse(localStorage.getItem('ql_plant') || '{}');
  return fetch('/api/crm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ plant_id: p.id, company_id: Q.activeCo, token: p.token }, body))
  }).then(r => r.json()).catch(() => ({ ok: false, error: 'Network error' }));
}
const coOf = id => DATA.companies.find(c => +c.id === +id) || {};
const contactsOf = id => DATA.contacts.filter(c => +c.crm_company === +id);

/* Leads joined to their company — the shape the table renders. */
function rows() {
  return DATA.leads.map((l, i) => {
    const c = coOf(l.crm_company);
    return Object.assign({}, l, {
      idx: i, company: c.name || '—', industry: c.industry || '',
      value: CC.leadValue(l), weighted: CC.weightedValue(l),
      stageLabel: CC.stageLabel(l.stage), open: CC.isOpen(l.stage)
    });
  });
}

function stagePill(r) {
  const tone = r.stage === 'won' ? ['#dcfce7', '#15803d'] : r.stage === 'lost' ? ['#fee2e2', '#b91c1c']
    : r.stage === 'negotiat' || r.stage === 'quoted' ? ['#dbeafe', '#1d4ed8'] : ['#f1f5f9', '#475569'];
  return `<span class="qx-pill" style="background:${tone[0]};color:${tone[1]}">${esc(r.stageLabel)}</span>`;
}

/* ── the forecast band: three numbers, always together ── */
function insightHTML() {
  const f = CC.forecast(DATA.leads);
  const wr = CC.winRates(DATA.leads);
  if (!DATA.leads.length) return '';
  return `<div class="crm-fc">
    <div class="crm-fc-n"><b>${fC(f.gross)}</b><span>Pipeline (gross)</span></div>
    <div class="crm-fc-n"><b style="color:var(--ql-success-600,#15803d)">${fC(f.weighted)}</b><span>Weighted — plan against this</span></div>
    <div class="crm-fc-n"><b>${f.open}</b><span>Open leads</span></div>
    ${f.unvalued ? `<div class="crm-fc-n"><b style="color:#c2410c">${f.unvalued}</b><span>No price yet — go and get it</span></div>` : ''}
    <div class="crm-fc-n"><b>${wr.rate !== null ? Math.round(wr.rate * 100) + '%' : '—'}</b><span>${wr.rate !== null ? 'Win rate (' + wr.closed + ' closed)' : esc(wr.why || 'Win rate')}</span></div>
  </div>`;
}

/* ── forms ── */
const CO_SPECS = () => [
  { k: 'name', label: 'Company name', req: true, full: true },
  { k: 'industry', label: 'Industry', type: 'select', opts: () => [['', 'Unknown']].concat((IC2 ? IC2.INDUSTRIES : []).map(i => [i.key, i.label])),
    hint: 'Drives the lead score — it is ranked on what that industry actually earns you.' },
  { k: 'gstin', label: 'GSTIN', upper: true, hint: 'The only true company identity in India. It is what stops two rows for one buyer.' },
  { k: 'state', label: 'State' }, { k: 'city', label: 'City' },
  { k: 'distance_km', label: 'Distance from plant (km)', type: 'number', hint: 'Lime is heavy and cheap — freight decides more deals than price does.' },
  { k: 'est_tpm', label: 'Estimated tonnes / month', type: 'number' },
  { k: 'current_supplier', label: 'Currently buys from' },
  { k: 'source', label: 'How you got them', type: 'select', opts: [['manual', 'Entered by hand'], ['referral', 'Referral'], ['inbound', 'They contacted us'], ['apollo', 'Bought list'], ['exhibition', 'Exhibition / trade fair']] },
  { k: 'notes', label: 'Notes', type: 'textarea', full: true }
];
const CONTACT_SPECS = () => [
  { k: 'name', label: 'Name', req: true },
  { k: 'role', label: 'Role', ph: 'e.g. Purchase Manager' },
  { k: 'phone', label: 'Phone' }, { k: 'whatsapp', label: 'WhatsApp (if different)' },
  { k: 'email', label: 'Email', full: true },
  { k: 'consent_basis', label: 'How may you contact them?', type: 'select', full: true,
    opts: [['none', 'No basis yet — do not contact'], ['inbound', 'They contacted us first'], ['consent', 'They agreed to be contacted'],
           ['contract', 'Existing customer (we supply them)'], ['purchased', 'Bought / scraped list — email only']],
    hint: 'India’s DPDP Act treats this person’s mobile as personal data even in B2B. Buying a list is not permission to WhatsApp them — and cold WhatsApp is what gets numbers banned.' },
  { k: 'consent_note', label: 'Note (where the consent came from)', full: true, ph: 'e.g. gave card at Jaipur expo, 12-Jun-2026' }
];
const LEAD_SPECS = () => [
  { k: 'crm_company', label: 'Company', req: true, type: 'select', full: true, opts: () => DATA.companies.map(c => [String(c.id), c.name]) },
  { k: 'stage', label: 'Stage', type: 'select', opts: CC.STAGES.map(s => [s.key, s.label + '  ·  ' + Math.round(s.p * 100) + '%']) },
  { k: 'tonnes', label: 'Tonnes', type: 'number' },
  { k: 'price_per_tonne', label: 'Price per tonne (₹)', type: 'number', hint: 'Without tonnes AND price the lead has no value — the forecast will say "unknown", not zero.' },
  { k: 'next_action', label: 'Next action', full: true, ph: 'e.g. send sample, call about CaO spec' },
  { k: 'next_action_at', label: 'Next action on', type: 'date' },
  { k: 'expected_close', label: 'Expected close', type: 'date' },
  { k: 'owner', label: 'Owner' }
];

function addCompany(after) {
  QLShell.openForm({
    title: 'Add company', sub: 'A prospective buyer', specs: CO_SPECS(), initial: { source: 'manual' }, saveLabel: 'Add company',
    async onSave(v) {
      // Warn BEFORE writing. Two rows for one buyer means two salesmen quoting
      // one man two prices — worse than never calling him.
      const d = CC.dupeOf(v, DATA.companies);
      if (d.dupe) {
        toast(d.certain ? 'Already in your CRM as "' + d.of.name + '" (same GSTIN)'
                        : 'Looks like a duplicate of "' + d.of.name + '" — check before adding', 'err');
        if (d.certain) return false;
      }
      const r = await api({ action: 'upsertCompany', company: v });
      if (!r.ok) { toast(r.error || 'Could not save', 'err'); return false; }
      toast('Company added'); await load(); if (after) after(r.id);
    }
  });
}
function addContact(companyId) {
  QLShell.openForm({
    title: 'Add contact', sub: coOf(companyId).name || '', specs: CONTACT_SPECS(), initial: { consent_basis: 'none' }, saveLabel: 'Add contact',
    async onSave(v) {
      const r = await api({ action: 'upsertContact', contact: Object.assign({ crm_company: companyId }, v) });
      if (!r.ok) { toast(r.error || 'Could not save', 'err'); return false; }
      toast('Contact added'); await load();
    }
  });
}
function editLead(row) {
  const editing = !!(row && row.id);
  QLShell.openForm({
    title: editing ? 'Edit lead' : 'New lead', sub: editing ? row.company : 'Add to the pipeline',
    specs: LEAD_SPECS(), saveLabel: editing ? 'Save' : 'Add lead',
    initial: editing ? Object.assign({}, row, { crm_company: String(row.crm_company) }) : { stage: 'new' },
    async onSave(v) {
      if (!DATA.companies.length) { toast('Add a company first', 'err'); return false; }
      // The stage rule is the engine's, not this form's.
      if (editing) {
        const mv = CC.canMove(row.stage, v.stage);
        if (!mv.ok) { toast(mv.why, 'err'); return false; }
      }
      // Score it against what your own invoices say pays — only when we know
      // enough to be worth saying. A score off nothing is noise.
      const co = coOf(v.crm_company);
      if (IC2 && co.industry) {
        try {
          // Don't reach for icp.js here — this page doesn't load it, and a
          // missing cost would silently unweight every score by margin, which
          // is the whole point of the score.
          const tonnes = Q.salesRows().filter(s => s.status !== 'cancelled').reduce((a, s) => a + (+s.qty || 0), 0);
          const cpt = IC2.costPerTonne(Q.getPL ? Q.getPL() : null, tonnes);
          const icp = IC2.icpByIndustry({ sales: Q.salesRows(), parties: Q.partyRows(), costPerTonne: cpt });
          const s = IC2.scoreLead({ industry: co.industry, estTonnesPerMonth: +co.est_tpm || +v.tonnes || null, distanceKm: co.distance_km != null ? +co.distance_km : null }, icp);
          v.score = s.score; v.score_why = (s.why || []).join(' · ');
        } catch (_) {}
      }
      const r = await api({ action: 'upsertLead', lead: Object.assign({ id: editing ? row.id : 0 }, v) });
      if (!r.ok) { toast(r.error || 'Could not save', 'err'); return false; }
      toast(editing ? 'Lead updated' : 'Lead added'); await load();
    }
  });
}

/* ── detail ── */
function tabLead(r) {
  const kv = (l, v) => `<div class="qx-kv"><span>${l}</span><b>${v}</b></div>`;
  const co = coOf(r.crm_company);
  const cts = contactsOf(r.crm_company);
  const st = CC.stage(r.stage);
  const contactHTML = cts.length ? cts.map(c => {
    const wa = CC.mayContact(c, 'whatsapp'), em = CC.mayContact(c, 'email');
    return `<div class="crm-ct">
      <div><b>${esc(c.name || '—')}</b> <span class="qx-mut">${esc(c.role || '')}</span>
        ${c.opted_out_at ? '<span class="qx-pill" style="background:#fee2e2;color:#b91c1c">Opted out</span>' : ''}</div>
      <div class="qx-mut" style="font-size:12px">${esc(c.phone || '')} ${c.email ? '· ' + esc(c.email) : ''}</div>
      <div class="crm-consent ${wa.ok ? 'ok' : 'no'}">${wa.ok ? '✓' : '✕'} WhatsApp — ${esc(wa.why)}</div>
      <div class="crm-consent ${em.ok ? 'ok' : 'no'}">${em.ok ? '✓' : '✕'} Email — ${esc(em.why)}</div>
      ${!c.opted_out_at ? `<button class="ql-btn ql-btn-secondary" data-optout="${c.id}" style="margin-top:6px">They asked to stop</button>` : ''}
    </div>`;
  }).join('') : '<div class="qx-mut" style="font-size:12.5px">No contacts yet — and with no contact there is nobody to sell to.</div>';

  return `<div class="qx-sec-h">Lead</div>
    ${kv('Company', esc(co.name || '—'))}${kv('Stage', stagePill(r) + ' <span class="qx-mut">' + Math.round((st ? st.p : 0) * 100) + '% by default</span>')}
    ${kv('Value', r.value === null ? '<span style="color:#c2410c">No price yet — unknown, not zero</span>' : fC(r.value))}
    ${r.value !== null ? kv('Weighted', fC(r.weighted)) : ''}
    ${r.next_action ? kv('Next action', esc(r.next_action) + (r.next_action_at ? ' · ' + esc(r.next_action_at) : '')) : ''}
    ${r.score != null ? kv('Score', '<b>' + r.score + '/100</b>') : ''}
    ${r.score_why ? `<div class="crm-why">${esc(r.score_why)}</div>` : ''}
    <div class="qx-sec-h">Company</div>
    ${kv('Industry', esc(co.industry ? (IC2 ? IC2.industryLabel(co.industry) : co.industry) : 'Not set'))}
    ${co.gstin ? kv('GSTIN', esc(co.gstin)) : ''}${co.city || co.state ? kv('Where', esc([co.city, co.state].filter(Boolean).join(', '))) : ''}
    ${co.distance_km ? kv('Distance', co.distance_km + ' km from the plant') : ''}
    ${co.current_supplier ? kv('Buys from', esc(co.current_supplier)) : ''}
    ${co.party_id ? kv('ERP', '<span class="qx-pill" style="background:#dcfce7;color:#15803d">Already a customer</span>') : ''}
    <div class="qx-sec-h">Contacts <button class="ql-btn ql-btn-secondary" data-addct="${r.crm_company}" style="float:right">+ Add</button></div>
    ${contactHTML}`;
}

/* ── load + mount ── */
async function load() {
  const r = await api({ action: 'list' });
  if (!r.ok) { toast(r.error || 'Could not load the CRM', 'err'); return; }
  DATA = { companies: r.companies || [], contacts: r.contacts || [], leads: r.leads || [] };
  if (window.QLX && QLX.refresh) QLX.refresh();
}

QLX.mount({
  active: 'crm', title: 'Sales Pipeline', accent: 'blue', noun: 'lead', nounPl: 'leads',
  icon: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  data: rows, rowId: r => r.idx,
  subtitle: () => {
    const f = CC.forecast(DATA.leads);
    return `<b>${esc(Q.co ? Q.co.short : '')}</b> · ${f.open} open lead${f.open === 1 ? '' : 's'} · ${fC(f.weighted)} weighted`;
  },
  primary: { label: 'New lead', icon: IC.plus, onClick: () => editLead(null) },
  tools: [
    { label: 'Add company', icon: IC.plus, onClick: () => addCompany() },
    { label: 'Export', icon: IC.dl, onClick: () => exportLeads() }
  ],
  insights: () => insightHTML(),
  quick: [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open', test: r => r.open },
    { key: 'hot', label: 'Quoted / Negotiating', test: r => r.stage === 'quoted' || r.stage === 'negotiat' },
    { key: 'noprice', label: 'No price', test: r => r.value === null && r.open },
    { key: 'won', label: 'Won', test: r => r.stage === 'won' }
  ],
  search: r => [r.company, r.stageLabel, r.owner, r.next_action].join(' '),
  cols: [
    { key: 'company', label: 'Company', sort: true, cell: r => `<b>${esc(r.company)}</b>` },
    { key: 'stage', label: 'Stage', sort: true, cell: stagePill },
    { key: 'tonnes', label: 'Tonnes', num: true, sort: true, cell: r => r.tonnes ? `<span class="qx-num">${r.tonnes}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'value', label: 'Value', num: true, sort: true, cell: r => r.value === null ? '<span class="qx-mut" title="No tonnes/price yet">no price</span>' : `<span class="qx-num">${fC(r.value)}</span>` },
    { key: 'weighted', label: 'Weighted', num: true, sort: true, cell: r => r.weighted === null ? '<span class="qx-mut">—</span>' : `<span class="qx-num" style="color:var(--ql-success-600,#15803d)">${fC(r.weighted)}</span>` },
    { key: 'score', label: 'Score', num: true, sort: true, cell: r => r.score == null ? '<span class="qx-mut">—</span>' : `<span class="qx-num">${r.score}</span>` },
    { key: 'next_action_at', label: 'Next', sort: true, cell: r => r.next_action_at ? `<span class="qx-mut">${esc(r.next_action_at)}</span>` : '<span class="qx-mut">—</span>' },
    { key: 'actions', label: '', cell: r => QLX.actionsCell(r), cls: 'qx-act' }
  ],
  rowActions: r => [
    { tt: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { tt: 'Edit', icon: IC.edit, onClick: r => editLead(r) }
  ],
  rowMenu: r => [
    { label: 'Edit lead', icon: IC.edit, onClick: r => editLead(r) },
    { label: 'Details', icon: IC.eye, onClick: r => QLX.open(r.idx) },
    { label: 'Delete', icon: IC.trash, onClick: async r => { const x = await api({ action: 'del', what: 'lead', id: r.id }); x.ok ? (toast('Lead deleted'), load()) : toast(x.error, 'err'); } }
  ],
  card: r => ({ id: String(r.id), title: esc(r.company), amount: r.value === null ? 'no price' : fC(r.value), status: stagePill(r),
    rows: [['Stage', r.stageLabel], ['Tonnes', r.tonnes || '—'], ['Weighted', r.weighted === null ? '—' : fC(r.weighted)]] }),
  footer: rowsIn => {
    const f = CC.forecast(rowsIn.filter(r => r.open));
    return [{ label: 'Open', value: f.open }, { label: 'Gross', value: fC(f.gross) }, { label: 'Weighted', value: fC(f.weighted), strong: true }];
  },
  detail: r => ({
    eyebrow: 'Lead', title: esc(r.company), sub: (r.value === null ? 'No price yet' : fC(r.value)) + ' · ' + r.stageLabel,
    actions: [{ label: 'Edit', icon: IC.edit, primary: true, onClick: r => editLead(r) }],
    tabs: [{ label: 'Lead', icon: IC.file, render: tabLead }]
  })
});

/* delegated: opt-out + add-contact live inside the detail panel */
document.addEventListener('click', async e => {
  const oo = e.target.closest('[data-optout]');
  if (oo) {
    QLShell.confirmDelete({
      title: 'Record that they asked to stop?',
      desc: 'This is permanent and it is meant to be. They will be excluded from every channel, for good — there is no undo button, because a person who said "stop" said it once and for all.',
      reason: false, confirmLabel: 'Record the opt-out',
      onConfirm: async () => { const r = await api({ action: 'optOut', contact_id: oo.dataset.optout }); r.ok ? (toast('Opt-out recorded'), load()) : toast(r.error, 'err'); }
    });
  }
  const ac = e.target.closest('[data-addct]');
  if (ac) addContact(+ac.dataset.addct);
});

function exportLeads() {
  const r = rows();
  QLShell.exportCSV('pipeline_' + ((Q.co && Q.co.short) || 'leads').replace(/\s+/g, '_'),
    ['Company', 'Industry', 'Stage', 'Tonnes', 'Price/T', 'Value', 'Weighted', 'Score', 'Next action', 'Next on', 'Owner'],
    r.map(x => [x.company, x.industry, x.stageLabel, x.tonnes, x.price_per_tonne, x.value, x.weighted, x.score, x.next_action, x.next_action_at, x.owner]));
  toast('Exported ' + r.length + ' leads');
}

window.__qlOnSwitchCompany = () => load();
window.__qlRefresh = () => load();
QLD.init(() => load());
