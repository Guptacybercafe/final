(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const api = async (url, method = 'GET', body) => {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !url.includes('login')) { showLogin(); throw new Error('Login required'); }
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Request failed'); return j;
  };
  let timer, formDirty = false;

  function showLogin() { clearInterval(timer); $('#app').hidden = true; $('#loginView').hidden = false; }
  function showApp() { $('#loginView').hidden = true; $('#app').hidden = false; load(true); clearInterval(timer); timer = setInterval(() => load(false), 5000); }

  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api('/api/admin/login', 'POST', { password: $('#pw').value }); $('#pw').value = ''; $('#loginMsg').textContent = ''; $('#defBanner').hidden = !r.defaultPassword; showApp(); }
    catch (err) { $('#loginMsg').textContent = err.message; }
  };
  $('#logout').onclick = async () => { await api('/api/admin/logout', 'POST'); showLogin(); };

  function fillPrinters(sel, list, current) {
    const opts = new Set(list); if (current) opts.add(current);
    sel.innerHTML = '<option value="">-- choose printer --</option>' + [...opts].map(p => `<option ${p === current ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }

  async function load(full) {
    const s = await api('/api/admin/state');
    const st = s.stats;
    $('#stats').innerHTML = [['Jobs today', st.today], ['Pages today', st.todayPages], ['Earned today (printed)', 'Rs ' + st.todayAmount], ['Waiting', st.queued], ['Failed', st.failed]]
      .map(([l, v]) => `<div class="card stat"><b>${v}</b><span>${l}</span></div>`).join('');
    if (full || !formDirty) {
      $('#autoPrint').checked = s.settings.autoPrint; $('#accepting').checked = s.settings.acceptingJobs;
      $('#colorOn').checked = s.settings.printers.color.enabled; $('#bwOn').checked = s.settings.printers.bw.enabled;
      $('#colorPrice').value = s.settings.pricePerPage.color; $('#bwPrice').value = s.settings.pricePerPage.bw;
      fillPrinters($('#colorName'), s.systemPrinters, s.settings.printers.color.name);
      fillPrinters($('#bwName'), s.systemPrinters, s.settings.printers.bw.name);
    }
    $('#jobs').innerHTML = s.jobs.map(j => `<tr>
      <td><b>${esc(j.id)}</b></td>
      <td>${new Date(j.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${esc(j.name) || '-'}<br><span class="muted">${esc(j.phone)}</span></td>
      <td>${esc(j.original)}</td>
      <td>${j.mode === 'color' ? 'Colour' : 'B&amp;W'}</td>
      <td>${j.pages} x ${j.copies}</td><td>${j.amount}</td>
      <td><span class="pill ${j.status}">${j.status}</span>${j.error ? `<br><span class="bad" style="font-size:12px">${esc(j.error)}</span>` : ''}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-act="print" data-id="${j.id}">${j.status === 'printed' ? 'Reprint' : 'Print'}</button>
        <a class="btn sm" href="/api/admin/jobs/${j.id}/file">PDF</a>
        <button class="btn sm danger" data-act="del" data-id="${j.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="9" class="muted">No jobs yet.</td></tr>';
  }

  ['autoPrint', 'accepting', 'colorOn', 'bwOn', 'colorName', 'bwName', 'colorPrice', 'bwPrice'].forEach(id => $('#' + id).addEventListener('input', () => formDirty = true));

  const collect = () => ({
    autoPrint: $('#autoPrint').checked, acceptingJobs: $('#accepting').checked,
    printers: { color: { enabled: $('#colorOn').checked, name: $('#colorName').value }, bw: { enabled: $('#bwOn').checked, name: $('#bwName').value } },
    pricePerPage: { color: $('#colorPrice').value, bw: $('#bwPrice').value }
  });
  const flash = (t, bad) => { const m = $('#saveMsg'); m.textContent = t; m.className = bad ? 'bad' : 'ok'; setTimeout(() => m.textContent = '', 4000); };

  $('#saveAll').onclick = async () => { try { await api('/api/admin/settings', 'POST', collect()); formDirty = false; flash('Saved'); } catch (e) { flash(e.message, true); } };
  // the two switches apply instantly
  $('#autoPrint').onchange = $('#accepting').onchange = async () => { try { await api('/api/admin/settings', 'POST', { autoPrint: $('#autoPrint').checked, acceptingJobs: $('#accepting').checked }); flash('Saved'); } catch (e) { flash(e.message, true); } };

  for (const m of ['color', 'bw']) {
    $('#' + m + 'Test').onclick = async () => {
      try { await api('/api/admin/settings', 'POST', collect()); formDirty = false; await api('/api/admin/test/' + m, 'POST'); flash('Test page sent to ' + (m === 'color' ? 'colour' : 'B&W') + ' printer'); }
      catch (e) { flash(e.message, true); }
    };
  }
  $('#setPw').onclick = async () => { try { await api('/api/admin/password', 'POST', { password: $('#newPw').value }); $('#newPw').value = ''; $('#defBanner').hidden = true; flash('Password changed'); } catch (e) { flash(e.message, true); } };
  $('#printAll').onclick = async () => { const r = await api('/api/admin/print-all', 'POST'); flash(r.count + ' job(s) processed'); load(false); };

  $('#jobs').onclick = async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    try {
      if (b.dataset.act === 'print') { b.disabled = true; await api(`/api/admin/jobs/${b.dataset.id}/print`, 'POST'); }
      if (b.dataset.act === 'del' && confirm('Delete this job and its file?')) await api('/api/admin/jobs/' + b.dataset.id, 'DELETE');
    } catch (err) { alert(err.message); }
    load(false);
  };

  api('/api/admin/me').then(r => { $('#defBanner').hidden = !r.defaultPassword; showApp(); }).catch(() => showLogin());
})();
