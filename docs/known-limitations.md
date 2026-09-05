# Known limitations

Two sections: defects (bugs or gaps found and not yet fixed) and excluded scope (deliberately not
built). Appended whenever a limitation is discovered, in the same session it is found (D39).

## Defects

- **Frame timing anomalies in the sample videos.** All three sample videos contain duplicate
  presentation timestamps and dropped-frame gaps in their MP4 sample tables. Per-frame time is
  always taken from the file's own sample table (composition time minus edit-list offset, over the
  track timescale); nominal frame-rate arithmetic (`frame ÷ fps`) is never used for timing because
  it would drift by up to 0.43 s on the longest sample clip by its end. See D7, O11.

## Excluded scope

- **Input format.** MP4 with H.264 (AVC) video only (D4, O13). Other containers/codecs are listed
  in the UI with the reason, never silently dropped, and with a re-encode hint:

  ```
  ffmpeg -i in.avi -c:v libx264 -pix_fmt yuv420p -g 15 -bf 0 out.mp4
  ```
