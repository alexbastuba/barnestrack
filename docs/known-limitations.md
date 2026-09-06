# Known limitations

Three sections: defects (bugs or gaps found and not yet fixed), excluded scope (deliberately not
built), and findings about the sample data (properties of the inputs that the tool handles by
design rather than defects of the tool). Appended whenever a limitation is discovered, in the same
session it is found (D39).

## Defects

- **A merged animal is positioned, but only as a union.** When the animal straddles a hole (dark
  in the background, so there is no difference signal under the body) or hangs over the rim where
  the rim's shadow line cuts the difference image, the foreground is two pieces; since D48 the
  pieces are merged into one `low_confidence / fragmented` candidate when their centroids lie within
  `fragmentMergeDistance_cm` (8 cm) of each other and the union satisfies the single-blob area
  bounds. This is 8.7 % of test50's frames and 8.4 % of test53's (483 and 76 frames; 14 in test51),
  concentrated at holes. What remains: the union centroid is the area-weighted centroid of the
  visible pieces, so with the head in a hole it sits on the visible body, not the true body centre;
  the nose is available on only 53 % / 66 % / 21 % of fragmented frames (test50 / test53 / test51),
  and the union's bounding box spans the hole. Two pieces farther apart than the merge distance are
  still `ambiguous / multiple_blobs` (only the start cylinder's two crescents, 8.9 cm apart, in the
  sample videos).
- **The nose is often unavailable, and a tail-only nose never clears O16.** The tail cue exists on
  71 % / 78 % / 54 % of frames with a blob (test51 / test53 / test50) and no cue at all on 23 % /
  21 % / 32 %: the re-encoded tail is frequently below the foreground threshold along its whole
  length, and a hunched, nearly round body has no defined major axis. Where only the tail cue exists
  the heading confidence is 0.5, below O16's 0.6 cutoff, so events would fall back to the centroid on
  nearly every hole visit (the animal is stationary there, so the velocity cue is unavailable by
  design). Measured in `prototypes/tracker/RESULTS.md`; the nose ships as experimental (D18).
- **Velocity and tail cues can disagree on the left rim of test50.** With the moving threshold at
  8 cm/s the two cues still name opposite ends in 10 % of test50's frames that have both (68 of 679),
  mostly with the animal hanging over the left rim, where the grey wall lets part of the animal's
  shadow beyond the edge be attributed as "tail". Not resolved; such frames carry heading confidence
  0.0 and the nose is not trusted.
- **The background contamination check cannot see everything.** A stationary animal that touches the
  rim zone is skipped (indistinguishable from the dark surround inside the mask margin), and one
  smaller than a hole is not flagged (the elongation rule requires at least hole-sized area, because
  holes near the far platform edge are seen obliquely as small crescents). A baked-in animal of at
  least hole size away from the rim is flagged (unit-tested); on the sample videos there was nothing
  to flag.

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
- **No experimenter's hand, and the start cylinder is two crescents.** No hand appears inside the
  platform mask in any clip: test53's animal simply appears at the right rim at frame 150 (the
  platform is empty for frames 0–149), and test51's start cylinder is lifted between frames 74 and 76
  without a visible hand. The `oversized_blob` rule is therefore exercised only by the synthetic-hand
  tests. The cylinder itself (frames 0–74 of test51) thresholds as two crescents of ≈ 900 and 700 px²
  8.9 cm apart, so those frames are `ambiguous / multiple_blobs` (never `tracked`), not
  `oversized_blob`; as one blob its difference image (≈ 2000 px²) would be only 3.3–3.7 × the body
  area, so the × 3 oversized factor has little margin. The robust way to exclude the start is the
  trial-start marker (O5), not the blob rule.
- **The tail after re-encoding.** The tail is visible to the eye in nearly every frame but its
  difference from the background is often below the Otsu threshold (43–51) along most of its
  length, and its base is frequently the first part to drop out, leaving a detached thin piece
  beside the body. The tracker attaches such pieces to the one body within two opening radii when
  they are elongated (a compact shadow next to the body is not a tail) and still gets no tail cue on
  22–32 % of frames. The tail is thin enough that the 0.8 cm opening removes it wherever it is
  above threshold, so the centroid is unaffected.
- **Holes near the far platform edge are crescents.** The camera is not exactly overhead: the five
  or six holes on the platform's left (test50, test53) or right (test51) edge appear as crescents
  0.3–0.7 × the area of a face-on hole with elongation 1.8–2.5. The contamination check ignores
  them; a parametric hole ring (D10) still fits their centres.
- **test51's lighter surround needed no fallback.** With the median background the surround cancels
  and Otsu lands at 48 (test50 51, test53 43); the 1.5 cm mask margin was not tightened and no
  adaptive threshold was used. The animal's shadow on the grey wall when it hangs over the left rim of
  test50 is the one place the surround matters (see Defects).
- **The animals are nearly stationary most of the time.** Median centroid speed 1.8 / 1.8 / 3.3 cm/s
  (test51 / test53 / test50); only 82 / 98 / 1354 frames exceed 8 cm/s. Below walking speed the
  centroid's direction of motion is jitter (the head dipping into a hole shifts the blob), which is
  why the velocity cue for the nose applies only from 8 cm/s.
