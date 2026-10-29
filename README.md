# Samu confere — TSE 2026

Painel estático (HTML + CSS + JavaScript vanilla em módulos ES, sem dependências de
build) que compara, município a município, os votos válidos de **Lula (PT, 13)** e
**Flavio Bolsonaro (PL, 22)** entre o 1º e o 2º turno das eleições de 2026, usando a
divulgação oficial de resultados do TSE. Interface escura em slate com acento amarelo,
inspirada na linguagem visual de design systems modernos.

## Como rodar

Na pasta do projeto:

```bash
# 1. Baixar e validar a base local (gera data/elections.json).
#    Se data/elections.json já existe, pule este passo — a base já está pronta.
python download_data.py

# 2. Servir o painel por HTTP (módulos ES e fetch não funcionam via file://)
python -m http.server 8080 --bind 127.0.0.1
```

Abra <http://127.0.0.1:8080/>.

O download reutiliza o cache bruto em `data/raw/` (JSONs oficiais por município e
por UF, nos dois turnos); use `python download_data.py --refresh` para baixar tudo
de novo. A cada geração, `data/validation.json` registra o relatório de
reconciliação: SHA-256 do snapshot, cobertura e a comparação entre a soma
municipal e os totais estaduais oficiais do TSE para cada UF/turno.

## Testes

```bash
node test_analysis.mjs                  # fórmulas do motor (analysis.js)
node test_charts_model.mjs              # modelo dos gráficos (charts-model.js)
node test_map_geometry.mjs              # adaptação de anéis GeoJSON p/ Plotly
node test_map_style.mjs                 # cores/legenda do mapa (map-style.js)
node test_municipal_model.mjs           # junção TSE <-> IBGE e modelo municipal
python -m unittest test_download -v     # parser/validação do downloader
node --check app.js                     # sintaxe do frontend
node --check charts.js                  # sintaxe da página de gráficos
```

Teste de layout responsivo (mesma técnica; `test_layout.html` mede alinhamento dos
filtros, overflow do documento e pan nos gráficos em 1440/1024/768/390/360/320):

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless \
  --dump-dom --virtual-time-budget=300000 \
  http://127.0.0.1:8080/test_layout.html | grep -E "PASS|FAIL|DONE"
```

Teste de fumaça da página de gráficos (mesmo comando, trocando a URL por
`test_charts.html`; exige `vendor/plotly-3.3.0.min.js` e `data/brazil-ufs.geojson`):

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless \
  --dump-dom --virtual-time-budget=60000 \
  http://127.0.0.1:8080/test_charts.html | grep -E "PASS|FAIL|DONE"
```

Teste de fumaça da interface (requer a base gerada e o servidor rodando;
usa o Chrome já instalado, sem dependências):

```bash
# Git Bash / WSL
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless \
  --dump-dom --virtual-time-budget=30000 \
  http://127.0.0.1:8080/test_ui.html | grep -E "PASS|FAIL|DONE"
```

```powershell
# PowerShell nativo
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless `
  --dump-dom --virtual-time-budget=30000 `
  http://127.0.0.1:8080/test_ui.html | Select-String "PASS|FAIL|DONE"
```

## Estrutura

- `index.html`, `styles.css`, `app.js` — interface do painel.
- `charts.html`, `charts.css`, `charts.js` — página "Gráficos e mapa" (Plotly local).
- `charts-model.js` — modelo/métricas dos gráficos (toda a derivação vive aqui).
- `test_layout.html` — suíte de layout responsivo das duas páginas.
- `map-geometry.js` — adapta o GeoJSON do IBGE para a orientação de anéis do Plotly.
- `map-style.js` — paleta/legenda/escala do mapa: descontinuidade de matiz no zero
  (alta sempre verde-azulada, queda sempre laranja; zero exato cinza-claro, não
  definido cinza-escuro). O mapa aplica automaticamente contraste ampliado por
  raiz quadrada; não há seletor de escala. Os votos exibidos continuam crus —
  nunca transformados nem cortados — e a faixa é sempre a observada no recorte
  atual do mapa (nacional ou da UF selecionada), sem metade negativa sem uso.
- `analysis.js` — motor de comparação/filtragem/ranking/CSV (todas as fórmulas vivem aqui).
- `download_data.py` — baixa, valida e reconcilia os resultados municipais do TSE.
- `download_municipal_maps.py` — baixa as malhas municipais do IBGE (opcional `--refresh`).
- `municipal-model.js` — modelo do mapa/ranking municipal (junção TSE <-> IBGE por código).
- `data/elections.json` — base local gerada pelo download.
- `data/brazil-ufs.geojson` — malha das 27 UFs (IBGE, qualidade mínima).
- `data/municipalities/{uf}.geojson` — malhas municipais por UF (IBGE, qualidade mínima).
- `data/municipality-index.json` — índice TSE <-> IBGE das 5.571 unidades (códigos oficiais).
- `data/municipal-validation.json` — relatório de cobertura/proveniência das malhas.
- `vendor/` — Plotly 3.3.0, topologia `world_110m.json` e licenças (ver `vendor/README.md`).

## Página de gráficos

Abra <http://127.0.0.1:8080/charts.html> (ou use o link "Gráficos e mapa" na barra
lateral). Os filtros dela — candidato, UF e métrica — são **independentes** dos
filtros da Visão geral. No recorte Brasil, o mapa coroplético e o ranking mostram as
27 UFs (contexto nacional). Ao selecionar uma UF, o mesmo painel passa a exibir o
**mapa municipal da UF** — malha IBGE de `data/municipalities/{uf}.geojson`, com
escala de cores calculada dentro da UF — e o ranking vira municipal (até 20
municípios); o botão "Ver Brasil" volta ao mapa nacional. Os demais gráficos
(totais por turno, distribuição, ganhos/perdas municipais e dispersão de
participação) seguem a UF selecionada — clicar num estado do mapa nacional também
seleciona a UF. São 7 regiões Plotly: mapa coroplético com geometria IBGE local,
barras de votos por turno, ranking (estadual ou municipal), maiores ganhos,
maiores perdas, dispersão de participação e rosca de distribuição. Tudo roda
offline: a biblioteca
(`vendor/plotly-3.3.0.min.js`), a topologia base (`vendor/world_110m.json`), a
malha das UFs (`data/brazil-ufs.geojson`) e as malhas municipais
(`data/municipalities/`) são arquivos locais — URLs de origem, datas de download
e licenças em `vendor/README.md`.

As malhas municipais já estão baixadas; para atualizá-las rode
`python download_municipal_maps.py` (ou `--refresh` para forçar novo download —
sem isso o uso é 100% offline). A junção entre resultados do TSE e geometria do
IBGE usa **códigos oficiais** (`data/municipality-index.json`), nunca nomes.
Cobertura: 5.570 de 5.571 unidades com geometria associada — a única lacuna é
Boa Esperança do Norte/MT (IBGE 5101837), cujo município permanece nos totais e
gráficos mas não aparece no mapa de MT (142 unidades eleitorais, 141 formas). O
DF é exibido como a unidade eleitoral Brasília, sem divisão por regiões
administrativas.

## Convenções dos dados

- `shareFirst` e `shareSecond` representam participação em % dos votos válidos; `growth` representa crescimento em % sobre os votos do próprio candidato no 1º turno; `pp` é a diferença de participação em pontos percentuais. Os valores já vêm multiplicados por 100; `growth` é `null` quando o candidato teve zero voto no 1º turno.
- Só entram municípios com resultado oficial nos **dois** turnos (pareamento por UF +
  código TSE). Exterior (ZZ) excluído; DF mantido como unidade eleitoral do TSE.
- A participação usa todos os votos válidos do município em cada turno; o crescimento usa os votos do próprio candidato no 1º turno. Não há inferência de transferência individual de votos.

## Auditoria dos dados

`python audit_data.py` reconsulta os resultados municipais dos dois turnos, os
totais das UFs e Brasil/exterior no TSE. As respostas e o relatório são gravados
em `data/audit/<timestamp>/`, sem substituir `data/elections.json`. Requer
internet e pode levar alguns minutos. O último resultado auditado está em
[AUDITORIA.md](AUDITORIA.md).
