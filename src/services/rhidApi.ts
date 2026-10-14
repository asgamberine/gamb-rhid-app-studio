import type { AuthSession, LocationProfile, OfficialPunchArchive, RhidPendingItem, RhidPerson, RhidRequestInput, RhidRequestRecord, RhidSnapshot } from '../types';
import {
  parseRhidDailyPunchCollections,
  parseRhidOfficialBalanceDays,
  parseRhidPendingItems,
  parseRhidPortalHistoryPunchCollections,
  parseRhidPortalPendingDays,
  parseRhidPunchCollections,
  parseRhidRequestRecords,
  rhidDailyEntries,
} from './rhidParser';

const apiBase = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

function apiUrl(path: string) {
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface LoginRequest {
  email: string;
  password: string;
  domain: string;
}

export interface OfficialPunchLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
  automatic?: boolean;
  confirmed: boolean;
  expectedPunchCount: number;
}

export interface OfficialPunchResult {
  registered: true;
  datetime: string | null;
  hash: string | null;
  acceptedAt: string;
  automaticReferenceSource?: 'daily-punches' | 'home-profile' | 'work-profile' | null;
}

interface PeopleResponse {
  records?: RhidPerson[];
}

export class RhidApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new RhidApiError(payload.error ?? 'Falha de comunicação com a integração RHiD.', response.status);
  }
  return payload;
}

export function readRhidSession(): Promise<AuthSession> {
  return jsonRequest<AuthSession>('/api/auth/session');
}

export function loginRhid(input: LoginRequest): Promise<AuthSession> {
  return jsonRequest<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export function logoutRhid(): Promise<{ authenticated: false }> {
  return jsonRequest<{ authenticated: false }>('/api/auth/logout', { method: 'POST' });
}

export async function readRhidArchive(): Promise<OfficialPunchArchive | null> {
  const response = await jsonRequest<{ archive: OfficialPunchArchive | null }>('/api/rhid/archive');
  return response.archive;
}

export async function readLocationProfile(): Promise<LocationProfile> {
  const response = await jsonRequest<{ profile: LocationProfile }>('/api/rhid/location-profile');
  return response.profile;
}

export async function saveLocationProfile(profile: LocationProfile): Promise<LocationProfile> {
  const response = await jsonRequest<{ profile: LocationProfile }>('/api/rhid/location-profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
  return response.profile;
}

export async function geocodeAddress(address: string): Promise<{ point: LocationProfile['work']['point']; displayName: string; attribution: string }> {
  return jsonRequest<{ point: LocationProfile['work']['point']; displayName: string; attribution: string }>('/api/rhid/geocode', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
}

export async function listRhidPeople(): Promise<RhidPerson[]> {
  const response = await jsonRequest<PeopleResponse>('/api/rhid/people?start=0&length=100');
  return response.records ?? [];
}

export async function syncRhidApuracao(idPerson: number, dataIni: string, dataFinal: string): Promise<RhidSnapshot> {
  const query = new URLSearchParams({ idPerson: String(idPerson), dataIni, dataFinal });
  const snapshot = await jsonRequest<RhidSnapshot>(`/api/rhid/apuracao?${query}`);
  const parsed = parseRhidPunchCollections(snapshot.data);
  return {
    ...snapshot,
    dataIni,
    dataFinal,
    source: 'integration-apuracao',
    punches: parsed.punches,
    excludedPunches: parsed.excludedPunches,
    excludedPunchCount: parsed.excludedPunches.length,
  };
}

export async function syncRhidDaily(): Promise<RhidSnapshot> {
  const snapshot = await jsonRequest<RhidSnapshot>('/api/rhid/daily');
  const entries = rhidDailyEntries(snapshot.data);
  const parsed = parseRhidDailyPunchCollections(snapshot.data);
  return {
    ...snapshot,
    source: 'portal-daily',
    punches: parsed.punches,
    excludedPunches: parsed.excludedPunches,
    excludedPunchCount: parsed.excludedPunches.length,
    reportedPunchCount: entries?.length ?? null,
  };
}

export async function syncRhidHistory(dataIni: string, dataFinal: string): Promise<RhidSnapshot> {
  const query = new URLSearchParams({ dataIni, dataFinal });
  const snapshot = await jsonRequest<RhidSnapshot>(`/api/rhid/history?${query}`);
  const parsed = parseRhidPortalHistoryPunchCollections(snapshot.data);
  return {
    ...snapshot,
    dataIni,
    dataFinal,
    source: 'portal-history',
    punches: parsed.punches,
    excludedPunches: parsed.excludedPunches,
    excludedPunchCount: parsed.excludedPunches.length,
    pendingDays: parseRhidPortalPendingDays(snapshot.data),
    officialBalanceDays: parseRhidOfficialBalanceDays(snapshot.data),
  };
}

export async function readRhidPendingItems(date: string): Promise<RhidPendingItem[]> {
  const query = new URLSearchParams({ date });
  const response = await jsonRequest<{ data: unknown }>(`/api/rhid/pending?${query}`);
  return parseRhidPendingItems(response.data);
}

export async function readRhidRequests(startDate: string, endDate: string): Promise<RhidRequestRecord[]> {
  const query = new URLSearchParams({ startDate, endDate });
  const response = await jsonRequest<{ data: unknown }>(`/api/rhid/requests?${query}`);
  return parseRhidRequestRecords(response.data);
}

export async function createRhidRequest(input: RhidRequestInput): Promise<RhidRequestRecord> {
  const response = await jsonRequest<{ request: RhidRequestRecord }>('/api/rhid/requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.request;
}

export function registerRhidPunch(location: OfficialPunchLocation): Promise<OfficialPunchResult> {
  return jsonRequest<OfficialPunchResult>('/api/rhid/punch', {
    method: 'POST',
    body: JSON.stringify(location),
  });
}

export function updateAutomationSettings(settings: {
  targetMinutes: number;
  automaticLunchEnabled?: boolean;
  automaticSafetyExitEnabled?: boolean;
}): Promise<{ ok: boolean }> {
  return jsonRequest<{ ok: boolean }>('/api/rhid/automation-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function fetchAutomationLogs(): Promise<{ logs: unknown[] }> {
  return jsonRequest<{ logs: unknown[] }>('/api/rhid/automation/logs');
}


