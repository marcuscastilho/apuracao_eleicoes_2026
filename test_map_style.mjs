import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDashboard } from './charts-model.js';
import { MAP_COLORS, MAP_COLOR_SCALE, mapDirection, buildMapLegend, buildMapScale } from './map-style.js';

for (const value of [1, 1e-15, 1e9]) assert.equal(mapDirection(value), 'gain');
for (const value of [-1, -1e-15, -1e9]) assert.equal(mapDirection(value), 'loss');
for (const value of [0, -0]) assert.equal(mapDirection(value), 'zero');
for (const value of [null, undefined, NaN, Infinity]) assert.equal(mapDirection(value), 'missing');
assert.deepEqual(MAP_COLOR_SCALE.map(stop => stop[0]), [0, 0.5, 0.5, 1]);
assert.ok(MAP_COLOR_SCALE.every(stop => stop[1] !== MAP_COLORS.zero && stop[1] !== MAP_COLORS.missing));
const states = [
  { ibge: '11', value: -1 }, { ibge: '12', value: 1e-15 },
  { ibge: '13', value: 0 }, { ibge: '14', value: null },
];
const legend = buildMapLegend(states);
assert.deepEqual(legend.entries.map(entry => entry.count), [1, 1, 1, 1]);
assert.deepEqual(legend.zeroLocations, ['13']);
assert.deepEqual(legend.missingLocations, ['14']);
assert.equal(new Set(legend.entries.map(entry => entry.color)).size, 4);

const mixed = [{ value: -100 }, { value: 400 }, { value: 0 }, { value: null }];
const captured = JSON.stringify(mixed);
const sqrt = buildMapScale(mixed);
const linear = buildMapScale(mixed, 'linear');
assert.equal(sqrt.min, -100);
assert.equal(sqrt.max, 400);
assert.equal(sqrt.observedMin, -100);
assert.equal(sqrt.observedMax, 400);
assert.deepEqual(linear.colorscale.map(stop => stop[0]), [0, 0.2, 0.2, 1]);
assert.equal(sqrt.colorscale[0][0], 0);
assert.equal(sqrt.colorscale.at(-1)[0], 1);
assert.ok(sqrt.colorscale.every((stop, index, all) => index === 0 || stop[0] >= all[index - 1][0]));
assert.equal(sqrt.colorscale.filter(stop => stop[0] === 0.2).length, 2);
// +100 is one quarter of +400, so half of the light-to-strong RGB ramp.
assert.deepEqual(sqrt.colorscale.find(stop => stop[0] === (100 + 100) / 500), [0.4, '#53c5b6']);
// -25 is one quarter of -100 and gets the same half-intensity on the orange ramp.
assert.deepEqual(sqrt.colorscale.find(stop => stop[0] === (-25 + 100) / 500), [0.15, '#e08c5b']);
assert.equal(JSON.stringify(mixed), captured);
assert.deepEqual(buildMapScale([{ value: 10 }, { value: 100 }], 'linear').colorscale,
  [[0, MAP_COLORS.gainLight], [1, MAP_COLORS.gainStrong]]);
assert.deepEqual(buildMapScale([{ value: -100 }, { value: -1 }], 'linear').colorscale,
  [[0, MAP_COLORS.lossStrong], [1, MAP_COLORS.lossLight]]);
assert.equal(buildMapScale([{ value: null }]).hasVariation, false);
assert.equal(buildMapScale([{ value: null }]).observedMin, null);
assert.equal(buildMapScale([{ value: 0 }]).hasVariation, false);
assert.equal(buildMapScale([{ value: 0 }]).observedMin, 0);
assert.throws(() => buildMapScale(mixed, 'fake'));
assert.ok(buildMapLegend(mixed).note.includes('n\u00e3o \u00e9 linear'));
assert.ok(buildMapLegend(mixed, 'linear').note.includes('varia linearmente'));

const dataset = JSON.parse(readFileSync(new URL('./data/elections.json', import.meta.url), 'utf8'));
for (const candidateId of ['13', '22']) {
  for (const metric of ['delta', 'growth', 'pp']) {
    const model = buildDashboard(dataset, { candidateId, metric });
    const style = buildMapLegend(model.states);
    assert.equal(style.entries.reduce((sum, entry) => sum + entry.count, 0), 27);
    assert.equal(style.entries.find(entry => entry.key === 'gain').count,
      model.states.filter(state => state.value > 0).length);
    assert.equal(style.entries.find(entry => entry.key === 'loss').count,
      model.states.filter(state => state.value !== null && state.value < 0).length);
    const filtered = buildDashboard(dataset, { candidateId, metric, uf: 'SP' });
    assert.deepEqual(buildMapLegend(filtered.states), style);
    for (const mode of ['sqrt', 'linear']) {
      const scale = buildMapScale(model.states, mode);
      const values = model.states.map(state => state.value).filter(value => value !== null);
      assert.equal(scale.min, Math.min(0, ...values));
      assert.equal(scale.max, Math.max(0, ...values));
      assert.ok(values.every(value => value >= scale.min && value <= scale.max));
      assert.deepEqual(buildMapScale(filtered.states, mode), scale);
    }
  }
}
const lulaVotes = buildDashboard(dataset);
assert.equal(buildMapLegend(lulaVotes.states).entries.find(entry => entry.key === 'gain').count, 27);
assert.equal(buildMapLegend(lulaVotes.states).zeroLocations.length, 0);
assert.equal(buildMapScale(lulaVotes.states).min, 0);
const flavioScale = buildMapScale(buildDashboard(dataset, { candidateId: '22' }).states);
assert.equal(flavioScale.min, -15092);
assert.equal(flavioScale.max, 1217155);
console.log('Map style assertions passed: signs, square-root intensity, actual asymmetric ranges, no clipping, raw data preserved, UF-filter consistency across both candidates and all metrics.');
