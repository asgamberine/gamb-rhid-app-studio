import dayjs from 'dayjs';
import type { GeographicPoint, LocationProfile } from '../types';

export const AUTOMATIC_LOCATION_RADIUS_METERS = 100;

export interface AutomaticLocationReference {
  kind: 'daily-punch' | 'home' | 'work';
  label: string;
  point: GeographicPoint;
}

const EARTH_RADIUS_METERS = 6_371_000;

function degreesToRadians(value: number) {
  return value * (Math.PI / 180);
}

export function distanceInMeters(left: GeographicPoint, right: GeographicPoint): number {
  const latitudeDelta = degreesToRadians(right.latitude - left.latitude);
  const longitudeDelta = degreesToRadians(right.longitude - left.longitude);
  const leftLatitude = degreesToRadians(left.latitude);
  const rightLatitude = degreesToRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function profileReferenceForDate(
  profile: LocationProfile,
  date: string,
): AutomaticLocationReference | null {
  const onsite = profile.onsiteDates.includes(date);
  const preset = onsite ? profile.work : profile.home;
  if (!preset.point) {
    return null;
  }
  return {
    kind: onsite ? 'work' : 'home',
    label: onsite ? 'Trabalho' : 'Residência',
    point: preset.point,
  };
}

export function automaticLocationAllowed(
  current: GeographicPoint,
  references: AutomaticLocationReference[],
): { allowed: boolean; nearestDistance: number | null } {
  if (references.length === 0) {
    return { allowed: false, nearestDistance: null };
  }
  const nearestDistance = Math.min(...references.map((reference) => distanceInMeters(current, reference.point)));
  return {
    allowed: nearestDistance <= AUTOMATIC_LOCATION_RADIUS_METERS,
    nearestDistance,
  };
}

export function normalizedOnsiteDates(values: string[]): string[] {
  return [...new Set(values.filter((value) => (
    /^\d{4}-\d{2}-\d{2}$/.test(value)
    && dayjs(`${value}T12:00:00`).isValid()
    && dayjs(`${value}T12:00:00`).format('YYYY-MM-DD') === value
  )))].sort();
}
