# Carinhanha 2026

Mapa GPS offline (PWA) para a descida de canoa pelo Rio Carinhanha.

- Página de instalação: `https://educrvz.github.io/carinhanha-2026/instrucoes.html`
- Mapa direto: `https://educrvz.github.io/carinhanha-2026/index.html`
- Sem etapa de build: HTML, CSS, JavaScript, Leaflet e Service Worker.
- As imagens de satélite são baixadas para o aparelho na primeira abertura pelo Wi-Fi.
- Pacote atual: 9.892 imagens, aproximadamente 163 MB.
- Rota corrigida: 151,89 km, 1.421 vértices seguindo as curvas do rio.
- Os 151 pontos do KML da equipe são preservados em suas coordenadas exatas para validação, mas seus IDs ficam ocultos no mapa para não serem confundidos com quilômetros.
- Para criar anotações, ative o botão 📝, toque no mapa e desative o botão ao terminar. Pressionar ou arrastar o mapa com o modo desligado não cria pontos.

## Atualizar a rota

1. Substitua `data/Pontos Carinhanha.kml` por um KML com pontos ordenados.
2. Atualize `data/osm-waterways.json` somente se a geometria-base do rio mudar.
3. Rode `python3 generate-route-data.py`. O gerador preserva cada ponto do KML e ajusta a geometria detalhada do rio entre eles.
4. Rode `python3 download-tiles.py` para baixar as imagens e gerar `tile-manifest.js`.
5. Atualize a estimativa de download em `index.html` e `instrucoes.html`, se necessário.

Geometria intermediária derivada de © OpenStreetMap contributors (ODbL), ajustada aos pontos autoritativos do KML da equipe.

Os hospitais exibidos no botão da cobra vêm da base oficial consolidada pelo SoroJá, com data de fonte registrada em `route-data.js`. A listagem não confirma estoque em tempo real; em emergência, ligue antes e acione o SAMU (192).
