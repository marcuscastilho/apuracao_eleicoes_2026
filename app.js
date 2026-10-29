const PAGE_SIZE = 50;
const DATA_URL = 'data/elections.json';
const OTHER = { '13': '22', '22': '13' };

const state = {
  candidateId: null,
  uf: 'SP',
  search: '',
  trend: 'all',
  order: 'gain',
  page: 1,
};

let dataset = null;
let engine = null;
let searchTimer = null;

const intFmt = new Intl.NumberFormat('pt-BR');
const decFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

const els = {
  status: document.getElementById('status'),
  dashboard: document.getElementById('dashboard'),
  snapshotDate: document.getElementById('snapshot-date'),
  roundsLabel: document.getElementById('rounds-label'),
  baseStatus: document.getElementById('base-status'),
  tabs: document.getElementById('candidate-tabs'),
  ufSelect: document.getElementById('uf-select'),
  searchInput: document.getElementById('search-input'),
  trendSelect: document.getElementById('trend-select'),
  orderSelect: document.getElementById('order-select'),
  resetButton: document.getElementById('reset-button'),
  csvButton: document.getElementById('csv-button'),
  partialWarning: document.getElementById('partial-warning'),
  kpiCoverage: document.getElementById('kpi-coverage'),
  chart: document.getElementById('chart'),
  chartTitle: document.getElementById('chart-title'),
  chartSubtitle: document.getElementById('chart-subtitle'),
  tableSubtitle: document.getElementById('table-subtitle'),
  resultsBody: document.getElementById('results-body'),
  emptyState: document.getElementById('empty-state'),
  emptyReset: document.getElementById('empty-reset'),
  pagination: document.getElementById('pagination'),
};

const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatInt = value => intFmt.format(value);
const formatSigned = value => `${value > 0 ? '+' : value < 0 ? '\u2212' : ''}${intFmt.format(Math.abs(value))}`;
const formatPct = value => value === null ? '\u2014' : `${decFmt.format(value)}%`;
const formatSignedPct = value => value === null ? '\u2014' : `${value > 0 ? '+' : value < 0 ? '\u2212' : ''}${decFmt.format(Math.abs(value))}%`;
const formatPP = value => value === null ? '\u2014' : `${value > 0 ? '+' : value < 0 ? '\u2212' : ''}${decFmt.format(Math.abs(value))} p.p.`;

const candidateById = id => dataset.candidates.find(candidate => candidate.id === id);
const stateName = uf => (dataset.metadata.states.find(entry => entry.uf === uf) || {}).name || uf;
const pluralCities = count => `${formatInt(count)} ${count === 1 ? 'município' : 'municípios'}`;

function filteredCities() {
  return engine.selectCities(dataset.cities, {
    uf: state.uf,
    search: state.search,
    trend: state.trend,
    candidateId: state.candidateId,
  });
}

function groupedRows() {
  return engine.groupRanked(filteredCities(), state.candidateId, state.order);
}

/* ---------- Status / loading ---------- */

function showLoading() {
  els.status.hidden = false;
  els.dashboard.hidden = true;
  els.status.innerHTML = '<p class="status-loading">Carregando base local ' +
    '<span class="dots"><span>.</span><span>.</span><span>.</span></span></p>';
}

function showError(title, detail) {
  els.status.hidden = false;
  els.dashboard.hidden = true;
  els.status.innerHTML = `
    <div class="status-error">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(detail)}</p>
      <p>Este painel precisa ser servido por HTTP a partir da pasta do projeto e ler
        <code>data/elections.json</code>. Verifique:</p>
      <p><code>python download_data.py</code><br>
         <code>python -m http.server 8080 --bind 127.0.0.1</code><br>
         e abra <code>http://127.0.0.1:8080/</code></p>
      <p><button type="button" class="button button-primary" id="retry-button">Tentar novamente</button></p>
    </div>`;
  document.getElementById('retry-button').addEventListener('click', init);
}

async function loadDataset() {
  const response = await fetch(DATA_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao buscar ${DATA_URL}`);
  }
  return response.json();
}

async function init() {
  showLoading();
  try {
    engine = engine || await import('./analysis.js');
  } catch (error) {
    showError('Motor de análise indisponível',
      `Não foi possível carregar analysis.js (${error.message || error}).`);
    return;
  }
  try {
    dataset = await loadDataset();
  } catch (error) {
    showError('Não foi possível carregar a base local',
      error.message || String(error));
    return;
  }
  setup();
}

function setup() {
  const meta = dataset.metadata;
  state.candidateId = dataset.candidates[0].id;
  if (!meta.states.some(entry => entry.uf === 'SP')) state.uf = 'all';

  els.snapshotDate.textContent = meta.downloadedAt ? dateFmt.format(new Date(meta.downloadedAt)) : '—';
  els.roundsLabel.textContent = meta.rounds
    .map(round => `${round.turn}º turno ${round.date}`).join(' · ') || '—';
  els.baseStatus.textContent = `${formatInt(meta.coverage.paired)} municípios pareados` +
    (meta.coverage.excluded ? ` · ${formatInt(meta.coverage.excluded)} excluídos` : '') +
    (meta.coverage.errors ? ` · ${formatInt(meta.coverage.errors)} com erro` : '');

  renderTabs();
  renderUfOptions();
  els.searchInput.value = '';
  els.trendSelect.value = state.trend;
  els.orderSelect.value = state.order;

  els.status.hidden = true;
  els.dashboard.hidden = false;
  render();
  document.body.dataset.ready = 'true';
  document.dispatchEvent(new CustomEvent('data-loaded', { detail: { cities: dataset.cities.length } }));
}

/* ---------- Controls ---------- */

function renderTabs() {
  els.tabs.innerHTML = dataset.candidates.map(candidate => `
    <button type="button" class="tab tab-${escapeHtml(candidate.id)}"
      data-id="${escapeHtml(candidate.id)}"
      aria-pressed="${candidate.id === state.candidateId}">
      <span class="dot dot-${escapeHtml(candidate.id)}" aria-hidden="true"></span>
      ${escapeHtml(candidate.name)} <span class="party">${escapeHtml(candidate.party)}</span>
    </button>`).join('');
}

function renderUfOptions() {
  const states = dataset.metadata.states;
  els.ufSelect.innerHTML = '<option value="all">Todos os estados</option>' +
    states.map(entry => `<option value="${escapeHtml(entry.uf)}">${escapeHtml(entry.uf)} — ${escapeHtml(entry.name)} ` +
      `(${formatInt(entry.paired)}/${formatInt(entry.expected)})</option>`).join('');
  els.ufSelect.value = state.uf;
}

function resetFilters() {
  state.search = '';
  state.trend = 'all';
  state.order = 'gain';
  state.uf = dataset.metadata.states.some(entry => entry.uf === 'SP') ? 'SP' : 'all';
  state.page = 1;
  els.searchInput.value = '';
  els.trendSelect.value = 'all';
  els.orderSelect.value = 'gain';
  els.ufSelect.value = state.uf;
  render();
}

function downloadCSV() {
  const csv = engine.toCSV(groupedRows(), state.candidateId);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `samu-confere-2026-${state.uf}-${state.candidateId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Render ---------- */

function render() {
  const cities = filteredCities();
  const groups = engine.groupRanked(cities, state.candidateId, state.order);
  renderKpis(cities);
  renderChart(cities);
  renderTable(groups);
}

function renderKpis(cities) {
  for (const candidate of dataset.candidates) {
    const summary = engine.summarize(cities, candidate.id);
    const card = document.getElementById(`kpi-${candidate.id}`);
    const trendBits = [];
    if (summary.gaining) trendBits.push(`em alta em ${pluralCities(summary.gaining)}`);
    if (summary.losing) trendBits.push(`em queda em ${pluralCities(summary.losing)}`);
    if (summary.stable) trendBits.push(`estável em ${pluralCities(summary.stable)}`);
    card.innerHTML = `
      <h3><span class="dot dot-${escapeHtml(candidate.id)}" aria-hidden="true"></span>${escapeHtml(candidate.name)}</h3>
      <p class="kpi-party">${escapeHtml(candidate.party)} · nº ${escapeHtml(candidate.id)}</p>
      <p class="kpi-delta ${summary.delta >= 0 ? 'positive' : 'negative'}">${formatSigned(summary.delta)}</p>
      <p class="kpi-trends">variação total no recorte · crescimento agregado ${formatSignedPct(summary.growth)}</p>
      <dl>
        <div><dt>1º turno</dt><dd>${formatInt(summary.first)}</dd></div>
        <div><dt>2º turno</dt><dd>${formatInt(summary.second)}</dd></div>
      </dl>
      <p class="kpi-trends">${trendBits.join(' · ') || 'sem municípios no recorte'}</p>`;
  }

  const coverage = dataset.metadata.coverage;
  els.kpiCoverage.innerHTML = `
    <h3>Cobertura</h3>
    <p class="kpi-party">Municípios no recorte e na base</p>
    <p class="kpi-delta positive">${formatInt(cities.length)}</p>
    <p class="kpi-trends">municípios no recorte atual</p>
    <dl>
      <div><dt>Base pareada</dt><dd>${formatInt(coverage.paired)}</dd></div>
      <div><dt>Esperados</dt><dd>${formatInt(coverage.expected)}</dd></div>
      <div><dt>Excluídos</dt><dd>${formatInt(coverage.excluded)}</dd></div>
      <div><dt>Erros</dt><dd>${formatInt(coverage.errors)}</dd></div>
    </dl>`;

  const partial = engine.summarize(cities, state.candidateId).partial;
  els.partialWarning.hidden = partial === 0;
  if (partial) {
    els.partialWarning.textContent = `Atenção: ${pluralCities(partial)} do recorte ` +
      'ainda não tinha apuração oficial finalizada em pelo menos um dos turnos.';
  }
}

function renderChart(cities) {
  const top = engine.chartCities(cities, state.candidateId, state.order);
  const selected = candidateById(state.candidateId);
  const other = candidateById(OTHER[state.candidateId]);
  els.chartTitle.textContent = `Maiores variações de ${selected.name} no recorte`;
  els.chartSubtitle.textContent = `Top ${top.length} ${top.length === 1 ? 'município' : 'municípios'} ` +
    'na ordenação atual, comparando a variação de votos dos dois candidatos (1º → 2º turno).';

  if (!top.length) {
    els.chart.innerHTML = '<p class="chart-empty">Sem municípios para exibir.</p>';
    return;
  }

  const width = 880;
  const labelWidth = 210;
  const plotCenter = labelWidth + 330;
  const plotHalf = 280;
  const rowHeight = 56;
  const legendHeight = 28;
  const axisLabelY = 48;
  const rowsTop = 60;
  const height = rowsTop + top.length * rowHeight + 14;
  const maxAbs = Math.max(1, ...top.flatMap(item => [Math.abs(item.metrics.delta), Math.abs(item.otherMetrics.delta)]));
  const scale = value => value / maxAbs * plotHalf;

  const legend = `
    <g class="legend">
      <rect x="8" y="8" width="12" height="12" class="bar-${escapeHtml(selected.id)}"></rect>
      <text x="26" y="18">${escapeHtml(selected.name)} (${escapeHtml(selected.party)}) — selecionado</text>
      <rect x="270" y="8" width="12" height="12" class="bar-muted-${escapeHtml(other.id)}"></rect>
      <text x="288" y="18">${escapeHtml(other.name)} (${escapeHtml(other.party)})</text>
    </g>
    <g class="axis">
      <text class="axis-label" x="${plotCenter}" y="${axisLabelY}" text-anchor="middle">0</text>
      <text class="axis-label" x="${plotCenter + plotHalf}" y="${axisLabelY}" text-anchor="end">+${formatInt(maxAbs)}</text>
      <text class="axis-label" x="${plotCenter - plotHalf}" y="${axisLabelY}" text-anchor="start">−${formatInt(maxAbs)}</text>
    </g>`;

  const rows = top.map((item, index) => {
    const y = rowsTop + index * rowHeight;
    const bar = (metrics, cls, offsetY) => {
      const delta = metrics.delta;
      const length = Math.abs(scale(delta));
      const x = delta >= 0 ? plotCenter : plotCenter - length;
      const textX = delta >= 0 ? x + length + 6 : x - 6;
      const anchor = delta >= 0 ? 'start' : 'end';
      return `
        <rect class="${cls}" x="${x.toFixed(1)}" y="${y + offsetY}" width="${Math.max(length, 1).toFixed(1)}" height="13" rx="2"></rect>
        <text class="value-label" x="${textX.toFixed(1)}" y="${y + offsetY + 11}" text-anchor="${anchor}">${formatSigned(delta)}</text>`;
    };
    return `
      <g>
        <text class="city-label" x="8" y="${y + 18}">${escapeHtml(truncate(item.city.name, 26))}</text>
        <text class="city-label city-uf" x="8" y="${y + 34}">${escapeHtml(item.city.uf)}</text>
        ${bar(item.metrics, `bar-${selected.id}`, 6)}
        ${bar(item.otherMetrics, `bar-muted-${other.id}`, 32)}
        <line x1="8" x2="${width - 8}" y1="${y + rowHeight - 4}" y2="${y + rowHeight - 4}"
          stroke="rgba(20,56,59,0.08)"></line>
      </g>`;
  }).join('');

  const accessible = top.map(item =>
    `<li>${escapeHtml(item.city.name)} (${escapeHtml(item.city.uf)}): ` +
    `${escapeHtml(selected.name)} ${formatSigned(item.metrics.delta)} votos; ` +
    `${escapeHtml(other.name)} ${formatSigned(item.otherMetrics.delta)} votos.</li>`).join('');

  els.chart.innerHTML = `
    <div class="chart-scroll" tabindex="0" role="region" aria-label="Gráfico de variações rolável horizontalmente">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-svg-title" preserveAspectRatio="xMidYMid meet">
        <title id="chart-svg-title">Variação de votos por município, ${escapeHtml(selected.name)} em destaque</title>
        ${legend}
        <line class="zero-line" x1="${plotCenter}" x2="${plotCenter}" y1="${rowsTop - 6}" y2="${height - 6}"></line>
        ${rows}
      </svg>
    </div>
    <ul class="sr-only">${accessible}</ul>`;
}

const truncate = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

function renderTable(groups) {
  const flat = groups.flatMap(group => group.rows.map(row => ({ uf: group.uf, ...row })));
  const totalPages = Math.max(1, Math.ceil(flat.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const pageRows = flat.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  const candidate = candidateById(state.candidateId);

  els.tableSubtitle.textContent =
    `${pluralCities(flat.length)} no recorte · ranking por UF para ${candidate.name} ` +
    '· a numeração recomeça em cada unidade da federação.';

  let lastUf = null;
  els.resultsBody.dataset.candidate = state.candidateId;
  els.resultsBody.innerHTML = pageRows.map(({ uf, city, metrics, rank }) => {
    const header = uf !== lastUf
      ? `<tr class="group-header"><td colspan="9">${escapeHtml(uf)} — ${escapeHtml(stateName(uf))}` +
        `<span class="group-count">${pluralCities(groups.find(group => group.uf === uf).rows.length)}</span></td></tr>`
      : '';
    lastUf = uf;
    const deltaClass = metrics.delta > 0 ? 'delta-pos' : metrics.delta < 0 ? 'delta-neg' : '';
    return `${header}
      <tr>
        <td class="num">${rank}º</td>
        <td class="city-name">${escapeHtml(city.name)}</td>
        <td class="num">${formatInt(metrics.first)}</td>
        <td class="num">${formatPct(metrics.shareFirst)}</td>
        <td class="num">${formatInt(metrics.second)}</td>
        <td class="num">${formatPct(metrics.shareSecond)}</td>
        <td class="num ${deltaClass}">${formatSigned(metrics.delta)}</td>
        <td class="num">${formatSignedPct(metrics.growth)}</td>
        <td class="num">${formatPP(metrics.pp)}</td>
      </tr>`;
  }).join('');

  els.emptyState.hidden = flat.length > 0;
  els.pagination.hidden = totalPages <= 1;
  if (totalPages > 1) renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const current = state.page;
  const windowSize = 7;
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const buttons = [];
  buttons.push(`<button type="button" class="page-button" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>‹ Anterior</button>`);
  for (let page = start; page <= end; page += 1) {
    buttons.push(`<button type="button" class="page-button" data-page="${page}"` +
      `${page === current ? ' aria-current="page"' : ''}>${page}</button>`);
  }
  buttons.push(`<button type="button" class="page-button" data-page="${current + 1}" ${current === totalPages ? 'disabled' : ''}>Próxima ›</button>`);
  buttons.push(`<span class="page-info">Página ${formatInt(current)} de ${formatInt(totalPages)} · ${PAGE_SIZE} por página</span>`);
  els.pagination.innerHTML = buttons.join('');
}

/* ---------- Events ---------- */

els.tabs.addEventListener('click', event => {
  const button = event.target.closest('.tab');
  if (!button || button.dataset.id === state.candidateId) return;
  state.candidateId = button.dataset.id;
  state.page = 1;
  renderTabs();
  render();
});

els.ufSelect.addEventListener('change', () => {
  state.uf = els.ufSelect.value;
  state.page = 1;
  render();
});

els.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = els.searchInput.value;
    state.page = 1;
    render();
  }, 200);
});

els.trendSelect.addEventListener('change', () => {
  state.trend = els.trendSelect.value;
  state.page = 1;
  render();
});

els.orderSelect.addEventListener('change', () => {
  state.order = els.orderSelect.value;
  state.page = 1;
  render();
});

els.resetButton.addEventListener('click', resetFilters);
els.emptyReset.addEventListener('click', resetFilters);
els.csvButton.addEventListener('click', downloadCSV);

els.pagination.addEventListener('click', event => {
  const button = event.target.closest('.page-button');
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  render();
  els.resultsBody.closest('.table-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const navLinks = [...document.querySelectorAll('.sidebar-nav .nav-link')];
const validAnchors = new Set(navLinks.map(link => link.getAttribute('href')));

function syncNav() {
  const hash = validAnchors.has(window.location.hash) ? window.location.hash : '#overview';
  for (const link of navLinks) {
    const active = link.getAttribute('href') === hash;
    link.classList.toggle('nav-active', active);
    if (active) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', syncNav);
syncNav();

if (typeof document !== 'undefined') {
  init();
}
