# Carinhanha 2026

Mapa GPS offline (PWA) para a descida de canoa pelo Rio Carinhanha.

- Página de instalação: `https://educrvz.github.io/carinhanha-2026/instrucoes.html`
- Mapa direto: `https://educrvz.github.io/carinhanha-2026/index.html`
- Sem etapa de build: HTML, CSS, JavaScript, Leaflet e Service Worker.
- As imagens de satélite são baixadas para o aparelho na primeira abertura pelo Wi-Fi.
- Pacote atual: 9.441 imagens, aproximadamente 155 MB.

## Atualizar a rota

1. Substitua `data/Pontos Carinhanha.kml` por um KML com pontos ordenados.
2. Rode `python3 generate-route-data.py`.
3. Rode `python3 download-tiles.py` para baixar as imagens e gerar `tile-manifest.js`.
4. Atualize a estimativa de download em `index.html` e `instrucoes.html`, se necessário.

Os hospitais exibidos no botão da cobra vêm da base oficial consolidada pelo SoroJá, com data de fonte registrada em `route-data.js`. A listagem não confirma estoque em tempo real; em emergência, ligue antes e acione o SAMU (192).
