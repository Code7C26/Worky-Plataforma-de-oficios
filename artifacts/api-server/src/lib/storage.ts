import { Readable } from "node:stream";
import sharp from "sharp";

const privateObjectDir = () => (process.env.PRIVATE_OBJECT_DIR || "").replace(/\/+$/, "");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROFILE_PHOTO_EDGE = 512;
type SignedObjectMethod = "GET" | "PUT" | "DELETE";

type StoredObject = {
  getMetadata: () => Promise<[{ contentType: string; size: number | null }]>;
  createReadStream: () => Readable;
};

export function normalizeObjectPath(value: string) {
  if (value.startsWith("/objects/")) return value;
  try {
    const url = new URL(value);
    const prefix = `${privateObjectDir()}/`;
    const index = url.pathname.indexOf(prefix);
    return index >= 0 ? `/objects/${url.pathname.slice(index + prefix.length)}` : value;
  } catch { return value; }
}

export async function createUploadUrl() {
  return createSignedUpload(`uploads/${crypto.randomUUID()}`);
}

export async function createChatAttachmentUploadUrl(changaId: number, usuarioId: number) {
  return createSignedUpload(`chat-attachments/${changaId}/${usuarioId}/${crypto.randomUUID()}`);
}

export function isChatAttachmentPath(objectPath: string, changaId: number, usuarioId: number) {
  return new RegExp(`^/objects/chat-attachments/${changaId}/${usuarioId}/[0-9a-f-]{36}$`).test(objectPath);
}

export async function createProfilePhotoUploadUrl(usuarioId: number) {
  return createSignedUpload(`profile-photos/${usuarioId}/source/${crypto.randomUUID()}`);
}

export function isProfilePhotoSourcePath(objectPath: string, usuarioId: number) {
  return new RegExp(`^/objects/profile-photos/${usuarioId}/source/[0-9a-f-]{36}$`).test(objectPath);
}

export function isProfilePhotoRenderedPath(objectPath: string, usuarioId: number) {
  return new RegExp(`^/objects/profile-photos/${usuarioId}/rendered/[0-9a-f-]{36}\\.webp$`).test(objectPath);
}

export async function processProfilePhoto(sourcePath: string, usuarioId: number) {
  if (!isProfilePhotoSourcePath(sourcePath, usuarioId)) throw new Error("La foto debe cargarse desde esta cuenta.");
  const source = await getObject(sourcePath);
  if (!source) throw new Error("No encontramos la foto que intentaste cargar.");
  const [metadata] = await source.getMetadata();
  if (metadata.size !== null && metadata.size > MAX_IMAGE_BYTES) throw new Error("La foto supera el límite de 10 MB.");

  const sourceBuffer = await readStream(source.createReadStream(), MAX_IMAGE_BYTES);
  let image: Buffer;
  try {
    image = await sharp(sourceBuffer, { animated: false, limitInputPixels: 40_000_000 })
      .rotate()
      .resize(PROFILE_PHOTO_EDGE, PROFILE_PHOTO_EDGE, { fit: "cover", position: "attention" })
      .webp({ quality: 86, smartSubsample: true })
      .toBuffer();
  } catch {
    throw new Error("No pudimos procesar esta imagen. Probá con una foto JPG, PNG, WebP, GIF, AVIF o HEIC.");
  }

  const destination = await createSignedUpload(`profile-photos/${usuarioId}/rendered/${crypto.randomUUID()}.webp`);
  const uploaded = await fetch(destination.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": "image/webp", "Content-Length": String(image.length) },
    body: image,
    signal: AbortSignal.timeout(30_000),
  });
  if (!uploaded.ok) throw new Error("No pudimos guardar la versión preparada de tu foto.");
  if (!(await getObject(destination.objectPath))) throw new Error("No pudimos verificar la foto guardada.");
  return destination.objectPath;
}

export async function isValidImageObject(objectPath: string) {
  const source = await getObject(objectPath);
  if (!source) return false;
  try {
    const [metadata] = await source.getMetadata();
    if (metadata.size !== null && metadata.size > MAX_IMAGE_BYTES) return false;
    const sourceBuffer = await readStream(source.createReadStream(), MAX_IMAGE_BYTES);
    await sharp(sourceBuffer, { animated: false, limitInputPixels: 40_000_000 })
      .rotate()
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

export async function getObject(path: string): Promise<StoredObject | null> {
  if (!path.startsWith("/objects/") || !privateObjectDir()) return null;
  const candidates = objectCandidates(path);
  for (const candidate of candidates) {
    const signedUrl = await requestSignedObjectUrl(candidate, "GET", 5 * 60 * 1000);
    if (!signedUrl) continue;
    const objectResponse = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!objectResponse.ok || !objectResponse.body) continue;
    const sizeHeader = objectResponse.headers.get("content-length");
    const size = sizeHeader && Number.isFinite(Number(sizeHeader)) ? Number(sizeHeader) : null;
    return {
      getMetadata: async () => [{ contentType: objectResponse.headers.get("content-type") || "application/octet-stream", size }],
      createReadStream: () => Readable.fromWeb(objectResponse.body as unknown as ReadableStream),
    };
  }
  return null;
}

/**
 * Deletes one object without broadening the caller's path scope. Callers
 * should validate their business-specific prefix before invoking this.
 */
export async function deleteObject(path: string): Promise<boolean> {
  if (!path.startsWith("/objects/") || !privateObjectDir()) return false;
  let missing = false;
  for (const candidate of objectCandidates(path)) {
    const signedUrl = await requestSignedObjectUrl(candidate, "DELETE", 5 * 60 * 1000);
    if (!signedUrl) continue;
    const response = await fetch(signedUrl, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
    if (response.ok) return true;
    if (response.status === 404) {
      missing = true;
      continue;
    }
  }
  return missing;
}

async function createSignedUpload(relativePath: string) {
  const fullPath = `${privateObjectDir()}/${relativePath}`;
  if (!fullPath.startsWith("/")) throw new Error("Object Storage no está configurado.");
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const signedUrl = await requestSignedObjectUrl({ bucketName, objectName }, "PUT", 15 * 60 * 1000);
  if (!signedUrl) throw new Error("No se pudo firmar la carga.");
  return { uploadURL: signedUrl, objectPath: `/objects/${relativePath}` };
}

function objectCandidates(path: string) {
  const relativePath = path.slice("/objects/".length);
  const current = parseObjectPath(`${privateObjectDir()}/${relativePath}`);
  const candidates = [current];
  const legacyBucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
  const legacyPrefix = privateObjectDir().replace(/^\/+|\/+$/g, "");
  if (legacyBucket && legacyPrefix) candidates.push({ bucketName: legacyBucket, objectName: `${legacyPrefix}/${relativePath}` });
  return candidates;
}

async function requestSignedObjectUrl(candidate: { bucketName: string; objectName: string }, method: SignedObjectMethod, lifetimeMs: number) {
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: candidate.bucketName,
      object_name: candidate.objectName,
      method,
      expires_at: new Date(Date.now() + lifetimeMs).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  const signed = await response.json() as { signed_url?: string };
  return signed.signed_url || null;
}

async function readStream(stream: Readable, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("La foto supera el límite de 10 MB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) throw new Error("Ruta de Object Storage inválida.");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}