# SEDNA · Identidade visual para implementação

Este pacote contém a proposta de identidade visual criada a pedido do Alan em 14.11.2026. A implementação da aplicação está sendo conduzida separadamente. Nenhum arquivo do produto foi alterado para produzir este kit.

## Comece por aqui

1. Veja `../SEDNA-Identity-Overview.png` e `../guide/SEDNA-Brand-Guide.pdf`.
2. Use os SVGs finais em `../logos/svg/`. Não redesenhe a marca com CSS e não reconstrua o nome digitando uma fonte com letter-spacing aproximado.
3. Copie apenas os arquivos efetivamente usados para o diretório de assets da aplicação.
4. Preserve a identidade Void e as fontes IBM Plex já existentes. O novo kit formaliza a marca orbital e suas aplicações.

## Arquivos recomendados

| Superfície | Asset | Regra |
| --- | --- | --- |
| Cabeçalho escuro | `sedna-horizontal-on-dark.svg` | Largura mínima de 180 px. |
| Cabeçalho com pouco espaço | `sedna-wordmark-on-dark.svg` | Largura mínima de 120 px. |
| Símbolo isolado | `sedna-symbol-on-dark.svg` | 32 px ou mais. |
| Favicon ou marca de 16–24 px | `sedna-symbol-micro-on-dark.svg` | Traço reforçado, sem ponto interno. |
| Abertura de apresentação | `sedna-horizontal-tagline-on-dark.svg` | 320 px ou mais. |
| Assinatura vertical | `sedna-stacked-on-dark.svg` | 280 px ou mais. |
| Nome com tagline | `sedna-wordmark-tagline-on-dark.svg` | 240 px ou mais. |
| Compartilhamento | `../applications/sedna-social-1200x630.png` | Imagem final em 1200 × 630. |
| Avatar | `../applications/sedna-avatar-dark.png` | 1024 × 1024, símbolo centralizado. |
| Ícones | `../applications/sedna-icon-*.png` e `sedna-favicon.ico` | Tamanhos específicos, sem texto. |

Os SVGs de logo são transparentes. Os PNGs de ícones e aplicações têm fundo.

## Cores

Preserve os tokens existentes do produto. Estes valores foram extraídos deles:

- `background` e `stage`: `#020305`
- `foreground`: `#ECEEF2`
- `primary`: `#C2462C`
- `primaryText`: `#E0694A`
- `muted`: `#7E8595`

Use `primaryText` para textos destacados sobre Void. O ponto vermelho da marca usa `primary`. A marca é uma assinatura estática, não um indicador de carregamento ou de detecção.

Os símbolos em marca d'água das capas são grafismos de comunicação. Não devem ser inseridos em imagens científicas ou usados como estrelas decorativas na ferramenta.

## Tipografia

- IBM Plex Sans 300, 400, 500 e 600 para textos.
- IBM Plex Mono 400 e 500 para datas, coordenadas e valores.
- As letras dos logos já estão em curvas. Não dependem das fontes instaladas.
- O subconjunto Latin incluído atende português e inglês. Mantenha as licenças ao redistribuir fontes.

## Acessibilidade e comportamento

- Usar `alt="SEDNA"` no logo. Quando o nome já estiver presente no mesmo link, tratar o símbolo como decorativo para não duplicar a leitura.
- SVGs possuem viewBox e tamanho intrínseco. Preserve a proporção, forneça dimensões e evite saltos no carregamento.
- O ícone micro foi desenhado especificamente para redução. Não force o símbolo completo a 16 px.
- Não animar a marca continuamente dentro do visualizador. A atenção deve ficar na comparação entre observações.
- O kit não altera cores de mapas científicos, flags, catálogos, a escala dos quadros ou a reprodução entre épocas.

## Texto

Nome: **SEDNA**

Tagline: **Explore the Unseen.**

Descrição breve sugerida: **Explore how astronomical objects change over time.**

A narrativa histórica remete à identificação de Sedna pelo deslocamento em três imagens de 14.11.2003. A geometria do logo é simbólica, sem escala física. A marca não promete confirmar a existência ou descobrir o Planeta Nove.

## Verificação após integrar

Conferir o logo em cabeçalho desktop e mobile, avatar circular, favicon a 16 e 32 px e prévia de compartilhamento. Verificar que o nome não foi deformado, que a tagline não ficou pequena demais e que o logo não se sobrepõe aos dados astronômicos. Os cenários claros deste kit não solicitam um novo tema para o aplicativo.
