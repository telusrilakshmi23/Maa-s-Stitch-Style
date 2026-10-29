import { fileTypeFromBuffer } from 'file-type';

const allowedImageMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Detect supported image types from file bytes; never trust a filename or browser Content-Type. */
export async function detectSupportedImage(buffer: Uint8Array) {
  const detected = await fileTypeFromBuffer(buffer);
  return detected && allowedImageMimes.has(detected.mime) ? detected : null;
}
