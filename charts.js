const DATA_URL = 'data/elections.json';
const GEO_URL = 'data/brazil-ufs.geojson';
const MUN_INDEX_URL = 'data/municipality-index.json';
const munGeoUrl = uf => `data/municipalities/${uf.toLowerCase()}.geojson`;

const state = { candidateId: null, uf: 'all', metric: 'delta' };
let dataset = null;
let geojson = null;
let geoError = null;
let model = null;
let modelApi = null;
let geoApi = null;
let mapStyleApi = null;
let munModelApi = null;
let municipal = null;
let munIndexPromise = null;
const munGeoPromises = new Map();
let renderQueue = Promise.resolve();
let lastError = null;

const C = {
  accent: '#facc15', lula: '#f87171', flavio: '#38bdf8',
  teal: '#2dd4bf', orange: '#fb923c', slate: '#334155',
  text: '#cbd5e1', muted: '#94a3b8', grid: 'rgba(148,163,184,.14)',
};
const CAND_COLOR = { '13': C.lula, '22': C.flavio };
const DIR_COLOR = { gain: C.teal, loss: C.orange, stable: C.muted };
const MAP_BORDER = 'rgba(148,163,184,.55)';

const intFmt = new Intl.NumberFormat('pt-BR');
const decFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sign = v => (v > 0 ? '+' : v < 0 ? '\u2212' : '');
const fmtInt = v => intFmt.format(v);
const fmtMetric = (v, unit) => v === null ? 'não definido'
  : `${sign(v)}${(unit === 'votos' ? intFmt : decFmt).format(Math.abs(v))} ${unit}`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtShare = v => v === null ? 'não definido' : `${decFmt.format(v)}% válidos`;

const $ = id => document.getElementById(id);
const els = {
  status: $('charts-status'), dashboard: $('charts-dashboard'), tabs: $('c-tabs'),
  uf: $('c-uf-select'), metric: $('c-metric-select'), reset: $('c-reset'),
  insights: $('insights'), scopeNote: $('scope-note'), mapMetric: $('map-metric-name'),
  mapTitle: $('map-title'), rankingTitle: $('ranking-title'), rankingSub: $('ranking-subtitle'),
  rankingMetric: $('ranking-metric-name'), mapSubtitle: $('map-subtitle'),
  mapToolbar: $('map-toolbar'), mapBack: $('map-back'), mapHelper: $('map-helper'),
  mapCoverage: $('map-coverage'), mapLoading: $('map-loading'),
  mapError: $('map-error'), mapTable: $('map-table'), metricDesc: $('c-metric-desc'),
  mapLegend: $('map-legend'), mapLegendNote: $('map-legend-note'),
  mapScaleRange: $('map-scale-range'),
};
const PLOTS = {
  map: $('map-chart'), totals: $('totals-chart'), dist: $('distribution-chart'),
  ranking: $('ranking-chart'), gains: $('gains-chart'), losses: $('losses-chart'),
  scatter: $('scatter-chart'),
};

const baseLayout = () => ({
  paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: '"Segoe UI", system-ui, sans-serif', color: C.text, size: 12 },
  separators: ',.',
  margin: { l: 56, r: 20, t: 16, b: 44 },
  legend: { font: { color: C.text } },
});
const axis = extra => {
  const out = Object.assign({
    gridcolor: C.grid, zerolinecolor: C.muted, zerolinewidth: 1,
    tickfont: { color: C.muted },
  }, extra);
  if (typeof out.title === 'string')
    out.title = { text: out.title, font: { color: C.muted }, standoff: 10 };
  else if (out.title && out.title.text)
    out.title = Object.assign({ font: { color: C.muted }, standoff: 10 }, out.title);
  if (out.title && out.title.text) out.automargin = true;
  return out;
};
const CONFIG = { responsive: true, displaylogo: false, topojsonURL: 'vendor/' };
const MAP_CONFIG = Object.assign({}, CONFIG, { displayModeBar: true, scrollZoom: true });

/* Perfis responsivos de apresentação: só margens/fontes/legendas/ticks, nunca dados */
const profOf = gd => {
  const w = gd.clientWidth || 0;
  return w <= 480 ? 'sm' : w <= 760 ? 'md' : 'lg';
};
const profFont = key => (key === 'sm' ? 10 : key === 'md' ? 11 : 12);
const profLayout = (key, extra) => {
  const l = baseLayout();
  l.font.size = profFont(key);
  return Object.assign(l, extra);
};
const truncLabel = label => {
  const i = label.lastIndexOf('/');
  const name = i > 0 ? label.slice(0, i) : label;
  const uf = i > 0 ? label.slice(i) : '';
  return (name.length > 16 ? `${name.slice(0, 15)}…` : name) + uf;
};
const profilePatch = (name, key, gd) => {
  const patch = { 'font.size': profFont(key) };
  switch (name) {
    case 'totals':
      return Object.assign(patch, {
        margin: key === 'sm' ? { l: 44, r: 12, t: 26, b: 60 } : { l: 56, r: 20, t: 16, b: 44 },
        'legend.y': key === 'sm' ? -0.24 : -0.18,
        'legend.font.size': key === 'sm' ? 10 : 12,
      });
    case 'dist':
      return Object.assign(patch, {
        'legend.y': key === 'sm' ? -0.18 : -0.12,
        'legend.font.size': key === 'sm' ? 10 : 12,
      });
    case 'ranking': {
      Object.assign(patch, {
        margin: key === 'sm' ? { l: 44, r: 56, t: 12, b: 44 } : { l: 54, r: 70, t: 10, b: 44 },
        'yaxis.automargin': true,
      });
      const yv = gd.data && gd.data[0] && gd.data[0].y;
      if (yv && yv.length) {
        patch['yaxis.tickmode'] = 'array';
        patch['yaxis.tickvals'] = yv.slice();
        patch['yaxis.ticktext'] = key === 'sm' ? yv.map(truncLabel) : yv.slice();
      }
      return patch;
    }
    case 'gains':
    case 'losses': {
      Object.assign(patch, {
        margin: key === 'sm' ? { l: 8, r: 48, t: 10, b: 44 } : { l: 10, r: 60, t: 10, b: 44 },
        'yaxis.automargin': true,
      });
      const yv = gd.data && gd.data[0] && gd.data[0].y;
      if (yv && yv.length) {
        patch['yaxis.tickmode'] = 'array';
        patch['yaxis.tickvals'] = yv.slice();
        patch['yaxis.ticktext'] = key === 'sm' ? yv.map(truncLabel) : yv.slice();
      }
      return patch;
    }
    case 'scatter':
      return Object.assign(patch, {
        margin: key === 'sm' ? { l: 44, r: 12, t: 10, b: 46 } : { l: 56, r: 20, t: 16, b: 44 },
        'annotations[0].font.size': key === 'sm' ? 9 : 11,
        'annotations[1].font.size': key === 'sm' ? 9 : 11,
        'annotations[0].x': key === 'sm' ? 4 : 12,
        'annotations[0].y': key === 'sm' ? 94 : 92,
        'annotations[0].xanchor': key === 'sm' ? 'left' : 'center',
        'annotations[1].x': key === 'sm' ? 96 : 88,
        'annotations[1].y': key === 'sm' ? 6 : 8,
        'annotations[1].xanchor': key === 'sm' ? 'right' : 'center',
      });
    case 'map':
      return Object.assign(patch, {
        margin: { l: 0, r: 0, t: 0, b: key === 'sm' ? 55 : 0 },
      });
    default:
      return patch;
  }
};

const hoverRow = m =>
  `${esc(m.name || '')}${m.uf ? `/${esc(m.uf)}` : ''}<br>` +
  `1º turno: ${fmtInt(m.first)} (${fmtShare(m.shareFirst)}) · ` +
  `2º turno: ${fmtInt(m.second)} (${fmtShare(m.shareSecond)})<br>` +
  `Δ: ${fmtMetric(m.delta, 'votos')} · cresc.: ${fmtMetric(m.growth, '%')} · p.p.: ${fmtMetric(m.pp, 'p.p.')}`;

/* ---------- status ---------- */

function showLoading(msg) {
  els.status.hidden = false;
  els.dashboard.hidden = true;
  els.status.innerHTML = `<p class="status-loading">${esc(msg)} <span class="dots"><span>.</span><span>.</span><span>.</span></span></p>`;
}

function showError(title, detail) {
  els.status.hidden = false;
  els.dashboard.hidden = true;
  els.status.innerHTML = `
    <div class="status-error">
      <h2>${esc(title)}</h2>
      <p>${esc(detail)}</p>
      <p>Sirva a pasta do projeto com <code>python -m http.server 8080 --bind 127.0.0.1</code>
        e confira <code>data/elections.json</code> e <code>vendor/plotly-3.3.0.min.js</code>.</p>
      <p><button type="button" class="button button-primary" id="c-retry">Tentar novamente</button></p>
    </div>`;
  $('c-retry').addEventListener('click', init);
}

/* ---------- load ---------- */

/* Malhas/índice municipal: carregados sob demanda por UF, com cache */
const loadMunIndex = () => {
  if (!munIndexPromise) {
    munIndexPromise = fetch(MUN_INDEX_URL, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} em ${MUN_INDEX_URL}`);
        return r.json();
      })
      .then(data => ({ data, error: null }))
      .catch(error => ({ data: null, error }));
  }
  return munIndexPromise;
};

const loadMunGeo = uf => {
  let promise = munGeoPromises.get(uf);
  if (!promise) {
    const url = munGeoUrl(uf);
    promise = fetch(url, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
        return r.json();
      })
      // normalize a cópia para o Plotly; o arquivo-fonte permanece intacto
      .then(raw => ({ data: geoApi.geometryForPlotly(raw), error: null }))
      .catch(error => ({ data: null, error }));
    munGeoPromises.set(uf, promise);
  }
  return promise;
};

async function init() {
  delete document.body.dataset.ready;
  showLoading('Carregando gráficos');
  munIndexPromise = null;
  munGeoPromises.clear();
  municipal = null;
  if (typeof Plotly === 'undefined') {
    showError('Biblioteca de gráficos indisponível',
      'vendor/plotly-3.3.0.min.js não foi carregado.');
    return;
  }
  try {
    modelApi = modelApi || await import('./charts-model.js');
    geoApi = geoApi || await import('./map-geometry.js');
    mapStyleApi = mapStyleApi || await import('./map-style.js');
  } catch (error) {
    showError('Modelo de dados indisponível', `charts-model.js/map-geometry.js/map-style.js: ${error.message || error}`);
    return;
  }
  try {
    const dataRes = await fetch(DATA_URL, { cache: 'no-store' });
    if (!dataRes.ok) throw new Error(`HTTP ${dataRes.status} em ${DATA_URL}`);
    dataset = await dataRes.json();
  } catch (error) {
    showError('Não foi possível carregar a base local', error.message || String(error));
    return;
  }
  try {
    const geoRes = await fetch(GEO_URL, { cache: 'no-store' });
    if (!geoRes.ok) throw new Error(`HTTP ${geoRes.status} em ${GEO_URL}`);
    geojson = geoApi.geometryForPlotly(await geoRes.json());
    geoError = null;
  } catch (error) {
    geojson = null;
    geoError = error;
  }
  setup();
}

function setup() {
  state.candidateId = dataset.candidates[0].id;
  state.uf = 'all';
  state.metric = 'delta';
  renderTabs();
  els.uf.innerHTML = '<option value="all">Brasil (todas as UFs)</option>' +
    dataset.metadata.states.map(s =>
      `<option value="${esc(s.uf)}">${esc(s.uf)} — ${esc(s.name)} (${fmtInt(s.paired)}/${fmtInt(s.expected)})</option>`).join('');
  els.uf.value = 'all';
  els.metric.value = 'delta';
  els.status.hidden = true;
  els.dashboard.hidden = false;
  scheduleRender().then(() => {
    if (lastError) return;
    document.body.dataset.ready = 'true';
    document.dispatchEvent(new CustomEvent('charts-loaded'));
  });
}

/* ---------- controls ---------- */

function renderTabs() {
  els.tabs.innerHTML = dataset.candidates.map(c => `
    <button type="button" class="tab tab-${esc(c.id)}" data-id="${esc(c.id)}"
      aria-pressed="${c.id === state.candidateId}">
      <span class="dot dot-${esc(c.id)}" aria-hidden="true"></span>
      ${esc(c.name)} <span class="party">${esc(c.party)}</span>
    </button>`).join('');
}

els.tabs.addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn || btn.dataset.id === state.candidateId) return;
  state.candidateId = btn.dataset.id;
  renderTabs();
  scheduleRender();
});
els.uf.addEventListener('change', () => { state.uf = els.uf.value; scheduleRender(); });
els.metric.addEventListener('change', () => { state.metric = els.metric.value; scheduleRender(); });
els.reset.addEventListener('click', () => {
  state.uf = 'all';
  state.metric = 'delta';
  els.uf.value = 'all';
  els.metric.value = 'delta';
  scheduleRender();
});
if (els.mapBack) els.mapBack.addEventListener('click', () => {
  state.uf = 'all';
  els.uf.value = 'all';
  scheduleRender();
});

/* ---------- model + render (serializado: última revisão sempre vence) ---------- */

function scheduleRender() {
  renderQueue = renderQueue.then(renderAll).catch(err => {
    lastError = err;
    console.error(err);
    showError('Falha ao renderizar gráficos', err.message || String(err));
  });
  return renderQueue;
}

const staleCtx = ctx =>
  ctx.uf !== state.uf || ctx.candidateId !== state.candidateId || ctx.metric !== state.metric;

let renderBusy = false;

async function renderAll() {
  renderBusy = true;
  const ctx = { uf: state.uf, candidateId: state.candidateId, metric: state.metric };
  try {
    await renderAllBody(ctx);
  } finally {
    renderBusy = false;
  }
}

async function renderAllBody(ctx) {
  model = modelApi.buildDashboard(dataset, state);
  renderText();
  renderKpis();
  renderInsights();
  await Promise.all([
    renderTotals(), renderDistribution(),
    renderGainLoss('gains'), renderGainLoss('losses'), renderScatter(),
  ]);
  // Ativos municipais: só quando uma UF está selecionada; nunca bloqueiam os demais gráficos
  let mun = null;
  municipal = null;
  if (ctx.uf !== 'all') {
    setMapLoading(true);
    try {
      munModelApi = munModelApi || await import('./municipal-model.js');
      const [idx, geo] = await Promise.all([loadMunIndex(), loadMunGeo(ctx.uf)]);
      if (staleCtx(ctx)) { setMapLoading(false); return; }
      const mm = munModelApi.buildMunicipalMap(dataset, idx.data, geo.data,
        { uf: ctx.uf, candidateId: ctx.candidateId, metric: ctx.metric });
      mun = { model: mm, geo: geo.data, geoError: geo.error, indexError: idx.error };
    } catch (error) {
      if (staleCtx(ctx)) { setMapLoading(false); return; }
      mun = { error };
    }
    municipal = mun && mun.model ? mun.model : null;
  }
  await renderRanking(municipal);
  try {
    await renderMap(ctx, mun);
  } catch (error) {
    if (ctx.uf === 'all') { geoError = error; renderMapFallback(); }
    else renderMunicipalFallback(mun, error);
  }
  setMapLoading(false);
  lastError = null;
}

const RANKING_SUB_NATIONAL = 'Brasil: 27 UFs ordenadas pela métrica selecionada. Selecione uma UF para abrir o ranking de seus municípios.';

function renderText() {
  els.mapMetric.textContent = model.metric.label;
  els.mapTitle.textContent = 'Mapa do Brasil';
  els.rankingMetric.textContent = model.metric.label;
  els.rankingTitle.textContent = 'Ranking estadual';
  els.rankingSub.textContent = RANKING_SUB_NATIONAL;
  els.mapSubtitle.textContent =
    `Variação de ${model.candidate.name} entre os turnos. ` +
    'A cor mostra alta ou queda, não o vencedor da UF. Clique em um estado para filtrar o recorte.';
  els.scopeNote.textContent = model.scopeNote;
  if (els.metricDesc) els.metricDesc.textContent = model.metric.description;
}

function renderInsights() {
  els.insights.replaceChildren(...model.insights.map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

function renderKpis() {
  for (const t of model.totals) {
    const m = t.metrics;
    const card = $(`kpi-${t.candidate.id}`);
    if (!card) continue;
    card.innerHTML = `
      <h3><span class="dot dot-${esc(t.candidate.id)}" aria-hidden="true"></span>${esc(t.candidate.name)}</h3>
      <p class="kpi-party">${esc(t.candidate.party)} · ${esc(model.selectedUfName)}</p>
      <p class="kpi-delta">${sign(m.delta)}${intFmt.format(Math.abs(m.delta))}</p>
      <p class="kpi-trends">Δ total · crescimento ${fmtMetric(m.growth, '%')} · p.p. ${fmtMetric(m.pp, 'p.p.')}</p>
      <dl>
        <div><dt>1º turno</dt><dd>${fmtInt(m.first)}</dd></div>
        <div><dt>2º turno</dt><dd>${fmtInt(m.second)}</dd></div>
      </dl>
      <p class="kpi-trends">alta ${fmtInt(m.gaining)} · queda ${fmtInt(m.losing)} · estável ${fmtInt(m.stable)}</p>`;
  }
  const cov = model.coverage;
  $('kpi-coverage').innerHTML = `
    <h3>Cobertura</h3>
    <p class="kpi-party">Municípios no recorte</p>
    <p class="kpi-delta">${fmtInt(model.cityCount)}</p>
    <p class="kpi-trends">${model.partialCount ? `apuração parcial em ${fmtInt(model.partialCount)} · ` : ''}base ${fmtInt(cov.paired)}/${fmtInt(cov.expected)} pareados</p>
    <dl>
      <div><dt>Excluídos</dt><dd>${fmtInt(cov.excluded)}</dd></div>
      <div><dt>Erros</dt><dd>${fmtInt(cov.errors)}</dd></div>
    </dl>`;
}

/* ---------- Plotly ---------- */

const mapTraces = (m, geometry = geojson, key = profOf(PLOTS.map)) => {
  const rows = m.rows || m.states;
  const isMunicipal = m.scope === 'municipal';
  const borderW = isMunicipal ? 0.45 : 0.8;
  const hoverFor = r => r.hasData === false
    ? `${esc(r.name)}${r.ibge ? ` · IBGE ${esc(r.ibge)}` : ''}<br>Sem resultado municipal pareado`
    : `${hoverRow({ ...r.metrics, name: r.name, uf: r.uf })}` +
      (isMunicipal ? `<br>TSE ${esc(r.code || '—')} · IBGE ${esc(r.ibge || '—')}` : '') +
      `<br>${m.metric.label}: ${fmtMetric(r.value, m.metric.unit)}`;
  const customFor = r => isMunicipal
    ? { kind: 'municipal', uf: r.uf, code: r.code, ibge: r.ibge }
    : { uf: r.uf };
  const byDir = k => rows.filter(r => mapStyleApi.mapDirection(r.value) === k);
  const ramp = rows.filter(r => {
    const d = mapStyleApi.mapDirection(r.value);
    return d === 'gain' || d === 'loss';
  });
  const overlay = (overlayRows, color) => ({
    type: 'choropleth', geojson: geometry, featureidkey: 'properties.codarea',
    locations: overlayRows.map(r => r.ibge),
    // z fixo é apenas um sentinel de renderização; o hover mostra o valor real
    z: overlayRows.map(() => 0), zmin: 0, zmax: 1, zauto: false,
    colorscale: [[0, color], [1, color]], showscale: false,
    marker: { line: { color: MAP_BORDER, width: borderW } },
    text: overlayRows.map(hoverFor), hovertemplate: '%{text}<extra></extra>',
    customdata: overlayRows.map(customFor),
  });
  const scale = mapStyleApi.buildMapScale(rows, 'sqrt');
  const traces = [{
    type: 'choropleth', geojson: geometry, featureidkey: 'properties.codarea',
    locations: ramp.map(r => r.ibge), z: ramp.map(r => r.value),
    zmin: scale.min, zmax: scale.max, zauto: false,
    showscale: scale.hasVariation,
    colorscale: scale.colorscale,
    marker: { line: { color: MAP_BORDER, width: borderW } },
    colorbar: key === 'sm' ? {
      orientation: 'h', x: 0.5, xanchor: 'center', y: -0.1, len: 0.9, thickness: 12,
      title: { text: m.metric.unit, font: { color: C.muted } },
      tickfont: { color: C.muted }, outlinewidth: 0,
    } : {
      title: { text: m.metric.unit, font: { color: C.muted } },
      tickfont: { color: C.muted }, outlinewidth: 0, thickness: 14,
    },
    text: ramp.map(hoverFor),
    hovertemplate: '%{text}<extra></extra>',
    customdata: ramp.map(customFor),
  }];
  const zeroRows = byDir('zero'), missRows = byDir('missing');
  if (zeroRows.length) traces.push(overlay(zeroRows, mapStyleApi.MAP_COLORS.zero));
  if (missRows.length) traces.push(overlay(missRows, mapStyleApi.MAP_COLORS.missing));
  const sel = rows.find(r => r.selected);
  if (sel) {
    traces.push({
      type: 'choropleth', geojson: geometry, featureidkey: 'properties.codarea',
      locations: [sel.ibge], z: [sel.value === null ? 0 : sel.value],
      colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']], showscale: false,
      marker: { line: { color: C.accent, width: 2.5 } },
      hoverinfo: 'skip', customdata: [{ uf: sel.uf }],
    });
  }
  return traces;
};

function renderMapLegend(legend) {
  els.mapLegend.hidden = false;
  els.mapLegendNote.hidden = false;
  if (els.mapScaleRange) els.mapScaleRange.hidden = false;
  els.mapLegend.innerHTML = legend.entries.map(e => `
    <li><span class="swatch" aria-hidden="true" style="background:${e.key === 'gain' || e.key === 'loss'
      ? `linear-gradient(90deg, ${e.color}, ${e.strongColor})` : e.color}"></span>${esc(e.label)} · ${fmtInt(e.count)} ${esc(legend.areaLabel || 'UFs')}</li>`).join('');
  els.mapLegendNote.textContent = legend.note;
  if (els.mapScaleRange) els.mapScaleRange.textContent = legend.rangeNote || '';
}

function setMapLoading(on) {
  if (!els.mapLoading) return;
  const gd = PLOTS.map;
  els.mapLoading.hidden = !on;
  gd.setAttribute('aria-busy', on ? 'true' : 'false');
  gd._busy = on;
  if (!on) return;
  // reserva a tela: esconde só a imagem velha, sem colapsar nem medir em zero
  gd.parentElement.style.display = '';
  gd.style.visibility = 'hidden';
  els.mapTable.hidden = true;
  els.mapError.hidden = true;
  els.mapLegend.hidden = true;
  els.mapLegendNote.hidden = true;
  els.mapCoverage.hidden = true;
  if (els.mapScaleRange) els.mapScaleRange.hidden = true;
}

function attachMapClick(gd) {
  if (gd._samuClick) return;
  gd._samuClick = true;
  gd.on('plotly_click', ev => {
    const d = ev.points && ev.points[0] && ev.points[0].customdata;
    if (!d || !d.uf || d.kind === 'municipal' || d.uf === state.uf) return;
    state.uf = d.uf;
    els.uf.value = d.uf;
    scheduleRender();
  });
}

const geoRanges = geo => {
  let w = 180, s = 90, e = -180, n = -90;
  const visit = a => {
    if (typeof a[0] === 'number') {
      if (a[0] < w) w = a[0]; if (a[0] > e) e = a[0];
      if (a[1] < s) s = a[1]; if (a[1] > n) n = a[1];
    } else a.forEach(visit);
  };
  (geo.features || []).forEach(f => f.geometry && visit(f.geometry.coordinates));
  const px = (e - w) * 0.03 || 0.01, py = (n - s) * 0.03 || 0.01;
  return { lon: [w - px, e + px], lat: [s - py, n + py] };
};

const MAP_LAYOUT = (key, uf, geo) => {
  const r = geo ? geoRanges(geo) : null;
  return Object.assign(baseLayout(), {
    margin: { l: 0, r: 0, t: 0, b: key === 'sm' ? 55 : 0 },
    geo: {
      // fitbounds do Plotly ajusta a malha dentro da caixa do mundo renderizada
      // (projeção recortada), subdimensionando áreas quadradas; o intervalo
      // explícito dos eixos faz o fitExtent enquadrar a própria malha.
      fitbounds: false,
      lonaxis: r ? { range: r.lon } : {}, lataxis: r ? { range: r.lat } : {},
      projection: { type: 'natural earth' },
      showcoastlines: false, showcountries: false, showframe: false,
      showland: false, showlakes: false, bgcolor: 'rgba(0,0,0,0)',
      // uirevision por UF: troca de UF refaz o fit; mesmo UF preserva zoom/pan
      uirevision: `samu-map-${uf}`,
    },
  });
};

async function drawMap(gd, traces, layout) {
  gd._busy = true;
  gd.setAttribute('aria-busy', 'true');
  try {
    await Plotly.react(gd, traces, layout, MAP_CONFIG);
  } finally {
    gd._busy = false;
    gd.setAttribute('aria-busy', 'false');
    gd.style.visibility = 'visible';
  }
  const fl = gd._fullLayout;
  if (fl && (Math.abs(fl.width - gd.clientWidth) > 1 ||
             Math.abs(fl.height - gd.clientHeight) > 1)) {
    try { await Plotly.Plots.resize(gd); }
    catch (err) { console.warn('map resize pós-exibição', err); }
  }
  attachMapClick(gd);
}

async function renderMap(ctx, mun) {
  const gd = PLOTS.map;
  els.mapToolbar.hidden = ctx.uf === 'all';
  els.mapCoverage.hidden = true;
  els.mapCoverage.classList.remove('warning');
  if (ctx.uf === 'all') {
    if (geoError) return renderMapFallback();
    // restaura área mensurável ANTES de medir; nunca medir display:none
    gd.parentElement.style.display = '';
    gd.style.visibility = 'hidden';
    gd.getBoundingClientRect();
    const key = gd._profKey = profOf(gd);
    els.mapTable.hidden = true;
    els.mapError.hidden = true;
    renderMapLegend(mapStyleApi.buildMapLegend(model.states, 'sqrt', model.metric.unit, 'national'));
    await drawMap(gd, mapTraces(model, geojson, key), MAP_LAYOUT(key, ctx.uf, geojson));
    return;
  }
  const mm = mun && mun.model;
  if (mm) {
    els.mapTitle.textContent = `Mapa municipal de ${mm.name} (${mm.uf})`;
    els.mapSubtitle.textContent =
      `Variação de ${mm.candidate.name} entre os turnos. ` +
      'A cor mostra alta ou queda, não o vencedor do município.';
    els.mapCoverage.hidden = false;
    els.mapCoverage.textContent = mm.note;
    els.mapCoverage.classList.toggle('warning',
      mm.coverage.citiesWithoutGeometry.length > 0);
  } else {
    els.mapTitle.textContent = `Mapa municipal — ${ctx.uf}`;
    els.mapSubtitle.textContent =
      `Variação de ${model.candidate.name} entre os turnos. ` +
      'A cor mostra alta ou queda, não o vencedor do município.';
  }
  if (!mm || !mm.coverage.mapAvailable) {
    return renderMunicipalFallback(mun, mun && (mun.error || mun.geoError || mun.indexError));
  }
  gd.parentElement.style.display = '';
  gd.style.visibility = 'hidden';
  gd.getBoundingClientRect();
  const key = gd._profKey = profOf(gd);
  els.mapTable.hidden = true;
  els.mapError.hidden = true;
  renderMapLegend(mapStyleApi.buildMapLegend(mm.rows, 'sqrt', mm.metric.unit, 'municipal'));
  await drawMap(gd, mapTraces(mm, mun.geo, key), MAP_LAYOUT(key, ctx.uf, mun.geo));
}

function renderMunicipalFallback(mun, error) {
  const mm = mun && mun.model;
  const uf = (mm && mm.uf) || state.uf;
  els.mapError.hidden = false;
  els.mapError.textContent = `Mapa municipal indisponível (${error ? error.message : 'malha ou índice ausentes'}); ` +
    'substituído pela tabela de municípios. ' +
    `Verifique ${munGeoUrl(uf)} e ${MUN_INDEX_URL}. Os demais gráficos continuam funcionando.`;
  PLOTS.map.parentElement.style.display = 'none';
  PLOTS.map.style.visibility = '';
  PLOTS.map.setAttribute('aria-busy', 'false');
  els.mapTable.hidden = false;
  els.mapLegend.hidden = true;
  els.mapLegendNote.hidden = true;
  if (els.mapScaleRange) els.mapScaleRange.hidden = true;
  if (!mm) { els.mapTable.innerHTML = ''; return; }
  els.mapTable.innerHTML = `<table><thead><tr>
      <th>Município</th><th>Código TSE</th><th class="num">${esc(mm.metric.label)}</th></tr></thead><tbody>` +
    mm.rows.filter(r => r.hasData).map(r => `<tr>
      <td>${esc(r.name)}</td><td>${esc(r.code || '—')}</td>
      <td class="num">${esc(fmtMetric(r.value, mm.metric.unit))}</td>
    </tr>`).join('') + '</tbody></table>';
}

function renderMapFallback() {
  els.mapError.hidden = false;
  els.mapError.textContent = `Geometria indisponível (${geoError.message}); mapa substituído pela tabela de UFs. ` +
    'Verifique data/brazil-ufs.geojson. Os demais gráficos continuam funcionando.';
  PLOTS.map.parentElement.style.display = 'none';
  PLOTS.map.style.visibility = '';
  PLOTS.map.setAttribute('aria-busy', 'false');
  els.mapTable.hidden = false;
  els.mapLegend.hidden = true;
  els.mapLegendNote.hidden = true;
  els.mapToolbar.hidden = true;
  els.mapCoverage.hidden = true;
  if (els.mapScaleRange) els.mapScaleRange.hidden = true;
  const unit = model.metric.unit;
  els.mapTable.innerHTML = `<table><thead><tr>
      <th>UF</th><th>Estado</th><th class="num">${esc(model.metric.label)}</th><th></th></tr></thead><tbody>` +
    model.stateRanking.map(r => `<tr${r.selected ? ' class="delta-pos"' : ''}>
      <td>${esc(r.uf)}</td><td>${esc(r.name)}</td>
      <td class="num">${esc(fmtMetric(r.value, unit))}</td>
      <td><button type="button" class="uf-button" data-uf="${esc(r.uf)}">Filtrar</button></td>
    </tr>`).join('') + '</tbody></table>';
  els.mapTable.querySelectorAll('.uf-button').forEach(btn =>
    btn.addEventListener('click', () => {
      state.uf = btn.dataset.uf;
      els.uf.value = state.uf;
      scheduleRender();
    }));
}

async function renderTotals() {
  const gd = PLOTS.totals;
  const key = gd._profKey = profOf(gd);
  const traces = model.totals.map(t => ({
    type: 'bar', name: `${t.candidate.name} (${t.candidate.party})`,
    x: ['1º turno', '2º turno'], y: [t.metrics.first, t.metrics.second],
    marker: { color: CAND_COLOR[t.candidate.id] || C.muted },
    text: [t.metrics.first, t.metrics.second].map(fmtInt), textposition: 'outside',
    cliponaxis: false,
    hovertemplate: '%{x}: %{y:,.0f} votos<extra>%{fullData.name}</extra>',
  }));
  await Plotly.react(gd, traces, profLayout(key, {
    barmode: 'group', yaxis: axis({ title: 'Votos' }), xaxis: axis({ gridcolor: 'rgba(0,0,0,0)' }),
    showlegend: true,
    legend: { orientation: 'h', y: key === 'sm' ? -0.24 : -0.18, font: { color: C.text, size: key === 'sm' ? 10 : 12 } },
    margin: key === 'sm' ? { l: 44, r: 12, t: 26, b: 60 } : { l: 56, r: 20, t: 16, b: 44 },
  }), CONFIG);
}

async function renderRanking(mm) {
  const gd = PLOTS.ranking;
  const key = gd._profKey = profOf(gd);
  const isMunicipal = Boolean(mm && mm.scope === 'municipal');
  const src = isMunicipal ? mm : model;
  const rows = isMunicipal ? mm.ranking : model.stateRanking;
  const labelFor = r => isMunicipal
    ? `${r.name} (${r.code || r.ibge || '—'})`
    : r.uf;
  const yFull = rows.map(labelFor);
  if (isMunicipal) {
    els.rankingTitle.textContent = 'Ranking municipal';
    els.rankingSub.textContent =
      `Até ${mm.rankingLimit} municípios da UF, ordenados pela métrica selecionada · ` +
      `${fmtInt(mm.rankingCount)} unidades eleitorais na UF.`;
  }
  await Plotly.react(gd, [{
    type: 'bar', orientation: 'h',
    y: yFull, x: rows.map(r => r.value),
    marker: {
      color: rows.map(r => (r.value === null || r.value === 0) ? C.slate : r.value > 0 ? C.teal : C.orange),
      line: { color: rows.map(r => r.selected ? C.accent : 'rgba(0,0,0,0)'), width: 2.5 },
    },
    text: rows.map(r => r.value === null ? '—' : fmtMetric(r.value, src.metric.unit)),
    textposition: 'auto', cliponaxis: false,
    hovertext: rows.map(r => `${esc(r.name)} (${esc(isMunicipal ? (r.code || '—') : r.uf)})<br>` +
      `${src.metric.label}: ${fmtMetric(r.value, src.metric.unit)}`),
    hovertemplate: '%{hovertext}<extra></extra>',
  }], profLayout(key, {
    margin: key === 'sm' ? { l: 44, r: 56, t: 12, b: 44 } : { l: 54, r: 70, t: 10, b: 44 },
    xaxis: axis({ title: `${src.metric.label} (${src.metric.unit})`, zeroline: true }),
    yaxis: axis(key === 'sm'
      ? { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', automargin: true, tickmode: 'array', tickvals: yFull, ticktext: yFull.map(truncLabel) }
      : { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', automargin: true }),
    annotations: rows.some(r => r.value === null) ? [{
      x: 0.5, y: 1.06, xref: 'paper', yref: 'paper', showarrow: false, align: 'left',
      text: `Sem valor definido: ${rows.filter(r => r.value === null).map(labelFor).join(', ')}`,
      font: { color: C.muted, size: 11 },
    }] : [],
  }), CONFIG);
}

async function renderGainLoss(kind) {
  const el = PLOTS[kind];
  const rows = model[kind];
  if (!rows.length) {
    Plotly.purge(el);
    el.innerHTML = `<p class="empty-note">${kind === 'losses'
      ? 'Nenhum município do recorte perdeu votos para o candidato selecionado.'
      : 'Nenhum município do recorte ganhou votos para o candidato selecionado.'}</p>`;
    return;
  }
  if (!el.data) el.textContent = '';
  const key = el._profKey = profOf(el);
  const yFull = rows.map(r => `${esc(r.name)}/${esc(r.uf)}`);
  const color = kind === 'gains' ? C.teal : C.orange;
  await Plotly.react(el, [{
    type: 'bar', orientation: 'h',
    y: yFull, x: rows.map(r => r.delta),
    marker: { color },
    text: rows.map(r => `${sign(r.delta)}${fmtInt(Math.abs(r.delta))}`),
    textposition: 'auto', cliponaxis: false,
    hovertext: rows.map(hoverRow),
    hovertemplate: '%{hovertext}<extra></extra>',
  }], profLayout(key, {
    margin: key === 'sm' ? { l: 8, r: 48, t: 10, b: 44 } : { l: 10, r: 60, t: 10, b: 44 },
    xaxis: axis({ title: 'Variação de votos', zeroline: true }),
    yaxis: axis(key === 'sm'
      ? { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', automargin: true, tickmode: 'array', tickvals: yFull, ticktext: yFull.map(truncLabel) }
      : { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', automargin: true }),
  }), CONFIG);
}

async function renderScatter() {
  const gd = PLOTS.scatter;
  const key = gd._profKey = profOf(gd);
  const pts = model.scatter;
  await Plotly.react(gd, [{
    type: 'scattergl', mode: 'markers',
    x: pts.map(p => p.x), y: pts.map(p => p.y),
    marker: { size: 6, opacity: 0.7, color: pts.map(p => DIR_COLOR[p.direction]) },
    text: pts.map(hoverRow), hovertemplate: '%{text}<extra></extra>',
  }], profLayout(key, {
    margin: key === 'sm' ? { l: 44, r: 12, t: 10, b: 46 } : { l: 56, r: 20, t: 16, b: 44 },
    xaxis: axis({ title: 'Participação no 1º turno (%)', range: [0, 100] }),
    yaxis: axis({ title: 'Participação no 2º turno (%)', range: [0, 100] }),
    shapes: [{
      type: 'line', x0: 0, y0: 0, x1: 100, y1: 100,
      line: { color: C.muted, width: 1, dash: 'dash' },
    }],
    annotations: key === 'sm' ? [
      { x: 4, y: 94, xref: 'x', yref: 'y', xanchor: 'left', showarrow: false, text: 'acima: ganho de participação', font: { color: C.teal, size: 9 } },
      { x: 96, y: 6, xref: 'x', yref: 'y', xanchor: 'right', showarrow: false, text: 'abaixo: perda de participação', font: { color: C.orange, size: 9 } },
    ] : [
      { x: 12, y: 92, xref: 'x', yref: 'y', showarrow: false, text: 'acima: ganho de participação', font: { color: C.teal, size: 11 } },
      { x: 88, y: 8, xref: 'x', yref: 'y', showarrow: false, text: 'abaixo: perda de participação', font: { color: C.orange, size: 11 } },
    ],
  }), CONFIG);
}

async function renderDistribution() {
  const gd = PLOTS.dist;
  const key = gd._profKey = profOf(gd);
  const d = model.distribution;
  await Plotly.react(gd, [{
    type: 'pie', hole: 0.55,
    labels: d.map(x => `${x.label} (${fmtInt(x.value)})`), values: d.map(x => x.value),
    marker: {
      colors: d.map(x => DIR_COLOR[x.key]),
      line: { color: '#1e293b', width: 2 },
    },
    textinfo: 'none',
    hovertemplate: '%{label}<br>%{percent} do recorte<extra></extra>',
    sort: false,
  }], profLayout(key, {
    showlegend: true,
    legend: { orientation: 'h', y: key === 'sm' ? -0.18 : -0.12, font: { color: C.text, size: key === 'sm' ? 10 : 12 } },
    annotations: [{
      text: `${fmtInt(model.cityCount)}<br>municípios`, showarrow: false,
      font: { color: C.text, size: 14 },
    }],
  }), CONFIG);
}

/* Redimensionamento consolidado: um scheduler debounced que enfileira na MESMA
   renderQueue do app — resize e Plotly.react nunca se sobrepõem. Mede na execução
   e nunca toca em plot oculto/ocupado. flushPlotResize nunca aguarda a fila,
   então não há deadlock; whenIdle inclui os resizes enfileirados. */
let resizeTimer = null;

function schedulePlotResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderQueue = renderQueue.then(flushPlotResize).catch(err =>
      console.warn('plot resize job failed', err));
  }, 150);
}

async function flushPlotResize() {
  if (renderBusy) { schedulePlotResize(); return; }
  for (const [name, gd] of Object.entries(PLOTS)) {
    if (!gd || !gd.data || !gd.isConnected || gd._busy) continue;
    if (gd.style.visibility === 'hidden') continue;
    if (!gd.clientWidth || !gd.clientHeight) continue;
    const key = profOf(gd);
    try {
      await Plotly.Plots.resize(gd);
      if (gd._profKey === key) continue;
      gd._profKey = key;
      await Plotly.relayout(gd, profilePatch(name, key, gd));
      if (name === 'map' && gd.data && gd.data[0]) {
        await Plotly.restyle(gd, key === 'sm' ? {
          'colorbar.orientation': 'h', 'colorbar.x': 0.5, 'colorbar.xanchor': 'center',
          'colorbar.y': -0.1, 'colorbar.len': 0.9, 'colorbar.thickness': 12,
        } : {
          'colorbar.orientation': 'v', 'colorbar.x': undefined, 'colorbar.xanchor': undefined,
          'colorbar.y': undefined, 'colorbar.len': undefined, 'colorbar.thickness': 14,
        }, [0]);
      }
    } catch (err) {
      console.warn(`resize ${name}`, err);
    }
  }
}

window.addEventListener('resize', schedulePlotResize);

if (typeof ResizeObserver === 'function') {
  const plotObserver = new ResizeObserver(schedulePlotResize);
  Object.values(PLOTS).forEach(gd => plotObserver.observe(gd));
}

window.samuCharts = {
  get model() { return model; },
  get municipal() { return municipal; },
  get state() { return state; },
  get lastError() { return lastError; },
  reload: init,
  whenIdle: () => renderQueue,
  mapTraces: (m, geometry) => mapTraces(m, geometry),
};

if (typeof document !== 'undefined') init();
