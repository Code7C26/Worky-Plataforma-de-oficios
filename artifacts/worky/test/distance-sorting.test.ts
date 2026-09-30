import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sortProfessionalsByDistance } from '../src/lib/professionals';

test('ordena por cercanía y conserva al final a quienes no tienen distancia', () => {
  const professionals = [
    { id: 1, distanceKm: 8.4, rating: 4.5, reviewsCount: 12 },
    { id: 2, distanceKm: null, rating: 4.5, reviewsCount: 12 },
    { id: 3, distanceKm: 2.1, rating: 4.5, reviewsCount: 12 },
    { id: 4, distanceKm: undefined, rating: 4.5, reviewsCount: 12 },
  ];

  const sorted = sortProfessionalsByDistance(professionals);

  assert.deepEqual(sorted.map((professional) => professional.id), [3, 1, 2, 4]);
  assert.deepEqual(professionals.map((professional) => professional.id), [1, 2, 3, 4]);
});

test('la interfaz invita a activar ubicación y solo muestra distancias aproximadas', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const cardStart = source.indexOf('function ProfessionalCardWithDistance');
  const homeStart = source.indexOf('function HomePage');
  const cardSource = source.slice(cardStart, homeStart);

  assert.match(source, /Activá tu ubicación para que “Más cercanos” pueda ordenar con precisión\./);
  assert.match(source, /Distancias aproximadas, sin mostrar tu ubicación exacta\./);
  assert.match(cardSource, /professional\.distanceKm !== null && professional\.distanceKm !== undefined/);
  assert.doesNotMatch(cardSource, /latitud|longitud|latitude|longitude|coordinates/);
});