// Billing: build a bill, print it, save as PDF, send on WhatsApp, keep history in this browser (localStorage).
(function () {
  const $ = s => document.querySelector(s);
  if (!$('#billForm')) return;

  const SHOP = { name: 'Gupta Cyber Cafe', tag: 'Since 2014 | Online Internet Cyber Cafe', owner: 'Yogesh Gupta', wa: '9086703813', call: '8825096033', email: 'yogeshgupta786786@gmail.com', insta: '@guptacybercafe_' };
  const KEY = 'gcc-bills-v1';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const money = n => '₹' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rs = n => 'Rs ' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const niceDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  // ---- storage ----
  const load = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const store = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 1000))); return true; } catch (e) { return false; } };

  const f = { name: $('#bName'), phone: $('#bPhone'), no: $('#bNo'), date: $('#bDate'), disc: $('#bDisc'), gst: $('#bGst'), mode: $('#bMode'), paid: $('#bPaid') };
  const itemsBox = $('#billItems'), msg = $('#billMsg');
  let rates = { bw: 2, color: 10 };
  fetch('/api/public-info').then(r => r.json()).then(i => { if (i && i.pricePerPage) rates = i.pricePerPage; }).catch(() => {});

  // ---- items ----
  function addRow(desc, qty, rate, focus) {
    const row = document.createElement('div'); row.className = 'bill-row';
    row.innerHTML = `<input class="d" placeholder="Item / service" maxlength="80" aria-label="Item" value="${esc(desc || '')}">` +
      `<input class="q" type="number" min="0" step="any" aria-label="Quantity" value="${qty == null ? 1 : qty}">` +
      `<input class="r" type="number" min="0" step="any" aria-label="Rate" placeholder="Rate" value="${rate ? rate : ''}">` +
      `<output class="a">${money(0)}</output>` +
      `<button type="button" class="btn sm danger x" aria-label="Remove item">&times;</button>`;
    itemsBox.appendChild(row); calc();
    if (focus) row.querySelector('.d').focus();
  }
  function readItems() {
    return [...itemsBox.querySelectorAll('.bill-row')].map(r => {
      const desc = r.querySelector('.d').value.trim(), qty = num(r.querySelector('.q').value), rate = num(r.querySelector('.r').value);
      return { desc, qty, rate, amt: r2(qty * rate) };
    });
  }
  function totals() {
    const items = readItems(), sub = r2(items.reduce((s, i) => s + i.amt, 0));
    const disc = Math.min(num(f.disc.value), sub), taxable = r2(sub - disc);
    const gstPct = Math.min(num(f.gst.value), 100), gst = r2(taxable * gstPct / 100), total = r2(taxable + gst);
    let paid = f.paid.value === '' ? (f.mode.value === 'Pending' ? 0 : total) : num(f.paid.value);
    paid = Math.min(paid, total);
    return { items, sub, disc, gstPct, gst, total, paid, due: r2(total - paid) };
  }
  function calc() {
    [...itemsBox.querySelectorAll('.bill-row')].forEach(r => { r.querySelector('.a').textContent = money(num(r.querySelector('.q').value) * num(r.querySelector('.r').value)); });
    const t = totals();
    $('#tSub').textContent = money(t.sub); $('#tDisc').textContent = '-' + money(t.disc); $('#tGst').textContent = money(t.gst);
    $('#tTotal').textContent = money(t.total); $('#tPaid').textContent = money(t.paid); $('#tDue').textContent = money(t.due);
    $('#tDue').classList.toggle('bad', t.due > 0);
    return t;
  }
  function nextNo(date) {
    const p = 'GCC-' + date.replace(/-/g, '') + '-';
    let max = 0; load().forEach(b => { if (b.no && b.no.startsWith(p)) max = Math.max(max, parseInt(b.no.slice(p.length), 10) || 0); });
    return p + String(max + 1).padStart(3, '0');
  }
  function say(t, cls) { msg.className = cls || ''; msg.textContent = t || ''; }
  function resetForm() {
    f.name.value = ''; f.phone.value = ''; f.date.value = today(); f.disc.value = 0; f.gst.value = 0; f.mode.value = 'Cash'; f.paid.value = '';
    itemsBox.innerHTML = ''; addRow('', 1, ''); f.no.value = nextNo(f.date.value); say('');
    calc();
  }

  // ---- gather bill ----
  function gather() {
    const t = totals(), items = t.items.filter(i => i.desc && i.amt > 0);
    if (!items.length) { say('Add at least one item with a quantity and rate.', 'bad'); return null; }
    return { no: f.no.value, date: f.date.value || today(), name: f.name.value.trim().slice(0, 60), phone: f.phone.value.replace(/[^\d+]/g, '').slice(0, 15), items,
      sub: t.sub, disc: t.disc, gstPct: t.gstPct, gst: t.gst, total: t.total, mode: f.mode.value, paid: t.paid, due: t.due, ts: Date.now() };
  }
  function save(b) {
    const list = load(), i = list.findIndex(x => x.no === b.no);
    if (i >= 0) list[i] = b; else list.unshift(b);
    list.sort((a, c) => (c.date + String(c.ts).padStart(15, '0')).localeCompare(a.date + String(a.ts).padStart(15, '0')));
    if (!store(list)) say('Could not save in this browser (storage full or blocked). The bill can still be printed.', 'bad');
    renderHistory();
  }

  // ---- print ----
  function sheetHtml(b) {
    const rows = b.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.desc)}</td><td class="r">${i.qty}</td><td class="r">${money(i.rate)}</td><td class="r">${money(i.amt)}</td></tr>`).join('');
    return `<div class="bs-head"><img src="brand/gc-logo-light.png" alt="${esc(SHOP.name)}" height="56"><div class="bs-shop"><strong>${esc(SHOP.name)}</strong><br>${esc(SHOP.tag)}<br>Proprietor: ${esc(SHOP.owner)}<br>WhatsApp: ${SHOP.wa} | Call: ${SHOP.call}<br>${esc(SHOP.email)} | Instagram ${esc(SHOP.insta)}</div></div>
<h3 class="bs-title">BILL / RECEIPT</h3>
<div class="bs-meta"><div><b>Bill no:</b> ${esc(b.no)}<br><b>Date:</b> ${niceDate(b.date)}</div><div><b>Customer:</b> ${esc(b.name || 'Walk-in')}<br><b>Mobile:</b> ${esc(b.phone || '-')}</div></div>
<table class="bs-tbl"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="bs-tot"><tr><td>Subtotal</td><td class="r">${money(b.sub)}</td></tr>${b.disc ? `<tr><td>Discount</td><td class="r">-${money(b.disc)}</td></tr>` : ''}${b.gst ? `<tr><td>GST (${b.gstPct}%)</td><td class="r">${money(b.gst)}</td></tr>` : ''}<tr class="g"><td>Total</td><td class="r">${money(b.total)}</td></tr><tr><td>Paid (${esc(b.mode)})</td><td class="r">${money(b.paid)}</td></tr><tr><td>Balance due</td><td class="r">${money(b.due)}</td></tr></table>
<p class="bs-foot">Thank you for choosing ${esc(SHOP.name)}. This is a computer-generated bill.</p>`;
  }
  function doPrint() {
    const b = gather(); if (!b) return; save(b);
    const sheet = $('#billSheet'); sheet.innerHTML = sheetHtml(b); sheet.hidden = false; document.body.classList.add('printing-bill');
    const done = () => { sheet.hidden = true; document.body.classList.remove('printing-bill'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); setTimeout(() => window.print(), 150);
  }

  // ---- PDF ----
  async function doPdf() {
    const b = gather(); if (!b) return;
    if (!window.PDFLib) { say('PDF library did not load. Check your internet and try again.', 'bad'); return; }
    save(b); say('Making PDF...');
    try {
      const { PDFDocument, StandardFonts, rgb } = PDFLib;
      const pdf = await PDFDocument.create(), reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const W = 595.28, H = 841.89, M = 40, ink = rgb(0.05, 0.1, 0.2), mut = rgb(0.35, 0.4, 0.5), pri = rgb(0.12, 0.37, 0.88), acc = rgb(0.95, 0.55, 0.1);
      const clean = s => String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?');
      const fit = (s, font, size, max) => { s = clean(s); while (s.length > 1 && font.widthOfTextAtSize(s, size) > max) s = s.slice(0, -2) + '...'; return s; };
      let page, y;
      const right = (t, x, yy, font, size, col) => page.drawText(clean(t), { x: x - font.widthOfTextAtSize(clean(t), size), y: yy, size, font, color: col || ink });
      const header = () => {
        page = pdf.addPage([W, H]); y = H - M;
        page.drawRectangle({ x: M, y: y - 44, width: 44, height: 44, color: pri });
        page.drawText('G', { x: M + 14, y: y - 33, size: 28, font: bold, color: rgb(1, 1, 1) });
        page.drawText('Gupta', { x: M + 56, y: y - 20, size: 20, font: bold, color: ink });
        page.drawText('Cyber Cafe', { x: M + 56, y: y - 40, size: 15, font: bold, color: acc });
        const info = [SHOP.tag, 'Proprietor: ' + SHOP.owner, `WhatsApp: ${SHOP.wa} | Call: ${SHOP.call}`, `${SHOP.email} | Instagram ${SHOP.insta}`];
        info.forEach((l, i) => right(l, W - M, y - 10 - i * 12, i ? reg : bold, 9, i ? mut : ink));
        y -= 70; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0.8, 0.84, 0.9) }); y -= 24;
      };
      header();
      page.drawText('BILL / RECEIPT', { x: M, y, size: 14, font: bold, color: ink }); y -= 22;
      page.drawText('Bill no: ' + clean(b.no), { x: M, y, size: 10, font: reg, color: ink }); right('Customer: ' + (b.name || 'Walk-in'), W - M, y, reg, 10); y -= 14;
      page.drawText('Date: ' + niceDate(b.date), { x: M, y, size: 10, font: reg, color: ink }); right('Mobile: ' + (b.phone || '-'), W - M, y, reg, 10); y -= 24;
      const cols = { n: M + 4, d: M + 28, q: W - M - 190, r: W - M - 110, a: W - M - 4 };
      const th = () => { page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: rgb(0.93, 0.95, 0.98) });
        page.drawText('#', { x: cols.n, y, size: 9, font: bold, color: ink }); page.drawText('Description', { x: cols.d, y, size: 9, font: bold, color: ink });
        right('Qty', cols.q, y, bold, 9); right('Rate', cols.r, y, bold, 9); right('Amount', cols.a, y, bold, 9); y -= 22; };
      th();
      b.items.forEach((it, n) => {
        if (y < M + 150) { header(); th(); }
        page.drawText(String(n + 1), { x: cols.n, y, size: 10, font: reg, color: ink });
        page.drawText(fit(it.desc, reg, 10, cols.q - cols.d - 40), { x: cols.d, y, size: 10, font: reg, color: ink });
        right(String(it.qty), cols.q, y, reg, 10); right(rs(it.rate), cols.r, y, reg, 10); right(rs(it.amt), cols.a, y, reg, 10);
        y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rgb(0.85, 0.88, 0.92) }); y -= 14;
      });
      if (y < M + 130) header();
      y -= 6;
      const line = (l, v, bd) => { page.drawText(l, { x: W - M - 200, y, size: bd ? 12 : 10, font: bd ? bold : reg, color: ink }); right(v, W - M - 4, y, bd ? bold : reg, bd ? 12 : 10); y -= bd ? 20 : 15; };
      line('Subtotal', rs(b.sub)); if (b.disc) line('Discount', '-' + rs(b.disc)); if (b.gst) line(`GST (${b.gstPct}%)`, rs(b.gst));
      line('Total', rs(b.total), true); line('Paid (' + clean(b.mode) + ')', rs(b.paid)); line('Balance due', rs(b.due));
      page.drawText('Thank you for choosing Gupta Cyber Cafe. This is a computer-generated bill.', { x: M, y: M, size: 9, font: reg, color: mut });
      const blob = new Blob([await pdf.save()], { type: 'application/pdf' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = b.no + '.pdf'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say('PDF saved: ' + b.no + '.pdf', 'ok');
    } catch (e) { say('Could not make the PDF: ' + (e.message || e), 'bad'); }
  }

  // ---- WhatsApp ----
  function doWhatsApp() {
    const b = gather(); if (!b) return; save(b);
    const lines = [`*${SHOP.name}* (Since 2014)`, `Bill: ${b.no}  Date: ${niceDate(b.date)}`, b.name ? `Customer: ${b.name}` : '', ''];
    b.items.forEach((i, n) => lines.push(`${n + 1}. ${i.desc} - ${i.qty} x ${rs(i.rate)} = ${rs(i.amt)}`));
    lines.push('', `Subtotal: ${rs(b.sub)}`); if (b.disc) lines.push(`Discount: -${rs(b.disc)}`); if (b.gst) lines.push(`GST (${b.gstPct}%): ${rs(b.gst)}`);
    lines.push(`*Total: ${rs(b.total)}*`, `Paid (${b.mode}): ${rs(b.paid)}`, `Balance due: ${rs(b.due)}`, '', `Thank you! Call ${SHOP.call}`);
    let p = b.phone.replace(/\D/g, ''); if (p.length === 10) p = '91' + p; else if (p.length < 11) p = '';
    window.open('https://wa.me/' + p + '?text=' + encodeURIComponent(lines.filter((x, i) => x || i).join('\n')), '_blank', 'noopener');
  }

  // ---- history ----
  const hist = $('#billHistory'), summary = $('#billSummary');
  function renderHistory() {
    const list = load(), td = today(), tdl = list.filter(b => b.date === td);
    const sum = k => r2(tdl.reduce((s, b) => s + (b[k] || 0), 0));
    summary.innerHTML = `<div><b>${tdl.length}</b><span>Bills today</span></div><div><b>${money(sum('total'))}</b><span>Billed today</span></div><div><b>${money(sum('paid'))}</b><span>Received</span></div><div><b>${money(sum('due'))}</b><span>Due</span></div>`;
    hist.innerHTML = list.length ? list.slice(0, 40).map(b => `<li><div><strong>${esc(b.no)}</strong> &middot; ${niceDate(b.date)}<br><span class="muted">${esc(b.name || 'Walk-in')} &middot; ${money(b.total)}${b.due > 0 ? ` &middot; <span class="bad">due ${money(b.due)}</span>` : ''}</span></div><div class="bill-hact"><button type="button" class="btn sm" data-a="open" data-no="${esc(b.no)}">Open</button><button type="button" class="btn sm danger" data-a="del" data-no="${esc(b.no)}">Delete</button></div></li>`).join('') : '<li class="muted">No saved bills yet.</li>';
  }
  hist.addEventListener('click', e => {
    const btn = e.target.closest('button[data-a]'); if (!btn) return;
    const list = load(), b = list.find(x => x.no === btn.dataset.no); if (!b) return;
    if (btn.dataset.a === 'del') { if (confirm('Delete bill ' + b.no + '?')) { store(list.filter(x => x.no !== b.no)); renderHistory(); } return; }
    f.name.value = b.name; f.phone.value = b.phone; f.no.value = b.no; f.date.value = b.date; f.disc.value = b.disc; f.gst.value = b.gstPct; f.mode.value = b.mode; f.paid.value = b.paid;
    itemsBox.innerHTML = ''; b.items.forEach(i => addRow(i.desc, i.qty, i.rate)); calc(); say('Opened ' + b.no + '. Save to update it.', 'ok');
    $('#billForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  $('#billCsv').addEventListener('click', () => {
    const list = load(); if (!list.length) { say('No bills to export yet.', 'bad'); return; }
    const rows = [['Bill no', 'Date', 'Customer', 'Mobile', 'Items', 'Subtotal', 'Discount', 'GST', 'Total', 'Payment', 'Paid', 'Due']]
      .concat(list.map(b => [b.no, b.date, b.name, b.phone, b.items.map(i => `${i.desc} x${i.qty}`).join('; '), b.sub, b.disc, b.gst, b.total, b.mode, b.paid, b.due]));
    const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'gupta-cyber-cafe-bills.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  // ---- wiring ----
  $('#billChips').innerHTML = ['B/W Print', 'Colour Print', 'Photocopy', 'Scanning', 'Lamination', 'Passport Photos', 'Form Filling', 'Typing'].map(t => `<button type="button" class="pill-btn" data-t="${esc(t)}">+ ${esc(t)}</button>`).join('');
  $('#billChips').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    const last = itemsBox.lastElementChild, blank = last && !last.querySelector('.d').value && !last.querySelector('.r').value;
    if (blank) last.remove();
    const t = b.dataset.t; addRow(t, 1, t === 'B/W Print' ? rates.bw : t === 'Colour Print' ? rates.color : '');
  });
  itemsBox.addEventListener('input', calc);
  itemsBox.addEventListener('click', e => { if (e.target.closest('.x')) { e.target.closest('.bill-row').remove(); if (!itemsBox.children.length) addRow('', 1, ''); calc(); } });
  [f.disc, f.gst, f.mode, f.paid].forEach(el => el.addEventListener('input', calc));
  f.date.addEventListener('change', () => { if (!load().some(b => b.no === f.no.value)) f.no.value = nextNo(f.date.value || today()); });
  $('#addItem').addEventListener('click', () => addRow('', 1, '', true));
  $('#billPrint').addEventListener('click', doPrint);
  $('#billPdf').addEventListener('click', doPdf);
  $('#billWa').addEventListener('click', doWhatsApp);
  $('#billSave').addEventListener('click', () => { const b = gather(); if (b) { save(b); say('Saved ' + b.no + ' in this browser.', 'ok'); } });
  $('#billNew').addEventListener('click', resetForm);
  $('#billForm').addEventListener('submit', e => e.preventDefault());

  resetForm(); renderHistory();
})();
