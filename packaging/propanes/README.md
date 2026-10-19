# SolidCraft web + ProPanes widget

This fork embeds the [ProPanes](https://github.com/tinkerer/propanes) feedback
widget in the web app (`apps/solidcraft-web/index.html`). The widget is loaded
same-origin from `/propanes/widget/propanes.js` and posts to
`/propanes/api/v1/feedback`, so whatever serves `dist/web` must also proxy
`/propanes/` to a ProPanes server.

`serve.mjs` does both (static site + reverse proxy, WebSockets included) with no
dependencies, and `solidcraft-web.service` runs it under systemd. The hosted
instance is `https://propanes-vm-sc.myworkbench.ai` (VM port 3088, ProPanes on
the same VM at :3001).

Build and run:

```sh
cd apps/solidcraft-web && trunk build --release --public-url ./ && cd ../..
PORT=3088 node packaging/propanes/serve.mjs
```

The app key in the script tag identifies the "SolidCraft" application in that
ProPanes instance; change `data-app-key` to point the widget elsewhere.
