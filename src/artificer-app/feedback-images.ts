/**
 * Screenshots for a feedback report (#1773, the owner's call on #1772): pasted, dropped or picked
 * with 📎, then made small here in the browser before they're kept or sent.
 *
 * Each image is drawn onto a canvas at most MAX_SIDE on its long side and encoded again as WebP
 * (JPEG where the browser can't write WebP, as older Safari can't). Drawing to a canvas keeps only
 * the pixels, so the EXIF block, GPS position included, never leaves the device. If the result is
 * still over TARGET_BYTES, the quality and then the size step down until it fits.
 */

import { IMAGE_BYTES, type FeedbackImage, type ImageType } from '../artificer-play/feedback';

export const MAX_SIDE = 1600;
/** A little under the server's limit, so base64 rounding never tips one over. */
export const TARGET_BYTES = Math.floor(IMAGE_BYTES * 0.95);

/** A size that fits within `max` on its long side, keeping the shape; never upscaled. */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Why an image couldn't be added. */
export type ImageRefusal = 'not-image' | 'too-big';

const toBlob = (c: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise(resolve => c.toBlob(resolve, type, quality));

const base64Of = (b: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/** One file made small, or why not. Anything that isn't an image the browser can draw is refused. */
export async function shrinkImage(file: Blob): Promise<FeedbackImage | ImageRefusal> {
  if (!file.type.startsWith('image/')) return 'not-image';
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { return 'not-image'; }
  try {
    let size = fitWithin(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    for (let shrink = 0; shrink < 4; shrink++) {
      canvas.width = size.w;
      canvas.height = size.h;
      const g = canvas.getContext('2d');
      if (!g) return 'not-image';
      g.drawImage(bmp, 0, 0, size.w, size.h);
      for (const quality of [0.85, 0.7, 0.55]) {
        let blob = await toBlob(canvas, 'image/webp', quality);
        // A browser that can't write WebP hands back a PNG instead: ask for JPEG then.
        if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality);
        if (blob && blob.size <= TARGET_BYTES) return { type: blob.type as ImageType, data: await base64Of(blob) };
      }
      size = { w: Math.max(1, Math.round(size.w * 0.75)), h: Math.max(1, Math.round(size.h * 0.75)) };
    }
    return 'too-big';
  } finally {
    bmp.close();
  }
}

/** The files in a paste or a drop (`shrinkImage` refuses those that aren't images, and the panel says so). */
export function filesOf(list: DataTransfer | null): File[] {
  return list ? [...list.files] : [];
}
