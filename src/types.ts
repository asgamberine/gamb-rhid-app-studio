export interface Punch {
  id: string;
  timestamp: string;
  origin: 'local' | 'rhid';
  excluded?: boolean;
  exclusionReason?: string | null;
}

export interface RhidPendingDay {
  date: string;
  idPerson: number | null;
}

export interface OfficialBalanceDay {
  date: string;
  cumulativeBalanceMinutes: number;
}

export interface RhidPendingItem {
  id: number | string | null;
  description: string;
  classification?: string;
  filesUrl: string[];
}

export type RhidRequestStatus = 'queued' | 'pending' | 'approved' | 'rejected';

export interface RhidRequestRecord {
  id: string;
  type: string;
  status: RhidRequestStatus;
  requestedAt: string;
  startDate: string;
  endDate: string;
  description: string;
  notes?: string;
  filesUrl: string[];
  source: 'local' | 'rhid';
}

export interface RhidRequestInput {
  type: string;
  startDate: string;
  endDate: string;
  time?: string;
  retryOf?: string;
  description: string;
  notes?: string;
}

export interface RhidPerson {
  id: number;
  name?: string;
  registration?: string;
}

export interface RhidCustomer {
  id: number;
  domain: string;
  name: string;
}

export interface RhidSnapshot {
  data: unknown;
  syncedAt: string;
  idPerson: number | null;
  dataIni?: string;
  dataFinal?: string;
  source?: 'integration-apuracao' | 'portal-daily' | 'portal-history';
  punches?: Punch[];
  excludedPunches?: Punch[];
  excludedPunchCount?: number;
  reportedPunchCount?: number | null;
  pendingDays?: RhidPendingDay[];
  officialBalanceDays?: OfficialBalanceDay[];
}

export interface OfficialPunchArchive {
  idPerson: number;
  punches: Punch[];
  pendingDays?: RhidPendingDay[];
  officialBalanceDays?: OfficialBalanceDay[];
  excludedPunchCount?: number;
  savedAt: string;
  dataIni: string;
  dataFinal: string;
}

export interface OfficialPunchReceipt {
  accountKey: string;
  acceptedAt: string;
  confirmedAt?: string;
  hash?: string | null;
  automatic?: boolean;
}

export interface GeographicPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}

export interface LocationPreset {
  address: string;
  point: GeographicPoint | null;
}

export interface LocationProfile {
  home: LocationPreset;
  work: LocationPreset;
  onsiteDates: string[];
  updatedAt?: string;
}

export interface AuthSession {
  authenticated: boolean;
  email: string;
  displayName?: string;
  domain: string;
  isPerson?: boolean;
  personId?: number | null;
  source?: 'integration' | 'portal';
  workerDaily?: boolean;
  officialPunchEnabled?: boolean;
  requiresDomain?: boolean;
  customers?: RhidCustomer[];
}

export interface JornadaSettings {
  targetMinutes: number;
  breakMinutes: number;
  warningMinutes: number;
  breakWarningMinutes: number;
}

export type HistoryPeriod = 'all' | 'yesterday' | 'week' | 'month';

export interface DaySummary {
  date: string;
  punches: Punch[];
  workedMs: number;
  breakMs: number;
  remainingMs: number;
  balanceMs: number;
  officialBalanceMs?: number | null;
  breakRemainingMs: number;
  isWorking: boolean;
  isOnBreak: boolean;
  projectedFinish: Date | null;
}
