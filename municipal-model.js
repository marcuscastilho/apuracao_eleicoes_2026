import { compare, summarize, selectCities } from './analysis.js';
import { IBGE_BY_UF, METRICS } from './charts-model.js';

const emptyMetrics = () => ({
  first: null, second: null, shareFirst: null, shareSecond: null,
  delta: null, growth: null, pp: null,
});

export function buildMunicipalMap(dataset, index, geojson, { uf, candidateId = '13', metric = 'delta' }) {
  if (!IBGE_BY_UF[uf]) throw new Error('Selecione uma UF v\u00e1lida para o mapa municipal.');
  const candidate = dataset.candidates.find(row => row.id === candidateId);
  if (!candidate || !Object.hasOwn(METRICS, metric)) throw new Error('Candidato ou m\u00e9trica inv\u00e1lidos.');
  const state = dataset.metadata.states.find(row => row.uf === uf);
  if (!state) throw new Error('UF ausente na base eleitoral.');
  const cities = selectCities(dataset.cities, { uf, candidateId });
  const identities = new Map();
  const ibgeSeen = new Set();
  const indexAvailable = Array.isArray(index?.cities);
  for (const row of (index?.cities || []).filter(row => row.uf === uf)) {
    if (identities.has(row.code) || ibgeSeen.has(row.ibge)) {
      throw new Error('Associa\u00e7\u00e3o municipal duplicada.');
    }
    if (!/^\d{7}$/.test(row.ibge) || !row.ibge.startsWith(IBGE_BY_UF[uf])) {
      throw new Error('Identificador municipal IBGE incompat\u00edvel com a UF.');
    }
    identities.set(row.code, row);
    ibgeSeen.add(row.ibge);
  }
  const electoralRows = cities.map(city => {
    const metrics = compare(city, candidateId);
    return {
      uf, code: city.code, ibge: identities.get(city.code)?.ibge ?? null,
      name: city.name, metrics, value: metrics[metric], selected: false, hasData: true,
    };
  });
  const byIbge = new Map(electoralRows.filter(row => row.ibge).map(row => [row.ibge, row]));
  const mapAvailable = indexAvailable && geojson?.type === 'FeatureCollection' && Array.isArray(geojson.features);
  const geometryCodes = new Set();
  const rows = mapAvailable ? geojson.features.map(feature => {
    const ibge = feature.properties?.codarea;
    if (typeof ibge !== 'string' || !/^\d{7}$/.test(ibge) || !ibge.startsWith(IBGE_BY_UF[uf]) || geometryCodes.has(ibge)) {
      throw new Error('Malha municipal cont\u00e9m c\u00f3digo duplicado ou de outra UF.');
    }
    geometryCodes.add(ibge);
    return byIbge.get(ibge) || {
      uf, code: null, ibge, name: `\u00c1rea IBGE ${ibge}`, metrics: emptyMetrics(),
      value: null, selected: false, hasData: false,
    };
  }) : electoralRows;
  const citiesWithoutGeometry = electoralRows.filter(row => !row.ibge || !geometryCodes.has(row.ibge))
    .map(({ uf: stateUf, code, ibge, name }) => ({ uf: stateUf, code, ibge, name }));
  const areasWithoutVotes = rows.filter(row => !row.hasData).map(row => row.ibge);
  const mapped = electoralRows.length - citiesWithoutGeometry.length;
  const ranked = [...electoralRows].sort((a, b) => {
    if (a.value === null && b.value !== null) return 1;
    if (b.value === null && a.value !== null) return -1;
    return (b.value ?? 0) - (a.value ?? 0) || a.name.localeCompare(b.name, 'pt-BR') || a.code.localeCompare(b.code);
  });
  const rankingLimit = 20;
  const note = mapAvailable
    ? `Mapa de ${state.name} (${uf}): ${mapped} de ${cities.length} unidades eleitorais com geometria associada por c\u00f3digo oficial. ` +
      'A escala das cores considera os munic\u00edpios desta UF; n\u00e3o compare a intensidade entre UFs diferentes. ' +
      '\u00c1rea territorial n\u00e3o representa quantidade de votos. ' +
      (citiesWithoutGeometry.length
        ? `${citiesWithoutGeometry.length} unidades sem malha (${citiesWithoutGeometry.map(row => row.name).join(', ')}) permanecem nos totais e nos gr\u00e1ficos, mas n\u00e3o aparecem no mapa. A malha dispon\u00edvel pode anteceder mudan\u00e7as municipais recentes; interprete os limites territoriais com essa ressalva. ` : '') +
      (areasWithoutVotes.length
        ? `${areasWithoutVotes.length} \u00e1reas sem resultado pareado ficam em cinza-escuro. ` : '') +
      (uf === 'DF' ? 'O DF \u00e9 exibido como a unidade eleitoral Bras\u00edlia, sem divis\u00e3o por regi\u00f5es administrativas.' : '')
    : 'Mapa municipal indispon\u00edvel. A tabela, os totais e os demais gr\u00e1ficos continuam usando todas as unidades eleitorais da UF, sem associa\u00e7\u00e3o geogr\u00e1fica por nome.';
  return {
    scope: 'municipal', areaLabel: 'munic\u00edpios', uf, name: state.name, candidate,
    metric: METRICS[metric], rows, ranking: ranked.slice(0, rankingLimit),
    rankingCount: ranked.length, rankingLimit,
    coverage: { expected: cities.length, mapped, citiesWithoutGeometry, areasWithoutVotes, mapAvailable },
    summary: summarize(cities, candidateId), note,
  };
}
