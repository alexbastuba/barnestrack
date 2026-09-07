/**
 * A figure as a PNG at 2× or 3× (D32). The figure is *drawn* at that scale
 * rather than drawn once and enlarged, so the text and the hairlines are sharp
 * at a journal's resolution.
 *
 * Runs on an `OffscreenCanvas` where there is one and a detached `<canvas>`
 * otherwise. Node has neither, so this is the one module in `src/viz/` that no
 * Vitest test can exercise; it is checked in Chrome through the gallery page
 * (see `docs/known-limitations.md`).
 */
import type { FigureData, FigureOpts, FigureSpec } from './types.js';

export const PNG_MIME = 'image/png';

interface Surface {
  ctx: CanvasRenderingContext2D;
  toBlob(): Promise<Blob>;
}

function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser would not give a 2D context for the figure.');
    return {
      ctx: ctx as unknown as CanvasRenderingContext2D,
      toBlob: () => canvas.convertToBlob({ type: PNG_MIME }),
    };
  }
  if (typeof document === 'undefined') {
    throw new Error(
      'Rendering a figure to a PNG needs a canvas, which this environment does not have.',
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give a 2D context for the figure.');
  return {
    ctx,
    toBlob: () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('The browser produced no PNG for this figure.'));
        }, PNG_MIME);
      }),
  };
}

export async function renderFigureToPng(
  figure: FigureSpec,
  data: FigureData,
  opts: FigureOpts,
  scale = opts.scale,
): Promise<Blob> {
  const width = opts.width ?? figure.defaultSize.width;
  const height = opts.height ?? figure.defaultSize.height;
  const surface = createSurface(Math.round(width * scale), Math.round(height * scale));
  figure.draw(surface.ctx, data, { ...opts, scale, width, height });
  return surface.toBlob();
}

/** `barnestrack_<figure>_<trial>_3x.png` — recognisable in a downloads folder. */
export function figurePngName(figure: FigureSpec, data: FigureData, scale: number): string {
  const descriptor = data.session.videos.find((video) => video.id === data.videoId);
  const subject =
    figure.scope === 'cohort'
      ? data.session.name
      : (descriptor?.filename.replace(/\.[^.]+$/, '') ?? data.videoId);
  const slug = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'figure';
  return `barnestrack_${slug(figure.id)}_${slug(subject)}_${scale}x.png`;
}
