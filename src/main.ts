const CAPABILITY_MESSAGE_READY = 'Ready';
const CAPABILITY_MESSAGE_UNSUPPORTED =
  'This browser cannot decode video frames; use Chrome, Edge, Safari 16.4+ or Firefox 130+.';

function capabilityMessage(): string {
  return 'VideoDecoder' in window ? CAPABILITY_MESSAGE_READY : CAPABILITY_MESSAGE_UNSUPPORTED;
}

function render(root: HTMLElement): void {
  root.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'BarnesTrack';

  const purpose = document.createElement('p');
  purpose.textContent =
    'Turns a folder of Barnes maze videos into defensible, auditable behavioral metrics.';

  const capability = document.createElement('p');
  capability.setAttribute('role', 'status');
  capability.textContent = capabilityMessage();

  const footer = document.createElement('footer');
  footer.textContent = __BARNESTRACK_VERSION__;

  root.append(heading, purpose, capability, footer);
}

const appRoot = document.getElementById('app');
if (appRoot) {
  render(appRoot);
}
