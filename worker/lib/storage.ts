import type { Env } from '../env';
import { isMediaType, mediaExtension, uid } from './util';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function storeUpload(
  env: Env,
  file: File,
  prefix: string,
  options: { imagesOnly?: boolean; maxBytes?: number } = {},
): Promise<{ key: string; type: string }> {
  const type = file.type || 'application/octet-stream';
  const allowed = options.imagesOnly ? type.startsWith('image/') : isMediaType(type);
  if (!allowed) {
    throw new Error(options.imagesOnly ? 'Upload a photo (JPG, PNG, WebP or HEIC).' : 'Upload a photo or a video.');
  }
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  if (file.size > maxBytes) throw new Error(`Files must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`);
  if (file.size === 0) throw new Error('That file is empty.');

  const key = `${prefix}/${uid()}.${mediaExtension(file.name, type)}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { metadata: { contentType: type } });
  return { key, type };
}
