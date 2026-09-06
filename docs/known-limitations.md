# Known limitations

Three sections: defects (bugs or gaps found and not yet fixed), excluded scope (deliberately not
built), and findings about the sample data (properties of the inputs that the tool handles by
design rather than defects of the tool). Appended whenever a limitation is discovered, in the same
session it is found (D39).

## Defects

- **The maze click count is not in the session file.** The "Maze step: N clicks on the image" badge
  is the on-screen evidence for the D29 click budget, but `SessionFile` has no field for it (D47
  did not add one), so it lives only in the browser's autosave record. It therefore survives a
  reload and is restored with the session, but a session file saved, reset and loaded again comes
  back with the badge at zero. The maze itself is unaffected.
- **A fitted transform can carry floating-point rotation noise.** "Adjust" and "Apply from" fit a
  similarity from circle correspondences, whose true rotation is exactly zero; the least-squares
  fit returns values around 1e-15 degrees instead. Nothing measurable depends on it and no
  threshold was invented to round it away, but it is visible in a saved session file's
  `mazeTransform.rotationDeg`.
- **A reload inside the autosave window can lose the last edit.** Changes are written to IndexedDB
  about half a second after the last one, and the page also asks the store to flush on `pagehide`.
  That flush cannot be awaited — the browser may discard an IndexedDB transaction opened while the
  page is going away — so a reload in the moment after an edit can lose it. The header says
  "Saving…" until the write lands, and "All changes saved in this browser" once it has; wait for
  that before reloading. A fix would write synchronously on `visibilitychange` to a store that
  supports it.
- **One autosave slot per browser, not per session.** The IndexedDB record is stored under a single
  `current` key, so two BarnesTrack tabs open at once overwrite each other's autosave without
  noticing: the last tab to make a change wins, and the other tab's cohort is gone after its next
  reload. D27 speaks of autosave "keyed by video fingerprint"; this build has one slot. Until it is
  fixed, work in one tab at a time, and use Save session file before opening a second. A fix would
  refuse to overwrite a record saved after the one this tab loaded, and say so.

## Excluded scope

- **Input format.** MP4 with H.264 (AVC) video only (D4, O13). Other containers/codecs are listed
  in the UI with the reason, never silently dropped, and with a re-encode hint:

  ```
  ffmpeg -i in.avi -c:v libx264 -pix_fmt yuv420p -g 15 -bf 0 out.mp4
  ```

- **H.264 features outside the sample videos.** Only 8-bit 4:2:0 H.264 is accepted: the High 10,
  High 4:2:2 and High 4:4:4 Predictive profiles are rejected at intake with a re-encode hint
  (`-pix_fmt yuv420p`), and a decoder that still hands back a 10/12-bit frame stops the pass with
  an "unsupported decoded pixel format" error rather than reading two-byte samples as bytes.
  Frame identity orders same-timestamp frames by the bitstream's picture order count (POC type 0,
  frame pictures; see below). Streams using POC type 1 or field (interlaced) coding fall back to
  ordering ties by decode order, and the index records a warning saying so; a
  `memory_management_control_operation` 5 (a POC reset without an IDR, which x264 never emits) is
  not detected and would only affect the order within a tied pair. In an open-GOP stream (a non-IDR
  keyframe whose leading pictures reference the previous group) the scrubber cannot reach those
  leading pictures from their keyframe: it reports "frame N was not produced by the decoder" for
  them and decodes the rest of the group normally; it never substitutes a neighbouring frame.

- **No perspective correction.** The platform is fitted as a circle in image pixels. A camera that
  is not directly overhead images the platform as an ellipse, and a circle fit then splits the
  difference between the long and short axes; `px_per_cm` is a single number for the whole
  platform, so distances near the far rim are slightly under-measured and near the close rim
  slightly over-measured. Correcting this needs a homography from four rim points and a
  ground-plane assumption, which is a larger change to the maze map contract than this tool needs
  for the sample data (see the test51 note below).

- **No automated tests of the DOM layer.** `src/maze/` and `src/session/` are pure and unit-tested
  in Node; `src/ui/` is DOM- and canvas-bound, and the project has no DOM test environment (D3
  keeps the dependency list short). The UI is covered by TypeScript, by the browser checks in
  `tests/browser/app.spec.ts`, and by a recorded manual pass in Google Chrome. Adding jsdom or a
  component-test runner is deliberately not done.

- **The video is never stored, only its fingerprint.** After a reload a video is present but "not
  attached" until the same file is dropped again (D27). BarnesTrack could keep the file in
  IndexedDB and re-open it automatically, but that would put copies of a lab's video data in the
  browser profile without the user asking, so it is not done.

## Findings about the sample data

- **Frame timing anomalies.** All three sample videos contain duplicate presentation timestamps
  (162 / 17 / 25 tied pairs in test50 / test51 / test53) and dropped-frame gaps (214 / 23 / 34 gaps
  longer than 1.5 × the nominal frame interval) in their MP4 sample tables; test50 runs 0.433 s
  longer than `frame ÷ fps` by its end. Per-frame time is always taken from the file's own sample
  table (composition time minus edit-list offset, over the track timescale); nominal frame-rate
  arithmetic is never used for timing. See D7, O11.
- **Tied timestamps are not in decode order.** Within the tied pairs, the decoder emits the two
  frames in the bitstream's picture-order-count (POC) order, which differs from their order in the
  sample table for 68 / 7 / 5 pairs (test50 / test51 / test53, measured with `ffmpeg -bsf:v
  trace_headers`). BarnesTrack therefore orders ties by POC, read from each sample's first slice
  header (D45), so that "frame N" means the same picture in the sequential tracking pass, in the
  scrubber, and in ffprobe's output order. A plain sort by timestamp then decode order makes the
  decoder's output non-monotone at the first such pair (frame 174/175 of test50), which the
  prototype demonstrates on request (`prototypes/frame-server/RESULTS.md`).
- **Reduced visual quality.** The sample clips were re-encoded from the originals at lower quality:
  decoded frames show soft edges and smoothed texture (no blocking), and the mouse remains a
  well-separated dark blob on the white platform. Noted as a property of the inputs; whether it
  limits nose detection is measured in the tracker chunk.
- **test50 and test53 share a rig and a framing; test51 does not.** Fitted in Chrome from three rim
  clicks each: test53 and test50 both give a platform at (327.8, 239.7) px with radius 208.5 px, so
  a maze map made on one applies to the other with no adjustment at all. test51's platform is
  larger and left of centre — (280.0, 239.9) px, radius 222.5 px — giving 4.838 px/cm against
  4.533 px/cm for the other two, so its map needs the three-click "Adjust". This is why the maze
  map is shared but the placement is stored per video (D10, D28).
- **test51's platform is not quite circular in frame.** Its rim measures about 15 % wider than it
  is tall in the image, so the camera is not directly overhead. The circle fit splits the
  difference and the generated hole ring sits a few pixels inside the real holes on the near side.
  Individual holes can be nudged where it matters; no perspective correction is applied (see
  "Excluded scope").
- **The nominal frame rate and the per-frame timestamps disagree, by design.** The video card shows
  the file's nominal frame rate for orientation; the scrubber shows each frame's own timestamp from
  the sample table. On these clips the two drift apart by up to 0.43 s by the end of the video, so
  the two numbers next to each other are not two readings of the same thing. Every measurement uses
  the timestamp (D7, O11).
- **test51 opens with the start cylinder on the platform.** Frame 0 shows the cylinder near the
  centre of the maze and no visible animal, which is what makes it the useful frame for marking the
  maze and the reason trial start is detected rather than assumed to be frame 0 (O5).
