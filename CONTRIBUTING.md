# Contributing

Thanks for helping! Glaux has no build step, so contributing is quick.

1. Fork and clone the repo.
2. Load `extension/` unpacked (`chrome://extensions` → Developer mode → Load unpacked, or Firefox `about:debugging` → Load Temporary Add-on).
3. Make your change. After editing, reload the extension and the page.
4. Keep both browsers working: use `api.*` (never `chrome.*` directly) and promise-based calls.
5. New UI text goes in **both** `extension/_locales/en/messages.json` and `extension/_locales/pt_BR/messages.json`.
6. Open a pull request describing what changed and how you tested it (site + browser).

**Releasing** (maintainers): bump `version` in `extension/manifest.json`, update `CHANGELOG.md`, then push a tag `vX.Y.Z`. The *Release* workflow builds both zips and publishes the GitHub Release.

---

# Como contribuir

Obrigado pela ajuda! O Glaux não tem etapa de build, então contribuir é rápido.

1. Faça um fork e clone o repositório.
2. Carregue a pasta `extension/` sem compactação (`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação, ou `about:debugging` no Firefox → Carregar extensão temporária).
3. Faça sua alteração. Depois de editar, recarregue a extensão e a página.
4. Mantenha os dois navegadores funcionando: use `api.*` (nunca `chrome.*` direto) e chamadas com promises.
5. Todo texto novo de interface vai **nos dois** arquivos: `extension/_locales/en/messages.json` e `extension/_locales/pt_BR/messages.json`.
6. Abra um pull request explicando o que mudou e como você testou (site + navegador).

**Publicando uma versão** (mantenedores): aumente o `version` em `extension/manifest.json`, atualize o `CHANGELOG.md` e envie uma tag `vX.Y.Z`. O workflow *Release* gera os dois zips e publica a release no GitHub.
