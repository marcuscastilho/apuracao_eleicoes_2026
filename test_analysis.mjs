import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./analysis.js', import.meta.url), 'utf8');
const { compare, summarize, selectCities, groupRanked, chartCities, toCSV } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const city = (uf, code, name, first, second, valid1 = 200, valid2 = 200) => ({
  uf, code, name, rounds: [
    { validVotes: valid1, votes: { '13': first, '22': valid1 - first }, final: true },
    { validVotes: valid2, votes: { '13': second, '22': valid2 - second }, final: true },
  ],
});
const a = city('SP', '00001', 'São Teste', 100, 120);
const b = city('SP', '00002', 'Beta', 50, 40);
const c = city('RJ', '00003', 'Gama', 0, 20);
const d = city('SP', '00004', 'Delta', 20, 20);
assert.deepEqual(compare(a, '13'), {
  first: 100, second: 120, shareFirst: 50, shareSecond: 60, delta: 20, growth: 20, pp: 10,
});
assert.equal(compare(c, '13').growth, null);
assert.equal(compare(city('DF', '1', 'Zero', 0, 0, 0, 0), '13').pp, null);
assert.equal(compare(b, '13').growth, -20);
const summary = summarize([a, b], '13');
assert.equal(summary.first, 150);
assert.equal(summary.second, 160);
assert.equal(summary.shareFirst, 37.5);
assert.equal(summary.gaining, 1);
assert.equal(summary.losing, 1);
assert.ok(Math.abs(summary.growth - 10 / 150 * 100) < 1e-10);
assert.equal(summarize([], '13').growth, null);
assert.deepEqual(selectCities([a, b, c], { uf: 'SP', search: 'sao', candidateId: '13' }), [a]);
assert.deepEqual(selectCities([a, b, c], { trend: 'loss', candidateId: '13' }), [b]);
assert.deepEqual(selectCities([a, b, c, d], { trend: 'stable', candidateId: '13' }), [d]);
assert.deepEqual(groupRanked([b, c, a], '13').map(group =>
  [group.uf, group.rows.map(row => [row.city.code, row.rank])]),
[['RJ', [['00003', 1]]], ['SP', [['00001', 1], ['00002', 2]]]]);
assert.equal(groupRanked([a, b], '13', 'loss')[0].rows[0].city.code, '00002');
const zeroBase = city('SP', '00005', 'Zero base', 0, 50);
assert.deepEqual(groupRanked([zeroBase, b, a], '13', 'percent')[0].rows.map(row => row.city.code),
  ['00001', '00002', '00005']);
const unequal = city('SP', '00006', 'Unequal electorate', 100, 150, 1000, 2000);
assert.equal(compare(unequal, '13').growth, 50);
assert.equal(compare(unequal, '13').pp, -2.5);
assert.ok(Math.abs(summarize([a, unequal], '13').shareFirst - 200 / 1200 * 100) < 1e-10);
assert.equal(chartCities([a], '13')[0].otherMetrics.delta, -20);
const csv = toCSV(groupRanked([a, b, c], '13'), '13');
assert.ok(csv.startsWith('\uFEFF'));
assert.equal(csv.split('\r\n').length, 4);
assert.ok(csv.includes('"00001"'));
assert.ok(csv.includes('"20";"20";"50";"60";"10"'));
console.log('Analysis assertions passed: comparison, weighted aggregates, zero bases, filters, grouped ranks, CSV.');
