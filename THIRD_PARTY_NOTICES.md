# Third-party notices

BarnesTrack is MIT licensed (`LICENSE`). This file lists third-party code and patterns it depends
on or is derived from (D38).

## talmolab/vibes

- **What:** Patterns re-implemented in TypeScript, with a header comment naming the source tool in
  each file that borrows from it. No file is copied wholesale. Every borrowing below is checkable
  with `grep -rn "Adapted from talmolab/vibes" src/`; nothing is claimed that no file carries a
  header for.
  - Borrowed, from `video-player`: the sample-table frame-identity model, keyframe-window decoding
    and `avcC` decoder configuration — `src/video/mp4-index.ts`, `src/video/sample-reader.ts`,
    `src/video/frame-source.ts`.
  - Borrowed, from `labelroi`: the two-layer canvas with its screen-to-video transform and
    device-pixel-ratio backing store — `src/ui/canvas-view.ts`, `src/maze/view-transform.ts`.
  - Borrowed, from `slp-viewer`: the worker-side demux/decode core — `src/video/track-worker.ts`,
    `src/video/decoder.ts`, `src/video/mp4-index.ts`.
  - Borrowed, from `event-annotator`: the row model and the paint-style editing operations —
    `src/session/corrections.ts`, `src/ui/timeline-model.ts`, `src/ui/timeline.ts`,
    `src/ui/review-step.ts`.
  - Ideas only, no code: quality tiers (`quality-review-tool`), re-encode guidance
    (`encoding-helper`).
  - Not used: `webcam-pose-tracking`, `pose-subspace-analysis`, `salk-signature`.
- **Source:** https://github.com/talmolab/vibes, commit `d9410fa`.
- **Licence:** BSD 3-Clause.

```
BSD 3-Clause License

Copyright (c) 2025, Talmo Lab at the Salk Institute

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## mp4box.js

- **What:** MP4 demuxing (sample table, `avcC` decoder configuration) used at runtime.
- **Source:** https://github.com/gpac/mp4box.js
- **Licence:** BSD 3-Clause.

```
Copyright (c) 2012. Telecom ParisTech/TSI/MM/GPAC Cyril Concolato
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the copyright holder nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## exceljs

- **What:** XLSX export writer used at runtime.
- **Source:** https://github.com/exceljs/exceljs
- **Licence:** MIT.

```
The MIT License (MIT)

Copyright (c) 2014-2019 Guyon Roche

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

## matplotlib

- **What:** Colour-map data, not code. `src/viz/colormap-tables.ts` holds 33 RGB anchor points for
  each of `viridis` and `cividis`, sampled at evenly spaced positions from matplotlib's own tables
  and rounded to 8 bits; the figures interpolate between those anchors. No matplotlib source is
  used, imported or shipped, and the anchors are the only thing taken.
- **Version sampled:** matplotlib 3.9.1, recorded in the header of `src/viz/colormap-tables.ts`.
- **Source:** https://github.com/matplotlib/matplotlib
- **Licence:** the Matplotlib licence (a BSD-compatible, PSF-derived licence). Its full text, and
  the separate notices matplotlib keeps for the colour-map data it distributes, are in the
  `LICENSE/` directory of the matplotlib repository at the version named above. That directory is
  the authority on the terms for these anchor values; this file names what was taken and from
  where rather than restating terms it cannot verify offline.
