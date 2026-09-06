/**
 * Dev-only harness: runs the tracker over a video with ffmpeg and writes the
 * evidence outputs. Usage:
 *
 *   npx tsx scripts/track-node.ts <video.mp4> --platform-diameter-cm 92 \
 *     [--platform cx,cy,r] [--out prototypes/tracker/out] [--extra t0-t1:n ...] [--contact 30] [--debug f1,f2,...]
 *
 * Without --platform the harness prints the estimated circle and exits with
 * status 2 (the circle is required; the estimate is a proposal to check).
 * `--extra -15-end:3` picks 3 frames from the last 15 s; `--extra 0-2:3` 3
 * frames from the first 2 s.
 */
import { summaryLines, trackVideo, type ExtraRange } from './tracker-node/run.js';

function usage(message?: string): never {
  if (message) console.error(`error: ${message}`);
  console.error(
    'usage: npx tsx scripts/track-node.ts <video.mp4> --platform-diameter-cm <cm> [--platform cx,cy,r] [--out dir] [--extra t0-t1:n] [--contact n] [--debug frames]',
  );
  process.exit(message ? 1 : 0);
}

function parseExtra(spec: string): ExtraRange {
  const m = /^(-?[\d.]+)-([\d.]+|end):(\d+)$/.exec(spec);
  if (!m)
    usage(
      `bad --extra "${spec}" (expected t0-t1:n, t1 may be "end", negative t0 counts from the end)`,
    );
  return {
    start_s: Number(m[1]),
    end_s: m[2] === 'end' ? 'end' : Number(m[2]),
    count: Number(m[3]),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let video: string | undefined;
  let diameter: number | undefined;
  let platform: { cx: number; cy: number; r: number } | undefined;
  let out = 'prototypes/tracker/out';
  let contact = 30;
  const extras: ExtraRange[] = [];
  const debugFrames: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = () => {
      const v = args[++i];
      if (v === undefined) usage(`${a} needs a value`);
      return v;
    };
    if (a === '--platform-diameter-cm') diameter = Number(next());
    else if (a === '--platform') {
      const parts = next().split(',').map(Number);
      if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v)))
        usage('--platform expects cx,cy,r');
      platform = { cx: parts[0]!, cy: parts[1]!, r: parts[2]! };
    } else if (a === '--out') out = next();
    else if (a === '--extra') extras.push(parseExtra(next()));
    else if (a === '--contact') contact = Number(next());
    else if (a === '--debug') debugFrames.push(...next().split(',').map(Number));
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (video === undefined) video = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!video) usage('video path missing');
  if (!(diameter! > 0)) usage('--platform-diameter-cm is required and must be positive');

  const run = await trackVideo({
    video,
    platformDiameter_cm: diameter!,
    platform,
    outDir: out,
    contactFrames: contact,
    extras,
    debugFrames,
    log: (l) => console.log(l),
  });
  if (!run.result) {
    console.log(
      '--platform is required for tracking. Proposed circle from the background (check it before use):',
    );
    if (run.estimate) {
      const c = run.estimate.circle;
      console.log(`  --platform ${c.cx.toFixed(1)},${c.cy.toFixed(1)},${c.r.toFixed(1)}`);
    }
    process.exit(2);
  }
  console.log('');
  for (const line of summaryLines(run)) console.log(line);
  console.log(`outputs: ${run.outputs.join(', ')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
