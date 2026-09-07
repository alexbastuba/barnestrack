/**
 * The chunk-7a components, mounted and wired, on the synthetic session.
 *
 * This page is the specification of the wiring chunk 7b has to do inside the
 * Review step, done once where it can be looked at:
 *
 * - `onParametersChange` re-runs the real `derive()` and hands the panel the
 *   previous and next analyses, which is what makes the diff badge true;
 * - `onOverride` and `onRevert` add and remove a `StrategyOverrideCorrection`
 *   in the corrections layer and re-derive — corrections propagate by
 *   recomputation, never by patching an output (D9, D25);
 * - `onSeek` is where the timeline and the video would move; here it is logged
 *   with the frame, because chunk 6 owns the scrubber;
 * - `onAnnounce` is where `AppContext.announce` goes; here it is logged and
 *   echoed into the page's own live region (D37).
 *
 * Dev-only evidence page, in the same spirit as `prototypes/viz-gallery/`. It
 * is not part of the shipped build — `vite build` takes only the root
 * `index.html` as its entry.
 */
import '../../src/styles/app.css';
import { derive, type DeriveInput, type DerivedAnalysis } from '../../src/analysis/derive.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import type { CorrectionEntry, SearchStrategy, SessionFile } from '../../src/contracts/session.js';
import type { FrameIndex } from '../../src/contracts/track.js';
import {
  createEventList,
  createMetricsCard,
  createParametersPanel,
  createQualityPanel,
} from '../../src/ui/components/index.js';
import { syntheticSession } from '../../tests/fixtures/synthetic-analysis.js';

const session: SessionFile = syntheticSession();

const videoSelect = document.querySelector<HTMLSelectElement>('#video')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const clearButton = document.querySelector<HTMLButtonElement>('#clear')!;
const status = document.querySelector<HTMLParagraphElement>('#harness-status')!;
const log = document.querySelector<HTMLPreElement>('#log')!;

const parametersHost = document.querySelector<HTMLDivElement>('#parameters')!;
const eventsHost = document.querySelector<HTMLDivElement>('#events')!;
const metricsHost = document.querySelector<HTMLDivElement>('#metrics')!;
const qualityHost = document.querySelector<HTMLDivElement>('#quality')!;

if (!session.parameters || !session.mazeMap) {
  throw new Error('the synthetic session should carry both parameters and a maze map');
}

/** Per-video state the harness owns; the Review step would keep this in the store. */
interface TrialState {
  parameters: Parameters;
  corrections: CorrectionEntry[];
  previous: DerivedAnalysis | null;
  analysis: DerivedAnalysis;
}

const state = new Map<string, TrialState>();
let videoId = session.videos[0]!.id;

function record(message: string): void {
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  log.textContent += `${stamp}  ${message}\n`;
  log.scrollTop = log.scrollHeight;
}

function say(message: string): void {
  status.textContent = message;
}

function deriveInput(
  id: string,
  parameters: Parameters,
  corrections: CorrectionEntry[],
): DeriveInput {
  const descriptor = session.videos.find((video) => video.id === id)!;
  const analysis = session.analyses[id]!;
  return {
    videoId: id,
    auto: analysis.auto,
    corrections: { entries: corrections },
    mazeMap: session.mazeMap!,
    mazeTransform: descriptor.mazeTransform,
    index: descriptor.referenceResolution,
    parameters,
  };
}

function stateFor(id: string): TrialState {
  const existing = state.get(id);
  if (existing) return existing;
  const parameters = session.parameters!;
  const corrections = [...(session.analyses[id]?.corrections.entries ?? [])];
  const fresh: TrialState = {
    parameters,
    corrections,
    previous: null,
    analysis: derive(deriveInput(id, parameters, corrections)),
  };
  state.set(id, fresh);
  return fresh;
}

/** Re-derive and re-render. This is the whole of D20's "live recompute". */
function recompute(
  id: string,
  next: Partial<Pick<TrialState, 'parameters' | 'corrections'>>,
): void {
  const before = stateFor(id);
  const parameters = next.parameters ?? before.parameters;
  const corrections = next.corrections ?? before.corrections;
  const started = performance.now();
  const analysis = derive(deriveInput(id, parameters, corrections));
  const took = performance.now() - started;

  state.set(id, { parameters, corrections, previous: before.analysis, analysis });
  render();
  record(`derive() re-ran in ${took.toFixed(1)} ms`);
}

/** The strategy override in force, if any — the id `onRevert` will be given. */
function overrideId(id: string): string | null {
  const overrides = stateFor(id).corrections.filter((entry) => entry.kind === 'strategy_override');
  return overrides[overrides.length - 1]?.id ?? null;
}

const seek = (frame: FrameIndex): void => {
  record(`onSeek(${frame})  — chunk 6's timeline and the video would move here`);
};

const announce = (message: string): void => {
  record(`onAnnounce("${message}")`);
  say(message);
};

let panels: { destroy(): void }[] = [];

function render(): void {
  for (const panel of panels) panel.destroy();
  parametersHost.replaceChildren();
  eventsHost.replaceChildren();
  metricsHost.replaceChildren();
  qualityHost.replaceChildren();

  const trial = stateFor(videoId);

  panels = [
    createParametersPanel(
      parametersHost,
      { parameters: trial.parameters, previous: trial.previous, next: trial.analysis },
      {
        onParametersChange(next) {
          record('onParametersChange(…)');
          recompute(videoId, { parameters: next });
        },
        onAnnounce: announce,
      },
    ),

    createMetricsCard(
      metricsHost,
      {
        analysis: trial.analysis,
        parameters: trial.parameters,
        strategyOverrideId: overrideId(videoId),
      },
      {
        onSeek: seek,
        onAnnounce: announce,
        onOverride(strategy: SearchStrategy, reason: string) {
          record(`onOverride(${strategy}, "${reason}")`);
          const entry: CorrectionEntry = {
            id: `harness-strategy-${Date.now()}`,
            timestamp: new Date().toISOString(),
            source: 'user',
            kind: 'strategy_override',
            strategy,
            reason,
          };
          // Additive: the automatic classification is never overwritten (D9).
          recompute(videoId, { corrections: [...stateFor(videoId).corrections, entry] });
        },
        onRevert(id: string) {
          record(`onRevert(${id})`);
          recompute(videoId, {
            corrections: stateFor(videoId).corrections.filter((entry) => entry.id !== id),
          });
        },
      },
    ),

    createQualityPanel(
      qualityHost,
      { session, videoId, analysis: trial.analysis },
      { onSeek: seek, onAnnounce: announce },
    ),

    createEventList(
      eventsHost,
      { events: trial.analysis.events, flags: trial.analysis.reviewFlags },
      { onSeek: seek, onAnnounce: announce },
    ),
  ];
}

for (const video of session.videos) {
  const { animal, day, trial } = video.metadata;
  videoSelect.append(
    new Option(
      `${video.filename} — ${animal ?? '?'}, day ${day ?? '?'}, trial ${trial ?? '?'}`,
      video.id,
    ),
  );
}

videoSelect.addEventListener('change', () => {
  videoId = videoSelect.value;
  render();
  const trial = stateFor(videoId);
  say(
    `Showing ${videoId}: ${trial.analysis.events.length} events, ` +
      `strategy ${trial.analysis.metrics.strategy}, tier ${trial.analysis.quality.tier}.`,
  );
});

resetButton.addEventListener('click', () => {
  state.delete(videoId);
  render();
  record('parameters reset to the session defaults');
  say('Parameters reset to the session defaults.');
});

clearButton.addEventListener('click', () => {
  log.textContent = '';
  say('Callback log cleared.');
});

render();
say(
  `Mounted on ${videoId}. Change a threshold on the left and watch the badge, the metrics and the events recompute.`,
);
record(`harness ready — ${session.videos.length} synthetic trials`);
