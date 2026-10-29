// Plotly's d3-geo uses clockwise exteriors; IBGE GeoJSON uses RFC 7946 CCW rings.
// Adapt a copy for rendering, leaving the downloaded geographic source intact.
export function geometryForPlotly(geojson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error('Malha geogr\u00e1fica inv\u00e1lida.');
  }
  const copy = structuredClone(geojson);
  for (const feature of copy.features) {
    const geometry = feature.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
      throw new Error('Tipo de geometria n\u00e3o suportado.');
    }
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      polygon.forEach((ring, index) => {
        const signedArea = ring.slice(1).reduce((sum, point, i) =>
          sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
        const shouldReverse = index === 0 ? signedArea > 0 : signedArea < 0;
        if (shouldReverse) ring.reverse();
      });
    }
  }
  return copy;
}
