import './styles/app.css';
import { SessionStore } from './session/session-store.js';
import { IndexedDbSessionStorage, MemorySessionStorage } from './session/storage.js';
import { mountApp } from './ui/app.js';
import { placeholderStep } from './ui/placeholder-step.js';
import { createMazeStep } from './ui/maze-step.js';
import { createTrackStep } from './ui/track-step.js';
import { createVideosStep } from './ui/videos-step.js';
import type { AppContext, Step } from './ui/step.js';

const toolVersion = __BARNESTRACK_VERSION__;

const storage = IndexedDbSessionStorage.isAvailable()
  ? new IndexedDbSessionStorage()
  : new MemorySessionStorage();

function makeSteps(context: AppContext): Step[] {
  return [
    createVideosStep(context),
    createMazeStep(context),
    createTrackStep(context),
    placeholderStep({
      id: 'review',
      label: 'Review & Export',
      what:
        'Read the events, latencies, errors, path measures and search strategy for each trial, ' +
        'check the quality report, and export tidy CSVs and an XLSX workbook.',
      definitions: [
        'Every threshold that defines an event travels with the numbers, as a column in the export (D11).',
        'Each export is stamped with the tool version, the schema version and the parameters hash (D12).',
      ],
      waitingFor: () => 'metrics and exports are built in a later chunk',
    }),
  ];
}

const appRoot = document.getElementById('app');
if (appRoot) {
  const store = new SessionStore(storage, toolVersion);
  // A reload must never lose the last few hundred milliseconds of work (D27).
  window.addEventListener('pagehide', () => void store.flush());
  const app = mountApp(appRoot, store, toolVersion, makeSteps);
  void store.restore().then((restored) => {
    app.refresh();
    if (restored) {
      app.context.announce(
        `Restored your last session: ${store.videos.length} video${store.videos.length === 1 ? '' : 's'}. Drop each video file again to re-attach it.`,
      );
    }
  });
}
