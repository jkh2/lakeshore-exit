# Credits

Lakeshore Exit is copyright © 2026 James Keith Harwood II. All rights reserved; see `LICENSE`.

## James Keith Harwood

| Content                                       | Notes                                                         |
| --------------------------------------------- | ------------------------------------------------------------- |
| Key art (`docs/key-art.jpg`, `public/og.jpg`) | James Keith Harwood.                                          |
| Cabin music (`public/audio/cabin.mp3`)        | James Keith Harwood, made with Suno; used under Suno's terms. |

## Third-party assets and code

| Asset                                                                   | Source                                                                              | License   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------- |
| `public/textures/waternormals.jpg`                                      | [three.js examples](https://github.com/mrdoob/three.js/tree/r170/examples/textures) | MIT       |
| Sky model (`three/examples/jsm/objects/Sky.js`)                         | [three.js](https://github.com/mrdoob/three.js)                                      | MIT       |
| Libraries in the game bundle (three.js, React, lucide-react and others) | npm                                                                                 | MIT / ISC |

`npm run build:web` writes `THIRD-PARTY-NOTICES.txt` into `dist-web/` with the name, version and full license text of every package in the game bundle (`scripts/third-party-notices.mjs`). The game's menu links to it.

Everything else (city ground, clouds, buildings, aircraft, canopy, sound effects) is generated in code.
