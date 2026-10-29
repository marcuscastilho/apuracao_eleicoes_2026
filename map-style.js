// A discontinuous hue at zero keeps small gains/losses distinct from stability.
export const MAP_COLORS = Object.freeze({
  lossStrong: '#c2410c',
  lossLight: '#fed7aa',
  gainLight: '#99f6e4',
  gainStrong: '#0d9488',
  zero: '#94a3b8',
  missing: '#475569',
});

export const MAP_COLOR_SCALE = Object.freeze([
  Object.freeze([0, MAP_COLORS.lossStrong]),
  Object.freeze([0.5, MAP_COLORS.lossLight]),
  Object.freeze([0.5, MAP_COLORS.gainLight]),
  Object.freeze([1, MAP_COLORS.gainStrong]),
]);

export function mapDirection(value) {
  if (value === null || !Number.isFinite(value)) return 'missing';
  return value > 0 ? 'gain' : value < 0 ? 'loss' : 'zero';
}

const interpolateColor = (light, strong, intensity) => {
  const channels = [1, 3, 5].map(offset => {
    const a = parseInt(light.slice(offset, offset + 2), 16);
    const b = parseInt(strong.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * intensity).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
};

export function buildMapScale(states, mode = 'sqrt') {
  if (!['sqrt', 'linear'].includes(mode)) throw new Error('Escala de cores desconhecida.');
  const values = states.map(state => state.value).filter(value =>
    value !== null && Number.isFinite(value));
  const observedMin = values.length ? Math.min(...values) : null;
  const observedMax = values.length ? Math.max(...values) : null;
  const min = Math.min(0, observedMin ?? 0);
  const max = Math.max(0, observedMax ?? 0);
  const hasVariation = min < 0 || max > 0;
  const methodLabel = mode === 'sqrt' ? 'Raiz quadrada (n\u00e3o linear)' : 'Linear';
  if (!hasVariation) {
    const color = values.length ? MAP_COLORS.zero : MAP_COLORS.missing;
    return {
      min: 0, max: 1, observedMin, observedMax, hasVariation, methodLabel,
      colorscale: [[0, color], [1, color]],
    };
  }
  // Sample in color-intensity space. Stop positions remain on the RAW value axis:
  // a quarter of the extreme gets half the intensity in square-root mode.
  const colorscale = [];
  const steps = mode === 'sqrt' ? 16 : 1;
  const position = value => (value - min) / (max - min);
  if (min < 0) {
    for (let i = steps; i >= 0; i--) {
      const intensity = i / steps;
      const magnitude = mode === 'sqrt' ? intensity ** 2 : intensity;
      colorscale.push([
        position(min * magnitude),
        interpolateColor(MAP_COLORS.lossLight, MAP_COLORS.lossStrong, intensity),
      ]);
    }
  }
  if (max > 0) {
    for (let i = 0; i <= steps; i++) {
      const intensity = i / steps;
      const magnitude = mode === 'sqrt' ? intensity ** 2 : intensity;
      colorscale.push([
        position(max * magnitude),
        interpolateColor(MAP_COLORS.gainLight, MAP_COLORS.gainStrong, intensity),
      ]);
    }
  }
  return { min, max, observedMin, observedMax, hasVariation, methodLabel, colorscale };
}

export function buildMapLegend(states, mode = 'sqrt', unit = 'votos', scope = 'national') {
  if (!['national', 'municipal'].includes(scope)) throw new Error('Abrang\u00eancia geogr\u00e1fica inv\u00e1lida.');
  const municipal = scope === 'municipal';
  const scale = buildMapScale(states, mode);
  const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
  const valueLabel = value => `${value > 0 ? '+' : ''}${format.format(value)}`;
  const entries = [
    { key: 'gain', label: 'Alta: valor maior que zero', color: MAP_COLORS.gainLight, strongColor: MAP_COLORS.gainStrong },
    { key: 'loss', label: 'Queda: valor menor que zero', color: MAP_COLORS.lossLight, strongColor: MAP_COLORS.lossStrong },
    { key: 'zero', label: 'Sem varia\u00e7\u00e3o: zero exato', color: MAP_COLORS.zero, strongColor: MAP_COLORS.zero },
    { key: 'missing', label: 'Sem valor definido', color: MAP_COLORS.missing, strongColor: MAP_COLORS.missing },
  ];
  return {
    areaLabel: municipal ? 'munic\u00edpios' : 'UFs',
    entries: entries.map(entry => ({
      ...entry, count: states.filter(state => mapDirection(state.value) === entry.key).length,
    })),
    zeroLocations: states.filter(state => mapDirection(state.value) === 'zero').map(state => state.ibge),
    missingLocations: states.filter(state => mapDirection(state.value) === 'missing').map(state => state.ibge),
    rangeNote: scale.observedMin === null
      ? 'Nenhum valor definido para a escala de cores.'
      : `Faixa observada ${municipal ? 'nos munic\u00edpios desta UF' : 'nas UFs'}: ${valueLabel(scale.observedMin)} a ${valueLabel(scale.observedMax)} ${unit}. Escala das cores: ${scale.methodLabel}.`,
    note: 'Verde-azulado indica alta; laranja indica queda. ' +
      (mode === 'sqrt'
        ? 'Contraste ampliado por raiz quadrada: diferen\u00e7as menores ficam mais vis\u00edveis e os extremos dominam menos as cores. A intensidade n\u00e3o \u00e9 linear. '
        : 'A intensidade varia linearmente com a magnitude. ') +
      'Tons mais escuros indicam maior magnitude dentro de cada sinal; compare os n\u00fameros para confrontar altas e quedas. A escala usa os extremos ' +
      (municipal ? 'dos munic\u00edpios da UF selecionada' : 'nacionais') +
      ' observados, com zero como refer\u00eancia, sem cortar valores. Os votos e os valores da legenda num\u00e9rica n\u00e3o s\u00e3o transformados. Cinza-claro indica somente zero exato; cinza-escuro indica valor n\u00e3o definido. As cores representam varia\u00e7\u00e3o, n\u00e3o o vencedor.',
  };
}
