import { toCanvas } from 'html-to-image';

/** 1×1 transparent PNG, used when an image inside the node can't be fetched. */
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export type ImageFormat = 'png' | 'jpeg';

/**
 * Renders a DOM node to an image file and downloads it. Elements marked
 * data-export-ignore="true" (the toolbar itself) are left out.
 */
export async function downloadNodeAsImage(
  node: HTMLElement,
  { filename, format = 'png', pixelRatio = 2, background }: { filename: string; format?: ImageFormat; pixelRatio?: number; background?: string },
): Promise<void> {
  const canvas = await toCanvas(node, {
    pixelRatio,
    backgroundColor: background,
    imagePlaceholder: PLACEHOLDER,
    filter: (n) => !(n instanceof HTMLElement && n.dataset.exportIgnore === 'true'),
  });
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, format === 'jpeg' ? 0.92 : undefined));
  if (!blob) throw new Error('Could not render the report to an image');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${format === 'jpeg' ? 'jpg' : 'png'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFilename(symbol: string, d = new Date()): string {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `zak-trade-daily-report-${symbol}-${date}`;
}
