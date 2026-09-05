# Frame server — measured results (chunk 1)

How the sample-table frame identity, the sequential decoder, the tracking-pass worker and the
random-access frame source behave on the three sample videos. Everything below was measured on
2026-09-05 with the evidence page in this folder, driven by `tests/browser/frame-server.spec.ts`
in **Google Chrome 152.0.7977.76** (headed, `channel: 'chrome'`) on a **MacBook Pro, Apple M1 Pro,
32 GB, macOS 15.5**. The sample videos live in the public sample-data repository
(`../rse-takehome-2026/data/barnes-maze/`); nothing from them is committed here.

Reproduce:

```
BARNESTRACK_SAMPLE_DIR=/path/to/data/barnes-maze BARNESTRACK_HEADED=1 npx playwright test --grep sample
BARNESTRACK_FRAME_SERVER_OPTIONS=hardware      … # allow hardware decoding (no-preference)
BARNESTRACK_FRAME_SERVER_OPTIONS=decode_order  … # plain tie-break, expected to fail
```

Each run writes `test-results/frame-server/<name>[.<options>].json` (gitignored). The Vitest side
(`BARNESTRACK_SAMPLE_DIR=… npx vitest run`) checks the same index against the ffprobe fixtures in
`tests/fixtures/` without a browser.

## Index (sample table)

| file   | frames | timescale | nominal fps | edit offset (ticks) | duration (s) | keyframes | duplicate-timestamp pairs | dropped-frame gaps | drift (s) | parse (ms) | SHA-256 (ms) |
| ------ | -----: | --------: | ----------: | ------------------: | -----------: | --------: | ------------------------: | -----------------: | --------: | ---------: | -----------: |
| test50 |   5539 |     15360 |     30.0000 |                1024 |     185.0667 |       370 |                       162 |                214 |   +0.4333 |         32 |           64 |
| test51 |    741 |     15000 |     14.9850 |                2002 |      49.3827 |        50 |                        17 |                 23 |   −0.0667 |         26 |           16 |
| test53 |    905 |     15360 |     30.0000 |                1024 |      30.2333 |        61 |                        25 |                 34 |   +0.0667 |         14 |           17 |

All three: `avc1.640020`, 640×480, keyframe every 15 frames (all IDR), B-pyramid (decode order ≠
presentation order, up to 8 positions apart), tie-break rule applied: `poc` (no warnings).

Per-frame `t_s` against the ffprobe fixture after rebasing both to start at 0: max |error|
0.438 µs (test50), 0.333 µs (test51), 0.438 µs (test53) — within the 1 µs criterion; the residual
is ffprobe's 6-decimal printing.

## Sequential pass (worker, all frames in decode order, luma copied per frame)

Default configuration: `hardwareAcceleration: 'prefer-software'`, `optimizeForLatency: false`,
four luma readbacks in flight, decode queue capped at 8.

| file   | outputs | order check                     | elapsed (s) |     fps | peak JS heap (MB) | peak renderer RSS (MB) | peak GPU-process RSS (MB) |
| ------ | ------: | ------------------------------- | ----------: | ------: | ----------------: | ---------------------: | ------------------------: |
| test50 |    5539 | strictly monotone, no repeats   |       14.77 |   375.1 |              15.2 |                    214 |                       130 |
| test51 |     741 | strictly monotone, no repeats   |        0.82 |   908.5 |               8.0 |                    216 |                       128 |
| test53 |     905 | strictly monotone, no repeats   |        1.18 |   770.5 |               9.1 |                    217 |                       130 |

Notes on the numbers:

- The order check is asserted on every output (`presIndex === expected`, derived from the
  synthetic timestamp); the pass rejects at the first violation. All three files pass with the
  POC tie-break, so the 162 / 17 / 25 tied-timestamp pairs survive decoding as distinct frames.
- fps varies with what else the machine is doing: a second software run of test50 earlier in the
  session gave 469 fps (11.8 s). Both are above the 300 fps criterion.
- JS heap is `performance.memory.usedJSHeapSize` sampled on the main thread every 100 ms (it is
  not exposed inside workers; decoded frames live outside the JS heap anyway). Process RSS is the
  peak of Chrome's renderer and GPU processes sampled with `ps` every 250 ms during the whole
  test, including the page itself; Chrome's idle baseline on this machine is about 190–200 MB for
  the renderer and 115–130 MB for the GPU process, so the pass itself adds roughly 15–25 MB.

### Hardware decoding allowed (`hardwareAcceleration: 'no-preference'`)

| file   | outputs | elapsed (s) |   fps | peak renderer RSS (MB) | random-access median seek (ms) |
| ------ | ------: | ----------: | ----: | ---------------------: | -----------------------------: |
| test50 |    5539 |       21.38 | 259.1 |                    221 |                            8.0 |
| test51 |     741 |        1.63 | 455.8 |                    202 |                            8.6 |
| test53 |     905 |        2.32 | 390.0 |                    203 |                            8.0 |

With hardware decoding the bottleneck is reading each decoded frame back into CPU memory
(`VideoFrame.copyTo` on a GPU-backed frame), not decoding: test50 stays below 300 fps
(259–283 fps across runs, 270 fps before the readbacks were overlapped). Software decoding needs no
readback and is 1.5–2× faster here, which is why it is the default (see "Fallback ladder").

## Random access (main thread `FrameSource.getGray`, 30 frames per file)

Frames: 20 uniform, both members of three duplicate-timestamp pairs (6 members), first, last, one
keyframe, the frame before a keyframe; visited in a fixed shuffled order so every seek decodes a
window (no cache hits). The hash is 32-bit FNV-1a over the luma plane.

| file   | hash = sequential | duplicate-timestamp members checked | median seek (ms) | max seek (ms) |
| ------ | ----------------: | ----------------------------------: | ---------------: | ------------: |
| test50 |             30/30 |                                   6 |              5.9 |          16.0 |
| test51 |             30/30 |                                   6 |              4.9 |           8.0 |
| test53 |             30/30 |                                   6 |              4.7 |           7.5 |

The tied pairs of test50 that were checked, with their hashes (sequential = random access):
frames 1048/1049 at t_s 35.033333 s (`45753759` / `e52fc354`), 2832/2833 at 94.633333 s
(`d0f86ada` / `9d17aed8`), 4604/4605 at 153.833333 s (`b36b9d93` / `5799c49e`). The two members of
each pair are different pictures and each is retrieved as itself.

Each seek decodes from the last keyframe through the end of its 15-frame group (bounded by a
30-frame lookahead), so a 15-frame window costs about 5–8 ms; a later request inside the same
group is a cache hit (the LRU holds 90 ImageBitmaps). The first seek after opening a file pays for
decoder creation (16–22 ms).

## Eyeballed frames

Frames 0, 450 and 904 of test53, 0, 120 and 400 of test51, and 2000, 2832, 2833 of test50 were
drawn to the page's canvas and inspected. Content is as expected (test53 starts with an empty
platform; test51 starts with the start cylinder on the platform; the tied pair 2832/2833 shows the
mouse at the same bottom hole in two slightly different poses). The re-encoded clips are visibly
soft, with smoothed texture and no blocking; the mouse remains a well-separated dark blob. Recorded
in `docs/known-limitations.md` under "Findings about the sample data".

## Fallback ladder

The correctness criteria passed with the POC tie-break, so the ladder was not needed for them.
Steps were still run to record their effect, all on test50:

1. **Plain tie-break (timestamp, then decode order)** — the rule the chunk prompt specified:
   `DecodeOrderError: decoder output out of order: expected frame 174, got 175`, at the first
   tied pair whose picture order count differs from decode order. This is the behaviour the
   `ffmpeg -bsf:v trace_headers` measurement predicted (68 / 7 / 5 such pairs in test50 / test51 /
   test53). Resolution: order ties by POC read from each sample's first slice header
   (`src/video/h264-poc.ts`), which makes table order equal decoder output order. Not the ladder's
   "+1 µs per tie" step: that changes timestamps, not the order the decoder emits pictures in.
2. **`optimizeForLatency: true`** — no measurable change (270.6 vs 269.8 fps, hardware allowed,
   before the readback overlap).
3. **Readback overlap** (four `copyTo` calls in flight, delivery still in order) — hardware-allowed
   test50 270 → 283 fps; also bounded the number of open frames, which cut the software path's
   peak renderer RSS from about 400 MB to about 215–240 MB.
4. **`hardwareAcceleration: 'prefer-software'`** — test50 375–469 fps, test51 909–939 fps,
   test53 771–776 fps. Adopted as the default for the tracking pass and the frame source, with an
   automatic fallback to `no-preference` if a browser rejects the hint. The frame source is faster
   too (median seek 4.7–5.9 ms vs 8.0–8.6 ms).

## Re-run after the review fixes (commit 1e2c51a)

The reviewer's findings changed the decoder's cancel path, the frame source's open-GOP window and
the luma format check, so the full Playwright suite was run again at that commit (same machine,
same Chrome): every verdict unchanged. Sequential 5539 / 741 / 905 frames at 464.8 / 837.5 /
766.3 fps, main-thread JS heap 16.8 / 8.1 / 9.2 MB, renderer RSS 234 / 227 / 217 MB; random
access 30/30 on each file with 6 duplicate-timestamp members, median seek 4.8 / 4.9 / 4.7 ms;
t_s max |error| 0.438 / 0.333 / 0.438 µs; the index reports no warnings. Cancelling the pass at
frames 2, 15, 400 and 730–739 of test51 (the last of these while the final flush is in progress)
resolves `status: 'cancelled'` with the frames delivered so far, where the pre-fix code rejected
with `AbortError` in the flush window.

## Verdicts against the acceptance criteria (§8 of the chunk prompt)

| criterion                                                                 | test50 | test51 | test53 |
| ------------------------------------------------------------------------- | :----: | :----: | :----: |
| sequential output count = 5539 / 741 / 905, strictly monotone, no repeats |  PASS  |  PASS  |  PASS  |
| per-frame t_s matches the ffprobe fixture within 1 µs                     |  PASS  |  PASS  |  PASS  |
| random-access hash = sequential hash for 30/30 incl. ≥ 5 duplicate members |  PASS  |  PASS  |  PASS  |
| sequential decode ≥ 300 fps (default configuration)                       |  PASS  |  PASS  |  PASS  |
| peak memory < 300 MB (JS heap; renderer RSS incl. Chrome baseline)        |  PASS  |  PASS  |  PASS  |
| median seek latency recorded                                              | 5.9 ms | 4.9 ms | 4.7 ms |
