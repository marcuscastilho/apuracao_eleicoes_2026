import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildMunicipalMap } from './municipal-model.js';
import { buildMapLegend, buildMapScale } from './map-style.js';
import { geometryForPlotly } from './map-geometry.js';

const feature = ibge => ({
  type: 'Feature', properties: { codarea: ibge },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});
const fixture = {
  metadata: { states: [{ uf: 'SP', name: 'Sao Paulo' }] },
  candidates: [{ id: '13', name: 'Lula', party: 'PT' }, { id: '22', name: 'Flavio', party: 'PL' }],
  cities: [
    { uf: 'SP', code: '00001', name: 'Mesmo nome', rounds: [
      { validVotes: 100, votes: { '13': 40, '22': 60 }, final: true },
      { validVotes: 200, votes: { '13': 50, '22': 150 }, final: true },
    ] },
    { uf: 'SP', code: '00002', name: 'Mesmo nome', rounds: [
      { validVotes: 100, votes: { '13': 60, '22': 40 }, final: true },
      { validVotes: 100, votes: { '13': 30, '22': 70 }, final: true },
    ] },
  ],
};
const idx = { cities: [
  { uf: 'SP', code: '00001', ibge: '3500001' },
  { uf: 'SP', code: '00002', ibge: '3500002' },
] };
const geo = { type: 'FeatureCollection', features: [feature('3500002'), feature('3500001')] };
const mapped = buildMunicipalMap(fixture, idx, geo, { uf: 'SP' });
assert.equal(mapped.rows[0].code, '00002');
assert.equal(mapped.rows[0].value, -30);
assert.equal(mapped.rows[1].value, 10);
assert.equal(mapped.summary.delta, -20);
assert.equal(mapped.rows[1].metrics.pp, -15);
assert.equal(mapped.ranking[0].code, '00001');
assert.equal(mapped.coverage.mapped, 2);
const incomplete = buildMunicipalMap(fixture, idx, {
  type: 'FeatureCollection', features: [feature('3500001'), feature('3500003')],
}, { uf: 'SP' });
assert.equal(incomplete.rows[1].hasData, false);
assert.equal(incomplete.rows[1].value, null);
assert.equal(incomplete.rows[1].metrics.first, null);
assert.equal(incomplete.coverage.citiesWithoutGeometry[0].code, '00002');
assert.deepEqual(incomplete.coverage.areasWithoutVotes, ['3500003']);
assert.equal(incomplete.summary.delta, -20);
assert.equal(incomplete.rankingCount, 2);
const unavailable = buildMunicipalMap(fixture, null, null, { uf: 'SP' });
assert.equal(unavailable.coverage.mapAvailable, false);
assert.equal(unavailable.rows.length, 2);
assert.equal(unavailable.summary.delta, -20);
assert.equal(unavailable.rows[0].ibge, null);
assert.throws(() => buildMunicipalMap(fixture, idx, geo, { uf: 'all' }));
assert.throws(() => buildMunicipalMap(fixture, { cities: [idx.cities[0], idx.cities[0]] }, geo, { uf: 'SP' }));
assert.throws(() => buildMunicipalMap(fixture, idx, {
  type: 'FeatureCollection', features: [feature('1500001')],
}, { uf: 'SP' }));
const legend = buildMapLegend(mapped.rows, 'sqrt', 'votos', 'municipal');
assert.equal(legend.areaLabel, 'munic\u00edpios');
assert.ok(legend.rangeNote.includes('nos munic\u00edpios desta UF'));
assert.ok(!legend.note.includes('extremos nacionais'));
assert.deepEqual(legend.entries.map(row => row.count), [1, 1, 0, 0]);
console.log('Municipal fixtures passed: identity joins despite identical names, missing areas vs zero, fallback, sorting, scoped legends.');

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const dataset = read('./data/elections.json');
const index = read('./data/municipality-index.json');
const report = read('./data/municipal-validation.json');
assert.equal(index.cities.length, dataset.cities.length);
assert.equal(new Set(index.cities.map(row => `${row.uf}/${row.code}`)).size, 5571);
assert.equal(report.expected, 5571);
assert.equal(report.mapped, 5570);
let mappedCount = 0;
for (const state of dataset.metadata.states) {
  const path = `./data/municipalities/${state.uf.toLowerCase()}.geojson`;
  const source = read(path);
  const body = readFileSync(new URL(path, import.meta.url));
  const audit = report.states.find(row => row.uf === state.uf);
  assert.equal(createHash('sha256').update(body).digest('hex'), audit.sha256);
  const normalized = geometryForPlotly(source);
  assert.deepEqual(normalized.features.map(row => row.properties), source.features.map(row => row.properties));
  for (const candidateId of ['13', '22']) {
    for (const metric of ['delta', 'growth', 'pp']) {
      const result = buildMunicipalMap(dataset, index, source, { uf: state.uf, candidateId, metric });
      assert.equal(result.rows.length, source.features.length);
      assert.equal(result.coverage.mapped, audit.mapped);
      assert.equal(result.rankingCount, state.paired);
      assert.ok(result.ranking.length <= 20);
      assert.equal(buildMapLegend(result.rows, 'sqrt', result.metric.unit, 'municipal')
        .entries.reduce((sum, row) => sum + row.count, 0), source.features.length);
      const scale = buildMapScale(result.rows);
      for (const row of result.rows.filter(row => row.hasData)) {
        const city = dataset.cities.find(city => city.uf === state.uf && city.code === row.code);
        assert.equal(row.metrics.first, city.rounds[0].votes[candidateId]);
        assert.equal(row.metrics.second, city.rounds[1].votes[candidateId]);
        assert.equal(row.metrics.delta, row.metrics.second - row.metrics.first);
        assert.equal(row.value, row.metrics[metric]);
        if (row.value !== null) assert.ok(row.value >= scale.min && row.value <= scale.max);
      }
    }
  }
  mappedCount += audit.mapped;
}
assert.equal(mappedCount, 5570);
assert.deepEqual(report.states.filter(state => state.citiesWithoutGeometry.length).map(state =>
  [state.uf, state.citiesWithoutGeometry]), [['MT', ['5101837']]]);
const mt = buildMunicipalMap(dataset, index, read('./data/municipalities/mt.geojson'), { uf: 'MT' });
assert.ok(mt.note.includes('mudan\u00e7as municipais recentes'));
assert.equal(mt.summary.count, 142);
assert.equal(mt.coverage.mapped, 141);
const df = buildMunicipalMap(dataset, index, read('./data/municipalities/df.geojson'), { uf: 'DF' });
assert.equal(df.rows.length, 1);
assert.ok(df.note.includes('sem divis\u00e3o por regi\u00f5es administrativas'));
console.log('Municipal snapshot audit passed: all 27 UFs x both candidates x 3 metrics; 5570/5571 codes matched, missing MT/5101837 explicitly disclosed.');
