# Known limitations

Three sections: defects (bugs or gaps found and not yet fixed), excluded scope (deliberately not
built), and findings about the sample data (properties of the inputs that the tool handles by
design rather than defects of the tool). Appended whenever a limitation is discovered, in the same
session it is found (D39).

## Defects

_None recorded yet._

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
