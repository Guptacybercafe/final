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
  // Page list from text like "1-3, 5". Blank means every page.
  function pagesOf(str, max) {
    const s = (str || '').trim().toLowerCase();
    const out = !s || s === 'all' ? Array.from({ length: max }, (_, i) => i + 1) : parseRanges(s, max);
    if (!out.length) throw new Error('No valid pages. This PDF has ' + max + ' page(s).');
    return out;
  }
  // Render every page, apply a colour filter, and rebuild as a new PDF (pages become images).
  async function filterPdf(file, scale, q, filter, log) {
    const out = await PDFLib.PDFDocument.create();
    await renderPdf(file, scale, async (c, i, t, page) => {
      log(`Page ${i} of ${t}`);
      const x = c.getContext('2d');
      if (filter === 'invert') { x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over'; }
      else {
        const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
        for (let k = 0; k < p.length; k += 4) { let g = 0.299 * p[k] + 0.587 * p[k + 1] + 0.114 * p[k + 2]; if (filter === 'bw') g = g > 170 ? 255 : 0; p[k] = p[k + 1] = p[k + 2] = g; }
        x.putImageData(d, 0, 0);
      }
      const img = await out.embedJpg(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()), vp = page.getViewport({ scale: 1 });
      out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      c.width = c.height = 0;
    });
    return new Blob([await out.save()], { type: 'application/pdf' });
  }
  // JPG at or under maxBytes: tries lower quality first, then shrinks the picture.
  async function jpegUnder(img, maxBytes) {
    let s = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    for (let t = 0; t < 14; t++) {
      const c = drawToCanvas(img, Math.max(1, Math.round(img.naturalWidth * s)), Math.max(1, Math.round(img.naturalHeight * s)), '#fff');
      let lo = 0.15, hi = 0.95, best = await toBlob(c, 'image/jpeg', lo);
      if (best.size > maxBytes) { s *= 0.8; continue; }
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2, b = await toBlob(c, 'image/jpeg', m); if (b.size <= maxBytes) { best = b; lo = m; } else hi = m; }
      return best;
    }
    throw new Error('Could not make the image that small. Try a larger size.');
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

  // ---------- Passport photo maker: background removal, passport crop, print sheet ----------
  const PP_SIZES = {
    p3545: { label: '35 x 45 mm (India, UK, EU, Australia)', w: 35, h: 45, head: [0.71, 0.80] },
    p2in: { label: '2 x 2 in (US passport and visa, India visa)', w: 50.8, h: 50.8, head: [0.50, 0.69] },
    p3348: { label: '33 x 48 mm (China)', w: 33, h: 48, head: [0.58, 0.69] },
    p5070: { label: '50 x 70 mm (Canada)', w: 50, h: 70, head: [0.44, 0.51] },
    stamp: { label: '20 x 25 mm (Stamp size)', w: 20, h: 25, head: [0.70, 0.80] },
    custom: { label: 'Custom size', w: 35, h: 45, head: [0.70, 0.80] }
  };
  const PP_PAPERS = { '4x6': { label: '4 x 6 in', w: 101.6, h: 152.4, fn: '4x6in' }, '5x7': { label: '5 x 7 in', w: 127, h: 177.8, fn: '5x7in' }, a4: { label: 'A4', w: 210, h: 297, fn: 'A4' } };
  const ppClamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ppCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ppPx = (mm, dpi) => Math.max(1, Math.round(mm / 25.4 * dpi));
  const ppMm = v => String(Math.round(v * 10) / 10);
  const ppMedian = a => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  function ppEstimateBg(d, w, h) {
    const R = [], G = [], B = [], bw = Math.max(2, Math.round(Math.min(w, h) * 0.006));
    const add = (x, y) => { const p = (y * w + x) * 4; R.push(d[p]); G.push(d[p + 1]); B.push(d[p + 2]); };
    for (let y = 0; y < bw; y++) for (let x = 0; x < w; x += 3) add(x, y);
    const ymax = Math.floor(h * 0.6);
    for (let y = 0; y < ymax; y += 3) for (let x = 0; x < bw; x++) { add(x, y); add(w - 1 - x, y); }
    return [ppMedian(R), ppMedian(G), ppMedian(B)];
  }
  function ppErode(a, w, h, n) {
    let src = a, dst = new Uint8Array(a.length);
    for (let k = 0; k < n; k++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const i = row + x; let v = src[i];
          if (v) {
            if (x > 0 && src[i - 1] < v) v = src[i - 1];
            if (x < w - 1 && src[i + 1] < v) v = src[i + 1];
            if (y > 0 && src[i - w] < v) v = src[i - w];
            if (y < h - 1 && src[i + w] < v) v = src[i + w];
          }
          dst[i] = v;
        }
      }
      const t = src; src = dst; dst = (t === a) ? new Uint8Array(a.length) : t;
    }
    return src;
  }
  function ppBlur(a, w, h, r) {
    if (r <= 0) return a;
    const k = 2 * r + 1, t = new Float32Array(a.length), o = new Uint8Array(a.length);
    for (let y = 0; y < h; y++) {
      const row = y * w; let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + ppClamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { t[row + x] = sum / k; sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += t[ppClamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { o[y * w + x] = Math.round(sum / k); sum += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; }
    }
    return o;
  }
  // Flood-fills the wall colour in from the picture edges, keeps the biggest remaining piece (the person).
  function ppAlpha(d, w, h, ref, tol, edge, soft) {
    const N = w * h, bg = new Uint8Array(N), q = new Int32Array(N);
    let qh = 0, qt = 0;
    const rr = ref[0], rg = ref[1], rb = ref[2], tolFar = tol * 1.7, step = tol * 0.18;
    const dref = j => { const p = j * 4, a = d[p] - rr, b = d[p + 1] - rg, c = d[p + 2] - rb; return Math.sqrt(a * a + b * b + c * c); };
    const seed = i => { if (!bg[i] && dref(i) <= tol) { bg[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    const visit = (j, p) => {
      if (bg[j]) return;
      const dr = dref(j); let ok = dr <= tol;
      if (!ok && dr <= tolFar) { const q4 = j * 4, a = d[q4] - d[p], b = d[q4 + 1] - d[p + 1], c = d[q4 + 2] - d[p + 2]; ok = Math.sqrt(a * a + b * b + c * c) <= step; }
      if (ok) { bg[j] = 1; q[qt++] = j; }
    };
    while (qh < qt) {
      const i = q[qh++], x = i % w, p = i * 4;
      if (x > 0) visit(i - 1, p);
      if (x < w - 1) visit(i + 1, p);
      if (i >= w) visit(i - w, p);
      if (i < N - w) visit(i + w, p);
    }
    const grow = (s, mark) => {
      let size = 0; qh = 0; qt = 0; q[qt++] = s; mark[s] = 1;
      while (qh < qt) {
        const i = q[qh++]; size++; const x = i % w;
        if (x > 0) { const j = i - 1; if (!bg[j] && !mark[j]) { mark[j] = 1; q[qt++] = j; } }
        if (x < w - 1) { const j = i + 1; if (!bg[j] && !mark[j]) { mark[j] = 1; q[qt++] = j; } }
        if (i >= w) { const j = i - w; if (!bg[j] && !mark[j]) { mark[j] = 1; q[qt++] = j; } }
        if (i < N - w) { const j = i + w; if (!bg[j] && !mark[j]) { mark[j] = 1; q[qt++] = j; } }
      }
      return size;
    };
    const seen = new Uint8Array(N), comps = []; let bestSize = 0;
    for (let s = 0; s < N; s++) { if (bg[s] || seen[s]) continue; const size = grow(s, seen); comps.push([s, size]); if (size > bestSize) bestSize = size; }
    const keep = new Uint8Array(N); comps.forEach(([s, size]) => { if (size >= bestSize * 0.08) grow(s, keep); });
    let a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = keep[i] ? 255 : 0;
    if (edge > 0) a = ppErode(a, w, h, edge);
    if (soft > 0) { a = ppBlur(a, w, h, soft); a = ppBlur(a, w, h, soft); }
    return a;
  }
  function ppStats(alpha, w, h) {
    let cnt = 0, top = -1, bottom = -1, left = w, right = -1;
    const rowMin = new Int32Array(h).fill(w), rowMax = new Int32Array(h).fill(-1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) if (alpha[row + x] > 127) { cnt++; if (x < rowMin[y]) rowMin[y] = x; if (x > rowMax[y]) rowMax[y] = x; }
      if (rowMax[y] >= 0) { if (top < 0) top = y; bottom = y; if (rowMin[y] < left) left = rowMin[y]; if (rowMax[y] > right) right = rowMax[y]; }
    }
    return { cov: cnt / (w * h), bbox: top < 0 ? null : { top, bottom, left, right }, rowMin, rowMax };
  }
  function ppCss() {
    if (document.getElementById('pp-css')) return;
    const s = document.createElement('style'); s.id = 'pp-css';
    s.textContent = `
.pp{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:20px;align-items:start}
@media(max-width:720px){.pp{grid-template-columns:minmax(0,1fr)}}
.pp-frame{position:relative;margin:0 auto;width:min(100%,calc(55vh * var(--ar,.78)));line-height:0;border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.pp-frame canvas{display:block;width:100%;height:auto;touch-action:none;cursor:grab}
.pp-guide{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.pp-read{font:12px ui-monospace,Menlo,Consolas,monospace;color:var(--mut);text-align:center;margin:10px 0 2px}
.pp-hint{font-size:13px;color:var(--mut);text-align:center;margin:0}
.pp-ctl{display:grid;gap:12px;min-width:0}
.pp select,.pp input[type=number]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font:inherit}
.pp input[type=range]{width:100%;accent-color:var(--pri)}
.pp-lh{display:flex;justify-content:space-between}
.pp-lh output{font:12px ui-monospace,Menlo,Consolas,monospace;color:var(--mut);font-weight:400}
.pp-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.pp-chk{display:flex!important;align-items:center;gap:8px;font-weight:500!important}
.pp-chk input{width:auto!important}
.pp-sws{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pp-sw{width:34px;height:34px;border-radius:50%;border:1px solid var(--line);padding:0;cursor:pointer}
.pp-sw[aria-pressed=true]{outline:2px solid var(--pri);outline-offset:2px}
.pp input[type=color]{width:42px;height:34px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:pointer}
.pp fieldset{border:0;margin:0;padding:0;display:grid;gap:12px;min-width:0}
.pp fieldset:disabled{opacity:.45}
.pp-thumbbox{display:grid;grid-template-columns:minmax(0,170px) 1fr;gap:12px;align-items:start}
.pp-thumb{border:1px solid var(--line);border-radius:8px;overflow:hidden;line-height:0;cursor:crosshair}
.pp-thumb canvas{width:100%;height:auto;display:block}
.pp-small{font-size:13px;color:var(--mut);margin:0}
.pp-sheetbox{grid-column:1/-1;border-top:1px solid var(--line);padding-top:16px;display:grid;justify-items:center;gap:6px}
.pp-sheetbox canvas{width:auto;height:auto;max-width:100%;max-height:420px;border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,.18);background:#fff}
.pp-msg{min-height:1.4em;font-size:14px}
.pp [hidden]{display:none!important}
`;
    document.head.appendChild(s);
  }
  async function passportEditor(file, out) {
    ppCss();
    let img;
    try { img = window.createImageBitmap ? await createImageBitmap(file, { imageOrientation: 'from-image' }) : await loadImg(file); } catch (e) { img = await loadImg(file); }
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, sc = Math.min(1, 1200 / Math.max(iw, ih));
    const W0 = Math.max(2, Math.round(iw * sc)), H0 = Math.max(2, Math.round(ih * sc));
    const work = ppCanvas(W0, H0), wg = work.getContext('2d', { willReadFrequently: true });
    wg.imageSmoothingQuality = 'high'; wg.drawImage(img, 0, 0, W0, H0);
    const src = wg.getImageData(0, 0, W0, H0), adj = ppCanvas(W0, H0);
    const S = { w: W0, h: H0, autoRef: null, bgRef: null, pick: null, stats: null, keep: false, tol: 40, edge: 1, soft: 1, bg: '#ffffff', preset: 'p3545', cw: 35, ch: 45, srel0: 1, z: 1, cx: W0 / 2, cy: H0 / 2, br: 0, co: 0, guides: true };
    let cutData = null, raf = 0, needMask = false, needAdj = false, sheetT = 0;

    const div = document.createElement('div'); div.className = 'pp';
    div.innerHTML = `
<div>
  <div class="pp-frame"><canvas class="pp-prev" aria-label="Passport photo preview. Drag to move the photo."></canvas>
    <svg class="pp-guide" viewBox="0 0 35 45" preserveAspectRatio="none" aria-hidden="true">
      <line class="g-v" stroke="#fff" stroke-opacity=".55" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <ellipse class="g-e1" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="3.5" vector-effect="non-scaling-stroke"/>
      <ellipse class="g-e2" fill="none" stroke="#e5484d" stroke-width="1.6" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>
    </svg></div>
  <div class="pp-read pp-readout"></div>
  <p class="pp-hint pp-head"></p>
</div>
<div class="pp-ctl">
  <label>Photo size<select data-k="preset"></select></label>
  <div class="pp-two" data-custom hidden><label>Width (mm)<input type="number" data-k="cw" min="10" max="200" step="0.5" value="35"></label><label>Height (mm)<input type="number" data-k="ch" min="10" max="250" step="0.5" value="45"></label></div>
  <div>
    <div class="pp-small" style="font-weight:600;color:var(--ink);margin-bottom:6px">New background</div>
    <div class="pp-sws">
      <button type="button" class="pp-sw" data-c="#ffffff" style="background:#ffffff" aria-label="White" aria-pressed="true"></button>
      <button type="button" class="pp-sw" data-c="#e6e8eb" style="background:#e6e8eb" aria-label="Light grey" aria-pressed="false"></button>
      <button type="button" class="pp-sw" data-c="#d3e6f7" style="background:#d3e6f7" aria-label="Light blue" aria-pressed="false"></button>
      <button type="button" class="pp-sw" data-c="#c8102e" style="background:#c8102e" aria-label="Red" aria-pressed="false"></button>
      <input type="color" data-k="bgcolor" value="#ffffff" aria-label="Custom background colour">
    </div>
  </div>
  <label class="pp-chk"><input type="checkbox" data-k="keep"> Keep my original background</label>
  <fieldset data-remove>
    <div class="pp-thumbbox">
      <div class="pp-thumb"><canvas class="pp-thumbc" aria-label="Your photo. Click the wall behind you to choose the colour to remove."></canvas></div>
      <div><p class="pp-small">Click the wall in your photo if the edges look wrong.</p><div class="pp-row" style="margin-top:8px"><button type="button" class="btn" data-a="autoref">Detect wall again</button></div><p class="pp-small pp-mask" style="margin-top:8px"></p></div>
    </div>
    <label><span class="pp-lh">Wall colour range<output data-o="tol"></output></span><input type="range" data-k="tol" min="6" max="120" step="1" value="40"></label>
    <label><span class="pp-lh">Trim edge<output data-o="edge"></output></span><input type="range" data-k="edge" min="0" max="6" step="1" value="1"></label>
    <label><span class="pp-lh">Edge softness<output data-o="soft"></output></span><input type="range" data-k="soft" min="0" max="6" step="1" value="1"></label>
  </fieldset>
  <label><span class="pp-lh">Zoom<output data-o="zoom"></output></span><input type="range" data-k="zoom" min="30" max="400" step="1" value="100"></label>
  <div class="pp-row"><button type="button" class="btn" data-a="fit">Auto-fit head</button><label class="pp-chk"><input type="checkbox" data-k="guides" checked> Show head guide</label></div>
  <p class="pp-small">Drag the photo to move it. Scroll or use Zoom to resize. The guide is only a preview aid and is not saved.</p>
  <label><span class="pp-lh">Brightness<output data-o="br"></output></span><input type="range" data-k="br" min="-40" max="40" step="1" value="0"></label>
  <label><span class="pp-lh">Contrast<output data-o="co"></output></span><input type="range" data-k="co" min="-40" max="40" step="1" value="0"></label>
  <div class="pp-two">
    <label>Maximum file size<select data-k="maxkb"><option value="0">No limit</option><option value="50">50 KB</option><option value="100">100 KB</option><option value="200">200 KB</option><option value="500">500 KB</option></select></label>
    <label>Print sheet paper<select data-k="paper"><option value="4x6">4 x 6 in</option><option value="5x7">5 x 7 in</option><option value="a4">A4</option></select></label>
  </div>
  <label>Copies on the sheet<select data-k="copies"><option value="fill">Fill the sheet</option><option value="2">2</option><option value="4">4</option><option value="6">6</option><option value="8">8</option><option value="12">12</option></select></label>
  <div class="pp-row"><button type="button" class="btn primary" data-a="save1">Download photo</button><button type="button" class="btn" data-a="save2">Download print sheet</button></div>
  <div class="pp-msg" role="status"></div>
</div>
<div class="pp-sheetbox"><canvas class="pp-sheet" aria-label="Print sheet preview"></canvas><div class="pp-read pp-sheetinfo"></div><p class="pp-hint">Thin grey lines show where to cut. Print at 100% scale.</p></div>`;
    out.appendChild(div);
    const q = s => div.querySelector(s), qa = s => div.querySelectorAll(s), K = k => q('[data-k=' + k + ']');
    const P = () => PP_SIZES[S.preset];
    const say = (m, cls) => { const e = q('.pp-msg'); e.textContent = m || ''; e.style.color = cls === 'bad' ? 'var(--bad)' : cls === 'ok' ? 'var(--ok)' : ''; };

    function drawThumb() {
      const t = q('.pp-thumbc'), w = Math.min(S.w, 520), h = Math.round(S.h * w / S.w);
      t.width = w; t.height = h;
      const g = t.getContext('2d'); g.drawImage(work, 0, 0, w, h);
      if (S.pick) {
        const x = S.pick.x * w / S.w, y = S.pick.y * h / S.h;
        g.lineWidth = 4; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 10, 0, 6.2832); g.stroke();
        g.lineWidth = 2; g.strokeStyle = '#e5484d'; g.beginPath(); g.arc(x, y, 10, 0, 6.2832); g.stroke();
      }
    }
    function runMask() {
      const { w, h } = S, d = src.data, N = w * h;
      if (!S.autoRef) S.autoRef = ppEstimateBg(d, w, h);
      const ref = S.bgRef || S.autoRef;
      let alpha;
      if (S.keep) { alpha = new Uint8Array(N).fill(255); S.stats = null; }
      else { alpha = ppAlpha(d, w, h, ref, S.tol, S.edge, S.soft); S.stats = ppStats(alpha, w, h); }
      const o = new ImageData(w, h), od = o.data;
      for (let i = 0; i < N; i++) {
        const p = i * 4, a = alpha[i];
        if (a === 255) { od[p] = d[p]; od[p + 1] = d[p + 1]; od[p + 2] = d[p + 2]; od[p + 3] = 255; }
        else if (a > 0) {
          const af = a / 255, inv = 1 - af;
          od[p] = ppClamp((d[p] - inv * ref[0]) / af, 0, 255); od[p + 1] = ppClamp((d[p + 1] - inv * ref[1]) / af, 0, 255); od[p + 2] = ppClamp((d[p + 2] - inv * ref[2]) / af, 0, 255); od[p + 3] = a;
        }
      }
      cutData = o; applyAdjust();
      const m = q('.pp-mask');
      if (S.keep || !S.stats) m.textContent = '';
      else if (S.stats.cov < 0.04) m.textContent = 'Almost nothing was kept. Lower the wall colour range, or click the wall in your photo.';
      else if (S.stats.cov > 0.97) m.textContent = 'Very little background was found. Raise the wall colour range, or click the wall in your photo.';
      else m.textContent = 'Kept ' + Math.round(S.stats.cov * 100) + '% of the picture as the person.';
    }
    function applyAdjust() {
      const g = adj.getContext('2d', { willReadFrequently: true });
      if (!S.br && !S.co) { g.putImageData(cutData, 0, 0); return; }
      const cv = S.co * 2.55, f = (259 * (cv + 255)) / (255 * (259 - cv)), add = S.br * 2.55, lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = f * (v - 128) + 128 + add;
      const s = cutData.data, o = new ImageData(S.w, S.h), od = o.data;
      for (let i = 0, n = s.length; i < n; i += 4) { od[i] = lut[s[i]]; od[i + 1] = lut[s[i + 1]]; od[i + 2] = lut[s[i + 2]]; od[i + 3] = s[i + 3]; }
      g.putImageData(o, 0, 0);
    }
    function syncZoom() { K('zoom').value = Math.round(S.z * 100); q('[data-o=zoom]').textContent = Math.round(S.z * 100) + '%'; }
    function autoFit() {
      const st = S.stats;
      if (S.keep || !st || !st.bbox) { S.srel0 = Math.max(S.cw / S.w, S.ch / S.h) / S.cw; S.z = 1; S.cx = S.w / 2; S.cy = S.h / 2; syncZoom(); return; }
      const { top, bottom } = st.bbox, bh = bottom - top + 1, H = S.h, wid = new Float32Array(H), sm = new Float32Array(H);
      for (let y = top; y <= bottom; y++) wid[y] = st.rowMax[y] >= st.rowMin[y] ? st.rowMax[y] - st.rowMin[y] + 1 : 0;
      for (let y = top; y <= bottom; y++) { let s = 0, n = 0; for (let k = -4; k <= 4; k++) { const yy = y + k; if (yy >= top && yy <= bottom) { s += wid[yy]; n++; } } sm[y] = s / n; }
      let peak = 0, peakY = top, valley = 1e9, valleyY = -1, neck = -1;
      const limit = Math.min(bottom, top + Math.round(bh * 0.75));
      for (let y = top; y <= limit && neck < 0; y++) {
        const v = sm[y];
        if (v > peak) { peak = v; peakY = y; valley = 1e9; valleyY = -1; }
        else { if (v < valley) { valley = v; valleyY = y; } if (valleyY > 0 && y > peakY + bh * 0.06 && valley < peak * 0.9 && v > valley * 1.22) neck = valleyY; }
      }
      const headH = neck > 0 ? (neck - top) * 0.92 : Math.min(bh, peak / 0.68), hd = P().head, mid = (hd[0] + hd[1]) / 2, sMM = mid * S.ch / headH;
      S.srel0 = sMM / S.cw; S.z = 1; S.cy = top - ((0.47 - mid / 2 - 0.5) * S.ch) / sMM;
      let sx = 0, n = 0;
      for (let y = Math.round(top + headH * 0.3); y <= Math.min(Math.round(top + headH * 0.7), bottom); y++) if (st.rowMax[y] >= 0) { sx += (st.rowMin[y] + st.rowMax[y]) / 2; n++; }
      S.cx = n ? sx / n : (st.bbox.left + st.bbox.right) / 2;
      syncZoom();
    }
    function paint(c, W, H) {
      c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = S.bg; g.fillRect(0, 0, W, H);
      const s = S.srel0 * S.z * W; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(adj, W / 2 - S.cx * s, H / 2 - S.cy * s, S.w * s, S.h * s);
    }
    function sheetLayout() {
      const paper = PP_PAPERS[K('paper').value], g = 2, m = 5; let best = null;
      for (const land of [false, true]) {
        const sw = land ? paper.h : paper.w, sh = land ? paper.w : paper.h;
        const cols = Math.floor((sw - 2 * m + g) / (S.cw + g)), rows = Math.floor((sh - 2 * m + g) / (S.ch + g));
        if (cols < 1 || rows < 1) continue;
        if (!best || cols * rows > best.n) best = { land, sw, sh, cols, rows, n: cols * rows, g };
      }
      return best;
    }
    function buildSheet(dpi) {
      const lay = sheetLayout(); if (!lay) return null;
      const mm = v => Math.round(v / 25.4 * dpi), sel = K('copies').value, count = sel === 'fill' ? lay.n : Math.min(lay.n, +sel);
      const c = ppCanvas(mm(lay.sw), mm(lay.sh)), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      const pw = mm(S.cw), ph = mm(S.ch), pc = ppCanvas(pw, ph); paint(pc, pw, ph);
      const uc = Math.min(lay.cols, count), ur = Math.ceil(count / lay.cols);
      const x0 = (lay.sw - (uc * S.cw + (uc - 1) * lay.g)) / 2, y0 = (lay.sh - (ur * S.ch + (ur - 1) * lay.g)) / 2;
      g.strokeStyle = '#b4bac4'; g.lineWidth = 1;
      for (let k = 0; k < count; k++) {
        const x = mm(x0 + (k % lay.cols) * (S.cw + lay.g)), y = mm(y0 + Math.floor(k / lay.cols) * (S.ch + lay.g));
        g.drawImage(pc, x, y, pw, ph); g.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
      }
      return { canvas: c, lay, count };
    }
    function renderSheet() {
      const res = buildSheet(100), info = q('.pp-sheetinfo'), sc = q('.pp-sheet');
      if (!res) { sc.width = sc.height = 1; info.textContent = 'This photo size does not fit on that paper.'; return; }
      sc.width = res.canvas.width; sc.height = res.canvas.height; sc.getContext('2d').drawImage(res.canvas, 0, 0);
      info.textContent = PP_PAPERS[K('paper').value].label + ' · ' + res.count + ' photo' + (res.count === 1 ? '' : 's') + ' · ' + (res.lay.land ? 'landscape' : 'portrait');
    }
    function render() {
      const Wp = ppPx(S.cw, 300), Hp = ppPx(S.ch, 300);
      paint(q('.pp-prev'), Wp, Hp);
      q('.pp-frame').style.setProperty('--ar', S.cw / S.ch);
      const hd = P().head, mid = (hd[0] + hd[1]) / 2, ry = mid * S.ch / 2, cy = 0.47 * S.ch, rx = Math.min(0.34 * mid * S.ch, S.cw * 0.48), cx = S.cw / 2;
      const gs = q('.pp-guide'); gs.setAttribute('viewBox', '0 0 ' + S.cw + ' ' + S.ch); gs.style.display = S.guides ? '' : 'none';
      ['.g-e1', '.g-e2'].forEach(s => { const e = q(s); e.setAttribute('cx', cx); e.setAttribute('cy', cy); e.setAttribute('rx', rx); e.setAttribute('ry', ry); });
      const v = q('.g-v'); v.setAttribute('x1', cx); v.setAttribute('x2', cx); v.setAttribute('y1', 0); v.setAttribute('y2', S.ch);
      q('.pp-readout').textContent = ppMm(S.cw) + ' x ' + ppMm(S.ch) + ' mm · ' + ppPx(S.cw, 300) + ' x ' + ppPx(S.ch, 300) + ' px at 300 dpi';
      q('.pp-head').textContent = 'Head height (crown to chin) should be about ' + Math.round(hd[0] * 100) + '-' + Math.round(hd[1] * 100) + '% of the photo height. Check the rules of the office you apply to.';
      clearTimeout(sheetT); sheetT = setTimeout(renderSheet, 160);
    }
    function queue(o) {
      if (o.mask) needMask = true; if (o.adj) needAdj = true;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (needMask) { needMask = needAdj = false; runMask(); } else if (needAdj) { needAdj = false; applyAdjust(); } render(); });
    }
    const setZoom = v => { S.z = ppClamp(v, 0.3, 4); syncZoom(); queue({}); };

    // controls
    const sel = K('preset'); Object.keys(PP_SIZES).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = PP_SIZES[k].label; sel.appendChild(o); });
    sel.onchange = () => {
      S.preset = sel.value;
      if (S.preset !== 'custom') { S.cw = P().w; S.ch = P().h; } else { S.cw = ppClamp(+K('cw').value || 35, 10, 200); S.ch = ppClamp(+K('ch').value || 45, 10, 250); }
      q('[data-custom]').hidden = S.preset !== 'custom'; autoFit(); queue({});
    };
    ['cw', 'ch'].forEach(k => { K(k).oninput = () => { const v = +K(k).value; if (v >= 10) { S[k] = ppClamp(v, 10, k === 'cw' ? 200 : 250); queue({}); } }; K(k).onchange = () => { autoFit(); queue({}); }; });
    const rng = (k, fmt, fn) => { const el = K(k), o = q('[data-o=' + k + ']'), show = () => { o.textContent = fmt(+el.value); }; el.oninput = () => { S[k] = +el.value; show(); fn(); }; show(); };
    const sgn = v => (v > 0 ? '+' : '') + v;
    rng('tol', v => v, () => queue({ mask: true })); rng('edge', v => v + ' px', () => queue({ mask: true })); rng('soft', v => v + ' px', () => queue({ mask: true }));
    rng('br', sgn, () => queue({ adj: true })); rng('co', sgn, () => queue({ adj: true }));
    K('zoom').oninput = () => setZoom(+K('zoom').value / 100);
    K('guides').onchange = () => { S.guides = K('guides').checked; queue({}); };
    K('keep').onchange = () => { S.keep = K('keep').checked; q('[data-remove]').disabled = S.keep; runMask(); autoFit(); queue({}); };
    ['paper', 'copies'].forEach(k => K(k).onchange = () => queue({}));
    const setBg = c => { S.bg = c; K('bgcolor').value = c; qa('.pp-sw').forEach(b => b.setAttribute('aria-pressed', b.dataset.c === c ? 'true' : 'false')); queue({}); };
    qa('.pp-sw').forEach(b => b.onclick = () => setBg(b.dataset.c)); K('bgcolor').oninput = () => setBg(K('bgcolor').value);
    q('[data-a=fit]').onclick = () => { autoFit(); queue({}); };
    q('[data-a=autoref]').onclick = () => { S.bgRef = null; S.pick = null; S.autoRef = null; drawThumb(); queue({ mask: true }); };
    q('.pp-thumbc').onclick = e => {
      if (S.keep) return;
      const r = e.currentTarget.getBoundingClientRect(), x = Math.round((e.clientX - r.left) / r.width * S.w), y = Math.round((e.clientY - r.top) / r.height * S.h), d = src.data;
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const p = (ppClamp(y + dy, 0, S.h - 1) * S.w + ppClamp(x + dx, 0, S.w - 1)) * 4; R += d[p]; G += d[p + 1]; B += d[p + 2]; n++; }
      S.bgRef = [R / n, G / n, B / n]; S.pick = { x, y }; drawThumb(); queue({ mask: true });
    };
    // drag and pinch on the preview
    const pc = q('.pp-prev'), ptrs = new Map(); let pinch0 = null;
    pc.onpointerdown = e => { pc.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: S.z }; } };
    pc.onpointermove = e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 1) { const r = pc.getBoundingClientRect(), k = pc.width / r.width, s = S.srel0 * S.z * pc.width; S.cx -= dx * k / s; S.cy -= dy * k / s; queue({}); }
      else if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; setZoom(pinch0.z * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch0.d); }
    };
    pc.onpointerup = pc.onpointercancel = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
    pc.addEventListener('wheel', e => { e.preventDefault(); setZoom(S.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

    // saving
    async function encodeJpg(c, kb) {
      const b = await toBlob(c, 'image/jpeg', 0.95); if (!kb || b.size <= kb * 1024) return { b, ok: true };
      let lo = 0.15, hi = 0.95, best = null;
      for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2, t = await toBlob(c, 'image/jpeg', m); if (t.size <= kb * 1024) { best = t; lo = m; } else hi = m; }
      return best ? { b: best, ok: true } : { b: await toBlob(c, 'image/jpeg', 0.15), ok: false };
    }
    q('[data-a=save1]').onclick = async () => {
      try {
        const W = ppPx(S.cw, 300), H = ppPx(S.ch, 300), c = ppCanvas(W, H); paint(c, W, H);
        const kb = +K('maxkb').value, r = await encodeJpg(c, kb);
        dl(r.b, 'passport-photo-' + ppMm(S.cw) + 'x' + ppMm(S.ch) + 'mm.jpg');
        say('Photo saved: ' + W + ' x ' + H + ' px, ' + fmtKB(r.b.size) + (r.ok ? '.' : '. This is still above ' + kb + ' KB. Try a smaller photo size.'), r.ok ? 'ok' : 'bad');
      } catch (e) { say('Could not save the photo. ' + (e.message || ''), 'bad'); }
    };
    q('[data-a=save2]').onclick = async () => {
      try {
        const res = buildSheet(300); if (!res) throw new Error('This photo size does not fit on that paper.');
        const b = await toBlob(res.canvas, 'image/jpeg', 0.95); dl(b, 'passport-sheet-' + PP_PAPERS[K('paper').value].fn + '.jpg');
        say('Print sheet saved with ' + res.count + ' photos (' + fmtKB(b.size) + '). Print at 100% scale.', 'ok');
      } catch (e) { say(e.message || 'Could not save the sheet.', 'bad'); }
    };

    drawThumb(); runMask(); autoFit(); render();
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
    { id: 'pdfinvert', title: 'Invert PDF', desc: 'Flip the colours: white pages turn black and black text turns white. Pages become images.', files: '.pdf,application/pdf', btn: 'Invert PDF', opts: [{ k: 'q', label: 'Quality', type: 'select', options: [['1.5', 'Standard'], ['1.1', 'Fast, smaller file'], ['2', 'Sharp, larger file']] }],
      async run(files, o, log) {
        const b = await filterPdf(files[0], +o.q, 0.85, 'invert', log); dl(b, base(files[0].name) + '-inverted.pdf');
        return 'Inverted PDF created (' + fmtKB(b.size) + '). Text is no longer selectable.';
      } },
    { id: 'pdfgray', title: 'PDF to Black & White', desc: 'Make a coloured PDF grayscale or pure black and white, good for cheaper printing.', files: '.pdf,application/pdf', btn: 'Convert PDF', opts: [{ k: 'mode', label: 'Style', type: 'select', options: [['gray', 'Grayscale'], ['bw', 'Black and white only']] }, { k: 'q', label: 'Quality', type: 'select', options: [['1.5', 'Standard'], ['1.1', 'Fast, smaller file'], ['2', 'Sharp, larger file']] }],
      async run(files, o, log) {
        const b = await filterPdf(files[0], +o.q, 0.85, o.mode, log); dl(b, base(files[0].name) + '-bw.pdf');
        return 'PDF created (' + fmtKB(b.size) + '). Text is no longer selectable.';
      } },
    { id: 'pdfrotate', title: 'Rotate PDF', desc: 'Fix sideways or upside-down pages.', files: '.pdf,application/pdf', btn: 'Rotate PDF', opts: [{ k: 'deg', label: 'Turn clockwise', type: 'select', options: [['90', '90°'], ['180', '180°'], ['270', '270°']] }, { k: 'range', label: 'Pages (blank for all, e.g. 2-4)', type: 'text', value: '' }],
      async run(files, o) {
        const d = await PDFLib.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }), pages = pagesOf(o.range, d.getPageCount());
        pages.forEach(p => { const pg = d.getPage(p - 1); pg.setRotation(PDFLib.degrees((pg.getRotation().angle + +o.deg) % 360)); });
        dl(new Blob([await d.save()], { type: 'application/pdf' }), base(files[0].name) + '-rotated.pdf'); return pages.length + ' page(s) rotated.';
      } },
    { id: 'pdfdelete', title: 'Delete PDF Pages', desc: 'Remove unwanted pages and keep the rest.', files: '.pdf,application/pdf', btn: 'Delete pages', opts: [{ k: 'range', label: 'Pages to delete (e.g. 2, 4-6)', type: 'text', value: '' }],
      async run(files, o) {
        if (!o.range.trim()) throw new Error('Type the pages to delete, like 2, 4-6.');
        const d = await PDFLib.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }), n = d.getPageCount(), del = pagesOf(o.range, n), keep = [];
        for (let i = 1; i <= n; i++) if (!del.includes(i)) keep.push(i - 1);
        if (!keep.length) throw new Error('That would delete every page.');
        const out = await PDFLib.PDFDocument.create(); (await out.copyPages(d, keep)).forEach(p => out.addPage(p));
        dl(new Blob([await out.save()], { type: 'application/pdf' }), base(files[0].name) + '-trimmed.pdf'); return del.length + ' page(s) deleted, ' + keep.length + ' kept.';
      } },
    { id: 'pdfnumbers', title: 'Add Page Numbers', desc: 'Put page numbers at the bottom of every page.', files: '.pdf,application/pdf', btn: 'Add numbers', opts: [{ k: 'pos', label: 'Position', type: 'select', options: [['c', 'Bottom centre'], ['r', 'Bottom right'], ['l', 'Bottom left']] }, { k: 'style', label: 'Style', type: 'select', options: [['n', '1, 2, 3'], ['p', 'Page 1'], ['o', 'Page 1 of 10']] }, { k: 'start', label: 'Start from', type: 'number', value: 1 }],
      async run(files, o) {
        const d = await PDFLib.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }), font = await d.embedFont(PDFLib.StandardFonts.Helvetica), pages = d.getPages(), st = parseInt(o.start, 10) || 1;
        pages.forEach((pg, i) => {
          const num = i + st, t = o.style === 'n' ? String(num) : o.style === 'p' ? 'Page ' + num : `Page ${num} of ${pages.length + st - 1}`;
          const w = font.widthOfTextAtSize(t, 10), W = pg.getWidth(), x = o.pos === 'l' ? 30 : o.pos === 'r' ? W - 30 - w : (W - w) / 2;
          pg.drawText(t, { x, y: 20, size: 10, font, color: PDFLib.rgb(0.2, 0.2, 0.2) });
        });
        dl(new Blob([await d.save()], { type: 'application/pdf' }), base(files[0].name) + '-numbered.pdf'); return pages.length + ' page(s) numbered.';
      } },
    { id: 'pdfwatermark', title: 'Watermark PDF', desc: 'Stamp text like COPY or CONFIDENTIAL across every page.', files: '.pdf,application/pdf', btn: 'Add watermark', opts: [{ k: 'text', label: 'Watermark text', type: 'text', value: 'COPY' }, { k: 'color', label: 'Colour', type: 'select', options: [['g', 'Gray'], ['r', 'Red'], ['b', 'Blue']] }, { k: 'op', label: 'Strength', type: 'select', options: [['0.12', 'Light'], ['0.25', 'Medium'], ['0.45', 'Strong']] }, { k: 'ang', label: 'Direction', type: 'select', options: [['45', 'Diagonal'], ['0', 'Straight']] }],
      async run(files, o) {
        const text = o.text.trim(); if (!text) throw new Error('Type the watermark text.');
        const d = await PDFLib.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }), font = await d.embedFont(PDFLib.StandardFonts.HelveticaBold), R = PDFLib.rgb;
        const col = o.color === 'r' ? R(0.8, 0.1, 0.1) : o.color === 'b' ? R(0.1, 0.25, 0.8) : R(0.4, 0.4, 0.4), a = +o.ang, th = a * Math.PI / 180;
        d.getPages().forEach(pg => {
          const W = pg.getWidth(), H = pg.getHeight(), size = Math.min(110, Math.max(24, Math.min(W, H) * 0.9 / Math.max(text.length * 0.62, 3)));
          const w = font.widthOfTextAtSize(text, size), h = size * 0.3;
          pg.drawText(text, { x: W / 2 - (w / 2 * Math.cos(th) - h * Math.sin(th)), y: H / 2 - (w / 2 * Math.sin(th) + h * Math.cos(th)), size, font, color: col, opacity: +o.op, rotate: PDFLib.degrees(a) });
        });
        dl(new Blob([await d.save()], { type: 'application/pdf' }), base(files[0].name) + '-watermarked.pdf'); return 'Watermark added. Use English letters and numbers.';
      } },
    { id: 'pdf2txt', title: 'PDF to Text', desc: 'Pull all the text out of a PDF into a plain text file.', files: '.pdf,application/pdf', btn: 'Extract text', opts: [],
      async run(files, o, log) {
        const pdf = await pdfjsLib.getDocument({ data: await readBuf(files[0]) }).promise, all = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          log(`Reading page ${p} of ${pdf.numPages}`);
          const tc = await (await pdf.getPage(p)).getTextContent(), lines = []; let cur = [], y = null;
          for (const it of tc.items) { const ty = Math.round(it.transform[5]); if (y !== null && Math.abs(ty - y) > 4) { lines.push(cur.join(' ')); cur = []; } cur.push(it.str); y = ty; }
          if (cur.length) lines.push(cur.join(' ')); all.push(lines.filter(l => l.trim()).join('\n'));
        }
        const txt = all.join('\n\n'); if (txt.trim().length < 20) throw new Error('No selectable text found. This looks like a scanned PDF.');
        dl(new Blob([txt], { type: 'text/plain' }), base(files[0].name) + '.txt'); return 'Text file created.';
      } },
    { id: 'imgkb', title: 'Compress Image to KB', desc: 'Shrink photos to fit a form limit like 50 KB or 200 KB.', files: 'image/*', multiple: true, btn: 'Compress', opts: [{ k: 'kb', label: 'Target size (KB)', type: 'number', value: 50 }],
      async run(files, o, log) {
        const kb = +o.kb; if (!(kb >= 5)) throw new Error('Enter a size of 5 KB or more.');
        for (const f of files) { log('Compressing ' + f.name); const b = await jpegUnder(await loadImg(f), kb * 1024); dl(b, `${base(f.name)}-${kb}kb.jpg`); await new Promise(r => setTimeout(r, 250)); }
        return files.length + ' file(s) compressed to ' + kb + ' KB or less.';
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
    { id: 'passport', title: 'Passport Photo Maker', desc: 'Remove the background, crop to passport size and print a sheet of photos. Your photo stays in your browser.', files: 'image/*', btn: 'Open photo editor', opts: [],
      async run(files, o, log, out) { out.innerHTML = ''; await passportEditor(files[0], out); return ''; } },
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
    form.insertAdjacentHTML('beforeend', `<button class="btn primary" type="submit">${t.btn || 'Convert'}</button>`);
    if (t.id === 'photo') form.preset.onchange = () => { if (form.preset.value) { const [w, h, k] = form.preset.value.split('|'); form.w.value = w; form.h.value = h; form.kb.value = k; } };
    form.onsubmit = async e => {
      e.preventDefault(); log.className = 'tlog'; log.textContent = 'Working...'; out.innerHTML = '';
      const btn = $('button', form); btn.disabled = true;
      try {
        const files = form.f ? [...form.f.files] : []; if (t.files && !files.length) throw new Error('Select a file first.');
        const o = {}; t.opts.forEach(op => o[op.k] = form[op.k].value);
        const msg = await t.run(files, o, m => log.textContent = m, out); log.textContent = msg || ''; log.classList.add('ok');
      } catch (err) {
        const m = err.message || String(err);
        log.textContent = err.name === 'PasswordException' || /encrypt|password/i.test(m) ? 'This PDF is protected with a password. Remove the password first, then try again.' : m;
        log.classList.add('bad');
      }
      btn.disabled = false;
    };
  }
  TOOLS.forEach(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tab'; b.dataset.id = t.id; b.textContent = t.title; b.onclick = () => show(t); tabs.appendChild(b); });
  show(TOOLS[0]);
})();
