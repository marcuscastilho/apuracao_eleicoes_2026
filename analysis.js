// Centralized comparison semantics: all shares use ALL valid votes in that turn.
export function compare(city, candidateId) {
  const [a, b] = city.rounds;
  const first = a.votes[candidateId];
  const second = b.votes[candidateId];
  const shareFirst = a.validVotes === 0 ? null : first / a.validVotes * 100;
  const shareSecond = b.validVotes === 0 ? null : second / b.validVotes * 100;
  return {
    first, second, shareFirst, shareSecond, delta: second - first,
    growth: first === 0 ? null : (second - first) / first * 100,
    pp: shareFirst === null || shareSecond === null ? null : shareSecond - shareFirst,
  };
}

export function summarize(cities, candidateId) {
  const rounds = [0, 1].map(index => ({
    validVotes: cities.reduce((sum, city) => sum + city.rounds[index].validVotes, 0),
    votes: { [candidateId]: cities.reduce((sum, city) => sum + city.rounds[index].votes[candidateId], 0) },
  }));
  const values = cities.map(city => compare(city, candidateId).delta);
  return {
    ...compare({ rounds }, candidateId),
    count: cities.length,
    gaining: values.filter(delta => delta > 0).length,
    losing: values.filter(delta => delta < 0).length,
    stable: values.filter(delta => delta === 0).length,
    partial: cities.filter(city => city.rounds.some(round => !round.final)).length,
  };
}

const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function selectCities(cities, { uf = 'all', search = '', trend = 'all', candidateId = '13' } = {}) {
  const query = normalize(search.trim());
  return cities.filter(city => {
    if (uf !== 'all' && city.uf !== uf) return false;
    if (query && !normalize(city.name).includes(query) && !city.code.includes(query)) return false;
    const delta = compare(city, candidateId).delta;
    return trend === 'all' || (trend === 'gain' && delta > 0) ||
      (trend === 'loss' && delta < 0) || (trend === 'stable' && delta === 0);
  });
}

function sorter(candidateId, order) {
  return (a, b) => {
    const x = compare(a, candidateId);
    const y = compare(b, candidateId);
    let primary;
    if (order === 'percent') {
      if (x.growth === null && y.growth !== null) return 1;
      if (y.growth === null && x.growth !== null) return -1;
      primary = (y.growth ?? 0) - (x.growth ?? 0);
    } else {
      primary = order === 'loss' ? x.delta - y.delta : y.delta - x.delta;
    }
    return primary || a.name.localeCompare(b.name, 'pt-BR') || a.code.localeCompare(b.code);
  };
}

export function groupRanked(cities, candidateId, order = 'gain') {
  const ufs = [...new Set(cities.map(city => city.uf))].sort();
  return ufs.map(uf => ({
    uf,
    rows: cities.filter(city => city.uf === uf).sort(sorter(candidateId, order))
      .map((city, index) => ({ city, metrics: compare(city, candidateId), rank: index + 1 })),
  }));
}

export function chartCities(cities, candidateId, order = 'gain') {
  return [...cities].sort(sorter(candidateId, order)).slice(0, 8).map(city => ({
    city, metrics: compare(city, candidateId), otherMetrics: compare(city, candidateId === '13' ? '22' : '13'),
  }));
}

export function toCSV(groups, candidateId) {
  const header = ['UF', 'Codigo TSE', 'Municipio', 'Candidato', 'Ranking na UF', 'Votos 1 turno',
    'Votos 2 turno', 'Variacao votos', 'Crescimento %', 'Participacao 1 turno %',
    'Participacao 2 turno %', 'Variacao p.p.', 'Finalizado 1 turno', 'Finalizado 2 turno'];
  const decimal = value => value === null ? '' : String(value).replace('.', ',');
  const escape = value => `"${String(value).replace(/"/g, '""')}"`;
  const rows = groups.flatMap(group => group.rows.map(({ city, metrics: m, rank }) => [
    city.uf, city.code, city.name, candidateId === '13' ? 'Lula' : 'Flavio Bolsonaro', rank,
    m.first, m.second, m.delta, decimal(m.growth), decimal(m.shareFirst), decimal(m.shareSecond),
    decimal(m.pp), city.rounds[0].final ? 'Sim' : 'Nao', city.rounds[1].final ? 'Sim' : 'Nao',
  ]));
  return '\uFEFF' + [header, ...rows].map(row => row.map(escape).join(';')).join('\r\n');
}
