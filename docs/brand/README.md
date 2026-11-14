# SEDNA — Explore the Unseen.

Identidade visual v1.0 · 14 de novembro de 2026

Abra **index.html** para explorar as versões, alternar o fundo e baixar cada logo. A galeria funciona localmente, sem conexão.

## O conceito

Uma órbita alongada, um pequeno ponto de referência e um objeto vermelho destacado em uma abertura da trajetória. A marca combina a história de 90377 Sedna com a ação central do produto: comparar observações para perceber mudanças.

Sedna foi identificado em imagens de 14 de novembro de 2003 por seu pequeno deslocamento entre exposições. O anúncio público aconteceu em março de 2004. A data 14.11 pode assinar peças comemorativas, enquanto a marca principal permanece independente de datas e eventos.

A geometria é simbólica. A inclinação de 35°, o espaçamento e o tamanho dos pontos foram escolhidos para legibilidade. Não representam a órbita, a posição ou o tamanho real de Sedna. O ponto pequeno referencia o Sol, e o ponto vermelho referencia Sedna. A abertura significa atenção e descoberta. Não é uma interrupção física da órbita.

## O que está incluído

- **logos/svg/** — 35 arquivos transparentes e vetoriais. Sete composições em cinco tratamentos de cor.
- **logos/png/** — as mesmas 35 composições com transparência e resolução elevada.
- **applications/** — avatares, capa para apresentação, imagem social, peça vertical e ícones.
- **guide/SEDNA-Brand-Guide.pdf** — guia de dez páginas sobre conceito, assinaturas, cores, tipografia, redução, linguagem gráfica e aplicações.
- **guide/SEDNA-Logo-Masters.pdf** — sete páginas com as matrizes vetoriais sobre fundos claro e escuro.
- **fonts/** — IBM Plex Sans e IBM Plex Mono em TTF e WOFF2, com suas licenças OFL.
- **handoff/** — instruções para implementação, paleta Adobe ASE e cores em JSON.
- **SEDNA-Identity-Overview.png** — apresentação resumida da identidade.

## Escolha do arquivo

| Composição | Uso |
| --- | --- |
| `horizontal` | Símbolo + nome. Assinatura principal. |
| `horizontal-tagline` | Símbolo + nome + Explore the Unseen. |
| `stacked` | Assinatura vertical com tagline. |
| `wordmark` | Apenas SEDNA. |
| `wordmark-tagline` | Nome + tagline. |
| `symbol` | Símbolo completo. |
| `symbol-micro` | Símbolo simplificado para 16–24 px, sem ponto de referência interno. |

| Sufixo | Uso |
| --- | --- |
| `on-dark` | Letras claras e ponto vermelho, para fundo escuro. |
| `on-light` | Letras escuras e ponto vermelho, para fundo claro. |
| `white` | Uma cor, branco puro. |
| `black` | Uma cor, preto puro. |
| `red` | Uma cor, vermelho Sedna. |

O fundo dos logos é transparente. O sufixo descreve a superfície recomendada. As peças em `applications/` já possuem fundo.

## Illustrator e Photoshop

**Illustrator:** abra qualquer SVG. O símbolo e todas as letras são curvas editáveis, sem imagens raster ou fontes externas. Desagrupe para editar os elementos. Salve uma cópia em AI se precisar do formato nativo. O PDF de matrizes também pode ser aberto por página.

**Photoshop:** insira o SVG como objeto inteligente ou use os PNGs transparentes. Abra o SVG no Illustrator para editar pontos e curvas. Os PNGs não contêm camadas de edição.

**Paleta:** importe `handoff/SEDNA-Palette.ase` no painel de amostras. Os arquivos são RGB. A conversão para impressão depende do perfil ICC escolhido com a gráfica.

**Fontes:** a instalação dos TTF só é necessária para compor novos textos. Os logos e os PDFs mantêm sua aparência sem instalação. As fontes incluídas são os subconjuntos Latin do projeto, adequados a português e inglês. Consulte as licenças para redistribuição.

## Recomendações de uso

- Preserve o ângulo, as proporções e o espaçamento do arquivo original.
- Deixe ao redor da marca pelo menos dois diâmetros do ponto vermelho, medidos na escala utilizada.
- Para logos pequenos, elimine a tagline usando a composição fornecida.
- Use o símbolo micro em 16–24 px. A partir de 32 px, use o símbolo completo.
- A versão clara é uma aplicação de comunicação e papelaria. O produto continua com a interface Void.
- Na interface, separe o vermelho da marca dos estados de erro e das cores que representam dados.
- Grafismos de marca pertencem às peças de comunicação. A área de observação astronômica preserva os dados reais.
- A tagline mantém exatamente a grafia **Explore the Unseen.**

## Fontes históricas

- NASA / Caltech, [Sedna Discovery Image — PIA05568](https://science.nasa.gov/photojournal/sedna-discovery-image/).
- Caltech, [Most distant object in solar system discovered](https://www.caltech.edu/about/news/most-distant-object-solar-system-discovered-could-be-part-never-seen-oort-cloud-814).
- Brown, Trujillo e Rabinowitz, [Discovery of a Candidate Inner Oort Cloud Planetoid](https://authors.library.caltech.edu/records/m50z2-rd109).

As fontes embasam a história. A geometria e as composições deste kit são propostas visuais para o SEDNA. O pacote foi preparado fora da aplicação para entrega a quem cuida da implementação.
