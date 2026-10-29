import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDashboard, IBGE_BY_UF } from './charts-model.js';

const city = (uf, code, first, second, valid1, valid2) => ({
  uf, code, name: `Cidade ${code}`,
  rounds: [
    { votes: { '13': first, '22': valid1 - first }, validVotes: valid1, final: true },
    { votes: { '13': second, '22': valid2 - second }, validVotes: valid2, final: true },
  ],
});
const fixture = {
  candidates: [{ id: '13', name: 'Lula', party: 'PT' }, { id: '22', name: 'Flavio Bolsonaro', party: 'PL' }],
  metadata: {
    states: [{ uf: 'SP', name: 'Sao Paulo' }, { uf: 'RJ', name: 'Rio de Janeiro' }, { uf: 'DF', name: 'Distrito Federal' }],
    coverage: { expected: 5, paired: 4, excluded: 1, errors: 1 },
  },
  cities: [
    city('SP', '1', 100, 150, 1000, 2000), // More votes but lower share.
    city('SP', '2', 100, 120, 200, 200),
    city('RJ', '3', 0, 20, 100, 100),
    city('RJ', '4', 40, 30, 100, 100),
  ],
};
const national = buildDashboard(fixture);
assert.equal(national.cityCount, 4);
assert.equal(national.summary.first, 240);
assert.equal(national.summary.second, 320);
assert.equal(national.summary.delta, 80);
assert.equal(national.summary.shareFirst, 240 / 1400 * 100);
assert.equal(national.summary.shareSecond, 320 / 2400 * 100);
assert.deepEqual(national.gains.map(row => row.code), ['1', '2', '3']);
assert.deepEqual(national.losses.map(row => row.code), ['4']);
assert.equal(national.scatter.find(row => row.code === '1').direction, 'loss');
assert.equal(national.scatter.find(row => row.code === '1').delta, 50);
assert.equal(national.scatter.find(row => row.code === '3').growth, null);
assert.deepEqual(national.distribution.map(row => row.value), [3, 1, 0]);
assert.equal(national.states.find(row => row.uf === 'DF').value, null);
assert.equal(national.stateRanking.at(-1).uf, 'DF');
const sp = buildDashboard(fixture, { uf: 'SP', candidateId: '13', metric: 'pp' });
assert.equal(sp.cityCount, 2);
assert.equal(sp.summary.delta, 70);
assert.equal(sp.states.find(row => row.uf === 'SP').ibge, '35');
assert.equal(sp.states.find(row => row.uf === 'SP').selected, true);
assert.deepEqual(sp.states.map(row => row.value),
  buildDashboard(fixture, { metric: 'pp' }).states.map(row => row.value));
assert.deepEqual(sp.mapRange, buildDashboard(fixture, { metric: 'pp' }).mapRange);
const zero = buildDashboard(fixture, { candidateId: '13', uf: 'DF' });
assert.equal(zero.cityCount, 0);
assert.equal(zero.summary.growth, null);
assert.equal(zero.gains.length, 0);
assert.equal(zero.scatter.length, 0);
assert.equal(zero.insights.length, 1);
assert.equal(buildDashboard(fixture, { candidateId: '22' }).summary.delta, 920);
assert.throws(() => buildDashboard(fixture, { candidateId: '99' }));
assert.throws(() => buildDashboard(fixture, { uf: 'ZZ' }));
assert.throws(() => buildDashboard(fixture, { metric: 'fake' }));
assert.equal(new Set(Object.values(IBGE_BY_UF)).size, 27);
assert.ok(national.insights.some(text => text.includes('somente a cobertura')));
const noLoss = buildDashboard(fixture, { uf: 'SP' });
assert.ok(noLoss.insights.some(text => text.startsWith('Nenhum')));
const zeroBaseFixture = { ...fixture, cities: [city('RJ', 'zero', 0, 20, 100, 100)] };
const zeroGrowth = buildDashboard(zeroBaseFixture, { metric: 'growth' });
assert.equal(zeroGrowth.states.find(row => row.uf === 'RJ').value, null);
assert.equal(zeroGrowth.mapRange.max, 1);
const stableFixture = { ...fixture, cities: [city('SP', 'stable', 30, 30, 100, 200)] };
stableFixture.cities[0].rounds[1].final = false;
const stable = buildDashboard(stableFixture);
assert.deepEqual(stable.distribution.map(row => row.value), [0, 0, 1]);
assert.equal(stable.scatter[0].direction, 'loss');
assert.equal(stable.partialCount, 1);
assert.ok(stable.insights.some(text => text.includes('n\u00e3o finalizada')));
console.log('Chart model fixture assertions passed.');

const real = JSON.parse(readFileSync(new URL('./data/elections.json', import.meta.url), 'utf8'));
const validation = JSON.parse(readFileSync(new URL('./data/validation.json', import.meta.url), 'utf8'));
for (const candidateId of ['13', '22']) {
  for (const metric of ['delta', 'growth', 'pp']) {
    const model = buildDashboard(real, { candidateId, metric });
    assert.equal(model.states.length, 27);
    assert.equal(model.cityCount, 5571);
    assert.equal(model.distribution.reduce((sum, row) => sum + row.value, 0), model.cityCount);
    assert.equal(model.scatter.length, model.cityCount);
    assert.equal(model.mapRange.min, -model.mapRange.max);
    for (const state of model.states) {
      const first = validation.states.find(row => row.uf === state.uf && row.turn === '1').official;
      const second = validation.states.find(row => row.uf === state.uf && row.turn === '2').official;
      assert.equal(state.metrics.first, first.votes[candidateId]);
      assert.equal(state.metrics.second, second.votes[candidateId]);
      assert.equal(state.metrics.delta, second.votes[candidateId] - first.votes[candidateId]);
      assert.equal(state.metrics.pp,
        second.votes[candidateId] / second.validVotes * 100 - first.votes[candidateId] / first.validVotes * 100);
      assert.equal(state.value, state.metrics[metric]);
    }
    const filtered = buildDashboard(real, { uf: 'SP', candidateId, metric });
    assert.equal(filtered.cityCount, 645);
    assert.deepEqual(filtered.mapRange, model.mapRange);
    assert.deepEqual(filtered.states.map(row => row.value), model.states.map(row => row.value));
  }
}
console.log('Real snapshot: both candidates x 3 metrics reconcile to 54 official UF/turn totals.');
