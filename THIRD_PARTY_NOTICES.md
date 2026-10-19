# Third-party notices

`hooks/cells.ts` adapts parts of the [plan-progress](https://github.com/zycck/claude-mods) mod: its dotted
braille track drawing, its state colours and its character-width checks. That code is used under the MIT license:

```
MIT License

Copyright (c) 2026 Kirill Serditov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`skills/self-evaluation/SKILL.md` adapts the `agent-self-evaluation` skill of [ECC](https://github.com/affaan-m/ecc):
its five axes, scoring scale, evidence rule, worked example and anti-patterns. That text is used under the MIT
license:

```
MIT License

Copyright (c) 2026 Affaan Mustafa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled with the live page (`web/vendor/`)

The live page runs on libraries that are bundled and served from this repository, not loaded from a network:
React 19.3.0 and React DOM 19.3.0, HeroUI 3.2.6 (`@heroui/react`, `@heroui/styles`), Bot Avatars 0.2.2, border-beam
1.4.1, thinking-orbs 0.3.2, liquid-gooey 0.2.2 and three.js 0.186.1 (all MIT), and htm 3.1.1 (Apache-2.0). Their licence
texts are in `web/vendor/LICENSES.txt`. The fonts Bricolage Grotesque, Doto, Space Grotesk and JetBrains Mono
(Fontsource 5.3.0 builds, SIL Open Font License 1.1) are in `web/vendor/`, with their licence texts in
`web/vendor/OFL.txt`. `node web/build-vendor.mjs` rebuilds the bundles from these exact versions.

