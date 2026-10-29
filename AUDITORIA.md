# Auditoria final - Samu confere

## Consulta direta ao TSE

- Inicio: 2026-10-29 02:12:38 UTC.
- Fim: 2026-10-29 02:16:31 UTC.
- Eleicoes presidenciais: 6257 (1o turno) e 6258 (2o turno), ciclo ele2026.
- Candidatos conferidos: Lula (13) e Flavio Bolsonaro (22).
- Fonte: https://resultados.tse.jus.br/oficial/

Foram capturados novamente 11.202 arquivos oficiais: 11.142 resultados
municipais (5.571 unidades eleitorais em dois turnos), 54 resultados de UF,
dois totais Brasil, dois totais do exterior e duas configuracoes municipais.
As capturas desta auditoria nao substituem a base usada pelo painel.

Resultado: nenhuma divergencia nos votos dos candidatos, votos validos ou
indicadores de finalizacao entre a base local, os arquivos brutos originais
e os resultados municipais reconsultados. Nenhuma falha de consulta.
As somas municipais coincidem com os resultados oficiais das 27 UFs nos
dois turnos.

Tambem foram verificados:

- Identidade da eleicao, turno, abrangencia e municipio em cada resultado.
- Numero e nome de urna dos candidatos.
- Soma de todos os candidatos igual ao total de votos validos.
- Participacao publicada pelo TSE igual a votos do candidato / votos validos,
  com tolerancia de 0,0000001 ponto percentual para a precisao publicada.
- Pareamento dos mesmos codigos municipais nas configuracoes dos dois turnos.
- Codigos IBGE do indice local iguais aos publicados pelo TSE nos dois turnos.
- Integridade da base local: arquivo inalterado durante a auditoria.

## Abrangencia dos totais

O painel soma as 27 UFs e **exclui o exterior (ZZ)**. A visao Brasil do
TSE inclui o exterior. Portanto, os numeros desses dois recortes nao devem
ser comparados diretamente.

Totais das 27 UFs, usados no painel:

| Candidato | 1o turno | 2o turno |
|---|---:|---:|
| Lula | 53.722.151 | 64.056.078 |
| Flavio Bolsonaro | 55.960.603 | 59.654.544 |
| Todos os votos validos | 118.969.906 | 123.710.622 |

Totais oficiais Brasil, incluindo o exterior:

| Candidato | 1o turno | 2o turno |
|---|---:|---:|
| Lula | 53.879.538 | 64.256.232 |
| Flavio Bolsonaro | 56.104.503 | 59.826.041 |
| Todos os votos validos | 119.300.788 | 124.082.273 |

A soma dos totais do painel com os votos oficiais do exterior coincide
exatamente com os totais Brasil em ambos os turnos.

## Correcoes de interface

Na revisao foram identificados e corrigidos dois problemas de apresentacao:

- Titulos de eixos usavam o formato legado de string, ignorado pelo Plotly 3.
  Agora os eixos exibem os titulos e unidades corretos, com margens automaticas.
- As contagens de fatias pequenas do grafico de distribuicao se sobrepunham
  e tinham pouco contraste. As tres contagens agora ficam na legenda,
  inclusive categorias com apenas uma unidade.

As correcoes nao alteraram votos, formulas, filtros, geometrias ou cores de
classificacao. Foram adicionados testes de regressao dos titulos e da
distribuicao, com verificacao do texto realmente renderizado em desktop e
em larguras iniciais de 390 e 320 pixels.

## Formulas e mapas

Os testes dos motores de calculo verificam variacao em votos, crescimento
relativo ao primeiro turno, participacao em todos os votos validos, diferenca
em pontos percentuais, agregacao ponderada, base zero, ordenacao por UF,
filtros e exportacao CSV. A tela arredonda os percentuais para exibicao;
os calculos usam os valores completos.

A associacao geografica usa UF e codigos TSE/IBGE, nunca nomes de cidades.
Foram validadas 5.570 geometrias municipais para 5.571 unidades eleitorais.
A unica unidade sem malha na fonte consultada e Boa Esperanca do Norte/MT,
IBGE 5101837. Seus votos continuam nos totais e graficos; o mapa de MT
mostra o aviso de cobertura e de possivel desatualizacao dos limites.
O DF representa a unidade eleitoral Brasilia, nao regioes administrativas.

As cores do mapa usam contraste por raiz quadrada, explicitado na legenda,
sem transformar votos, alterar sinais ou cortar valores. A escala municipal
e calculada dentro da UF; intensidades de UFs diferentes nao sao diretamente
comparaveis. Area territorial nao representa quantidade de votos.

## Evidencias e reproducao

- Relatorio completo: `data/audit/20261029T021238Z/report.json`.
- Capturas oficiais: `data/audit/20261029T021238Z/official/`.
- Cobertura geografica: `data/municipal-validation.json`.
- Evidencias de interface: `screenshots/final-audit/`.
- Testes de dados: `test_analysis.mjs`, `test_charts_model.mjs`,
  `test_municipal_model.mjs`, `test_map_style.mjs`, `test_map_geometry.mjs`
  e `test_download.py`.
- Testes de navegacao, filtros, CSV e responsividade: `test_ui.html`,
  `test_charts.html`, `test_layout.html`, `test_map_size.html` e
  `audit-overview.html`.
- Regressao dos titulos de eixos Plotly 3: `test_axes.html`.
- Regressao das contagens e legendas da distribuicao: `test_distribution.html`.

SHA-256 da base `data/elections.json` auditada:

```text
b8e61398729eaabbacf2f451ab6c27ade41da6b40e251394ad999546e74a278f
```

Para repetir a consulta completa ao TSE, com acesso a internet:

```powershell
python audit_data.py
```

Uma nova pasta com timestamp e criada em `data/audit/`. A rotina apenas
compara e registra fontes; nao atualiza `data/elections.json`.

## Limites

A verificacao oficial descreve o estado dos arquivos consultados nos horarios
registrados, nao atualizacoes futuras. A base continua estatica. A validacao
automatizada da interface foi executada no Chrome em Windows, incluindo
larguras de 320 a 1440 pixels e simulacao de falhas de arquivos locais.
Isso nao equivale a testes em todos os navegadores ou aparelhos fisicos,
nem garante ausencia absoluta de defeitos.

## Verificacao local final

Executada em 2026-10-29T13:09Z sobre o servidor local `http://127.0.0.1:8080`
(`python -m http.server`), apos as correcoes visuais de titulos de eixo e da
distribuicao. Esta rodada NAO reconsulta o TSE: e somente o portao local de
testes e interface, distinto da auditoria oficial de dados descrita acima.
Nenhum numero eleitoral foi recomputado.

Sintaxe: `node --check app.js` e `node --check charts.js` — OK.

Suites Node (`node <arquivo>`):

- `test_analysis.mjs` — OK (comparacao, agregados, bases zero, filtros, ranks, CSV).
- `test_charts_model.mjs` — OK (fixture + reconciliacao de 54 totais UF/turno).
- `test_map_geometry.mjs` — OK (27 UFs, orientacao de aneis para o Plotly).
- `test_map_style.mjs` — OK (sinais, raiz quadrada, faixas observadas, sem corte).
- `test_municipal_model.mjs` — OK (27 UFs x 2 candidatos x 3 metricas; 5570/5571
  codigos casados, MT/5101837 explicitamente divulgado).

Python: `python -m unittest test_download -v` — 6 testes, OK.

Navegador (Chrome headless instalado, perfil novo por execucao,
`--enable-logging=stderr --dump-dom --virtual-time-budget=300000`): todas as
suites com marcador DONE e zero FAIL — `test_ui.html` (49 linhas),
`test_charts.html` (121), `test_layout.html` (97), `test_map_size.html` (75),
`audit-overview.html` (25), `audit-axes.html` (8), `test_axes.html` (32),
`test_distribution.html` (27). Nenhuma linha CONSOLE de pagina emitida em
qualquer execucao (sem console.error/warn nem rejeicoes nao tratadas).

Evidencias desta rodada: `screenshots/final-verification/` — `dom-*.html`
(DOM bruto), `out-*.txt` (resultados extraidos), `console-*.log` (stderr do
navegador), `node-*.log`, `python-test_download.log`, `nodecheck.log`,
`http-server.log`, `README.before.md` e `AUDITORIA.before.md` (backups
anteriores a esta edicao).
