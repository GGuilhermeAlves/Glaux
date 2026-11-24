# Chrome Web Store — textos prontos para o cadastro

Copie e cole cada bloco no campo correspondente do [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
O nome e a descrição curta vêm automaticamente do `manifest.json` + `_locales`, em inglês e em português.

---

## 1. Store listing

**Category:** Tools (Ferramentas)
**Language:** English (padrão) + Português (Brasil)

### Imagens (pasta `store/images/`)

| Campo | Arquivo | Tamanho |
|---|---|---|
| Store icon | `extension/icons/icon128.png` | 128×128 |
| Screenshots (até 5) | `screenshot-s1/s2/s3-<idioma>.png` | 1280×800 |
| Small promo tile (obrigatório) | `promo-small-440x280-<idioma>.png` | 440×280 |
| Marquee promo tile (opcional) | `promo-marquee-1400x560-<idioma>.png` | 1400×560 |

> Recomendação: antes de publicar, substitua o vídeo de teste dos screenshots por capturas reais. Por exemplo, um vídeo seu em 360p ou 480p com a comparação aberta no meio. Use conteúdo que você tenha direito de mostrar, porque a loja pode recusar imagens com conteúdo de terceiros.

### Detailed description — English

```
Glaux makes web video look sharper, in real time, on your own GPU.

Most videos are streamed at a lower resolution than your screen, and the browser stretches them with a basic filter, so they look soft. Glaux replaces that step: every frame is upscaled to the exact pixel size of your player and then passed through contrast-adaptive sharpening. Detail and text get crisper, and the filter avoids halos and doesn't amplify compression noise.

✦ ONE CLICK, RIGHT IN THE PLAYER
• On YouTube, Glaux adds its buttons to the player's own control bar.
• On every other site, a frosted toggle appears centered at the top of the video when you hover it.
• It shows the live resolution, e.g. 480p → 1440p.

✦ SEE THE DIFFERENCE
• Drag the before/after line across the video. The original is on one side and Glaux on the other, live.

✦ TUNE IT YOUR WAY
• Sharpness slider with Soft / Balanced / Intense presets
• Compression guard, so grain and blocky artifacts aren't sharpened
• Auto-enhance every video, or turn it on only when you want it
• Turn it off on specific sites
• Max output resolution: 1080p, 1440p or 4K
• Shortcuts: Alt+Shift+R (on/off) and Alt+Shift+C (compare)

✦ WORKS ON
YouTube (including embedded videos), Twitch, Vimeo, news and course sites, and any HTML5 video player.

✦ PRIVATE AND LIGHTWEIGHT
• 100% local: frames never leave your device
• No account, no analytics, no remote code
• Open source

Note: DRM-protected services (Netflix, Prime Video, Disney+ and others) don't allow extensions to access their video pixels, so Glaux can't enhance them.
```

### Descrição detalhada — Português (Brasil)

```
O Glaux deixa os vídeos da web mais nítidos, em tempo real, usando a sua própria GPU.

A maioria dos vídeos é transmitida numa resolução menor que a da sua tela, e o navegador estica a imagem com um filtro básico, por isso ela fica "lavada". O Glaux substitui essa etapa: cada quadro é ampliado para o tamanho exato do player e passa por uma nitidez adaptativa por contraste. Detalhes e textos ficam mais definidos, e o filtro evita halos e não realça ruído de compressão.

✦ UM CLIQUE, DENTRO DO PLAYER
• No YouTube, o Glaux coloca seus botões na própria barra de controles do player.
• Em qualquer outro site, um botão fosco aparece centralizado no topo do vídeo quando você passa o mouse.
• Ele mostra a resolução ao vivo, ex.: 480p → 1440p.

✦ VEJA A DIFERENÇA
• Arraste a linha de comparação sobre o vídeo. O original fica de um lado e o Glaux do outro, ao vivo.

✦ DO SEU JEITO
• Controle de nitidez com predefinições Suave / Equilibrado / Intenso
• Proteção de compressão: não realça granulado nem blocos
• Melhorar todo vídeo automaticamente, ou só quando você quiser
• Desligar em sites específicos
• Saída máxima: 1080p, 1440p ou 4K
• Atalhos: Alt+Shift+R (liga/desliga) e Alt+Shift+C (comparar)

✦ FUNCIONA EM
YouTube (inclusive vídeos incorporados), Twitch, Vimeo, sites de notícia e cursos, e qualquer player de vídeo HTML5.

✦ PRIVADO E LEVE
• 100% local: os quadros nunca saem do seu dispositivo
• Sem conta, sem analytics, sem código remoto
• Código aberto

Observação: serviços com DRM (Netflix, Prime Video, Disney+ e outros) não permitem que extensões acessem os pixels do vídeo, então o Glaux não consegue melhorá-los.
```

---

## 2. Privacy practices (aba "Privacy")

**Single purpose description**
```
Glaux improves the visual clarity of HTML5 videos on web pages by upscaling and sharpening each frame locally with WebGL2, with in-player controls to turn it on/off and compare before/after.
```

**Permission justification — storage**
```
Used to save the user's settings (on/off, sharpness level, compression guard, auto-enhance, sites where the extension is disabled, maximum output resolution).
```

**Permission justification — activeTab**
```
Lets the toolbar popup query and control the video enhancement in the tab the user is currently viewing (show status, turn it on/off for that tab). When the user opens the popup, it also uses captureVisibleTab (about twice per second, only while the popup is open) to draw a blurred, live snapshot of the visible tab as the popup's frosted background. Images are kept only in memory and are never stored or transmitted.
```

**Host permission justification (content script on http/https/file pages)**
```
The extension's single purpose is to enhance any HTML5 video the user watches, on any website. The content script needs to run on all pages to detect <video> elements and draw the enhanced frames over them with WebGL. It does not read, collect or transmit page content.
```

**Are you using remote code?** → **No, I am not using remote code.**

**Data usage** → não marque nenhuma categoria de dado coletado. Marque as três certificações:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** → link do `PRIVACY.md` no seu GitHub, ex.: `https://github.com/GGuilhermeAlves/glaux/blob/main/PRIVACY.md`

---

## 3. Checklist de publicação

1. Confira o nome no `LICENSE` (hoje está `GGuilhermeAlves`).
2. Atualize o link "Chrome Web Store: coming soon" nos READMEs depois que a extensão for aprovada.
3. Rode `./scripts/pack.sh`, que gera `dist/glaux-1.0.1-chrome.zip` e `dist/glaux-1.0.1-firefox.zip`.
4. No Developer Dashboard (taxa única de cadastro de desenvolvedor), clique em **New item** e envie o `-chrome.zip`.
5. Preencha "Store listing" e "Privacy" com os textos acima e envie as imagens.
6. Em "Distribution", escolha Public e todos os países.
7. Envie para revisão. Extensões que rodam em todos os sites costumam passar por uma revisão mais detalhada, e as justificativas acima existem para isso.
8. Opcional: publique também na Microsoft Edge Add-ons e no Opera Add-ons, que aceitam o mesmo `-chrome.zip`.

### Para cada nova versão
- Aumente `"version"` em `extension/manifest.json`.
- Atualize o `CHANGELOG.md`.
- Rode `./scripts/pack.sh` e envie os novos zips em cada loja.

---

## 4. Firefox Add-ons (AMO)

1. Crie uma conta em <https://addons.mozilla.org/developers/>. É gratuito.
2. Clique em **Submit a New Add-on** → **On this site** e envie `dist/glaux-<versão>-firefox.zip`.
3. **Source code:** o Glaux não é minificado nem compilado, então responda **No** quando a loja perguntar se o código precisa de build.
4. Use os mesmos textos e imagens das seções acima. No AMO, a descrição aceita um pouco de Markdown.
5. **Data collection:** o manifest já declara `data_collection_permissions: { required: ["none"] }`, que é obrigatório para extensões novas no Firefox. Na tela de envio, confirme que a extensão não coleta dados.
6. **Categoria:** "Photos, Music & Videos".
7. Os IDs ficam definidos no manifest (`glaux@glaux-video`). Não mude esse ID depois de publicar, porque é por ele que o Firefox entrega as atualizações.
8. **Para testar antes:** em `about:debugging#/runtime/this-firefox`, clique em **Load Temporary Add-on…** e escolha o `manifest.json`.
