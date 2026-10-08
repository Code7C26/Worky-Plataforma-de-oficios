export const MAX_CHAT_IMAGES = 5;
export const MAX_CHAT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_LIMIT_MESSAGE = 'Podés adjuntar hasta 5 imágenes por mensaje.';
export const CHAT_IMAGE_SIZE_MESSAGE = 'Cada imagen puede pesar hasta 10 MB.';

type ChatImageCandidate = {
  type?: string | null;
  fileSize?: number | null;
};

export function filterChatImageSelection<T extends ChatImageCandidate>(assets: T[], selectedCount: number) {
  const remaining = Math.max(0, MAX_CHAT_IMAGES - selectedCount);
  const accepted: T[] = [];
  let rejectedForSize = false;
  let rejectedNonImage = false;
  let exceededLimit = false;

  for (const asset of assets) {
    if (asset.type && asset.type !== 'image') {
      rejectedNonImage = true;
      continue;
    }
    if (asset.fileSize != null && asset.fileSize > MAX_CHAT_IMAGE_SIZE_BYTES) {
      rejectedForSize = true;
      continue;
    }
    if (accepted.length >= remaining) {
      exceededLimit = true;
      continue;
    }
    accepted.push(asset);
  }

  return { accepted, rejectedForSize, rejectedNonImage, exceededLimit };
}