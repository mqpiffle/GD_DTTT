# Third-party material

## Item Assistant for Grim Dawn (iagd) — MIT

`labels.json` is generated from `StatTranslator/EnglishLanguage.cs` in
[marius00/iagd](https://github.com/marius00/iagd), which is MIT licensed. The port is
done by `scripts/port-labels.mjs`; it reads the literal entries and reproduces the
resistance families that file builds programmatically in its constructor.

MIT requires the copyright notice to travel with the work, so iagd's notice is
reproduced here in full, as published at
<https://github.com/marius00/iagd/blob/master/LICENSE>:

```
MIT License

Copyright (c) 2019 marius00

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

`src/lib/gdc.mjs` is a second port from the same repository: the save-file cipher from
`Parser/Stash/GDCryptoDataBuffer.cs` and the character block layout from
`Parser/Character/*.cs`. Same licence, same notice, reproduced above.

`labels.json` is regenerated, never hand-edited. Corrections and additions belong in
`labels.extra.json`, which is merged over the port and is original work.

## Grim Dawn — Crate Entertainment LLC

Not third-party *software*, but the reason for the data policy below.

The derived data in this repository (`ui-index.json`, `keywords.json`) contains
constellation names, star names, celestial power names and stat values from Grim Dawn.
Those remain the property of Crate Entertainment. They are included because a planner
cannot function without them, in the same way a wiki or a build calculator cannot.

What is deliberately **not** committed is `devotions.raw.json` — the verbatim extract
of Crate's DBR records. Crate's stated position distinguishes shipping core game
databases copied out of an installation, which is not permitted, from your own derived
records built with their toolset, which is. The raw dump is the former; the purpose-built
index is the latter. Anyone who wants the raw file regenerates it from their own legally
owned installation with `scripts/extract.mjs`.

This project is unofficial and is not affiliated with, endorsed by, or supported by
Crate Entertainment.
