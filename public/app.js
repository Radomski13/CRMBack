// Fly Visuals Shop Tool — front end (no build step).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => { const v = Math.round((Number(n) || 0) * 100) / 100; const d = Number.isInteger(v) ? 0 : 2; return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); };
const S = { me: null, settings: null, jobs: [], materials: [], view: 'board', weekStart: startOfWeek(new Date()), filter: { q: '', who: '' }, quote: { type: 'wrap' } };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('login'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast(data.error || 'Something went wrong'); throw new Error(data.error); }
  return data;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

// ---------- dates ----------
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
function ymd(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function niceDate(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }

// ---------- auth ----------
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#lname').value = localStorage.getItem('fv_name') || ''; }
$('#lgo').onclick = async () => {
  $('#lerr').textContent = '';
  try {
    const name = $('#lname').value.trim() || 'Staff';
    await api('/login', { method: 'POST', body: { name, password: $('#lpass').value } });
    try { localStorage.setItem('fv_name', name); } catch {}
    boot();
  } catch (e) { $('#lerr').textContent = 'Wrong password'; }
};
$('#lpass').onkeydown = e => { if (e.key === 'Enter') $('#lgo').click(); };
$('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); showLogin(); };

async function boot() {
  try { S.me = (await api('/me')).name; } catch { return; }
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#whoName').textContent = S.me;
  S.settings = await api('/settings');
  await reload();
  render();
  setInterval(async () => { if (!document.querySelector('.scrim')) { await reload(); render(); } }, 30000);
}
async function reload() { [S.jobs, S.materials] = await Promise.all([api('/jobs'), api('/materials')]); }

$('#nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.view = b.dataset.v;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  render();
};
function render() { ({ board: renderBoard, cal: renderCal, quote: renderQuote, mat: renderMat, set: renderSettings })[S.view](); }

// ---------- job card ----------
function cardHtml(j, compact) {
  const today = ymd(new Date());
  const late = j.install_date && j.install_date < today && j.stage !== 'done';
  return `<div class="card" draggable="true" data-id="${j.id}">
    <div class="t">${esc(j.customer)}</div>
    <div class="s">${esc(j.title || j.service || '')}${j.vehicle ? ' · ' + esc(j.vehicle) : ''}</div>
    ${compact ? '' : `<div class="tags">
      ${j.source === 'ghl' ? '<span class="tag ghl">GHL</span>' : ''}
      ${j.install_date ? `<span class="tag ${late ? 'late' : 'date'}">${niceDate(j.install_date)}${j.bay ? ' · ' + esc(j.bay) : ''}</span>` : ''}
      ${j.assigned_to ? `<span class="tag">${esc(j.assigned_to)}</span>` : ''}
      ${j.value ? `<span class="tag">${money(j.value)}</span>` : ''}
    </div>`}
  </div>`;
}
function wireCards(root) {
  root.querySelectorAll('.card').forEach(c => {
    c.onclick = () => openJob(+c.dataset.id);
    c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.id); };
  });
}
function filteredJobs() {
  const q = S.filter.q.toLowerCase();
  return S.jobs.filter(j => (!q || [j.customer, j.title, j.vehicle, j.service, j.phone].join(' ').toLowerCase().includes(q))
    && (!S.filter.who || j.assigned_to === S.filter.who));
}

// ---------- board ----------
function renderBoard() {
  const st = S.settings;
  const jobs = filteredJobs();
  const open = S.jobs.filter(j => j.stage !== 'done');
  $('#view').innerHTML = `
    <div class="toolbar">
      <h2>Job Board</h2>
      <span class="muted">${open.length} open · ${money(open.reduce((a, j) => a + (+j.value || 0), 0))} in the shop</span>
      <input id="fq" placeholder="Search customer, vehicle…" value="${esc(S.filter.q)}">
      <select id="fwho"><option value="">Everyone</option>${st.team.map(t => `<option ${S.filter.who === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <button class="btn primary" id="newJob">+ New job</button>
    </div>
    <div class="board">${st.stages.map(s => {
      const list = jobs.filter(j => j.stage === s.id || (!st.stages.some(x => x.id === j.stage) && s === st.stages[0]));
      return `<div class="col" data-stage="${s.id}"><h3>${esc(s.name)} <span>${list.length}</span></h3>
        <div class="drop">${list.map(j => cardHtml(j)).join('')}</div></div>`;
    }).join('')}</div>`;
  $('#fq').oninput = e => { S.filter.q = e.target.value; const p = e.target.selectionStart; renderBoard(); const f = $('#fq'); f.focus(); f.setSelectionRange(p, p); };
  $('#fwho').onchange = e => { S.filter.who = e.target.value; renderBoard(); };
  $('#newJob').onclick = () => openJob(null);
  wireCards($('#view'));
  document.querySelectorAll('.col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove('over');
      const id = +e.dataTransfer.getData('text/plain');
      const j = S.jobs.find(x => x.id === id);
      if (!j || j.stage === col.dataset.stage) return;
      j.stage = col.dataset.stage; renderBoard();
      await api('/jobs/' + id, { method: 'PATCH', body: { stage: col.dataset.stage } });
    };
  });
}

// ---------- job modal ----------
async function openJob(id, preset = {}) {
  const st = S.settings;
  const j = id ? await api('/jobs/' + id) : { stage: st.stages[0].id, activity: [], materials: [], ...preset };
  const opt = (arr, val, blank = true) => (blank ? '<option value=""></option>' : '') + arr.map(v => `<option ${v === val ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const matCost = (j.materials || []).reduce((a, m) => a + m.qty * m.cost, 0);
  $('#modalRoot').innerHTML = `<div class="scrim"><div class="modal">
    <div class="toolbar"><h2>${id ? esc(j.customer) : 'New job'}</h2>
      ${j.source === 'ghl' ? '<span class="tag ghl">From GoHighLevel</span>' : ''}
      <button class="btn" id="mClose">Close</button></div>
    <div class="grid">
      <div><label>Customer</label><input id="f_customer" value="${esc(j.customer)}"></div>
      <div><label>Phone</label><input id="f_phone" value="${esc(j.phone)}"></div>
      <div><label>Email</label><input id="f_email" value="${esc(j.email)}"></div>
      <div><label>Job title</label><input id="f_title" value="${esc(j.title)}"></div>
      <div><label>Service</label><input id="f_service" list="svcList" value="${esc(j.service)}">
        <datalist id="svcList"><option>Full wrap</option><option>Partial wrap</option><option>Lettering / decals</option><option>Window tint</option><option>PPF</option><option>Sign</option><option>Banner</option></datalist></div>
      <div><label>Vehicle</label><input id="f_vehicle" placeholder="Year make model" value="${esc(j.vehicle)}"></div>
      <div><label>Stage</label><select id="f_stage">${st.stages.map(s => `<option value="${s.id}" ${s.id === j.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label>Job value ($)</label><input id="f_value" type="number" step="0.01" value="${esc(j.value || '')}"></div>
      <div><label>Install date</label><input id="f_install_date" type="date" value="${esc(j.install_date)}"></div>
      <div><label>Bay</label><select id="f_bay">${opt(st.bays, j.bay)}</select></div>
      <div><label>Assigned to</label><select id="f_assigned_to">${opt(st.team, j.assigned_to)}</select></div>
    </div>
    <div class="section"><label>Notes</label><textarea id="f_notes">${esc(j.notes)}</textarea></div>
    <div class="row section"><button class="btn primary" id="mSave">${id ? 'Save changes' : 'Create job'}</button>
      ${id ? '<button class="btn danger" id="mDel" style="margin-left:auto">Delete job</button>' : ''}</div>
    ${id ? `<div class="two">
      <div><div class="section"><h3>Activity</h3>
        <div class="row" style="margin-bottom:8px"><input id="cText" placeholder="Add a note for the team…"><button class="btn" id="cAdd">Post</button></div>
        <div class="feed">${j.activity.map(a => `<div><b>${esc(a.who)}</b> ${esc(a.text)}<br><small>${esc(a.at)} UTC</small></div>`).join('') || '<span class="muted">No activity yet</span>'}</div></div></div>
      <div><div class="section"><h3>Materials used</h3>
        <div class="row" style="margin-bottom:8px">
          <select id="mmId"><option value="">Material…</option>${S.materials.map(m => `<option value="${m.id}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>
          <input id="mmQty" type="number" step="0.1" placeholder="Qty" style="width:80px"><button class="btn" id="mmAdd">Log</button></div>
        <div class="feed">${j.materials.map(m => `<div>${esc(m.qty)} ${esc(m.unit)} · ${esc(m.name)} <small>${money(m.qty * m.cost)}</small>
          <button class="btn sm danger" data-undo="${m.id}" style="float:right">Undo</button></div>`).join('') || '<span class="muted">Nothing logged</span>'}</div>
        <p class="muted">Material cost: <b>${money(matCost)}</b>${j.value ? ` · Margin after material: <b>${money(j.value - matCost)}</b>` : ''}</p>
      </div></div></div>` : ''}
  </div></div>`;
  const close = async () => { $('#modalRoot').innerHTML = ''; await reload(); render(); };
  $('#mClose').onclick = close;
  $('.scrim').onclick = e => { if (e.target.classList.contains('scrim')) close(); };
  $('#mSave').onclick = async () => {
    const body = {};
    ['customer', 'phone', 'email', 'title', 'service', 'vehicle', 'stage', 'value', 'install_date', 'bay', 'assigned_to', 'notes']
      .forEach(f => body[f] = $('#f_' + f).value);
    body.value = parseFloat(body.value) || 0;
    if (!body.customer.trim()) return toast('Add a customer name');
    if (body.install_date && j.stage === st.stages[0].id && body.stage === j.stage) {
      const sched = st.stages.find(s => s.id === 'scheduled'); if (sched) body.stage = 'scheduled';
    }
    if (id) await api('/jobs/' + id, { method: 'PATCH', body }); else await api('/jobs', { method: 'POST', body });
    toast('Saved'); close();
  };
  if (!id) return;
  $('#mDel').onclick = async () => { if (confirm('Delete this job? Logged material goes back into stock.')) { await api('/jobs/' + id, { method: 'DELETE' }); close(); } };
  $('#cAdd').onclick = async () => { const t = $('#cText').value.trim(); if (!t) return; await api(`/jobs/${id}/comment`, { method: 'POST', body: { text: t } }); openJob(id); };
  $('#cText').onkeydown = e => { if (e.key === 'Enter') $('#cAdd').click(); };
  $('#mmAdd').onclick = async () => {
    await api(`/jobs/${id}/materials`, { method: 'POST', body: { material_id: +$('#mmId').value, qty: $('#mmQty').value } });
    S.materials = await api('/materials'); openJob(id);
  };
  document.querySelectorAll('[data-undo]').forEach(b => b.onclick = async () => {
    await api('/job-materials/' + b.dataset.undo, { method: 'DELETE' }); S.materials = await api('/materials'); openJob(id);
  });
}

// ---------- calendar ----------
function renderCal() {
  const st = S.settings;
  const days = [...Array(7)].map((_, i) => addDays(S.weekStart, i));
  const today = ymd(new Date());
  const rows = [...st.bays, 'No bay'];
  const inWeek = S.jobs.filter(j => j.install_date && j.install_date >= ymd(days[0]) && j.install_date <= ymd(days[6]));
  const unsched = S.jobs.filter(j => !j.install_date && j.stage !== 'done');
  let grid = `<div class="hd"></div>` + days.map(d => `<div class="hd ${ymd(d) === today ? 'today' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })}</div>`).join('');
  for (const bay of rows) {
    grid += `<div class="bay">${esc(bay)}</div>`;
    for (const d of days) {
      const list = inWeek.filter(j => j.install_date === ymd(d) && ((j.bay || 'No bay') === bay || (bay === 'No bay' && !st.bays.includes(j.bay))));
      grid += `<div class="cell" data-date="${ymd(d)}" data-bay="${bay === 'No bay' ? '' : esc(bay)}">${list.map(j => cardHtml(j, true)).join('')}</div>`;
    }
  }
  $('#view').innerHTML = `
    <div class="toolbar"><h2>Install Calendar</h2>
      <button class="btn" id="wPrev">← Prev</button><button class="btn" id="wToday">This week</button><button class="btn" id="wNext">Next →</button></div>
    <p class="muted" style="margin-top:-6px">Drag a job onto a day and bay to schedule it. ${inWeek.length} installs this week.</p>
    <div class="callay">
      <div class="cal">${grid}</div>
      <div class="unsched"><h3>Not scheduled (${unsched.length})</h3>${unsched.map(j => cardHtml(j, true)).join('') || '<span class="muted">All caught up</span>'}</div>
    </div>`;
  $('#wPrev').onclick = () => { S.weekStart = addDays(S.weekStart, -7); renderCal(); };
  $('#wNext').onclick = () => { S.weekStart = addDays(S.weekStart, 7); renderCal(); };
  $('#wToday').onclick = () => { S.weekStart = startOfWeek(new Date()); renderCal(); };
  wireCards($('#view'));
  document.querySelectorAll('.cell').forEach(c => {
    c.ondragover = e => { e.preventDefault(); c.classList.add('over'); };
    c.ondragleave = () => c.classList.remove('over');
    c.ondrop = async e => {
      e.preventDefault(); c.classList.remove('over');
      const id = +e.dataTransfer.getData('text/plain');
      const j = S.jobs.find(x => x.id === id); if (!j) return;
      const body = { install_date: c.dataset.date, bay: c.dataset.bay };
      const early = st.stages.findIndex(s => s.id === j.stage) < st.stages.findIndex(s => s.id === 'scheduled');
      if (early && st.stages.some(s => s.id === 'scheduled')) body.stage = 'scheduled';
      Object.assign(j, body); renderCal();
      await api('/jobs/' + id, { method: 'PATCH', body });
    };
  });
}

// ---------- quote calculator ----------
function renderQuote() {
  const P = S.settings.pricing, q = S.quote;
  const sel = (id, obj, val) => `<select id="${id}">${Object.keys(obj).map(k => `<option ${k === val ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>`;
  let form = '';
  if (q.type === 'wrap') {
    q.size ??= Object.keys(P.wrap.sqft)[1]; q.mat ??= Object.keys(P.wrap.material_per_sqft)[1]; q.cover ??= 100; q.design ??= true;
    form = `<div class="grid">
      <div><label>Vehicle size</label>${sel('q_size', P.wrap.sqft, q.size)}</div>
      <div><label>Material</label>${sel('q_mat', P.wrap.material_per_sqft, q.mat)}</div>
      <div><label>Coverage %</label><input id="q_cover" type="number" value="${q.cover}"></div>
      <div><label>Override sq ft (optional)</label><input id="q_sqft" type="number" value="${q.sqft ?? ''}"></div>
      <div><label><input type="checkbox" id="q_design" ${q.design ? 'checked' : ''} style="width:auto"> Include design fee</label></div></div>`;
  } else if (q.type === 'tint') {
    q.car ??= Object.keys(P.tint.base)[1]; q.film ??= 'Ceramic'; q.adds ??= [];
    form = `<div class="grid">
      <div><label>Vehicle</label>${sel('q_car', P.tint.base, q.car)}</div>
      <div><label>Film</label>${sel('q_film', P.tint.film, q.film)}</div></div>
      <div class="section"><label>Add-ons</label>${Object.keys(P.tint.addons).map(a => `<label style="display:inline-flex;gap:6px;margin-right:14px;color:var(--ink)"><input type="checkbox" data-add="${esc(a)}" ${q.adds.includes(a) ? 'checked' : ''} style="width:auto">${esc(a)} (${money(P.tint.addons[a])})</label>`).join('')}</div>`;
  } else {
    q.smat ??= Object.keys(P.sign.per_sqft)[0]; q.w ??= 24; q.h ??= 18; q.qty ??= 1; q.inst ??= false;
    form = `<div class="grid">
      <div><label>Material</label>${sel('q_smat', P.sign.per_sqft, q.smat)}</div>
      <div><label>Width (in)</label><input id="q_w" type="number" value="${q.w}"></div>
      <div><label>Height (in)</label><input id="q_h" type="number" value="${q.h}"></div>
      <div><label>Quantity</label><input id="q_qty" type="number" value="${q.qty}"></div>
      ${P.sign.install_fee ? `<div><label><input type="checkbox" id="q_inst" ${q.inst ? 'checked' : ''} style="width:auto"> Install (${money(P.sign.install_fee)})</label></div>` : ''}</div>`;
  }
  const lines = quoteLines();
  const sub = lines.reduce((a, l) => a + l[1], 0);
  q.discount ??= 0;
  const disc = sub * (q.discount / 100);
  const tax = (sub - disc) * (P.tax_rate / 100);
  const total = sub - disc + tax;
  q.total = total; q.lines = lines;
  $('#view').innerHTML = `
    <div class="toolbar"><h2>Quote Calculator</h2><span class="muted">Prices come from Settings → Pricing</span></div>
    <div class="qwrap">
      <div class="panel">
        <div class="seg">${[['wrap', 'Wrap'], ['tint', 'Window tint'], ['sign', 'Signs']].map(([k, n]) => `<button class="btn ${q.type === k ? 'on' : ''}" data-qt="${k}">${n}</button>`).join('')}</div>
        ${form}
        <div class="grid section"><div><label>Discount %</label><input id="q_disc" type="number" value="${q.discount}"></div></div>
      </div>
      <div class="panel">
        <h3 style="font-size:20px">Quote</h3>
        <table class="lines">${lines.map(l => `<tr><td>${esc(l[0])}</td><td>${money(l[1])}</td></tr>`).join('')}
          ${disc ? `<tr><td>Discount (${q.discount}%)</td><td>−${money(disc)}</td></tr>` : ''}
          <tr><td>Tax (${P.tax_rate}%)</td><td>${money(tax)}</td></tr></table>
        <div class="total">${money(total)}</div>
        <div class="section"><label>Customer</label><input id="q_cust" value="${esc(q.cust || '')}" placeholder="Name"></div>
        <div class="section"><label>Vehicle / notes</label><input id="q_veh" value="${esc(q.veh || '')}" placeholder="2022 Ford Transit"></div>
        <div class="row section"><button class="btn primary" id="qJob">Create job</button><button class="btn" id="qCopy">Copy quote text</button></div>
      </div>
    </div>`;
  document.querySelectorAll('[data-qt]').forEach(b => b.onclick = () => { q.type = b.dataset.qt; renderQuote(); });
  const bind = (id, key, num) => { const el = $('#' + id); if (el) el.onchange = el.oninput = () => { q[key] = el.type === 'checkbox' ? el.checked : num ? (el.value === '' ? undefined : +el.value) : el.value; if (el.tagName === 'SELECT' || el.type === 'checkbox') renderQuote(); else updateTotalsOnly(); }; };
  bind('q_size', 'size'); bind('q_mat', 'mat'); bind('q_cover', 'cover', 1); bind('q_sqft', 'sqft', 1); bind('q_design', 'design');
  bind('q_car', 'car'); bind('q_film', 'film');
  bind('q_smat', 'smat'); bind('q_w', 'w', 1); bind('q_h', 'h', 1); bind('q_qty', 'qty', 1); bind('q_inst', 'inst');
  bind('q_disc', 'discount', 1);
  document.querySelectorAll('[data-add]').forEach(c => c.onchange = () => { q.adds = [...document.querySelectorAll('[data-add]:checked')].map(x => x.dataset.add); renderQuote(); });
  $('#q_cust').oninput = e => q.cust = e.target.value;
  $('#q_veh').oninput = e => q.veh = e.target.value;
  $('#qCopy').onclick = () => {
    const txt = `Fly Visuals quote${q.cust ? ' for ' + q.cust : ''}\n` + q.lines.map(l => `${l[0]}: ${money(l[1])}`).join('\n') + `\nTotal (incl. tax): ${money(q.total)}`;
    navigator.clipboard.writeText(txt).then(() => toast('Copied'));
  };
  $('#qJob').onclick = () => {
    if (!q.cust) return toast('Add the customer name');
    const svc = { wrap: 'Full wrap', tint: 'Window tint', sign: 'Sign' }[q.type];
    openJob(null, { customer: q.cust, vehicle: q.veh, service: svc, title: `${svc} — ${q.lines[0]?.[0] || ''}`, value: Math.round(q.total * 100) / 100,
      notes: q.lines.map(l => `${l[0]}: ${money(l[1])}`).join('\n') });
  };
  // Typing in number fields recalculates without losing focus.
  function updateTotalsOnly() { const a = document.activeElement?.id; const p = document.activeElement?.selectionStart; renderQuote(); if (a) { const el = $('#' + a); el.focus(); try { el.setSelectionRange(p, p); } catch {} } }
}
function quoteLines() {
  const P = S.settings.pricing, q = S.quote, L = [];
  if (q.type === 'wrap') {
    const sqft = q.sqft || Math.round((P.wrap.sqft[q.size] || 0) * (q.cover || 0) / 100);
    L.push([`${q.mat} vinyl + laminate — ${sqft} sq ft`, sqft * (P.wrap.material_per_sqft[q.mat] || 0)]);
    L.push([`Install labor — ${sqft} sq ft`, sqft * P.wrap.labor_per_sqft]);
    if (q.design) L.push(['Design', P.wrap.design_fee]);
  } else if (q.type === 'tint') {
    L.push([`${q.film} tint — ${q.car}`, Math.round((P.tint.film[q.film] || 0) * (P.tint.base[q.car] || 1))]);
    for (const a of q.adds || []) L.push([a, P.tint.addons[a] || 0]);
  } else {
    const each = Math.max(((q.w || 0) * (q.h || 0) / 144) * (P.sign.per_sqft[q.smat] || 0), P.sign.min_charge);
    L.push([`${q.qty} × ${q.w}"×${q.h}" ${q.smat}`, each * (q.qty || 0)]);
    if (q.inst && P.sign.install_fee) L.push(['Install', P.sign.install_fee]);
  }
  return L.map(([n, v]) => [n, Math.round(v * 100) / 100]);
}

// ---------- materials ----------
function renderMat() {
  const low = S.materials.filter(m => m.on_hand <= m.reorder_at);
  const value = S.materials.reduce((a, m) => a + m.on_hand * m.cost, 0);
  $('#view').innerHTML = `
    <div class="toolbar"><h2>Materials</h2>
      <span class="muted">${S.materials.length} items · ${money(value)} on hand · ${low.length ? `<b style="color:var(--bad)">${low.length} need reorder</b>` : 'stock OK'}</span>
      <button class="btn primary" id="mAdd">+ Add material</button></div>
    <div class="scroll"><table class="data"><tr><th>Name</th><th>Category</th><th>Unit</th><th>On hand</th><th>Reorder at</th><th>Cost / unit</th><th>Status</th><th></th></tr>
    ${S.materials.map(m => `<tr class="${m.on_hand <= m.reorder_at ? 'low' : ''}" data-id="${m.id}">
      <td><input data-f="name" value="${esc(m.name)}"></td>
      <td><select data-f="category">${['Vinyl', 'Laminate', 'Tint film', 'PPF', 'Substrate', 'Ink', 'Other'].map(c => `<option ${c === m.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><select data-f="unit">${['sq ft', 'roll', 'sheet', 'ft', 'each'].map(c => `<option ${c === m.unit ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><input data-f="on_hand" type="number" step="0.1" value="${m.on_hand}" style="width:90px"></td>
      <td><input data-f="reorder_at" type="number" step="0.1" value="${m.reorder_at}" style="width:90px"></td>
      <td><input data-f="cost" type="number" step="0.01" value="${m.cost}" style="width:90px"></td>
      <td>${m.on_hand <= m.reorder_at ? '<span class="pill low">Reorder</span>' : '<span class="pill ok">OK</span>'}</td>
      <td><button class="btn sm danger" data-del="${m.id}">Remove</button></td></tr>`).join('')}
    </table></div>
    ${S.materials.length ? '' : '<p class="muted">No materials yet. Add your vinyl, laminate, tint film and sign blanks to track stock.</p>'}
    <p class="muted">Material logged on a job is deducted here automatically. Edit a cell and click away to save.</p>`;
  $('#mAdd').onclick = async () => { await api('/materials', { method: 'POST', body: { name: 'New material', category: 'Vinyl', unit: 'sq ft' } }); S.materials = await api('/materials'); renderMat(); };
  document.querySelectorAll('tr[data-id] [data-f]').forEach(el => el.onchange = async () => {
    const id = el.closest('tr').dataset.id; const f = el.dataset.f;
    const v = el.type === 'number' ? parseFloat(el.value) || 0 : el.value;
    await api('/materials/' + id, { method: 'PATCH', body: { [f]: v } });
    S.materials = await api('/materials'); renderMat();
  });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this material?')) return;
    await api('/materials/' + b.dataset.del, { method: 'DELETE' }); S.materials = await api('/materials'); renderMat();
  });
}

// ---------- settings ----------
async function renderSettings() {
  const st = S.settings;
  const log = await api('/webhook-log');
  $('#view').innerHTML = `
    <div class="toolbar"><h2>Settings</h2></div>
    <div class="qwrap">
      <div class="panel">
        <h3>Team &amp; bays</h3>
        <div class="grid section">
          <div><label>Team (one per line)</label><textarea id="s_team">${esc(st.team.join('\n'))}</textarea></div>
          <div><label>Bays (one per line)</label><textarea id="s_bays">${esc(st.bays.join('\n'))}</textarea></div>
        </div>
        <div class="section"><label>Board stages — one per line as <code>id | Name</code>. Keep ids short; don't rename an id that has jobs in it.</label>
          <textarea id="s_stages" style="min-height:170px">${esc(st.stages.map(s => `${s.id} | ${s.name}`).join('\n'))}</textarea></div>
        <h3 class="section">Pricing</h3>
        <p class="muted">The starting numbers are placeholders. Set them to your real prices.</p>
        <textarea id="s_pricing" style="min-height:340px;font-family:ui-monospace,monospace;font-size:12px">${esc(JSON.stringify(st.pricing, null, 2))}</textarea>
        <div class="row section"><button class="btn primary" id="sSave">Save settings</button><span class="err" id="sErr"></span></div>
      </div>
      <div class="panel">
        <h3>GoHighLevel connection</h3>
        <p class="muted">In a GHL workflow, add a <b>Custom Webhook</b> (POST) action that sends to:</p>
        <code class="box">${esc(location.origin)}/api/ghl/webhook?key=YOUR_WEBHOOK_KEY</code>
        <p class="muted">Full steps are in the README. Recent webhook hits:</p>
        <div class="feed">${log.map(l => `<div><b>${esc(l.result)}</b> <small>${esc(l.at)} UTC</small><br><small style="word-break:break-all">${esc(l.body.slice(0, 300))}</small></div>`).join('') || '<span class="muted">Nothing received yet</span>'}</div>
      </div>
    </div>`;
  $('#sSave').onclick = async () => {
    try {
      const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);
      const stages = lines($('#s_stages').value).map(l => { const [id, ...n] = l.split('|'); return { id: id.trim(), name: (n.join('|').trim() || id.trim()) }; });
      if (!stages.length) throw new Error('Need at least one stage');
      const body = { team: lines($('#s_team').value), bays: lines($('#s_bays').value), stages, pricing: JSON.parse($('#s_pricing').value) };
      S.settings = await api('/settings', { method: 'PUT', body });
      toast('Settings saved');
    } catch (e) { $('#sErr').textContent = e.message.includes('JSON') ? 'Pricing has a typo (check commas and quotes).' : e.message; }
  };
}

boot();
