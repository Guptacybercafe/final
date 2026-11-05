(function () {
  const $ = s => document.querySelector(s);
  $('#yr').textContent = new Date().getFullYear();

  // ----- services grid with search -----
  const grid = $('#svcGrid');
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function renderServices(q) {
    q = (q || '').toLowerCase().trim();
    grid.innerHTML = SERVICES.map(([title, items]) => {
      const list = q ? items.filter(i => i.toLowerCase().includes(q) || title.toLowerCase().includes(q)) : items;
      if (!list.length) return '';
      return `<details class="card svc" ${q ? 'open' : ''}><summary>${esc(title)} <span>${list.length}</span></summary><ul>${list.map(i => `<li><a href="https://wa.me/919086703813?text=${encodeURIComponent('Hello, I need help with: ' + i)}" target="_blank" rel="noopener">${esc(i)}</a></li>`).join('')}</ul></details>`;
    }).join('') || '<p class="muted">No match. Message us on WhatsApp, we may still be able to help.</p>';
  }
  renderServices();
  $('#svcSearch').addEventListener('input', e => renderServices(e.target.value));

  // ----- print upload -----
  let info = { pricePerPage: { color: 10, bw: 2 }, accepting: true, colorAvailable: true, bwAvailable: true };
  const mode = $('#pMode'), line = $('#priceLine'), form = $('#printForm'), msg = $('#printMsg');
  function updatePrice() { line.textContent = `Rate: Rs ${info.pricePerPage[mode.value]} per page (${mode.value === 'color' ? 'Colour' : 'Black & White'}). Final amount is shown after upload.`; }
  fetch('/api/public-info').then(r => r.json()).then(i => {
    info = i; $('#printClosed').hidden = i.accepting;
    [...mode.options].forEach(o => { if ((o.value === 'color' && !i.colorAvailable) || (o.value === 'bw' && !i.bwAvailable)) o.disabled = true; });
    if (mode.selectedOptions[0].disabled) mode.value = [...mode.options].find(o => !o.disabled)?.value || 'bw';
    updatePrice();
  }).catch(() => { line.textContent = 'Print service is offline right now.'; });
  mode.addEventListener('change', updatePrice);

  form.addEventListener('submit', async e => {
    e.preventDefault(); msg.className = ''; msg.textContent = 'Uploading...';
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const r = await fetch('/api/print-upload', { method: 'POST', body: new FormData(form) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Upload failed');
      msg.className = 'ok';
      msg.innerHTML = `Received. Job ID <strong>${j.id}</strong> &middot; ${j.pages} page(s) &middot; Rs ${j.amount}. ` + (j.autoPrint ? 'Sent to the printer.' : 'Waiting for the operator to print.');
      $('#trackId').value = j.id; form.reset(); updatePrice();
    } catch (err) { msg.className = 'bad'; msg.textContent = err.message; }
    btn.disabled = false;
  });

  $('#trackForm').addEventListener('submit', async e => {
    e.preventDefault(); const out = $('#trackMsg'); const id = $('#trackId').value.trim();
    if (!id) return;
    const r = await fetch('/api/job/' + encodeURIComponent(id)); const j = await r.json();
    out.textContent = r.ok ? `Job ${j.id}: ${j.status.toUpperCase()}` : 'Job not found';
  });
})();
