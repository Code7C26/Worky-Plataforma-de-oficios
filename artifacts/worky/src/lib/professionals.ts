export type ProfessionalWithDistance = {
  distanceKm?: number | null;
  rating: number;
  reviewsCount: number;
};

function distanceOrInfinity(distanceKm: number | null | undefined) {
  return typeof distanceKm === 'number' && Number.isFinite(distanceKm)
    ? distanceKm
    : Number.POSITIVE_INFINITY;
}

export function sortProfessionalsByDistance<T extends ProfessionalWithDistance>(professionals: readonly T[]) {
  return [...professionals].sort((a, b) => {
    const distanceDifference = distanceOrInfinity(a.distanceKm) - distanceOrInfinity(b.distanceKm);
    return distanceDifference || b.rating - a.rating || b.reviewsCount - a.reviewsCount;
  });
}