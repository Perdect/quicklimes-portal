<?php
/* /rates-manage — rate management FROM THE PORTAL side.

   Uses the owner token the portal login stores in this origin's localStorage
   (ql_plant.token) and talks to the same owner-guarded api/rates.php the app
   uses — one API, two doors, zero duplicated auth. Signed out → a clear path
   to the portal login. Never indexed: this is a door, not a page. */
require __DIR__ . '/rates-lib.php';
ql_head(['title' => 'Manage Website Rates — Deshwali Minerals', 'desc' => 'Rate management for quicklimes.com — owner access.', 'path' => '/rates-manage', 'ld' => []]);
echo '<meta name="robots" content="noindex,nofollow">';
ql_nav('');
?>
<main class="rt-wrap">
  <section class="rt-hero">
    <h1>Manage Website Rates</h1>
    <p class="sub">Update the indicative rates shown on <a href="/lime-rates">quicklimes.com/lime-rates</a> and the product pages.
    Changes go live the moment you press <b>Save &amp; publish</b>; every rate change is added to the public history and the
    old records never change.</p>
  </section>
  <div id="rmGate" class="rt-ratecard" style="display:none">
    <div><div class="lbl">Sign in required</div>
    <p style="margin-top:8px;color:var(--ink-2)">Rates can only be changed by the account owner. Sign in once on the
    <a href="/portal"><b>Customer Portal</b></a> with your Deshwali Minerals login — then come back to this page.</p></div>
  </div>
  <div id="rmApp" style="display:none">
    <div class="rt-tblwrap"><table class="rt-tbl"><thead><tr>
      <th>Product</th><th>Grade</th><th style="min-width:150px">Rate (₹)</th><th>Unit</th><th>Status</th><th style="min-width:220px"></th>
    </tr></thead><tbody id="rmBody"></tbody></table></div>
    <p class="rt-disc">Leave the rate empty and the website shows <b>“On request”</b> for that product. Rates are indicative,
    ex-works and excluding GST — the disclaimer appears beside every rate on the site.</p>
    <div id="rmHist" class="rt-sec"></div>
  </div>
  <p id="rmMsg" style="color:var(--mut);margin-top:14px"></p>
</main>
<script>
'use strict';
var API = 'https://app.quicklimes.com/api/rates.php';
function tok() { try { return (JSON.parse(localStorage.getItem('ql_plant') || 'null') || {}).token || ''; } catch (e) { return ''; } }
async function api(body) {
  var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ token: tok() }, body)) });
  return r.json();
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function inr(v) { return v == null || v === '' ? '—' : '₹' + (+v).toLocaleString('en-IN'); }
var msg = function (t) { document.getElementById('rmMsg').textContent = t || ''; };

async function load() {
  if (!tok()) { document.getElementById('rmGate').style.display = ''; return; }
  var res = await api({ action: 'list' });
  if (!res.ok) {
    document.getElementById('rmGate').style.display = '';
    msg(res.error === 'Forbidden' ? 'This login is not the account owner — only the owner can change public rates.'
      : (res.error === 'Unauthorized' ? 'Your sign-in has expired — sign in again on the Customer Portal.' : (res.error || 'Could not load.')));
    return;
  }
  document.getElementById('rmApp').style.display = '';
  document.getElementById('rmGate').style.display = 'none';
  var tb = document.getElementById('rmBody');
  tb.innerHTML = res.products.map(function (p) {
    return '<tr data-slug="' + esc(p.slug) + '">'
      + '<td><b>' + esc(p.name) + '</b><div style="font-size:.78rem;color:var(--mut)">/' + esc(p.slug) + '</div></td>'
      + '<td>' + esc(p.grade) + '</td>'
      + '<td><input class="rm-rate" type="number" min="0" step="50" value="' + (p.rate == null ? '' : +p.rate) + '" placeholder="On request" style="width:130px;font:600 1rem var(--d1);padding:.5rem .6rem;border:1px solid var(--line);border-radius:9px"></td>'
      + '<td>Per ' + esc(p.unit) + '</td>'
      + '<td>' + (p.published == 1 ? '<b style="color:var(--ok)">Live</b>' : '<span style="color:var(--mut)">Hidden</span>') + '</td>'
      + '<td style="white-space:nowrap">'
      + '<button class="rt-btn rt-btn-primary rt-btn-sm" data-save style="background:var(--blue);color:#fff">Save & publish</button> '
      + (p.published == 1 ? '<button class="rt-btn rt-btn-sm" data-unpub>Unpublish</button> ' : '')
      + '<button class="rt-btn rt-btn-sm" data-hist>History</button>'
      + '</td></tr>';
  }).join('');
  tb.querySelectorAll('[data-save]').forEach(function (b) {
    b.onclick = async function () {
      var tr = b.closest('tr'), slug = tr.dataset.slug;
      var p = res.products.find(function (x) { return x.slug === slug; });
      var rate = tr.querySelector('.rm-rate').value;
      b.disabled = true; msg('Saving ' + p.name + '…');
      var s = await api({ action: 'save', product: { slug: slug, name: p.name, grade: p.grade, unit: p.unit, rate: rate, moq: p.moq, location: p.location, notes: p.notes, seo_title: p.seo_title, seo_desc: p.seo_desc } });
      if (s.ok) await api({ action: 'publish', slug: slug });
      b.disabled = false;
      msg(s.ok ? p.name + (rate ? ' is live at ' + inr(rate) + '/' + p.unit : ' is live as “On request”') + ' — check /lime-rates.' : (s.error || 'Could not save'));
      if (s.ok) load();
    };
  });
  tb.querySelectorAll('[data-unpub]').forEach(function (b) {
    b.onclick = async function () {
      var slug = b.closest('tr').dataset.slug;
      msg('Hiding…'); var s = await api({ action: 'unpublish', slug: slug });
      msg(s.ok ? 'Hidden from the website.' : (s.error || 'Failed')); if (s.ok) load();
    };
  });
  tb.querySelectorAll('[data-hist]').forEach(function (b) {
    b.onclick = async function () {
      var slug = b.closest('tr').dataset.slug;
      var h = await api({ action: 'history', slug: slug });
      var host = document.getElementById('rmHist');
      host.innerHTML = '<h2>Rate history — /' + esc(slug) + '</h2>' + ((h.history || []).length
        ? '<div class="rt-tblwrap"><table class="rt-tbl rt-hist"><thead><tr><th>Date</th><th class="num">Rate</th></tr></thead><tbody>'
          + h.history.map(function (x) { return '<tr><td>' + esc(new Date(x.recorded_at + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) + '</td><td class="num"><b class="rt-amt">' + inr(x.rate) + '</b><span class="rt-unit">/' + esc(x.unit) + '</span></td></tr>'; }).join('')
          + '</tbody></table></div>'
        : '<p style="color:var(--mut)">No rate changes recorded yet.</p>');
      host.scrollIntoView({ behavior: 'smooth' });
    };
  });
}
load();
</script>
<?php ql_footer(); ?>
