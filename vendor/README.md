# vendor/ — dependências locais do painel de gráficos

Baixadas em 28/10/2026 para uso **offline** (nenhum recurso é buscado em rede
durante o uso do painel).

| Arquivo | Origem | Licença / termos |
|---|---|---|
| `plotly-3.3.0.min.js` (4.838.098 bytes) | https://cdn.plot.ly/plotly-3.3.0.min.js | MIT — ver `PLOTLY-LICENSE.txt` |
| `PLOTLY-LICENSE.txt` (1.086 bytes) | https://raw.githubusercontent.com/plotly/plotly.js/v3.3.0/LICENSE | MIT |
| `world_110m.json` (136.642 bytes) | https://cdn.plot.ly/world_110m.json | TopoJSON Natural Earth 110m distribuído pela Plotly; usado como base geográfica local (`topojsonURL`) |

A geometria dos estados brasileiros fica em `data/brazil-ufs.geojson`
(98.502 bytes, 27 features, `properties.codarea` = código IBGE da UF):

- Fonte: API de malhas do IBGE —
  `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF`
- A resposta é servida com compressão gzip; o arquivo local é o JSON já
  decodificado, verbatim, sem simplificação adicional.
