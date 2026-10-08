import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_IMAGE_LIMIT_MESSAGE,
  CHAT_IMAGE_SIZE_MESSAGE,
  filterChatImageSelection,
  MAX_CHAT_IMAGES,
  MAX_CHAT_IMAGE_SIZE_BYTES,
} from '../lib/chat-attachments.ts';

const image = (id, fileSize = 1024) => ({ id, type: 'image', fileSize });

test('la selección móvil no acepta más de cinco imágenes por mensaje', () => {
  const firstSelection = filterChatImageSelection(
    Array.from({ length: 4 }, (_, index) => image(`first-${index}`)),
    0,
  );
  assert.equal(firstSelection.accepted.length, 4);
  assert.equal(firstSelection.exceededLimit, false);

  const secondSelection = filterChatImageSelection(
    Array.from({ length: 3 }, (_, index) => image(`second-${index}`)),
    firstSelection.accepted.length,
  );
  assert.equal(secondSelection.accepted.length, 1);
  assert.equal(secondSelection.exceededLimit, true);
  assert.equal(MAX_CHAT_IMAGES, 5);
  assert.equal(CHAT_IMAGE_LIMIT_MESSAGE, 'Podés adjuntar hasta 5 imágenes por mensaje.');
});

test('el límite de 10 MB es inclusivo y los archivos más grandes se rechazan', () => {
  const selection = filterChatImageSelection([
    image('at-limit', MAX_CHAT_IMAGE_SIZE_BYTES),
    image('over-limit', MAX_CHAT_IMAGE_SIZE_BYTES + 1),
  ], 0);

  assert.deepEqual(selection.accepted.map((asset) => asset.id), ['at-limit']);
  assert.equal(selection.rejectedForSize, true);
  assert.equal(CHAT_IMAGE_SIZE_MESSAGE, 'Cada imagen puede pesar hasta 10 MB.');
});

test('la selección solo conserva imágenes y reporta contenido no compatible', () => {
  const selection = filterChatImageSelection([
    image('image'),
    { id: 'video', type: 'video', fileSize: 1024 },
  ], 0);

  assert.deepEqual(selection.accepted.map((asset) => asset.id), ['image']);
  assert.equal(selection.rejectedNonImage, true);
});