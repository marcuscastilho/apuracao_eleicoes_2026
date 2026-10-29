import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geometryForPlotly } from './map-geometry.js';
import { IBGE_BY_UF } from './charts-model.js';

const ringArea = ring => ring.slice(1).reduce((sum, p, i) =>
  sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
const ringPoints = geometry => (geometry.type === 'Polygon'
  ? [geometry.coordinates] : geometry.coordinates).flatMap(polygon => polygon);
const original = JSON.parse(readFileSync(new URL('./data/brazil-ufs.geojson', import.meta.url), 'utf8'));
const captured = JSON.stringify(original);
const normalized = geometryForPlotly(original);
assert.equal(JSON.stringify(original), captured);
assert.equal(normalized.features.length, 27);
assert.deepEqual(new Set(normalized.features.map(feature => feature.properties.codarea)),
  new Set(Object.values(IBGE_BY_UF)));
for (let i = 0; i < original.features.length; i++) {
  const source = original.features[i];
  const result = normalized.features[i];
  assert.deepEqual(source.properties, result.properties);
  assert.equal(source.geometry.type, result.geometry.type);
  const originalPoints = ringPoints(source.geometry);
  const normalizedPoints = ringPoints(result.geometry);
  assert.equal(originalPoints.length, normalizedPoints.length);
  for (let r = 0; r < originalPoints.length; r++) {
    assert.equal(originalPoints[r].length, normalizedPoints[r].length);
    assert.deepEqual(originalPoints[r].map(JSON.stringify).sort(),
      normalizedPoints[r].map(JSON.stringify).sort());
  }
  const polygons = result.geometry.type === 'Polygon'
    ? [result.geometry.coordinates] : result.geometry.coordinates;
  for (const polygon of polygons) {
    assert.ok(ringArea(polygon[0]) <= 0);
    polygon.slice(1).forEach(hole => assert.ok(ringArea(hole) >= 0));
  }
}
assert.deepEqual(geometryForPlotly(normalized), normalized);
const square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
const hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
const withHole = geometryForPlotly({
  type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [square, hole] },
  }],
});
assert.ok(ringArea(withHole.features[0].geometry.coordinates[0]) < 0);
assert.ok(ringArea(withHole.features[0].geometry.coordinates[1]) > 0);
assert.throws(() => geometryForPlotly({ type: 'Point' }));
console.log('Map geometry assertions passed: all 27 UF identities and every coordinate preserved; exteriors/holes correctly oriented for Plotly.');
