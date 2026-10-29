import { compare, summarize, selectCities } from './analysis.js';

// IBGE two-digit state identifiers, joined to TSE data by UF, never by name.
export const IBGE_BY_UF = Object.freeze({
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35',
  PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
});

export const METRICS = Object.freeze({
  delta: {
    label: 'Varia\u00e7\u00e3o em votos', unit: 'votos',
    description: 'Votos no 2\u00ba turno menos votos no 1\u00ba turno. Valores negativos indicam perda de votos.',
  },
  growth: {
    label: 'Crescimento percentual', unit: '%',
    description: 'Varia\u00e7\u00e3o dividida pelos votos do candidato no 1\u00ba turno, vezes 100. Base zero n\u00e3o tem percentual definido.',
  },
  pp: {
    label: 'Mudan\u00e7a de participa\u00e7\u00e3o', unit: 'p.p.',
    description: 'Participa\u00e7\u00e3o nos votos v\u00e1lidos do 2\u00ba turno menos a do 1\u00ba, em pontos percentuais.',
  },
});

const number = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const signed = value => `${value > 0 ? '+' : ''}${decimal.format(value)}`;
const metricValue = (value, metric) => value === null
  ? 'n\u00e3o definido'
  : `${metric === 'delta' ? number.format(value) : signed(value)} ${METRICS[metric].unit}`;
const tieBreak = (a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.uf.localeCompare(b.uf);

function rankStates(rows) {
  return [...rows].sort((a, b) => {
    if (a.value === null && b.value !== null) return 1;
    if (b.value === null && a.value !== null) return -1;
    return (b.value ?? 0) - (a.value ?? 0) || a.uf.localeCompare(b.uf);
  });
}

function narrative(model) {
  const { candidate, summary, cityCount, selectedUfName, gains, losses } = model;
  if (cityCount === 0) return ['Nenhum munic\u00edpio pareado dispon\u00edvel para este recorte.'];
  const lines = [
    `${candidate.name} passou de ${number.format(summary.first)} para ${number.format(summary.second)} votos em ${selectedUfName}: varia\u00e7\u00e3o de ${metricValue(summary.delta, 'delta')} e crescimento ${metricValue(summary.growth, 'growth')}.`,
    `${number.format(summary.gaining)} munic\u00edpios ganharam votos, ${number.format(summary.losing)} perderam e ${number.format(summary.stable)} ficaram est\u00e1veis para ${candidate.name}. Essa contagem n\u00e3o mede participa\u00e7\u00e3o percentual.`,
    `A mudan\u00e7a de participa\u00e7\u00e3o agregada foi de ${metricValue(summary.pp, 'pp')}. O denominador inclui todos os votos v\u00e1lidos de cada turno; n\u00e3o \u00e9 a m\u00e9dia dos percentuais municipais.`,
  ];
  if (gains.length) {
    const top = gains[0];
    lines.push(`Maior ganho em quantidade no recorte: ${top.name}/${top.uf}, com ${metricValue(top.delta, 'delta')}.`);
  }
  if (losses.length) {
    const top = losses[0];
    lines.push(`Maior perda em quantidade no recorte: ${top.name}/${top.uf}, com ${metricValue(top.delta, 'delta')}.`);
  } else {
    lines.push('Nenhum munic\u00edpio do recorte perdeu votos para o candidato selecionado.');
  }
  if (model.partialCount) {
    lines.push(`Aten\u00e7\u00e3o: ${number.format(model.partialCount)} munic\u00edpios do recorte t\u00eam apura\u00e7\u00e3o n\u00e3o finalizada em algum turno.`);
  }
  if (model.coverage.excluded) {
    lines.push(`A base exclui ${number.format(model.coverage.excluded)} unidades sem pareamento v\u00e1lido; os totais mostram somente a cobertura dispon\u00edvel.`);
  }
  return lines;
}

export function buildDashboard(dataset, { candidateId = '13', uf = 'all', metric = 'delta' } = {}) {
  const candidate = dataset.candidates.find(entry => entry.id === candidateId);
  if (!candidate) throw new Error('Candidato desconhecido.');
  if (!Object.hasOwn(METRICS, metric)) throw new Error('M\u00e9trica desconhecida.');
  if (uf !== 'all' && !dataset.metadata.states.some(entry => entry.uf === uf)) {
    throw new Error('UF desconhecida.');
  }
  const otherCandidate = dataset.candidates.find(entry => entry.id !== candidateId);
  const cities = selectCities(dataset.cities, { uf, candidateId });
  const summary = summarize(cities, candidateId);
  const rows = cities.map(city => ({
    uf: city.uf, code: city.code, name: city.name, ...compare(city, candidateId),
  }));
  const states = dataset.metadata.states.map(state => {
    const stateCities = selectCities(dataset.cities, { uf: state.uf, candidateId });
    const metrics = summarize(stateCities, candidateId);
    if (!IBGE_BY_UF[state.uf]) throw new Error(`UF sem correspond\u00eancia IBGE: ${state.uf}`);
    return {
      uf: state.uf, name: state.name, ibge: IBGE_BY_UF[state.uf], metrics,
      value: stateCities.length ? metrics[metric] : null,
      selected: uf === state.uf, partialCount: metrics.partial,
    };
  });
  const maxAbs = Math.max(1, ...states.map(row => row.value === null ? 0 : Math.abs(row.value)));
  const gains = rows.filter(row => row.delta > 0)
    .sort((a, b) => b.delta - a.delta || tieBreak(a, b)).slice(0, 10);
  const losses = rows.filter(row => row.delta < 0)
    .sort((a, b) => a.delta - b.delta || tieBreak(a, b)).slice(0, 10);
  const scatter = rows.filter(row => row.shareFirst !== null && row.shareSecond !== null)
    .map(row => ({
      ...row, x: row.shareFirst, y: row.shareSecond,
      direction: row.pp > 0 ? 'gain' : row.pp < 0 ? 'loss' : 'stable',
    }));
  const model = {
    candidate, otherCandidate, uf, metric: METRICS[metric],
    selectedUfName: uf === 'all' ? 'Brasil (sem exterior)'
      : dataset.metadata.states.find(entry => entry.uf === uf).name,
    cityCount: cities.length, partialCount: summary.partial,
    coverage: dataset.metadata.coverage, summary,
    totals: dataset.candidates.map(entry => ({
      candidate: entry, metrics: summarize(cities, entry.id),
    })),
    states, stateRanking: rankStates(states),
    mapRange: { min: -maxAbs, max: maxAbs },
    gains, losses, scatter,
    distribution: [
      { label: 'Ganhou votos', value: summary.gaining, key: 'gain' },
      { label: 'Perdeu votos', value: summary.losing, key: 'loss' },
      { label: 'Est\u00e1vel em votos', value: summary.stable, key: 'stable' },
    ],
    scopeNote: 'Filtros desta aba s\u00e3o independentes da lista municipal. Brasil mostra o mapa e o ranking de UFs; ao selecionar uma UF, o mapa e o ranking passam a mostrar seus munic\u00edpios. Totais, distribui\u00e7\u00e3o, ganhos, perdas e dispers\u00e3o seguem a UF selecionada. Exterior exclu\u00eddo; DF mantido como unidade eleitoral.',
  };
  model.insights = narrative(model);
  return model;
}
