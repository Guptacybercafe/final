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

})();
