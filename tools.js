// Free in-browser tools. Nothing is uploaded to any server.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const readBuf = f => f.arrayBuffer();
  const base = n => n.replace(/\.[^.]+$/, '');
  const fmtKB = b => (b / 1024).toFixed(b < 102400 ? 1 : 0) + ' KB';
  const loadImg = file => new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => rej(new Error('Could not read image ' + file.name)); i.src = u; });
  const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function drawToCanvas(img, w, h, bg) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    x.drawImage(img, 0, 0, w, h); return c;
  }
  async function renderPdf(file, scale, onPage) {
    const pdf = await pdfjsLib.getDocument({ data: await readBuf(file) }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      await onPage(c, i, pdf.numPages, page);
    }
    return pdf.numPages;
  }
  function parseRanges(str, max) {
    const out = [];
    for (const part of str.split(',')) {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m) continue;
      let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a];
      for (let p = Math.max(1, a); p <= Math.min(max, b); p++) out.push(p);
    }
    return out;
  }

  const TOOLS = [
    { id: 'img2pdf', title: 'Image to PDF', desc: 'Combine JPG / PNG images into one PDF (A4).', files: 'image/*', multiple: true, opts: [{ k: 'fit', label: 'Page', type: 'select', options: [['a4', 'A4 page, fit image'], ['orig', 'Same size as image']] }],
      async run(files, o, log) {
        const pdf = await PDFLib.PDFDocument.create();
        for (const f of files) {
          log('Adding ' + f.name);
          let bytes = await readBuf(f), img;
          if (/png$/i.test(f.type)) img = await pdf.embedPng(bytes);
          else if (/jpe?g$/i.test(f.type)) img = await pdf.embedJpg(bytes);
          else { const i = await loadImg(f); const c = drawToCanvas(i, i.naturalWidth, i.naturalHeight, '#fff'); img = await pdf.embedJpg(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer()); }
          if (o.fit === 'orig') { pdf.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height }); }
          else { const W = 595.28, H = 841.89, M = 24, s = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height, 1.5 * 1); const p = pdf.addPage([W, H]); p.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s }); }
        }
        const b = new Blob([await pdf.save()], { type: 'application/pdf' }); dl(b, 'images.pdf'); return 'images.pdf created (' + fmtKB(b.size) + ')';
      } },
    { id: 'pdf2img', title: 'PDF to JPG / PNG', desc: 'Turn every PDF page into an image.', files: '.pdf,application/pdf', opts: [{ k: 'fmt', label: 'Format', type: 'select', options: [['jpeg', 'JPG'], ['png', 'PNG']] }, { k: 'q', label: 'Quality', type: 'select', options: [['2', 'High (sharp)'], ['1.4', 'Medium'], ['1', 'Small']] }],
      async run(files, o, log) {
        const f = files[0], ext = o.fmt === 'png' ? 'png' : 'jpg';
        const n = await renderPdf(f, +o.q, async (c, i, t) => { log(`Page ${i} of ${t}`); dl(await toBlob(c, 'image/' + o.fmt, 0.92), `${base(f.name)}-page${i}.${ext}`); await new Promise(r => setTimeout(r, 250)); });
        return n + ' image(s) downloaded. Allow multiple downloads if your browser asks.';
      } },
    { id: 'pdf2word', title: 'PDF to Word', desc: 'Extract text from a PDF into an editable Word file.', files: '.pdf,application/pdf', opts: [],
      async run(files, o, log) {
        const f = files[0], pdf = await pdfjsLib.getDocument({ data: await readBuf(f) }).promise; let html = '', chars = 0;
        for (let p = 1; p <= pdf.numPages; p++) {
          log(`Reading page ${p} of ${pdf.numPages}`);
          const tc = await (await pdf.getPage(p)).getTextContent(); const lines = []; let cur = [], y = null;
          for (const it of tc.items) { const ty = Math.round(it.transform[5]); if (y !== null && Math.abs(ty - y) > 4) { lines.push(cur.join(' ')); cur = []; } cur.push(it.str); y = ty; }
          if (cur.length) lines.push(cur.join(' '));
          const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
          html += lines.filter(l => l.trim()).map(l => { chars += l.length; return `<p>${esc(l.replace(/\s+/g, ' ').trim())}</p>`; }).join('') + (p < pdf.numPages ? '<br clear=all style="page-break-before:always">' : '');
        }
        if (chars < 20) throw new Error('No selectable text found. This looks like a scanned PDF. Convert it to images, or message us on WhatsApp for OCR typing.');
        const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:Calibri;font-size:11pt}</style></head><body>${html}</body></html>`;
        dl(new Blob(['﻿', doc], { type: 'application/msword' }), base(f.name) + '.doc');
        return 'Word file created. Text is extracted; complex layouts, tables and images are not preserved.';
      } },
    { id: 'merge', title: 'Merge PDF', desc: 'Join several PDFs into one, in the order selected.', files: '.pdf,application/pdf', multiple: true, opts: [],
      async run(files, o, log) {
        if (files.length < 2) throw new Error('Select at least 2 PDF files.');
        const out = await PDFLib.PDFDocument.create();
        for (const f of files) { log('Adding ' + f.name); const d = await PDFLib.PDFDocument.load(await readBuf(f)); (await out.copyPages(d, d.getPageIndices())).forEach(p => out.addPage(p)); }
        const b = new Blob([await out.save()], { type: 'application/pdf' }); dl(b, 'merged.pdf'); return 'merged.pdf created (' + fmtKB(b.size) + ')';
      } },
    { id: 'split', title: 'Split / Extract Pages', desc: 'Keep only the pages you want.', files: '.pdf,application/pdf', opts: [{ k: 'range', label: 'Pages (e.g. 1-3, 5, 8-10)', type: 'text', value: '1' }],
      async run(files, o) {
        const d = await PDFLib.PDFDocument.load(await readBuf(files[0])), pages = parseRanges(o.range, d.getPageCount());
        if (!pages.length) throw new Error('No valid pages. This PDF has ' + d.getPageCount() + ' page(s).');
        const out = await PDFLib.PDFDocument.create(); (await out.copyPages(d, pages.map(p => p - 1))).forEach(p => out.addPage(p));
        dl(new Blob([await out.save()], { type: 'application/pdf' }), base(files[0].name) + '-pages.pdf'); return pages.length + ' page(s) extracted.';
      } },
    { id: 'pdfcompress', title: 'Compress PDF', desc: 'Reduce PDF size for portal uploads (pages become images).', files: '.pdf,application/pdf', opts: [{ k: 'lvl', label: 'Level', type: 'select', options: [['1.3|0.6', 'Balanced'], ['1|0.45', 'Small'], ['0.75|0.35', 'Smallest']] }],
      async run(files, o, log) {
        const [sc, q] = o.lvl.split('|').map(Number), out = await PDFLib.PDFDocument.create();
        await renderPdf(files[0], sc, async (c, i, t, page) => { log(`Page ${i} of ${t}`); const img = await out.embedJpg(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()); const vp = page.getViewport({ scale: 1 }); out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height }); });
        const b = new Blob([await out.save()], { type: 'application/pdf' });
        dl(b, base(files[0].name) + '-small.pdf'); return `${fmtKB(files[0].size)} became ${fmtKB(b.size)}. ` + (b.size >= files[0].size ? 'This file was already small; keep the original.' : 'Text is no longer selectable.');
      } },
    { id: 'imgconv', title: 'Image Converter', desc: 'JPG, PNG and WEBP in any direction.', files: 'image/*', multiple: true, opts: [{ k: 'to', label: 'Convert to', type: 'select', options: [['image/jpeg|jpg', 'JPG'], ['image/png|png', 'PNG'], ['image/webp|webp', 'WEBP']] }],
      async run(files, o, log) {
        const [mime, ext] = o.to.split('|');
        for (const f of files) { log('Converting ' + f.name); const i = await loadImg(f); const c = drawToCanvas(i, i.naturalWidth, i.naturalHeight, mime === 'image/jpeg' ? '#fff' : null); dl(await toBlob(c, mime, 0.92), base(f.name) + '.' + ext); await new Promise(r => setTimeout(r, 250)); }
        return files.length + ' file(s) converted.';
      } },
    { id: 'photo', title: 'Photo / Signature Resize', desc: 'Exact pixel size and maximum KB for exam and portal uploads.', files: 'image/*', opts: [
        { k: 'preset', label: 'Preset', type: 'select', options: [['', 'Custom'], ['200|230|50', 'Photo 200x230, max 50 KB'], ['140|60|20', 'Signature 140x60, max 20 KB'], ['350|450|100', 'Photo 350x450, max 100 KB']] },
        { k: 'w', label: 'Width (px)', type: 'number', value: 200 }, { k: 'h', label: 'Height (px)', type: 'number', value: 230 }, { k: 'kb', label: 'Max size (KB)', type: 'number', value: 50 }],
      async run(files, o, log) {
        const w = +o.w, h = +o.h, kb = +o.kb; if (!w || !h || !kb) throw new Error('Enter width, height and max KB.');
        const i = await loadImg(files[0]); const c = drawToCanvas(i, w, h, '#fff');
        let lo = 0.05, hi = 0.95, best = await toBlob(c, 'image/jpeg', lo);
        if (best.size > kb * 1024) throw new Error('Even at lowest quality this is ' + fmtKB(best.size) + '. Increase max KB or reduce width/height.');
        for (let k = 0; k < 9; k++) { const m = (lo + hi) / 2, b = await toBlob(c, 'image/jpeg', m); if (b.size <= kb * 1024) { best = b; lo = m; } else hi = m; }
        dl(best, base(files[0].name) + `-${w}x${h}.jpg`); return `Saved ${w}x${h}px, ${fmtKB(best.size)}. Image is stretched to the exact size; crop first if the face looks wrong.`;
      } },
    { id: 'qr', title: 'QR Code', desc: 'Create a QR code for a link, UPI ID, WhatsApp number or text.', files: null, opts: [{ k: 'text', label: 'Text or link', type: 'text', value: 'https://wa.me/919086703813' }],
      async run(files, o, log, out) {
        if (!o.text.trim()) throw new Error('Enter some text.'); if (!window.QRCode) throw new Error('QR library did not load. Check internet.');
        out.innerHTML = ''; const box = document.createElement('div'); box.style.cssText = 'background:#fff;padding:14px;display:inline-block;border-radius:8px'; out.appendChild(box);
        new QRCode(box, { text: o.text, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
        await new Promise(r => setTimeout(r, 150)); const cv = box.querySelector('canvas');
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Download PNG'; b.onclick = async () => dl(await toBlob(cv, 'image/png'), 'qr.png'); out.appendChild(document.createElement('br')); out.appendChild(b); return '';
      } }
  ];

  const tabs = $('#toolTabs'), panel = $('#toolPanel');
  function show(t) {
    [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.id === t.id));
    panel.innerHTML = `<h3>${t.title}</h3><p class="muted">${t.desc}</p><form class="tform"></form><div class="tlog" role="status"></div><div class="tout"></div>`;
    const form = $('.tform', panel), log = $('.tlog', panel), out = $('.tout', panel);
    if (t.files) form.insertAdjacentHTML('beforeend', `<label>${t.multiple ? 'Select files' : 'Select file'}<input type="file" name="f" accept="${t.files}" ${t.multiple ? 'multiple' : ''}></label>`);
    t.opts.forEach(op => {
      const val = op.value ?? '';
      form.insertAdjacentHTML('beforeend', `<label>${op.label}${op.type === 'select' ? `<select name="${op.k}">${op.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : `<input name="${op.k}" type="${op.type}" value="${val}">`}</label>`);
    });
    form.insertAdjacentHTML('beforeend', '<button class="btn primary" type="submit">Convert</button>');
    if (t.id === 'photo') form.preset.onchange = () => { if (form.preset.value) { const [w, h, k] = form.preset.value.split('|'); form.w.value = w; form.h.value = h; form.kb.value = k; } };
    form.onsubmit = async e => {
      e.preventDefault(); log.className = 'tlog'; log.textContent = 'Working...'; out.innerHTML = '';
      const btn = $('button', form); btn.disabled = true;
      try {
        const files = form.f ? [...form.f.files] : []; if (t.files && !files.length) throw new Error('Select a file first.');
        const o = {}; t.opts.forEach(op => o[op.k] = form[op.k].value);
        const msg = await t.run(files, o, m => log.textContent = m, out); log.textContent = msg || ''; log.classList.add('ok');
      } catch (err) { log.textContent = err.message || String(err); log.classList.add('bad'); }
      btn.disabled = false;
    };
  }
  TOOLS.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tab'; b.dataset.id = t.id; b.textContent = t.title; b.onclick = () => show(t); tabs.appendChild(b); });
  show(TOOLS[0]);
})();
