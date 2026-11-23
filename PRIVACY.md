# Privacy Policy — Glaux

_Last updated: November 22, 2026_

**Glaux does not collect, transmit, sell or share any personal or usage data.**

- **Video frames** are processed entirely on your device's GPU (WebGL2). They are never stored, uploaded or sent anywhere.
- **Popup backdrop.** When you open the toolbar popup, Glaux takes snapshots of the visible tab (`tabs.captureVisibleTab`, about twice per second) and shows them blurred behind the popup, so the popup looks like frosted glass over the page. Capturing stops when the popup closes, and you can turn it off entirely with the *Transparent background* option, which gives the popup a solid color instead. The images exist only in the popup's memory while it is open. It is never saved or sent anywhere.
- **Settings** (on/off, sharpness, toggles, sites you disabled) are saved with `chrome.storage.sync`. If you have browser sync turned on, your browser syncs them to your own account. Glaux has no access to that sync service.
- **No network requests.** Glaux does not contact any server, does not use analytics or tracking, and does not load or run remote code.
- **Page access.** Glaux's content script runs on web pages only to find `<video>` elements and draw the enhanced picture over them. It does not read, store or transmit page content, browsing history, form data or anything else.

To delete all of Glaux's data, remove the extension.

Questions: open an issue on the project's GitHub repository.

---

# Política de Privacidade — Glaux

_Última atualização: 22 de novembro de 2026_

**O Glaux não coleta, transmite, vende nem compartilha nenhum dado pessoal ou de uso.**

- **Quadros de vídeo** são processados inteiramente na GPU do seu dispositivo (WebGL2). Eles nunca são armazenados, enviados ou transmitidos.
- **Fundo do popup.** Quando você abre o popup, o Glaux tira fotos da área visível da aba (`tabs.captureVisibleTab`, cerca de duas por segundo) e as mostra desfocadas atrás do popup, para ele parecer um vidro fosco sobre a página. A captura para quando o popup fecha, e você pode desligá-la de vez com a opção *Fundo transparente*, que deixa o popup com uma cor fixa. As imagens existem só na memória do popup enquanto ele está aberto. Ela nunca é salva nem enviada.
- **Configurações** (ligado/desligado, nitidez, opções, sites desativados) são salvas com `chrome.storage.sync`. Se a sincronização do navegador estiver ativa, o navegador as sincroniza com a sua própria conta. O Glaux não tem acesso a esse serviço de sincronização.
- **Nenhuma requisição de rede.** O Glaux não se conecta a nenhum servidor, não usa analytics nem rastreamento e não carrega nem executa código remoto.
- **Acesso às páginas.** O content script do Glaux roda nas páginas apenas para encontrar elementos `<video>` e desenhar a imagem melhorada por cima. Ele não lê, não armazena e não transmite o conteúdo da página, o histórico, dados de formulários nem qualquer outra coisa.

Para apagar todos os dados do Glaux, basta remover a extensão.

Dúvidas: abra uma issue no repositório do projeto no GitHub.
