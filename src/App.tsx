import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { formatPublishedVersion } from './version';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputSwitch } from 'primereact/inputswitch';
import { ProgressBar } from 'primereact/progressbar';
import { Tag } from 'primereact/tag';
import { Toast } from 'primereact/toast';
import { Tooltip } from 'primereact/tooltip';
import NotificationClockWorker from './workers/notificationClock.worker?worker';
import LoginView, { type SavedAccount } from './components/LoginView';
import ConfirmPunchDialog from './components/ConfirmPunchDialog';
import { useIsMobile } from './hooks/useIsMobile';
import { MobileHeader } from './components/mobile/MobileHeader';
import { MobileTabBar, type MobileTab } from './components/mobile/MobileTabBar';
import { MobileTodayView } from './components/mobile/MobileTodayView';
import {
  automaticLunchReturnAt,
  automaticLunchReturnControlHiddenForJourney,
  automaticLunchReturnGate,
  completedJourneyGate,
  balancePeriodEndDate,
  dayKey,
  excessPunchCount,
  formatDuration,
  groupDates,
  labelForPunch,
  mergeOfficialPunches,
  nextPunchLabel,
  officialAccumulatedBalanceAt,
  officialPunchGate,
  replaceOfficialBalanceDaysForPeriod,
  replacePendingDaysForPeriod,
  replacePunchesForPeriod,
  STANDARD_DAILY_PUNCH_LIMIT,
  summarizeDay,
  type AutomaticLunchReturnGate,
  type CompletedJourneyGate,
  type OfficialPunchGate,
} from './domain/journey';
import { manualOfficialPunchRequiresConfirmation } from './domain/registration';
import { isCountableWorkday, previousEligibleWorkday } from './domain/workday';
import { usePersistentState } from './hooks/usePersistentState';
import {
  availableNotificationPermission,
  buildWorkdayAlerts,
  findAlerts,
  pushBrowserNotification,
  requestNotificationPermission,
  type Alert as CenterAlert,
} from './services/notifications';
import {
  listRhidPeople,
  loginRhid,
  logoutRhid,
  readLocationProfile,
  readRhidArchive,
  readRhidRequests,
  readRhidSession,
  registerRhidPunch,
  RhidApiError,
  saveLocationProfile,
  syncRhidApuracao,
  syncRhidDaily,
  syncRhidHistory,
  type LoginRequest,
} from './services/rhidApi';
import type { AuthSession, DaySummary, HistoryPeriod, JornadaSettings, LocationProfile, OfficialPunchArchive, OfficialPunchReceipt, Punch, RhidPerson, RhidRequestRecord, RhidSnapshot } from './types';

const defaultSettings: JornadaSettings = {
  targetMinutes: 480,
  breakMinutes: 60,
  warningMinutes: 5,
  breakWarningMinutes: 2,
};
const OFFICIAL_HISTORY_MONTHS = 5;
const BASE_AUTO_SYNC_INTERVAL_MS = 50 * 60_000;
const FAST_AUTO_SYNC_INTERVAL_MS = 25 * 60_000;
const LUNCH_MONITOR_SYNC_INTERVAL_MS = 60_000;
const FAST_SYNC_START_MINUTE = 12 * 60;
const FAST_SYNC_END_MINUTE = 19 * 60;
const SESSION_HEARTBEAT_MS = 5 * 60_000;
const PRIORITY_SYNC_TIMES = [
  { hour: 12, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 16, minute: 0 },
  { hour: 17, minute: 0 },
  { hour: 17, minute: 30 },
  { hour: 18, minute: 0 },
  { hour: 19, minute: 0 },
];
const MAX_SYNC_EVENTS = 99;
const LEGACY_SNAPSHOT_KEYS = ['gamb-rhid:apuracao', 'gamb-rhid:history'];
const REGISTRATION_CONFIRMATION_ATTEMPTS = 10;
const REGISTRATION_CONFIRMATION_INTERVAL_MS = 1_500;
const FOCUS_SYNC_MIN_INTERVAL_MS = 5 * 60_000;
const CLOCK_ALIGNMENT_OFFSET_MS = 100;
const AUTOMATIC_LUNCH_RETRY_INTERVAL_MS = 60_000;
const AUTOMATIC_RETURN_SETTINGS_ANCHOR_ID = 'automatic-return-default-setting';
const JOURNEY_SETTINGS_ANCHOR_ID = 'journey-default-settings';
const MANUAL_LOCATION_SETTINGS_ANCHOR_ID = 'manual-location-settings';
const DEFAULT_WORK_ADDRESS = 'Avenida Raja Gabáglia, 1315, Luxemburgo, Belo Horizonte - MG, Brasil';
const OFFICIAL_HISTORY_FREEZE_END = '2026-06-30';

function officialHistoryStart(referenceDate: string): string {
  return dayjs(referenceDate).subtract(OFFICIAL_HISTORY_MONTHS, 'month').format('YYYY-MM-DD');
}

function officialHistoryPeriods(referenceDate: string): Array<{ startDate: string; endDate: string }> {
  const firstDate = dayjs(officialHistoryStart(referenceDate));
  const lastDate = dayjs(referenceDate);
  const periods: Array<{ startDate: string; endDate: string }> = [];
  let cursor = firstDate;
  while (!cursor.isAfter(lastDate, 'day')) {
    const end = cursor.endOf('month').isAfter(lastDate, 'day') ? lastDate : cursor.endOf('month');
    periods.push({ startDate: cursor.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') });
    cursor = end.add(1, 'day');
  }
  return periods;
}

type StatusBorderVariant = 'primary' | 'balance' | 'history' | 'integration';

function integrationPanelClassName(
  baseClass: string,
  status: IntegrationStatus,
  borderVariant: StatusBorderVariant = 'integration',
) {
  return [baseClass, 'integration-panel', `status-border-${borderVariant}`, status].join(' ');
}

const emptyLocationProfile: LocationProfile = {
  home: { address: '', point: null },
  work: { address: '', point: null },
  onsiteDates: [],
};

function getNextAutoSyncAt(from = new Date()) {
  const currentMinute = from.getHours() * 60 + from.getMinutes();
  const interval = currentMinute >= FAST_SYNC_START_MINUTE && currentMinute < FAST_SYNC_END_MINUTE
    ? FAST_AUTO_SYNC_INTERVAL_MS
    : BASE_AUTO_SYNC_INTERVAL_MS;
  const intervalTarget = from.getTime() + interval;
  const priorityTarget = PRIORITY_SYNC_TIMES
    .map(({ hour, minute }) => {
      const target = new Date(from);
      target.setHours(hour, minute, 0, 0);
      return target.getTime();
    })
    .filter((target) => target > from.getTime())
    .sort((left, right) => left - right)[0];

  return Math.min(intervalTarget, priorityTarget ?? intervalTarget);
}

function storedSnapshot(key: string): RhidSnapshot | null {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as RhidSnapshot : null;
  } catch {
    return null;
  }
}

type View = 'hoje' | 'historico' | 'ajustes';
type IntegrationStatus = 'connected' | 'syncing' | 'warning' | 'error';
interface SyncEvent {
  id: string;
  timestamp: string;
  status: IntegrationStatus;
  description: string;
}

function latestDistinctSyncEvents(events: SyncEvent[]): SyncEvent[] {
  const seenIds = new Set<string>();
  return events.filter((event) => {
    if (seenIds.has(event.id)) {
      return false;
    }
    seenIds.add(event.id);
    return true;
  }).slice(0, MAX_SYNC_EVENTS);
}

function renderSignedNumeral(value: string): React.ReactNode {
  if (value.startsWith('+') || value.startsWith('-')) {
    return (
      <span className="inline-flex items-baseline gap-[1px]">
        <span>{value[0]}</span>
        <span>{value.slice(1)}</span>
      </span>
    );
  }
  return value;
}

interface RequestDialogSeed {
  startDate: string;
  endDate: string;
  type: string;
  time?: string;
  notes: string;
}

interface HistoryAlertAction {
  label: string;
  type: 'request' | 'refresh' | 'email';
}

interface HistoryAlert extends CenterAlert {
  action?: HistoryAlertAction;
}
const VIEW_PATHS: Record<View, string> = {
  hoje: 'hoje',
  historico: 'registros',
  ajustes: 'ajustes',
};
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

const SETTING_FIELD_LABELS: Record<keyof JornadaSettings, string> = {
  targetMinutes: 'Horas trabalhadas',
  breakMinutes: 'Intervalo',
  warningMinutes: 'Primeiro aviso',
  breakWarningMinutes: 'Aviso retorno almoço',
};

function viewFromLocation(): View | null {
  const legacyHash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const pathname = window.location.pathname.replace(/\/$/, '');
  const normalized = legacyHash || pathname.slice(APP_BASE_PATH.length).replace(/^\//, '').toLowerCase();
  if (normalized === 'hoje') {
    return 'hoje';
  }
  if (normalized === 'registros' || normalized === 'historico') {
    return 'historico';
  }
  if (normalized === 'ajustes') {
    return 'ajustes';
  }
  return null;
}

function pathForView(view: View) {
  return `${APP_BASE_PATH}/${VIEW_PATHS[view]}`;
}

function formatSettingFieldValue(field: keyof JornadaSettings, value: number): string {
  return field === 'targetMinutes' ? formatDuration(value * 60_000) : `${value} min`;
}

function isAuthRelatedRhidError(error: unknown): error is RhidApiError {
  if (!(error instanceof RhidApiError)) {
    return false;
  }
  if (error.status === 401) {
    return true;
  }
  if (error.status !== 403) {
    return false;
  }
  return /sess[aã]o|autenticad|entre novamente|faça login|faca login|reautentic/i.test(error.message);
}

const RHID_SESSION_NOT_AUTHENTICATED_MESSAGE = 'O portal RHiD não informou o funcionário da sessão';

function isRhidSessionNotAuthenticatedMessage(message: string) {
  return message.includes(RHID_SESSION_NOT_AUTHENTICATED_MESSAGE);
}

function buildOutlookComposeUrl(subject: string, body: string): string {
  const normalizeMailText = (value: string) => value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim();
  let normalizedSubject = normalizeMailText(subject);
  let normalizedBody = normalizeMailText(body);
  const legacySubject = normalizedSubject.match(/^Solicitação enviada:\s*(.+)$/i);
  const legacyBody = normalizedBody.includes('Adicionar o que falta.');
  if (legacySubject || legacyBody) {
    const rawType = legacySubject?.[1]?.trim() ?? 'solicitação';
    const typeLabel = requestTypeMailLabel(rawType);
    const period = normalizedBody.match(/Período:\s*(.+)$/im)?.[1]?.trim() ?? 'Não informado';
    const description = normalizedBody
      .split(/\n{2,}/)[0]
      .trim();
    normalizedSubject = `Solicitação RHiD - ${typeLabel} - ${period}`;
    normalizedBody = [
      'Olá,',
      '',
      'Foi registrada uma solicitação no RHiD para análise.',
      '',
      `Tipo: ${typeLabel}`,
      `Data/período: ${period}`,
      `Descrição: ${description}`,
      'Status: Em análise',
      '',
      'Solicito, por gentileza, a conferência e o tratamento da solicitação.',
      '',
      'Atenciosamente,',
    ].join('\n');
  }
  return `https://outlook.office.com/mail/deeplink/compose?subject=${encodeURIComponent(normalizedSubject)}&body=${encodeURIComponent(normalizedBody)}`;
}

function requestTypeMailLabel(type: string): string {
  const labels: Record<string, string> = {
    inclusao_marcacao: 'Inclusão de marcação',
    atestado: 'Atestado',
    atestado_inss: 'Atestado INSS',
    banco_horas: 'Banco de horas',
    faltas: 'Faltas',
    abono: 'Abono',
    ajuste_horas: 'Ajuste de horas',
    relocar_extra_falta: 'Relocar extra/falta',
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}

function mergeAlertCollections(base: HistoryAlert[], extra: HistoryAlert[]) {
  const seen = new Set(base.map((alert) => alert.id));
  return [...base, ...extra.filter((alert) => !seen.has(alert.id))];
}

function alertDateLabel(alert: HistoryAlert, fallbackDate: string): string {
  const idDate = alert.id.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const alertDate = alert.requestPrefill?.startDate ?? idDate ?? fallbackDate;
  return dayjs(alertDate).format('DD/MM/YYYY');
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0] ?? 'U').slice(0, 1).toUpperCase();
}

const HistoryView = lazy(() => import('./components/HistoryView'));
const SettingsView = lazy(() => import('./components/SettingsView'));

function App() {
  const toast = useRef<Toast>(null);
  const automaticOfficialPunchRef = useRef<((options?: { automatic?: boolean }) => Promise<boolean>) | null>(null);
  const automaticLunchReturnEnabledRef = useRef(true);
  const automaticLunchReturnInFlightRef = useRef<string | null>(null);
  const automaticLunchCheckInFlightRef = useRef<string | null>(null);
  const automaticLunchReturnRetryAtRef = useRef(0);
  const automaticLunchCheckRetryAtRef = useRef(0);
  const pendingPunchCheckAtRef = useRef(0);
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<View>('hoje');
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('month');
  const [punches, setPunches] = usePersistentState<Punch[]>('gamb-rhid:punches', []);
  const [settings, setSettings] = usePersistentState<JornadaSettings>('gamb-rhid:settings', defaultSettings);
  const [delivered, setDelivered] = usePersistentState<string[]>('gamb-rhid:alerts', []);
  const [alertsEnabled, setAlertsEnabled] = usePersistentState<boolean>('gamb-rhid:alerts-enabled', true);
  const [automaticLunchReturnEnabled, setAutomaticLunchReturnEnabled] = usePersistentState<boolean>('gamb-rhid:automatic-lunch-return-enabled', true);
  const [automaticLunchReturnDisabledBySettings, setAutomaticLunchReturnDisabledBySettings] = usePersistentState<boolean>('gamb-rhid:automatic-lunch-return-disabled-by-settings', false);
  const [automaticLunchReturnControlHidden, setAutomaticLunchReturnControlHidden] = usePersistentState<boolean>('gamb-rhid:automatic-lunch-return-control-hidden', false);
  const [automaticLunchReturnToggleDay, setAutomaticLunchReturnToggleDay] = usePersistentState<string>('gamb-rhid:automatic-lunch-return-toggle-day', dayKey(new Date()));
  const [dismissedAlertIds, setDismissedAlertIds] = usePersistentState<string[]>('gamb-rhid:dismissed-alerts', []);
  const [manualAlerts, setManualAlerts] = usePersistentState<HistoryAlert[]>('gamb-rhid:manual-alerts', []);
  const [historyAnomalyRefreshAt, setHistoryAnomalyRefreshAt] = usePersistentState<Record<string, string>>('gamb-rhid:history-anomaly-refresh-at', {});
  const [syncEvents, setSyncEvents] = usePersistentState<SyncEvent[]>('gamb-rhid:sync-events', []);
  const [savedAccount, setSavedAccount] = usePersistentState<SavedAccount | null>('gamb-rhid:account', null);
  const [personId, setPersonId] = usePersistentState<number | null>('gamb-rhid:person', null);
  const [officialArchive, setOfficialArchive] = usePersistentState<OfficialPunchArchive | null>('gamb-rhid:official-punches', null);
  const [lastOfficialReceipt, setLastOfficialReceipt] = usePersistentState<OfficialPunchReceipt | null>('gamb-rhid:last-official-receipt', null);
  const [automaticLunchReturnAttempts, setAutomaticLunchReturnAttempts] = usePersistentState<string[]>('gamb-rhid:auto-lunch-return-attempts-v2', []);
  const [automaticLunchChecks, setAutomaticLunchChecks] = usePersistentState<string[]>('gamb-rhid:auto-lunch-return-checks-v2', []);
  const [automaticOfficialPunchIdsByAccount, setAutomaticOfficialPunchIdsByAccount] = usePersistentState<Record<string, string[]>>('gamb-rhid:automatic-official-punch-ids', {});
  const [automaticLunchReturnHiddenJourneyKey, setAutomaticLunchReturnHiddenJourneyKey] = usePersistentState<string | null>('gamb-rhid:auto-lunch-return-hidden-journey', null);
  const [completedJourneyReopenKeys, setCompletedJourneyReopenKeys] = usePersistentState<string[]>('gamb-rhid:completed-journey-reopen-keys', []);
  const [locationProfile, setLocationProfile] = useState<LocationProfile>(emptyLocationProfile);
  const [rhidSnapshot, setRhidSnapshot] = useState<RhidSnapshot | null>(null);
  const [rhidHistorySnapshot, setRhidHistorySnapshot] = useState<RhidSnapshot | null>(null);
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [authNotice, setAuthNotice] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [historySyncMessage, setHistorySyncMessage] = useState('');
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  const [locationProfileBusy, setLocationProfileBusy] = useState(false);
  const [locationRecoveryPending, setLocationRecoveryPending] = usePersistentState<boolean>('gamb-rhid:location-recovery-pending', false);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>('connected');
  const [nextAutoSyncAt, setNextAutoSyncAt] = useState<number | null>(null);
  const [alertsDialogOpen, setAlertsDialogOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [requestDialogSeed, setRequestDialogSeed] = useState<RequestDialogSeed | null>(null);
  const [reopenJourneyDialogOpen, setReopenJourneyDialogOpen] = useState(false);
  const [punchConfirmState, setPunchConfirmState] = useState<{
    visible: boolean;
    message: string;
  } | null>(null);
  const punchConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [officialRequests, setOfficialRequests] = useState<RhidRequestRecord[]>([]);
  const today = dayKey(now);
  const navigateToView = useCallback((nextView: View) => {
    setView(nextView);
    window.history.pushState(null, '', pathForView(nextView));
  }, []);
  const isMobile = useIsMobile(1249);
  const mobileActiveTab: MobileTab =
    view === 'hoje'
      ? 'inicio'
      : view === 'ajustes'
        ? 'ajustes'
        : historyPeriod === 'month'
          ? 'espelho'
          : 'registros';
  const handleMobileTabChange = useCallback(
    (tab: MobileTab) => {
      if (tab === 'inicio') {
        navigateToView('hoje');
      } else if (tab === 'registros') {
        setHistoryPeriod('week');
        navigateToView('historico');
      } else if (tab === 'espelho') {
        setHistoryPeriod('month');
        navigateToView('historico');
      } else if (tab === 'ajustes') {
        navigateToView('ajustes');
      }
    },
    [navigateToView, setHistoryPeriod],
  );
  const mobileViewTitle =
    view === 'hoje'
      ? 'Início'
      : view === 'ajustes'
        ? 'Ajustes'
        : historyPeriod === 'month'
          ? 'Espelho'
          : 'Registros';
  const requestPunchConfirmation = useCallback((message: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      if (punchConfirmResolverRef.current) {
        punchConfirmResolverRef.current(false);
      }
      punchConfirmResolverRef.current = resolve;
      setPunchConfirmState({
        visible: true,
        message,
      });
    });
  }, []);
  const handlePunchConfirmAction = useCallback((confirmed: boolean) => {
    const resolver = punchConfirmResolverRef.current;
    punchConfirmResolverRef.current = null;
    setPunchConfirmState((current) => (current ? { ...current, visible: false } : null));
    if (resolver) {
      resolver(confirmed);
    }
  }, []);
  useEffect(() => {
    return () => {
      if (punchConfirmResolverRef.current) {
        punchConfirmResolverRef.current(false);
        punchConfirmResolverRef.current = null;
      }
    };
  }, []);
  const officialPunchFeatureEnabled = session?.officialPunchEnabled ?? true;
  const officialRegistration = Boolean(session?.workerDaily && officialPunchFeatureEnabled);
  const rhidTestMode = Boolean(session?.workerDaily && !officialPunchFeatureEnabled);
  const archivePersonId = session?.workerDaily ? session.personId : personId;
  const activeArchive = officialArchive && archivePersonId === officialArchive.idPerson ? officialArchive : null;
  const historicalOfficialPunches = useMemo(
    () => session?.workerDaily
      ? mergeOfficialPunches(activeArchive?.punches ?? [], rhidHistorySnapshot?.punches ?? [])
      : [],
    [activeArchive?.punches, rhidHistorySnapshot?.punches, session?.workerDaily],
  );
  const archivedPunchesWithoutToday = useMemo(
    () => (session?.workerDaily ? historicalOfficialPunches : []).filter((punch) => dayKey(punch.timestamp) !== today),
    [historicalOfficialPunches, session?.workerDaily, today],
  );
  const trackedPunches = useMemo(
    () => session?.workerDaily
      ? mergeOfficialPunches(archivedPunchesWithoutToday, rhidSnapshot?.punches ?? [])
      : mergeOfficialPunches(punches, rhidSnapshot?.punches ?? []),
    [archivedPunchesWithoutToday, punches, rhidSnapshot, session?.workerDaily],
  );
  const summary = useMemo(() => summarizeDay(today, trackedPunches, settings, now), [now, settings, today, trackedPunches]);
  const isCountableToday = isCountableWorkday(today);
  const countableSummary = useMemo(() => (
    isCountableToday
      ? summary
      : {
        ...summary,
        workedMs: 0,
        breakMs: 0,
        remainingMs: 0,
        balanceMs: 0,
        breakRemainingMs: 0,
        projectedFinish: null,
      }
  ), [isCountableToday, summary]);
  const pendingHistoryDates = useMemo(
    () => session?.workerDaily
      ? [...(activeArchive?.pendingDays ?? []), ...(rhidHistorySnapshot?.pendingDays ?? [])].map((day) => day.date)
      : [],
    [activeArchive?.pendingDays, rhidHistorySnapshot?.pendingDays, session?.workerDaily],
  );
  const countableHistoryDates = useMemo(
    () => [...new Set([...groupDates(trackedPunches), ...pendingHistoryDates])].filter((date) => isCountableWorkday(date)).sort().reverse(),
    [pendingHistoryDates, trackedPunches],
  );
  const historyDates = countableHistoryDates;
  const historyReferenceDate = useMemo(() => dayjs(today).startOf('day').toDate(), [today]);
  const officialHistoryBalanceDays = useMemo(
    () => activeArchive?.officialBalanceDays ?? rhidHistorySnapshot?.officialBalanceDays ?? [],
    [activeArchive?.officialBalanceDays, rhidHistorySnapshot?.officialBalanceDays],
  );
  const historicalSummaries = useMemo(
    () => new Map(
      historyDates
        .filter((date) => date !== today)
        .map((date) => [date, summarizeDay(date, trackedPunches, settings, historyReferenceDate)]),
    ),
    [historyDates, historyReferenceDate, settings, today, trackedPunches],
  );
  const history = useMemo(
    () => historyDates.flatMap((date) => {
      const day = date === today ? summary : historicalSummaries.get(date);
      return day ? [day] : [];
    }),
    [historicalSummaries, historyDates, summary, today],
  );
  const previousWorkdayDate = useMemo(
    () => previousEligibleWorkday(today, officialRequests),
    [officialRequests, today],
  );
  const previousRegisteredSummary = useMemo(
    () => summarizeDay(previousWorkdayDate, trackedPunches, settings, historyReferenceDate),
    [historyReferenceDate, previousWorkdayDate, settings, trackedPunches],
  );

  useEffect(() => {
    if (!session?.workerDaily) {
      setOfficialRequests([]);
      return;
    }
    let cancelled = false;
    const endDate = dayjs(today).subtract(1, 'day').format('YYYY-MM-DD');
    const startDate = dayjs(endDate).subtract(1, 'year').format('YYYY-MM-DD');
    void readRhidRequests(startDate, endDate)
      .then((requests) => {
        if (!cancelled) setOfficialRequests(requests);
      })
      .catch(() => {
        if (!cancelled) setOfficialRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.workerDaily, today]);
  const historyAlerts = useMemo(
    () => buildWorkdayAlerts(history, settings, dismissedAlertIds, today),
    [dismissedAlertIds, history, settings, today],
  );
  const reminderAlerts = useMemo(
    () => findAlerts(summary, settings, delivered)
      .filter((alert) => !dismissedAlertIds.includes(alert.id))
      .map((alert) => ({ ...alert, kind: alert.kind ?? 'reminder' })),
    [delivered, dismissedAlertIds, settings, summary],
  );
  const activeAlerts = useMemo(
    () => mergeAlertCollections(
      mergeAlertCollections(historyAlerts, reminderAlerts as HistoryAlert[]),
      manualAlerts.filter((alert) => !dismissedAlertIds.includes(alert.id)),
    ),
    [dismissedAlertIds, historyAlerts, manualAlerts, reminderAlerts],
  );
  const selectedAlert = useMemo(
    () => activeAlerts.find((alert) => alert.id === selectedAlertId) ?? null,
    [activeAlerts, selectedAlertId],
  );
  const activeAlertCount = activeAlerts.length;
  const accumulatedBalance = useMemo(
    () => officialAccumulatedBalanceAt(
      officialHistoryBalanceDays,
      balancePeriodEndDate(
        countableSummary,
        today,
        isCountableToday,
      ),
    )
      ?? history.reduce(
        (total, day) => day.punches.length > 0 && (day.date !== today || (!day.isWorking && !day.isOnBreak))
          ? total + day.balanceMs
          : total,
        0,
      ),
    [countableSummary, history, isCountableToday, officialHistoryBalanceDays, today],
  );
  useEffect(() => {
    if (automaticLunchReturnDisabledBySettings) {
      return;
    }
    if (automaticLunchReturnToggleDay === today) {
      return;
    }
    if (!automaticLunchReturnEnabled) {
      setAutomaticLunchReturnEnabled(true);
    }
    setAutomaticLunchReturnToggleDay(today);
  }, [
    automaticLunchReturnDisabledBySettings,
    automaticLunchReturnEnabled,
    automaticLunchReturnToggleDay,
    setAutomaticLunchReturnEnabled,
    setAutomaticLunchReturnToggleDay,
    today,
  ]);
  useEffect(() => {
    if (automaticLunchReturnDisabledBySettings || automaticLunchReturnEnabled) {
      return;
    }
    if (summary.punches.length < STANDARD_DAILY_PUNCH_LIMIT) {
      return;
    }
    setAutomaticLunchReturnEnabled(true);
    setAutomaticLunchReturnToggleDay(today);
  }, [
    automaticLunchReturnDisabledBySettings,
    automaticLunchReturnEnabled,
    setAutomaticLunchReturnEnabled,
    setAutomaticLunchReturnToggleDay,
    summary.punches.length,
    today,
  ]);
  const countableProgress = Math.min((countableSummary.workedMs / (settings.targetMinutes * 60_000)) * 100, 100);
  const autoSyncRemainingMs = nextAutoSyncAt === null ? null : Math.max(nextAutoSyncAt - now.getTime(), 0);
  const notificationPermission = availableNotificationPermission();
  const canSynchronize = Boolean(personId || session?.workerDaily);
  const accountKey = session?.authenticated ? `${session.email.toLowerCase()}:${session.domain.toLowerCase()}` : '';
  const automaticLunchReturnEffectiveEnabled = !automaticLunchReturnDisabledBySettings && automaticLunchReturnEnabled;
  const currentJourneyKey = accountKey ? `${accountKey}|${today}` : '';
  const completedJourneyReopenKey = `${accountKey || 'session'}|${today}`;
  const completedJourneyManuallyReopened = completedJourneyReopenKeys.includes(completedJourneyReopenKey);
  const automaticOfficialPunchIds = useMemo(
    () => (accountKey ? automaticOfficialPunchIdsByAccount[accountKey] ?? [] : []),
    [accountKey, automaticOfficialPunchIdsByAccount],
  );
  const automaticOfficialPunchIdSet = useMemo(() => new Set(automaticOfficialPunchIds), [automaticOfficialPunchIds]);
  const automaticLunchReturnHiddenForCurrentJourney = automaticLunchReturnControlHiddenForJourney(
    automaticLunchReturnHiddenJourneyKey,
    accountKey,
    today,
  );
  const sessionReceipt = lastOfficialReceipt?.accountKey === accountKey ? lastOfficialReceipt : null;
  useEffect(() => {
    automaticLunchReturnEnabledRef.current = automaticLunchReturnEffectiveEnabled;
  }, [automaticLunchReturnEffectiveEnabled]);
  const automaticLunchReturnPunchId = useMemo(() => {
    if (!isCountableToday) {
      return null;
    }
    if (!sessionReceipt?.confirmedAt || !sessionReceipt.automatic) {
      return null;
    }
    const automaticPunch = summary.punches.find((punch, index) => (
      punch.origin === 'rhid'
      && labelForPunch(index) === 'Entrada 2 - Retorno Almoço'
      && punch.timestamp === sessionReceipt.confirmedAt
    ));
    return automaticPunch?.id ?? null;
  }, [isCountableToday, sessionReceipt?.automatic, sessionReceipt?.confirmedAt, summary.punches]);
  const registrationGate = officialPunchGate(
    trackedPunches,
    sessionReceipt?.confirmedAt ?? null,
    rhidSnapshot?.syncedAt ?? null,
    now,
  );
  const lunchReturnMonitorActive = Boolean(
    session?.authenticated
    && session.workerDaily
    && officialRegistration
    && isCountableToday
    && summary.punches.length === 2,
  );
  useEffect(() => {
    // CONTRATO VALIDADO: este monitor impede a dependência de atualização manual.
    // Mudanças exigem o processo de dupla autorização documentado no projeto.
    if (!lunchReturnMonitorActive) {
      return;
    }
    const refreshLunchClock = () => setNow(new Date());
    const intervalId = window.setInterval(refreshLunchClock, 5_000);
    document.addEventListener('visibilitychange', refreshLunchClock);
    window.addEventListener('focus', refreshLunchClock);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshLunchClock);
      window.removeEventListener('focus', refreshLunchClock);
    };
  }, [lunchReturnMonitorActive]);
  const journeyCompletion = isCountableToday
    ? completedJourneyGate(summary.punches, now)
    : {
      completed: false,
      active: false,
      completedAt: null,
      workedMs: 0,
      remainingMs: 0,
      progress: 0,
    };
  const lunchReturnGate = isCountableToday
    ? automaticLunchReturnGate(summary.punches, now)
    : {
      active: false,
      preparationDue: false,
      automaticDue: false,
      manualLockActive: false,
      lunchExitAt: null,
      preparationAt: null,
      returnAt: null,
      lockUntil: null,
      remainingUntilReturnMs: 0,
      remainingLockMs: 0,
    };
  const journeyCompletionLockActive = journeyCompletion.active && !completedJourneyManuallyReopened;
  const lunchReturnManualLockActive = lunchReturnGate.manualLockActive && automaticLunchReturnEffectiveEnabled;
  const baseOfficialRegistrationBlocked = officialRegistration && (journeyCompletionLockActive || registrationGate.state !== 'ready');
  const officialRegistrationBlocked = baseOfficialRegistrationBlocked
    || (officialRegistration && lunchReturnManualLockActive);
  const automaticLunchReturnTimestamp = isCountableToday ? automaticLunchReturnAt(summary.punches, now) : null;
  const automaticLunchReturnAttemptId = lunchReturnGate.lunchExitAt
    ? `${today}:${lunchReturnGate.lunchExitAt}`
    : null;
  const alertsActive = notificationPermission === 'granted' && alertsEnabled;

  useEffect(() => {
    let timeoutId: number | null = null;
    const notificationClock = new NotificationClockWorker();

    const scheduleNextMinute = () => {
      const current = new Date();
      const elapsedInMinute = current.getSeconds() * 1_000 + current.getMilliseconds();
      timeoutId = window.setTimeout(() => {
        setNow(new Date());
        scheduleNextMinute();
      }, 60_000 - elapsedInMinute + CLOCK_ALIGNMENT_OFFSET_MS);
    };

    const refreshClock = (timestamp = Date.now()) => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      setNow(new Date(timestamp));
      if (document.visibilityState === 'visible') {
        scheduleNextMinute();
      }
    };

    const refreshClockFromWorker = (event: MessageEvent<number>) => {
      setNow(new Date(event.data));
    };
    const handleVisibilityChange = () => refreshClock();

    scheduleNextMinute();
    notificationClock.addEventListener('message', refreshClockFromWorker);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      notificationClock.removeEventListener('message', refreshClockFromWorker);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      notificationClock.terminate();
    };
  }, []);

  useEffect(() => {
    const legacyHistory = storedSnapshot('gamb-rhid:history');
    const legacyDaily = storedSnapshot('gamb-rhid:apuracao');
    const idPerson = legacyHistory?.idPerson ?? legacyDaily?.idPerson;
    const migratedPunches = mergeOfficialPunches(legacyHistory?.punches ?? [], legacyDaily?.punches ?? []);
    if (idPerson && migratedPunches.length > 0) {
      const firstMigratedDate = dayKey(migratedPunches[0].timestamp);
      const lastMigratedDate = dayKey(migratedPunches[migratedPunches.length - 1].timestamp);
      setOfficialArchive((current) => {
        if (current && current.idPerson !== idPerson) {
          return current;
        }
        const storedPunches = current?.punches ?? [];
        return {
          idPerson,
          punches: mergeOfficialPunches(storedPunches, migratedPunches),
          savedAt: legacyDaily?.syncedAt ?? legacyHistory?.syncedAt ?? new Date().toISOString(),
          dataIni: legacyHistory?.dataIni ?? firstMigratedDate,
          dataFinal: legacyHistory?.dataFinal ?? lastMigratedDate,
        };
      });
    }
    LEGACY_SNAPSHOT_KEYS.forEach((key) => localStorage.removeItem(key));
  }, [setOfficialArchive, today]);

  useEffect(() => {
    readRhidSession()
      .then((restoredSession) => {
        setPersonId(restoredSession.personId ?? null);
        setSession(restoredSession);
      })
      .catch(() => setSession(null));
  }, [setPersonId]);

  useEffect(() => {
    if (session === null && window.location.pathname !== `${APP_BASE_PATH}/login`) {
      window.history.replaceState(null, '', `${APP_BASE_PATH}/login`);
    }
  }, [session]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    const syncViewWithLocation = () => {
      const nextView = viewFromLocation() ?? 'hoje';
      if (nextView !== view) {
        setView(nextView);
      }
      const targetPath = pathForView(nextView);
      if (window.location.pathname !== targetPath || window.location.hash) {
        window.history.replaceState(null, '', targetPath);
      }
    };

    syncViewWithLocation();

    const handleLocationChange = () => {
      const nextView = viewFromLocation() ?? 'hoje';
      setView(nextView);
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, [session?.authenticated, view]);

  const resetSessionState = useCallback((nextNotice = '', navigateToLogin = true, clearRemoteSession = false) => {
    if (clearRemoteSession) {
      void logoutRhid().catch(() => undefined);
    }
    setAuthNotice(nextNotice);
    setSession(null);
    setPersonId(null);
    setOfficialArchive(null);
    setLastOfficialReceipt(null);
    setRhidSnapshot(null);
    setRhidHistorySnapshot(null);
    setHistorySyncMessage('');
    setSyncMessage('');
    setRegistrationMessage('');
    setIntegrationStatus('connected');
    setSyncBusy(false);
    setRegisterBusy(false);
    setNextAutoSyncAt(null);
    setDismissedAlertIds([]);
    setManualAlerts([]);
    setHistoryAnomalyRefreshAt({});
    setAlertsDialogOpen(false);
    setSelectedAlertId(null);
    setRequestDialogSeed(null);
    if (punchConfirmResolverRef.current) {
      punchConfirmResolverRef.current(false);
      punchConfirmResolverRef.current = null;
    }
    setPunchConfirmState(null);
    setAutomaticLunchReturnAttempts([]);
    setAutomaticLunchChecks([]);
    setAutomaticOfficialPunchIdsByAccount({});
    setLocationProfile(emptyLocationProfile);
    setLocationRecoveryPending(false);
    setView('hoje');
    setHistoryPeriod('month');
    if (navigateToLogin) {
      window.history.replaceState(null, '', `${APP_BASE_PATH}/login`);
    }
  }, [
    setAuthNotice,
    setAutomaticLunchChecks,
    setAutomaticLunchReturnAttempts,
    setAutomaticOfficialPunchIdsByAccount,
    setHistoryPeriod,
    setHistorySyncMessage,
    setIntegrationStatus,
    setDismissedAlertIds,
    setLastOfficialReceipt,
    setLocationProfile,
    setLocationRecoveryPending,
    setManualAlerts,
    setNextAutoSyncAt,
    setOfficialArchive,
    setPersonId,
    setSelectedAlertId,
    setRegisterBusy,
    setRegistrationMessage,
    setRhidHistorySnapshot,
    setRhidSnapshot,
    setRequestDialogSeed,
    setSession,
    setSyncBusy,
    setSyncMessage,
    setView,
    setAlertsDialogOpen,
    setHistoryAnomalyRefreshAt,
  ]);

  const expireSession = useCallback((nextNotice = 'Sua sessão RHiD expirou. Entre novamente para continuar atualizando os registros.') => {
    resetSessionState(nextNotice, true, true);
  }, [resetSessionState]);

  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }

    let timeoutId: number | null = null;
    let cancelled = false;

    const scheduleHeartbeat = () => {
      timeoutId = window.setTimeout(async () => {
        try {
          const refreshedSession = await readRhidSession();
          if (cancelled) {
            return;
          }
          if (!refreshedSession.authenticated) {
            expireSession();
            return;
          }
          setSession(refreshedSession);
          setPersonId(refreshedSession.personId ?? null);
          scheduleHeartbeat();
        } catch (error) {
          if (cancelled) {
            return;
          }
          if (isAuthRelatedRhidError(error)) {
            expireSession();
            return;
          }
          scheduleHeartbeat();
        }
      }, SESSION_HEARTBEAT_MS);
    };

    scheduleHeartbeat();
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [expireSession, session?.authenticated, setPersonId, setSession]);

  useEffect(() => {
    if (!session?.authenticated || !session.workerDaily) {
      return;
    }
    readRhidArchive()
      .then((archive) => {
        if (!archive) {
          return;
        }
        setOfficialArchive(archive);
        setPersonId(archive.idPerson);
      })
      .catch((error) => {
        if (isAuthRelatedRhidError(error)) {
          expireSession();
        }
      });
  }, [expireSession, session?.authenticated, session?.workerDaily, setOfficialArchive, setPersonId]);

  useEffect(() => {
    if (!session?.authenticated) {
      setLocationProfile(emptyLocationProfile);
      return;
    }
    readLocationProfile()
      .then(setLocationProfile)
      .catch((error) => {
        if (isAuthRelatedRhidError(error)) {
          expireSession();
        }
      });
  }, [expireSession, session?.authenticated]);

  async function updateLocationProfile(profile: LocationProfile) {
    setLocationProfileBusy(true);
    try {
      const savedProfile = await saveLocationProfile(profile);
      setLocationProfile(savedProfile);
      if (locationRecoveryPending && savedProfile.work.point) {
        navigateToView('hoje');
        setLocationRecoveryPending(false);
        setRegistrationMessage('Localização salva. Confira as marcações do dia e toque em Registrar para tentar novamente.');
      }
    } finally {
      setLocationProfileBusy(false);
    }
  }

  const saveOfficialPeriod = useCallback((
    result: RhidSnapshot,
    officialPunches: Punch[],
    dataIni: string,
    dataFinal: string,
  ) => {
    const idPerson = result.idPerson;
    if (!idPerson) {
      return;
    }
    setOfficialArchive((current) => {
      const samePerson = current?.idPerson === idPerson;
      const storedPunches = samePerson ? current.punches : [];
      const storedPunchesInPeriod = storedPunches.filter((punch) => {
        const date = dayKey(punch.timestamp);
        return date > OFFICIAL_HISTORY_FREEZE_END && date >= dataIni && date <= dataFinal;
      });
      const mutableOfficialPunches = officialPunches.filter((punch) => dayKey(punch.timestamp) > OFFICIAL_HISTORY_FREEZE_END);
      const protectedOfficialPunches = mutableOfficialPunches.length === 0 && storedPunchesInPeriod.length > 0
        ? storedPunchesInPeriod
        : mutableOfficialPunches;
      const frozenPunches = storedPunches.filter((punch) => dayKey(punch.timestamp) <= OFFICIAL_HISTORY_FREEZE_END);
      const storedPendingDays = samePerson ? current?.pendingDays ?? [] : [];
      const storedBalanceDays = samePerson ? current?.officialBalanceDays ?? [] : [];
      return {
        idPerson,
        punches: mergeOfficialPunches(
          frozenPunches,
          replacePunchesForPeriod(storedPunches.filter((punch) => dayKey(punch.timestamp) > OFFICIAL_HISTORY_FREEZE_END), protectedOfficialPunches, dataIni, dataFinal),
        ),
        pendingDays: result.pendingDays
          ? [
            ...storedPendingDays.filter((day) => day.date <= OFFICIAL_HISTORY_FREEZE_END),
            ...replacePendingDaysForPeriod(
              storedPendingDays.filter((day) => day.date > OFFICIAL_HISTORY_FREEZE_END),
              result.pendingDays.filter((day) => day.date > OFFICIAL_HISTORY_FREEZE_END),
              dataIni,
              dataFinal,
            ),
          ]
          : storedPendingDays,
        officialBalanceDays: result.officialBalanceDays
          ? [
            ...storedBalanceDays.filter((day) => day.date <= OFFICIAL_HISTORY_FREEZE_END),
            ...replaceOfficialBalanceDaysForPeriod(
              storedBalanceDays.filter((day) => day.date > OFFICIAL_HISTORY_FREEZE_END),
              result.officialBalanceDays.filter((day) => day.date > OFFICIAL_HISTORY_FREEZE_END),
              dataIni,
              dataFinal,
            ),
          ]
          : storedBalanceDays,
        excludedPunchCount: result.excludedPunchCount ?? (samePerson ? current?.excludedPunchCount ?? 0 : 0),
        savedAt: result.syncedAt,
        dataIni: samePerson && current.dataIni < dataIni ? current.dataIni : dataIni,
        dataFinal: samePerson && current.dataFinal > dataFinal ? current.dataFinal : dataFinal,
      };
    });
    setPersonId(idPerson);
    setSession((current) => current?.workerDaily && !current.personId
      ? { ...current, personId: idPerson }
      : current);
  }, [setOfficialArchive, setPersonId]);

  const recordSyncEvent = useCallback((status: IntegrationStatus, description: string) => {
    setSyncEvents((current) => latestDistinctSyncEvents([{
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      status,
      description,
    }, ...current]));
  }, [setSyncEvents]);

  const recordAutomaticOfficialPunch = useCallback((punchId: string) => {
    if (!accountKey) {
      return;
    }
    setAutomaticOfficialPunchIdsByAccount((current) => {
      const currentIds = current[accountKey] ?? [];
      if (currentIds.includes(punchId)) {
        return current;
      }
      return {
        ...current,
        [accountKey]: [...currentIds, punchId],
      };
    });
  }, [accountKey, setAutomaticOfficialPunchIdsByAccount]);

  const removeAutomaticOfficialPunch = useCallback((punchId: string) => {
    if (!accountKey) {
      return;
    }
    setAutomaticOfficialPunchIdsByAccount((current) => {
      const currentIds = current[accountKey] ?? [];
      if (!currentIds.includes(punchId)) {
        return current;
      }
      return {
        ...current,
        [accountKey]: currentIds.filter((id) => id !== punchId),
      };
    });
  }, [accountKey, setAutomaticOfficialPunchIdsByAccount]);

  useEffect(() => {
    if (!session?.authenticated || !officialRegistration || !automaticLunchReturnPunchId || !sessionReceipt?.automatic) {
      return;
    }
    recordAutomaticOfficialPunch(automaticLunchReturnPunchId);
  }, [
    automaticLunchReturnPunchId,
    officialRegistration,
    recordAutomaticOfficialPunch,
    session?.authenticated,
    sessionReceipt?.automatic,
  ]);

  useEffect(() => {
    if (!accountKey) {
      return;
    }
    const todayPunch3 = summary.punches.find((punch, index) => (
      punch.origin === 'rhid' && labelForPunch(index) === 'Entrada 2 - Retorno Almoço'
    ));
    if (!todayPunch3) {
      return;
    }
    const hadAutoAttemptToday = automaticLunchReturnAttempts.some((attempt) => attempt.startsWith(`${today}:`));
    const wasAutoReceipt = Boolean(sessionReceipt?.confirmedAt === todayPunch3.timestamp && sessionReceipt.automatic);
    if (!hadAutoAttemptToday && !wasAutoReceipt) {
      removeAutomaticOfficialPunch(todayPunch3.id);
    }
  }, [
    accountKey,
    automaticLunchReturnAttempts,
    removeAutomaticOfficialPunch,
    sessionReceipt?.automatic,
    sessionReceipt?.confirmedAt,
    summary.punches,
    today,
  ]);

  const cancelAutomaticLunchReturn = useCallback((detail: string) => {
    if (!automaticLunchReturnAttemptId) {
      return;
    }
    automaticLunchCheckRetryAtRef.current = 0;
    automaticLunchReturnRetryAtRef.current = 0;
    setAutomaticLunchReturnAttempts((current) => [
      ...current.filter((attempt) => !attempt.startsWith(`${today}:`)),
      automaticLunchReturnAttemptId,
    ]);
    setRegistrationMessage(detail);
    setIntegrationStatus('warning');
    recordSyncEvent('warning', detail);
    toast.current?.show({
      severity: 'warn',
      summary: 'Retorno automático cancelado',
      detail,
      life: 8_000,
    });
  }, [
    automaticLunchReturnAttemptId,
    recordSyncEvent,
    setAutomaticLunchReturnAttempts,
    today,
  ]);

  const synchronize = useCallback(async (silent = false, includeHistory = true) => {
    if (!session?.authenticated || !canSynchronize) {
      return null;
    }
    setSyncBusy(true);
    setIntegrationStatus('syncing');
    if (!silent) {
      setSyncMessage(session.workerDaily
        ? `Baixando e arquivando o histórico oficial desde ${dayjs(officialHistoryStart(today)).format('DD/MM/YYYY')}...`
        : 'Consultando registros no RHiD...');
    }
    try {
      if (session.workerDaily) {
        const result = await syncRhidDaily();
        setRhidSnapshot(result);
        const count = result.punches?.length ?? 0;
        const excludedCount = result.excludedPunchCount ?? 0;
        const reportedCount = result.reportedPunchCount;
        if (reportedCount !== null && reportedCount === count + excludedCount) {
          saveOfficialPeriod(result, result.punches ?? [], today, today);
        }
        let dailyMessage = count > 0
          ? `${count} registro(s) válido(s) de hoje identificado(s).`
          : 'Consulta diária realizada; nenhum horário reconhecido no retorno.';
        if (excludedCount > 0) {
          dailyMessage += ` ${excludedCount} marcação(ões) excluída(s) são ignoradas para alinhar o saldo ao RHiD.`;
        }
        if (reportedCount === null) {
          dailyMessage = 'Atenção: Necessário fazer login novamente.';
        } else if (reportedCount === 0) {
          dailyMessage = 'O RHiD não possui registros. A próxima marcação está autorizada.';
        } else if (reportedCount !== count + excludedCount) {
          dailyMessage = `O RHiD retornou ${reportedCount} marcação(ões) diária(s), mas somente ${count} horário(s) válido(s) foram reconhecido(s). Abra o diagnóstico abaixo.`;
        }
        const dailyStatus: IntegrationStatus = reportedCount === count + excludedCount && count > 0 ? 'connected' : 'warning';
        setIntegrationStatus(dailyStatus);

        if (includeHistory) {
          try {
            const historyStart = officialHistoryStart(today);
            const historyPeriods = officialHistoryPeriods(today);
            let historyResult: RhidSnapshot | null = null;
            let historyPunches: Punch[] = [];
            let historyExcludedPunches: Punch[] = [];
            const historyPendingDays = new Map<string, NonNullable<RhidSnapshot['pendingDays']>[number]>();
            const historyBalanceDays = new Map<string, NonNullable<RhidSnapshot['officialBalanceDays']>[number]>();
            for (const period of historyPeriods) {
              const periodResult = await syncRhidHistory(period.startDate, period.endDate);
              const periodPunches = period.endDate === today
                ? mergeOfficialPunches(periodResult.punches ?? [], result.punches ?? [])
                : periodResult.punches ?? [];
              saveOfficialPeriod(periodResult, periodPunches, period.startDate, period.endDate);
              historyPunches = mergeOfficialPunches(historyPunches, periodPunches);
              historyExcludedPunches = mergeOfficialPunches(historyExcludedPunches, periodResult.excludedPunches ?? []);
              periodResult.pendingDays?.forEach((day) => historyPendingDays.set(day.date, day));
              periodResult.officialBalanceDays?.forEach((day) => historyBalanceDays.set(day.date, day));
              historyResult = periodResult;
            }
            if (!historyResult) {
              throw new Error('O RHiD não retornou períodos para arquivamento.');
            }
            const completeHistory: RhidSnapshot = {
              ...historyResult,
              dataIni: historyStart,
              dataFinal: today,
              punches: historyPunches,
              excludedPunches: historyExcludedPunches,
              excludedPunchCount: historyExcludedPunches.length,
              pendingDays: [...historyPendingDays.values()].sort((left, right) => right.date.localeCompare(left.date)),
              officialBalanceDays: [...historyBalanceDays.values()].sort((left, right) => left.date.localeCompare(right.date)),
            };
            setRhidHistorySnapshot(completeHistory);
            const historyCount = historyPunches.length;
            const historyExcludedCount = historyExcludedPunches.length;
            const pendingCount = historyPendingDays.size;
            const historyMessage = historyCount > 0 || pendingCount > 0
              ? `Histórico oficial de ${dayjs(historyStart).format('DD/MM/YYYY')} a ${dayjs(today).format('DD/MM/YYYY')}: ${historyCount} registro(s) válido(s)${historyExcludedCount > 0 ? `, ${historyExcludedCount} excluída(s)` : ''} e ${pendingCount} dia(s) com pendência guardados definitivamente.`
              : `A consulta histórica retornou sem horários reconhecidos desde ${dayjs(historyStart).format('DD/MM/YYYY')}. Abra o retorno na tela Banco de horas.`;
            const completeStatus: IntegrationStatus = dailyStatus === 'connected' && historyCount > 0 ? 'connected' : 'warning';
            setIntegrationStatus(completeStatus);
            recordSyncEvent(completeStatus, `Hoje: ${count} válido(s)${excludedCount > 0 ? `, ${excludedCount} excluída(s)` : ''} | Total: ${historyCount}`);
            setHistorySyncMessage(historyMessage);
            if (!silent) {
              setSyncMessage(`${dailyMessage} ${historyMessage}`);
            }
          } catch (error) {
            if (isAuthRelatedRhidError(error)) {
              expireSession();
              return null;
            }
            const message = error instanceof Error ? error.message : 'Falha ao consultar o histórico oficial dos últimos cinco meses.';
            if (isRhidSessionNotAuthenticatedMessage(message)) {
              resetSessionState('Sessão encerrada. Entre novamente para continuar no RHiD.', true, false);
              void logoutRhid()
                .catch(() => undefined)
                .finally(() => {
                  window.location.replace(`${APP_BASE_PATH}/login`);
                });
              return null;
            }
            const historyMessage = `Ponto diário sem histórico: ${message}`;
            setIntegrationStatus('warning');
            recordSyncEvent('warning', `Hoje: Histórico não atualizado: ${message}`);
            setHistorySyncMessage(historyMessage);
            if (!silent) {
              setSyncMessage(`${dailyMessage} ${historyMessage}`);
            }
          }
        } else if (!silent) {
          setSyncMessage(dailyMessage);
        }
        if (!includeHistory) {
          recordSyncEvent(dailyStatus, `Ponto diário: ${count} válido(s)${excludedCount > 0 ? `, ${excludedCount} excluída(s)` : ''}.`);
        }
        return result;
      }

      const result = await syncRhidApuracao(
        personId as number,
        dayjs().subtract(2, 'month').format('YYYY-MM-DD'),
        dayjs().format('YYYY-MM-DD'),
      );
      setRhidSnapshot(result);
      setIntegrationStatus('connected');
      recordSyncEvent('connected', `Apuração atualizada: ${result.punches?.length ?? 0} registro(s) válido(s)${(result.excludedPunchCount ?? 0) > 0 ? `, ${result.excludedPunchCount} excluída(s)` : ''}.`);
      if (!silent) {
        const count = result.punches?.length ?? 0;
        setSyncMessage(
          count > 0
            ? `${count} registro(s) identificado(s).`
            : 'Consulta realizada; nenhum horário reconhecido no retorno.',
        );
      }
      return result;
    } catch (error) {
      if (isAuthRelatedRhidError(error)) {
        expireSession();
        return null;
      }
      setIntegrationStatus('error');
      const message = error instanceof Error ? error.message : 'Falha ao consultar a apuração.';
      recordSyncEvent('error', message);
      setSyncMessage(message);
      return null;
    } finally {
      setSyncBusy(false);
    }
  }, [canSynchronize, expireSession, personId, recordSyncEvent, resetSessionState, saveOfficialPeriod, session, today]);

  useEffect(() => {
    if (!session?.authenticated || !canSynchronize) {
      setNextAutoSyncAt(null);
      return;
    }
    let timeoutId: number | null = null;
    let lastBackgroundSyncAt = 0;
    const runBackgroundSync = (includeHistory: boolean) => {
      lastBackgroundSyncAt = Date.now();
      return synchronize(true, includeHistory);
    };
    const scheduleNextSync = () => {
      const nextAt = lunchReturnMonitorActive
        ? Date.now() + LUNCH_MONITOR_SYNC_INTERVAL_MS
        : getNextAutoSyncAt();
      setNextAutoSyncAt(nextAt);
      timeoutId = window.setTimeout(() => {
        void runBackgroundSync(false).finally(scheduleNextSync);
      }, Math.max(nextAt - Date.now(), 1_000));
    };

    void runBackgroundSync(true);
    scheduleNextSync();
    const syncOnFocus = () => {
      if (Date.now() - lastBackgroundSyncAt < FOCUS_SYNC_MIN_INTERVAL_MS) {
        return;
      }
      void runBackgroundSync(false);
    };
    window.addEventListener('focus', syncOnFocus);
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener('focus', syncOnFocus);
      setNextAutoSyncAt(null);
    };
  }, [canSynchronize, lunchReturnMonitorActive, session, synchronize]);

  useEffect(() => {
    if (!session?.authenticated || !alertsEnabled) {
      return;
    }
    const alerts = mergeAlertCollections(
      mergeAlertCollections(historyAlerts, reminderAlerts as HistoryAlert[]),
      manualAlerts.filter((alert) => !dismissedAlertIds.includes(alert.id)),
    ).filter((alert) => !delivered.includes(alert.id));
    if (!alerts.length) {
      return;
    }

    alerts.forEach((alert) => {
      toast.current?.show({
        severity: alert.severity,
        summary: alert.title,
        detail: alert.body,
        life: 8_000,
      });
      void pushBrowserNotification(alert);
    });
    setDelivered((current) => [...new Set([...current, ...alerts.map((alert) => alert.id)])]);
  }, [
    alertsEnabled,
    delivered,
    dismissedAlertIds,
    historyAlerts,
    manualAlerts,
    reminderAlerts,
    session,
    setDelivered,
  ]);

  useEffect(() => {
    if (!session?.authenticated || !session.workerDaily || syncBusy) {
      return;
    }
    const refreshTargets = historyAlerts.filter((alert) => alert.historyRefresh);
    if (!refreshTargets.length) {
      return;
    }
    const unseenRefreshTarget = refreshTargets.find((alert) => !historyAnomalyRefreshAt[alert.id]);
    if (!unseenRefreshTarget) {
      return;
    }
    let cancelled = false;
    void synchronize(true, true).then(() => {
      if (cancelled) {
        return;
      }
      setHistoryAnomalyRefreshAt((current) => {
        const next = { ...current };
        refreshTargets.forEach((alert) => {
          next[alert.id] = new Date().toISOString();
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    historyAlerts,
    historyAnomalyRefreshAt,
    session?.authenticated,
    session?.workerDaily,
    setHistoryAnomalyRefreshAt,
    syncBusy,
    synchronize,
  ]);

  function registerPunch() {
    const label = nextPunchLabel(summary.punches.length);
    const punch: Punch = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      origin: 'local',
    };
    setPunches([...punches, punch]);
    toast.current?.show({
      severity: 'success',
      summary: label,
      detail: rhidTestMode
        ? `Simulação registrada às ${dayjs(punch.timestamp).format('HH:mm')}. Nenhum ponto foi enviado ao RHiD.`
        : `Marcação local registrada às ${dayjs(punch.timestamp).format('HH:mm')}.`,
      life: 4_000,
    });
    if (canSynchronize) {
      void synchronize(false, false);
    }
  }

  async function registerOfficialPunch({ automatic = false }: { automatic?: boolean } = {}): Promise<boolean> {
    const label = nextPunchLabel(summary.punches.length);
    const isFirstDailyPunch = summary.punches.length === 0;
    if (!automatic && lunchReturnManualLockActive) {
      setRegistrationMessage('A Entrada 2 está protegida pela automação. Aguarde a execução automática ou o fim da janela de segurança.');
      return false;
    }
    let confirmed = false;
    if (manualOfficialPunchRequiresConfirmation({
      automatic,
      dailyPunchCount: summary.punches.length,
    })) {
      confirmed = await requestPunchConfirmation(
        `Confirmar ${label.toLowerCase()} no RHiD? Sua localização atual será enviada para registrar a marcação oficial.`,
      );
      if (!confirmed) {
        return false;
      }
    }
    setRegisterBusy(true);
    setRegistrationMessage('');
    try {
      let submittedLocation: { latitude: number; longitude: number; accuracy: number | null; timestamp: number } | null = null;
      let usedManualLocation = false;
      if (navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15_000,
              maximumAge: 10_000,
            });
          });
          submittedLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };
        } catch {
          // A localização manual persistida é o protocolo de contingência.
        }
      }
      if (!submittedLocation && locationProfile.work.point) {
        usedManualLocation = true;
        submittedLocation = {
          latitude: locationProfile.work.point.latitude,
          longitude: locationProfile.work.point.longitude,
          accuracy: locationProfile.work.point.accuracy,
          timestamp: Date.parse(locationProfile.work.point.capturedAt) || Date.now(),
        };
      }
      if (!submittedLocation) {
        setLocationRecoveryPending(true);
        setLocationProfile((current) => ({
          ...current,
          work: {
            address: current.work.address.trim() || DEFAULT_WORK_ADDRESS,
            point: null,
          },
        }));
        setRegistrationMessage('Marcação não realizada: cadastre o endereço de trabalho em Ajustes. Ao salvar, a aplicação retornará e tentará novamente.');
        toast.current?.show({
          severity: 'warn',
          summary: 'Localização manual necessária',
          detail: 'Converta e salve o endereço de trabalho. A tentativa será retomada automaticamente.',
          life: 10_000,
        });
        navigateToView('ajustes');
        window.setTimeout(() => document.getElementById(MANUAL_LOCATION_SETTINGS_ANCHOR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
        return false;
      }
      if (usedManualLocation) {
        setLocationRecoveryPending(true);
      }
      const result = await registerRhidPunch({
        ...submittedLocation,
        automatic,
        confirmed,
        expectedPunchCount: summary.punches.length,
      });
      const acceptedAt = result.acceptedAt || new Date().toISOString();
      setLastOfficialReceipt({
        accountKey,
        acceptedAt,
        hash: result.hash,
        automatic: Boolean(automatic),
      });
      setRegistrationMessage('Registro aceito. Sincronizando a confirmação e o horário oficial no RHiD...');
      toast.current?.show({
        severity: 'info',
        summary: automatic ? 'Retorno automático enviado ao RHiD' : 'Registro enviado ao RHiD',
        detail: automatic
          ? `A Entrada 2 foi validada pela faixa de localização ${result.automaticReferenceSource === 'daily-punches' ? 'das marcações do dia' : result.automaticReferenceSource === 'work-profile' ? 'do trabalho' : 'da residência'} e enviada.`
          : 'Aguardando a confirmação do horário oficial.',
        life: 5_000,
      });

      try {
        let confirmedPunch: Punch | undefined;
        const acceptedThreshold = dayjs(acceptedAt).subtract(1, 'minute').valueOf();
        for (let attempt = 0; attempt < REGISTRATION_CONFIRMATION_ATTEMPTS; attempt += 1) {
          const confirmation = await syncRhidDaily();
          setRhidSnapshot(confirmation);
          const count = confirmation.punches?.length ?? 0;
          if (confirmation.reportedPunchCount !== null && confirmation.reportedPunchCount === count) {
            saveOfficialPeriod(confirmation, confirmation.punches ?? [], today, today);
          }
          const candidatePunches = (confirmation.punches ?? [])
            .filter((punch) => dayKey(punch.timestamp) === today && dayjs(punch.timestamp).valueOf() >= acceptedThreshold);
          confirmedPunch = candidatePunches[candidatePunches.length - 1];
          if (confirmedPunch) {
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, REGISTRATION_CONFIRMATION_INTERVAL_MS));
        }

        if (confirmedPunch) {
          if (automatic) {
            recordAutomaticOfficialPunch(confirmedPunch.id);
          } else {
            removeAutomaticOfficialPunch(confirmedPunch.id);
          }
          if (currentJourneyKey && (label === 'Entrada 2 - Retorno Almoço' || summary.punches.length === 2)) {
            setAutomaticLunchReturnHiddenJourneyKey(currentJourneyKey);
          }
          setLastOfficialReceipt({
            accountKey,
            acceptedAt,
            confirmedAt: confirmedPunch.timestamp,
            hash: result.hash,
            automatic: Boolean(automatic),
          });
          setLocationRecoveryPending(false);
          const time = dayjs(confirmedPunch.timestamp).format('HH:mm');
          setRegistrationMessage(isFirstDailyPunch
            ? `Jornada iniciada às ${time}. Registro confirmado pelo RHiD e novo registro bloqueado por 25 minutos.`
            : `Registro confirmado pelo RHiD às ${time}. Novo registro bloqueado por 25 minutos.`);
          setIntegrationStatus('connected');
          recordSyncEvent('connected', `Marcação confirmada pelo RHiD às ${time}.`);
          toast.current?.show({
            severity: 'success',
            summary: isFirstDailyPunch ? 'Jornada iniciada' : 'Marcação confirmada no RHiD',
            detail: isFirstDailyPunch
              ? `Entrada registrada e confirmada pelo RHiD às ${time}.`
              : `${label} registrada${automatic ? ' automaticamente' : ''} às ${time}.`,
            life: 8_000,
          });
          if (canSynchronize) {
            void synchronize(true, true);
          }
          return true;
        }

        setRegistrationMessage('Registro recebido, mas o horário ainda não apareceu na consulta diária. A atualização automática continuará verificando.');
        setIntegrationStatus('warning');
        recordSyncEvent('warning', 'Marcação recebida; confirmação do horário oficial ainda pendente.');
        toast.current?.show({
          severity: 'warn',
          summary: 'Confirmação pendente',
          detail: 'O envio foi recebido; aguardando o registro aparecer na consulta do RHiD.',
          life: 8_000,
        });
      } catch (syncError) {
        if (isAuthRelatedRhidError(syncError)) {
          expireSession();
          return false;
        }
        const message = syncError instanceof Error ? syncError.message : 'Não foi possível consultar a confirmação.';
        setRegistrationMessage(`Registro recebido, mas a confirmação automática falhou: ${message}`);
        setIntegrationStatus('warning');
        recordSyncEvent('warning', `Marcação recebida; falha ao confirmar: ${message}`);
      }
      // O envio foi aceito: interrompe novas submissões, mas o bloqueio temporal
      // continua dependendo de confirmedAt na consulta diária do RHiD.
      return true;
    } catch (error) {
      if (isAuthRelatedRhidError(error)) {
        expireSession();
        return false;
      }
      const detail = error instanceof Error
        ? error.message
        : 'Não foi possível registrar a marcação no RHiD.';
      setRegistrationMessage(automatic
        ? `Modo auto bloqueado: ${detail}`
        : `Marcação não realizada: ${detail}`);
      if (automatic) {
        setIntegrationStatus('warning');
        recordSyncEvent('warning', `Modo auto não realizado: ${detail}`);
      }
      toast.current?.show({
        severity: 'error',
        summary: 'Marcação não realizada',
        detail,
        life: 8_000,
      });
      if (error instanceof RhidApiError && error.status === 409 && !automatic) {
        void synchronize(false, false);
      }
      return false;
    } finally {
      setRegisterBusy(false);
    }
  }

  automaticOfficialPunchRef.current = registerOfficialPunch;

  useEffect(() => {
    if (
      !session?.authenticated
      || !sessionReceipt
      || sessionReceipt.confirmedAt
      || now.getTime() < pendingPunchCheckAtRef.current
      || syncBusy
      || registerBusy
    ) {
      return;
    }
    pendingPunchCheckAtRef.current = now.getTime() + 5 * 60_000;
    void synchronize(true, false).then((snapshot) => {
      const acceptedThreshold = dayjs(sessionReceipt.acceptedAt).subtract(1, 'minute').valueOf();
      const confirmationCandidates = (snapshot?.punches ?? [])
        .filter((punch) => dayKey(punch.timestamp) === today && dayjs(punch.timestamp).valueOf() >= acceptedThreshold);
      const confirmedPunch = confirmationCandidates[confirmationCandidates.length - 1];
      if (confirmedPunch) {
        setLastOfficialReceipt({ ...sessionReceipt, confirmedAt: confirmedPunch.timestamp });
        setLocationRecoveryPending(false);
        const time = dayjs(confirmedPunch.timestamp).format('HH:mm');
        setRegistrationMessage(`Registro confirmado pelo RHiD às ${time}. Novo registro bloqueado por 25 minutos.`);
        toast.current?.show({
          severity: 'success',
          summary: 'Marcação confirmada no RHiD',
          detail: `O horário oficial ${time} foi localizado na conferência automática.`,
          life: 8_000,
        });
        return;
      }
      const alert: CenterAlert = {
        id: `pending-punch:${sessionReceipt.acceptedAt}:${Math.floor(now.getTime() / (5 * 60_000))}`,
        title: 'Marcação ainda não confirmada',
        body: 'O RHiD ainda não apresentou o horário enviado. A aplicação continuará conferindo a cada 5 minutos; não faça um envio duplicado.',
        severity: 'warn',
        kind: 'reminder',
      };
      setRegistrationMessage(alert.body);
      toast.current?.show({ severity: 'warn', summary: alert.title, detail: alert.body, life: 10_000 });
      if (alertsEnabled) {
        void pushBrowserNotification(alert);
      }
    });
  }, [
    alertsEnabled,
    now,
    registerBusy,
    session?.authenticated,
    sessionReceipt,
    setLastOfficialReceipt,
    setLocationRecoveryPending,
    syncBusy,
    synchronize,
    today,
  ]);

  const dismissAlert = useCallback((alertId: string) => {
    setDismissedAlertIds((current) => (current.includes(alertId) ? current : [...current, alertId]));
    setManualAlerts((current) => current.filter((alert) => alert.id !== alertId));
    setSelectedAlertId((current) => current === alertId ? null : current);
  }, [setDismissedAlertIds, setManualAlerts]);
  const openRequestDialog = useCallback((seed?: RequestDialogSeed) => {
    setRequestDialogSeed(seed ?? {
      startDate: today,
      endDate: today,
      type: 'inclusao_marcacao',
      notes: '',
    });
    navigateToView('historico');
  }, [navigateToView, today]);

  const handleRequestSubmitted = useCallback((request: RhidRequestRecord) => {
    const typeLabel = requestTypeMailLabel(request.type);
    const startDateLabel = dayjs(request.startDate).format('DD/MM/YYYY');
    const endDateLabel = dayjs(request.endDate).format('DD/MM/YYYY');
    const periodLabel = request.startDate === request.endDate
      ? startDateLabel
      : `${startDateLabel} a ${endDateLabel}`;
    const requesterName = session?.displayName?.trim() || session?.email || 'Funcionário';
    const followUpAlert: HistoryAlert = {
      id: `request-followup:${request.id}`,
      title: 'Próximo passo: enviar e-mail',
      body: [
        'A solicitação já está registrada no RHiD.',
        '',
        '1. Clique em “Criar e-mail no Outlook”.',
        '2. Confira o tipo, período e descrição preenchidos automaticamente.',
        '3. Informe o destinatário responsável pela análise.',
        '4. Revise e envie a mensagem.',
      ].join('\n'),
      severity: 'warn',
      kind: 'followup',
      emailSubject: `Solicitação RHiD - ${typeLabel} - ${periodLabel}`,
      emailBody: [
        'Olá,',
        '',
        'Foi registrada uma solicitação no RHiD para análise.',
        '',
        `Solicitante: ${requesterName}`,
        `Tipo: ${typeLabel}`,
        `Data/período: ${periodLabel}`,
        `Descrição: ${request.description}`,
        'Status: Em análise',
        '',
        'Solicito, por gentileza, a conferência e o tratamento da solicitação.',
        '',
        'Atenciosamente,',
        requesterName,
      ].join('\n'),
    };
    setManualAlerts((current) => [
      followUpAlert,
      ...current.filter((alert) => alert.id !== followUpAlert.id),
    ]);
    setDismissedAlertIds((current) => current.filter((alertId) => alertId !== followUpAlert.id));
    setAlertsDialogOpen(false);
    setSelectedAlertId(followUpAlert.id);
  }, [session?.displayName, session?.email, setDismissedAlertIds, setManualAlerts]);

  useEffect(() => {
    if (
      !session?.authenticated
      || !session.workerDaily
      || !lunchReturnGate.preparationDue
      || !automaticLunchReturnEffectiveEnabled
      || !automaticLunchReturnAttemptId
      || automaticLunchChecks.includes(automaticLunchReturnAttemptId)
      || automaticLunchCheckInFlightRef.current === automaticLunchReturnAttemptId
      || now.getTime() < automaticLunchCheckRetryAtRef.current
      || syncBusy
    ) {
      return;
    }

    automaticLunchCheckInFlightRef.current = automaticLunchReturnAttemptId;
    setRegistrationMessage('Conferindo no RHiD se a Entrada 2 já existe antes da automação...');
    void synchronize(true, false)
      .then((snapshot) => {
        if (!snapshot) {
          automaticLunchCheckRetryAtRef.current = Date.now() + AUTOMATIC_LUNCH_RETRY_INTERVAL_MS;
          return;
        }

        const refreshedGate = automaticLunchReturnGate(snapshot.punches ?? [], new Date());
        if (!refreshedGate.active) {
          cancelAutomaticLunchReturn('A Entrada 2 já foi reconhecida no RHiD. A automação foi cancelada.');
          return;
        }

        automaticLunchCheckRetryAtRef.current = 0;
        setAutomaticLunchChecks((current) => [
          ...current.filter((attempt) => !attempt.startsWith(`${today}:`)),
          automaticLunchReturnAttemptId,
        ]);
      })
      .finally(() => {
        automaticLunchCheckInFlightRef.current = null;
      });
  }, [
    automaticLunchChecks,
    automaticLunchReturnAttemptId,
    automaticLunchReturnEffectiveEnabled,
    lunchReturnGate.preparationDue,
    now,
    session,
    cancelAutomaticLunchReturn,
    setAutomaticLunchChecks,
    syncBusy,
    synchronize,
    today,
  ]);

  useEffect(() => {
    if (
      !session?.authenticated
      || !automaticLunchReturnTimestamp
      || !automaticLunchReturnAttemptId
      || !automaticLunchReturnEffectiveEnabled
      || automaticLunchReturnAttempts.includes(automaticLunchReturnAttemptId)
      || automaticLunchReturnInFlightRef.current === automaticLunchReturnAttemptId
      || now.getTime() < automaticLunchReturnRetryAtRef.current
      || registerBusy
      || syncBusy
    ) {
      return;
    }

    if (session.workerDaily) {
      if (!officialRegistration) {
        setAutomaticLunchReturnAttempts((current) => [
          ...current.filter((attempt) => !attempt.startsWith(`${today}:`)),
          automaticLunchReturnAttemptId,
        ]);
        toast.current?.show({
          severity: 'warn',
          summary: 'Retorno automático não enviado',
          detail: 'A Entrada 2 completou 59 minutos, mas o envio oficial ao RHiD está desabilitado.',
          life: 8_000,
        });
        return;
      }
      if (baseOfficialRegistrationBlocked) {
        return;
      }

      const registerAutomaticPunch = automaticOfficialPunchRef.current;
      if (!registerAutomaticPunch) {
        return;
      }
      automaticLunchReturnInFlightRef.current = automaticLunchReturnAttemptId;
      void (async () => {
        try {
          const refreshedSnapshot = await synchronize(true, false);
          if (!refreshedSnapshot) {
            automaticLunchReturnRetryAtRef.current = Date.now() + AUTOMATIC_LUNCH_RETRY_INTERVAL_MS;
            return;
          }
          if (!automaticLunchReturnEnabledRef.current) {
            return;
          }

          const refreshedGate = automaticLunchReturnGate(refreshedSnapshot.punches ?? [], new Date());
          if (!refreshedGate.automaticDue || !refreshedGate.active) {
            cancelAutomaticLunchReturn('A Entrada 2 já foi reconhecida no RHiD. A automação foi cancelada.');
            return;
          }

          if (!automaticLunchReturnEnabledRef.current) {
            return;
          }
          const accepted = await registerAutomaticPunch({ automatic: true });
          if (accepted) {
            automaticLunchReturnRetryAtRef.current = 0;
            if (currentJourneyKey) {
              setAutomaticLunchReturnHiddenJourneyKey(currentJourneyKey);
            }
            setAutomaticLunchReturnAttempts((current) => [
              ...current.filter((attempt) => !attempt.startsWith(`${today}:`)),
              automaticLunchReturnAttemptId,
            ]);
            return;
          }

          const postAttemptSnapshot = await synchronize(true, false);
          const postAttemptGate = automaticLunchReturnGate(postAttemptSnapshot?.punches ?? [], new Date());
          if (!postAttemptGate.automaticDue || !postAttemptGate.active) {
            cancelAutomaticLunchReturn('A Entrada 2 já foi reconhecida no RHiD. A automação foi cancelada.');
            return;
          }

          automaticLunchReturnRetryAtRef.current = Date.now() + AUTOMATIC_LUNCH_RETRY_INTERVAL_MS;
        } finally {
          automaticLunchReturnInFlightRef.current = null;
        }
      })();
      return;
    }

    const automaticPunch: Punch = {
      id: crypto.randomUUID(),
      timestamp: automaticLunchReturnTimestamp,
      origin: 'local',
    };
    if (!automaticLunchReturnEnabledRef.current) {
      return;
    }
    let registered = false;
    setPunches((current) => {
      if (!automaticLunchReturnAt(current, new Date(automaticLunchReturnTimestamp))) {
        return current;
      }
      registered = true;
      return [...current, automaticPunch];
    });
    if (!registered) {
      return;
    }

    automaticLunchReturnInFlightRef.current = automaticLunchReturnAttemptId;
    setAutomaticLunchReturnAttempts((current) => [
      ...current.filter((attempt) => !attempt.startsWith(`${today}:`)),
      automaticLunchReturnAttemptId,
    ]);
    toast.current?.show({
      severity: 'success',
      summary: 'Entrada 2 - Retorno Almoço',
      detail: `Marcação automática registrada às ${dayjs(automaticPunch.timestamp).format('HH:mm')}, após 59 minutos de almoço.`,
      life: 8_000,
    });
  }, [
    automaticLunchReturnAttemptId,
    automaticLunchReturnAttempts,
    automaticLunchReturnTimestamp,
    automaticLunchReturnEffectiveEnabled,
    baseOfficialRegistrationBlocked,
    cancelAutomaticLunchReturn,
    currentJourneyKey,
    officialRegistration,
    now,
    registerBusy,
    session,
    setAutomaticLunchReturnAttempts,
    setAutomaticLunchReturnHiddenJourneyKey,
    setPunches,
    syncBusy,
    today,
    synchronize,
  ]);

  async function enableNotifications() {
    const permission = await requestNotificationPermission();
    if (permission === 'granted') {
      setAlertsEnabled(true);
    }
    toast.current?.show({
      severity: permission === 'granted' ? 'success' : 'warn',
      summary: permission === 'granted' ? 'Alertas ativos' : 'Alertas indisponíveis',
      detail: permission === 'granted' ? 'Este dispositivo pode exibir lembretes.' : 'Permita notificações no navegador.',
      life: 5_000,
    });
  }

  function toggleNotifications() {
    const enabled = !alertsEnabled;
    setAlertsEnabled(enabled);
    toast.current?.show({
      severity: enabled ? 'success' : 'info',
      summary: enabled ? 'Alertas ativos' : 'Alertas desligados',
      detail: enabled
        ? 'Os lembretes automáticos da jornada foram reativados.'
        : 'Os lembretes automáticos foram pausados nesta aplicação.',
      life: 5_000,
    });
  }

  function toggleAutomaticLunchReturn() {
    if (automaticLunchReturnDisabledBySettings) {
      toast.current?.show({
        severity: 'info',
        summary: 'Retorno automático controlado em Ajustes',
        detail: 'Desative a opção padrão em Ajustes para liberar o controle manual neste card.',
        life: 5_000,
      });
      return;
    }
    const enabled = !automaticLunchReturnEnabled;
    automaticLunchCheckRetryAtRef.current = 0;
    automaticLunchReturnRetryAtRef.current = 0;
    automaticLunchCheckInFlightRef.current = null;
    automaticLunchReturnInFlightRef.current = null;
    setAutomaticLunchReturnEnabled(enabled);
    setAutomaticLunchReturnToggleDay(today);
    toast.current?.show({
      severity: enabled ? 'success' : 'warn',
      summary: enabled ? 'Retorno modo auto' : 'Retorno modo manual',
      detail: enabled
        ? 'A Entrada 2 volta a ser enviada automaticamente quando a janela de retorno abrir.'
        : 'A aplicação não tentará enviar a Entrada 2 automaticamente e a marcação manual volta a ficar liberada.',
      life: 5_000,
    });
  }

  function testNotification() {
    void pushBrowserNotification({
      id: `manual-test:${Date.now()}`,
      title: 'Teste de notificação',
      body: 'Alerta recebido. Nenhum marcação foi enviada ao RHiD.',
      severity: 'info',
    });
    toast.current?.show({
      severity: 'info',
      summary: 'Teste enviado',
      detail: 'Nenhum marcação foi enviada ao RHiD.',
      life: 5_000,
    });
  }

  async function authenticate(input: LoginRequest) {
    const authenticatedSession = await loginRhid(input);
    if (!authenticatedSession.authenticated) {
      return authenticatedSession;
    }
    resetSessionState('', false, false);
    setSession(authenticatedSession);
    setPersonId(authenticatedSession.personId ?? null);
    const nextView = viewFromLocation() ?? 'hoje';
    window.history.replaceState(null, '', pathForView(nextView));
    return authenticatedSession;
  }

  async function logout() {
    resetSessionState('Sessão encerrada. Entre novamente para continuar no RHiD.', true, true);
  }

  async function selectCompany() {
    resetSessionState('Entre novamente para selecionar a empresa vinculada à sua conta RHiD.', true, true);
  }

  function removeLastPunch() {
    const lastLocalTodayIndex = punches.map((punch) => dayKey(punch.timestamp) === today).lastIndexOf(true);
    if (lastLocalTodayIndex < 0) {
      return;
    }
    setPunches(punches.filter((_, index) => index !== lastLocalTodayIndex));
    toast.current?.show({
      severity: 'info',
      summary: 'Última marcação removida',
      detail: 'O histórico local foi atualizado.',
      life: 4_000,
    });
  }

  function openHistory(period: HistoryPeriod) {
    setHistoryPeriod(period);
    navigateToView('historico');
  }

  const scrollToAutomaticReturnSettings = useCallback(() => {
    const startedAt = Date.now();
    const tryScroll = () => {
      const target = document.getElementById(AUTOMATIC_RETURN_SETTINGS_ANCHOR_ID);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (Date.now() - startedAt < 3_000) {
        window.setTimeout(tryScroll, 120);
      }
    };
    window.setTimeout(tryScroll, 0);
  }, []);

  const openAutomaticReturnSettings = useCallback(() => {
    if (view !== 'ajustes') {
      navigateToView('ajustes');
    }
    scrollToAutomaticReturnSettings();
  }, [navigateToView, scrollToAutomaticReturnSettings, view]);

  const openJourneySettings = useCallback(() => {
    if (view !== 'ajustes') {
      navigateToView('ajustes');
    }
    window.setTimeout(() => document.getElementById(JOURNEY_SETTINGS_ANCHOR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, [navigateToView, view]);

  const handleSettingsChange = useCallback((nextSettings: JornadaSettings) => {
    setSettings((current) => {
      const changedField = (Object.keys(SETTING_FIELD_LABELS) as (keyof JornadaSettings)[]).find(
        (field) => current[field] !== nextSettings[field],
      );
      if (changedField) {
        toast.current?.show({
          severity: 'success',
          summary: 'Jornada padrão atualizada',
          detail: `${SETTING_FIELD_LABELS[changedField]}: ${formatSettingFieldValue(changedField, current[changedField])} → ${formatSettingFieldValue(changedField, nextSettings[changedField])}`,
          life: 3_000,
        });
      }
      return nextSettings;
    });
  }, [setSettings]);

  const handleAutomaticLunchReturnDisabledBySettingsChange = useCallback((disabled: boolean) => {
    automaticLunchCheckRetryAtRef.current = 0;
    automaticLunchReturnRetryAtRef.current = 0;
    automaticLunchCheckInFlightRef.current = null;
    automaticLunchReturnInFlightRef.current = null;
    setAutomaticLunchReturnDisabledBySettings(disabled);
    setAutomaticLunchReturnEnabled(true);
    setAutomaticLunchReturnToggleDay(today);
    toast.current?.show({
      severity: disabled ? 'warn' : 'success',
      summary: disabled ? 'Modo auto desativado em Ajustes' : 'Modo auto ativado em Ajustes',
      detail: disabled
        ? 'O card da tela inicial ficará travado em desligado até a configuração ser removida.'
        : 'O card da tela inicial volta a obedecer o padrão ligado e pode ser desligado manualmente.',
      life: 5_000,
    });
    if (disabled) {
      navigateToView('hoje');
    }
  }, [
    navigateToView,
    setAutomaticLunchReturnDisabledBySettings,
    setAutomaticLunchReturnEnabled,
    setAutomaticLunchReturnToggleDay,
    today,
  ]);

  const refreshRegistrationBlock = useCallback(async () => {
    setRegistrationMessage('Conferindo novamente no RHiD para validar a liberação...');
    await synchronize(false, false);
  }, [synchronize]);

  const requestJourneyReopen = useCallback(() => {
    if (!journeyCompletionLockActive) {
      return;
    }
    setReopenJourneyDialogOpen(true);
  }, [journeyCompletionLockActive]);

  const closeJourneyReopenDialog = useCallback(() => {
    setReopenJourneyDialogOpen(false);
  }, []);

  const confirmJourneyReopen = useCallback(() => {
    if (!journeyCompletionLockActive) {
      setReopenJourneyDialogOpen(false);
      return;
    }
    setCompletedJourneyReopenKeys((current) => [
      ...current.filter((key) => key !== completedJourneyReopenKey),
      completedJourneyReopenKey,
    ]);
    setReopenJourneyDialogOpen(false);
    setRegistrationMessage('Jornada reaberta manualmente. Continue a contagem e faça nova conferência no RHiD ao concluir.');
    toast.current?.show({
      severity: 'warn',
      summary: 'Jornada reaberta',
      detail: 'O bloqueio prolongado da quarta marcação foi liberado para esta data.',
      life: 5_000,
    });
  }, [completedJourneyReopenKey, journeyCompletionLockActive, setCompletedJourneyReopenKeys]);

  const openAlertsPanel = useCallback(() => {
    setAlertsDialogOpen(true);
  }, []);

  const closeAlertsPanel = useCallback(() => {
    setAlertsDialogOpen(false);
  }, []);

  const closeAlertDetail = useCallback(() => {
    if (selectedAlertId) {
      dismissAlert(selectedAlertId);
    }
    setSelectedAlertId(null);
  }, [dismissAlert, selectedAlertId]);

  const handleAlertAction = useCallback(() => {
    if (!selectedAlert) {
      return;
    }
    if (selectedAlert.requestPrefill) {
      openRequestDialog(selectedAlert.requestPrefill);
      return;
    }
    if (selectedAlert.historyRefresh) {
      void synchronize(false, true);
      return;
    }
    if (selectedAlert.emailSubject && selectedAlert.emailBody) {
      window.open(
        buildOutlookComposeUrl(selectedAlert.emailSubject, selectedAlert.emailBody),
        '_blank',
        'noopener,noreferrer',
      );
    }
  }, [openRequestDialog, selectedAlert, synchronize]);

  if (session === undefined) {
    return <div className="loading-screen">Carregando...</div>;
  }

  if (!session?.authenticated) {
    return (
      <>
        <Toast ref={toast} position="top-right" />
        <LoginView
          savedAccount={savedAccount}
          notice={authNotice}
          onLogin={authenticate}
          onRemember={setSavedAccount}
        />
      </>
    );
  }

  const loggedUserName = session.displayName?.trim() || session.email || 'Usuário';
  const settingsRegistrationLabel = rhidTestMode
    ? 'Marcação bloqueada (teste)'
    : registrationGate.state === 'validation'
      ? 'Sincronize para liberar'
      : `${officialRegistration ? 'Registrar' : 'Anotar'} ${nextPunchLabel(summary.punches.length)}${officialRegistration ? ' no RHiD' : ''}`;

  const registerFromSettings = async () => {
    try {
      if (session.workerDaily) {
        await registerOfficialPunch();
      } else {
        registerPunch();
      }
    } finally {
      navigateToView('hoje');
    }
  };


  return (
    <>
      <Toast ref={toast} position="top-right" />

      <Dialog
        header={`Alertas ativos${activeAlertCount > 0 ? ` (${activeAlertCount})` : ''}`}
        visible={alertsDialogOpen}
        onHide={closeAlertsPanel}
        className="alerts-dialog"
        style={{ width: 'min(42rem, 94vw)' }}
        modal
        footer={(
          <div className="alerts-dialog-actions flex flex-wrap justify-center gap-6">
            <label className="alerts-notification-control" htmlFor="alerts-notification-switch">
              <span className="alerts-notification-copy">
                <strong>Alertas</strong>
                <small>{notificationPermission === 'granted' && alertsEnabled ? 'Ligado' : 'Desligado'}</small>
              </span>
              <InputSwitch
                inputId="alerts-notification-switch"
                checked={notificationPermission === 'granted' && alertsEnabled}
                onChange={(event) => {
                  if (event.value && notificationPermission !== 'granted') {
                    void enableNotifications();
                    return;
                  }
                  toggleNotifications();
                }}
                disabled={notificationPermission === 'unsupported'}
              />
            </label>
            <Button
              type="button"
              outlined
              severity="secondary"
              label="Enviar teste"
              icon="fi fi-rr-bell"
              onClick={testNotification}
            />
          </div>
        )}
      >
        <div className="alerts-dialog-content">
          <p className="text-sm text-slate-500">
            Clique em um alerta para ver a informação completa.
          </p>
          {activeAlerts.length === 0 ? (
            <p className="empty-state mt-4">Nenhum alerta ativo.</p>
          ) : (
            <div className="alerts-list mt-4">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`alerts-list-item ${alert.severity}`}
                >
                  <button
                    type="button"
                    className="alerts-list-open"
                    onClick={() => setSelectedAlertId(alert.id)}
                    aria-label={`Abrir alerta: ${alert.title}`}
                  >
                    <span className="alerts-list-title">
                      <span className="alerts-list-date">{alertDateLabel(alert, today)}</span>
                      <span aria-hidden="true"> - </span>
                      {alert.title}
                    </span>
                    <span className="alerts-list-body">{alert.body}</span>
                  </button>
                  <button
                    type="button"
                    className="alerts-list-remove"
                    onClick={() => dismissAlert(alert.id)}
                    aria-label={`Remover alerta: ${alert.title}`}
                    title="Remover alerta"
                  >
                    <i className="fi fi-rr-trash" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        header={selectedAlert?.title ?? 'Detalhe do alerta'}
        visible={selectedAlert !== null}
        onHide={closeAlertDetail}
        className="alert-detail-dialog"
        style={{ width: 'min(30rem, 92vw)' }}
        modal
        baseZIndex={21000}
        footer={selectedAlert && (
          <div className="alerts-dialog-actions dialog-footer-actions">
            {selectedAlert.requestPrefill && (
              <Button
                type="button"
                label="Nova Solicitação"
                icon="fi fi-rr-add"
                severity="secondary"
                outlined
                onClick={handleAlertAction}
              />
            )}
            {selectedAlert.historyRefresh && (
              <Button
                type="button"
                label="Atualizar relatório"
                icon="fi fi-rr-refresh"
                severity="secondary"
                outlined
                onClick={handleAlertAction}
              />
            )}
            {selectedAlert.emailSubject && selectedAlert.emailBody && (
              <a
                className="p-button p-component secondary-action alert-email-link p-button-primary"
                href={buildOutlookComposeUrl(selectedAlert.emailSubject, selectedAlert.emailBody)}
                target="_blank"
                rel="noreferrer"
              >
                <i className="fi fi-rr-arrow-up-right-from-square" aria-hidden="true" />
                <span className="p-button-label">Criar e-mail no Outlook</span>
              </a>
            )}
            <Button
              type="button"
              label="Fechar"
              severity="secondary"
              outlined
              onClick={closeAlertDetail}
            />
          </div>
        )}
      >
        {selectedAlert && (
          <div className="alert-detail-content">
            <p className={`alert-detail-body ${selectedAlert.severity}`}>{selectedAlert.body}</p>
          </div>
        )}
      </Dialog>

      <Dialog
        header="Reabrir jornada"
        visible={reopenJourneyDialogOpen}
        onHide={closeJourneyReopenDialog}
        className="alert-detail-dialog"
        style={{ width: 'min(28rem, 92vw)' }}
        modal
        footer={(
          <div className="alerts-dialog-actions dialog-footer-actions">
            <Button
              type="button"
              label="Cancelar"
              severity="secondary"
              outlined
              onClick={closeJourneyReopenDialog}
            />
            <Button
              type="button"
              label="Reabrir jornada"
              icon="fi fi-rr-lock-open-alt"
              severity="warning"
              onClick={confirmJourneyReopen}
            />
          </div>
        )}
      >
        <div className="alert-detail-content">
          <p className="alert-detail-body warning">Deseja realmente reabrir a jornada de trabalho?</p>
        </div>
      </Dialog>
      <ConfirmPunchDialog
        visible={Boolean(punchConfirmState?.visible)}
        message={punchConfirmState?.message ?? ''}
        onConfirm={() => handlePunchConfirmAction(true)}
        onCancel={() => handlePunchConfirmAction(false)}
      />

      {isMobile ? (
        <div className="mobile-shell flex flex-col min-h-screen bg-background font-body-md text-on-surface antialiased selection:bg-primary selection:text-on-primary">
          <MobileHeader
            viewTitle={mobileViewTitle}
            activeAlertCount={activeAlertCount}
            onOpenAlerts={openAlertsPanel}
            onOpenProfile={() => navigateToView('ajustes')}
            userName={loggedUserName}
          />
          <main className="flex flex-col relative w-full px-gutter pt-16 pb-28 bg-background min-h-screen">
            {view === 'hoje' && (
              <TodayView
                summary={summary}
                countableSummary={countableSummary}
                settings={settings}
                progress={countableProgress}
                accumulatedBalance={accumulatedBalance}
                previousRegisteredSummary={previousRegisteredSummary}
                integrationStatus={integrationStatus}
                onRegister={session.workerDaily ? async () => {
                  await registerOfficialPunch();
                } : registerPunch}
                officialRegistration={officialRegistration}
                rhidTestMode={rhidTestMode}
                registrationGate={registrationGate}
                journeyCompletion={journeyCompletion}
                lunchReturnGate={lunchReturnGate}
                registrationBlocked={officialRegistrationBlocked}
                registrationMessage={registrationMessage}
                registerBusy={registerBusy}
                validationBusy={syncBusy}
                automaticOfficialPunchIdSet={automaticOfficialPunchIdSet}
                automaticLunchReturnPunchId={automaticLunchReturnPunchId}
                automaticLunchReturnEnabled={automaticLunchReturnEffectiveEnabled}
                automaticLunchReturnDisabledBySettings={automaticLunchReturnDisabledBySettings}
                automaticLunchReturnControlHidden={automaticLunchReturnControlHidden || automaticLunchReturnHiddenForCurrentJourney}
                journeyCompletionLockActive={journeyCompletionLockActive}
                onToggleAutomaticLunchReturn={toggleAutomaticLunchReturn}
                onOpenAutomaticReturnSettings={openAutomaticReturnSettings}
                onOpenJourneySettings={openJourneySettings}
                onOpenRequestDialog={openRequestDialog}
                onValidateRegistration={async () => {
                  await synchronize(false, false);
                }}
                onRefreshRegistrationBlock={refreshRegistrationBlock}
                onRequestJourneyReopen={requestJourneyReopen}
                onUndo={removeLastPunch}
                canUndoLocal={punches.some((punch) => dayKey(punch.timestamp) === today)}
                onOpenHistory={openHistory}
                integrationPanel={null}
                isMobile={true}
              />
            )}
            <Suspense fallback={<div className="panel p-5 text-sm text-slate-500">Carregando...</div>}>
              {view === 'historico' && (
                <HistoryView
                  history={history}
                  rhidSnapshot={session.workerDaily ? rhidHistorySnapshot : rhidSnapshot}
                  officialArchive={session.workerDaily ? activeArchive : null}
                  automaticOfficialPunchIdSet={automaticOfficialPunchIdSet}
                  syncMessage={historySyncMessage}
                  selectedPeriod={historyPeriod}
                  onPeriodChange={setHistoryPeriod}
                  referenceDate={today}
                  requesterDisplayName={session.displayName?.trim() || session.email}
                  requestsEnabled={Boolean(session.workerDaily)}
                  requestDialogSeed={requestDialogSeed}
                  onRequestDialogConsumed={() => setRequestDialogSeed(null)}
                  onRequestSubmitted={handleRequestSubmitted}
                  onRegister={registerFromSettings}
                  registerBusy={registerBusy}
                  registrationDisabled={rhidTestMode || officialRegistrationBlocked || registerBusy}
                  registrationLabel={settingsRegistrationLabel}
                />
              )}
              {view === 'ajustes' && (
                <SettingsView
                  settings={settings}
                  onChange={handleSettingsChange}
                  automaticLunchReturnDisabledBySettings={automaticLunchReturnDisabledBySettings}
                  onAutomaticLunchReturnDisabledBySettingsChange={handleAutomaticLunchReturnDisabledBySettingsChange}
                  automaticLunchReturnControlHidden={automaticLunchReturnControlHidden}
                  onAutomaticLunchReturnControlHiddenChange={setAutomaticLunchReturnControlHidden}
                  locationProfile={locationProfile}
                  onSaveLocationProfile={updateLocationProfile}
                  locationProfileBusy={locationProfileBusy}
                  onRegister={registerFromSettings}
                  registerBusy={registerBusy}
                  registrationDisabled={rhidTestMode || officialRegistrationBlocked || registerBusy}
                  registrationLabel={settingsRegistrationLabel}
                  userName={loggedUserName}
                />
              )}
            </Suspense>
          </main>
          <MobileTabBar activeTab={mobileActiveTab} onTabChange={handleMobileTabChange} />
        </div>
      ) : (
        <div className="app-shell min-h-screen bg-canvas text-ink">
          <header className="app-header border-b border-line bg-white">
            <div className="app-header-row mx-auto max-w-screen-xl px-4 sm:px-6">
              <div className="app-brand" onClick={() => navigateToView('hoje')}>
                <div className="brand-mark" aria-hidden="true">
                  <i className="fi fi-rr-clock-three" />
                </div>
                <div className="app-brand-copy">
                  <h1 className="font-heading text-xl font-bold text-secondary">Gamb RHiD Plus</h1>
                  <p className="app-brand-subtitle text-xs text-slate-500">Controle de ponto pessoal</p>
                </div>
              </div>
              <nav className="app-navigation" aria-label="Seções">
                <NavButton icon="fi-rr-calendar-clock" label="Início" active={view === 'hoje'} onClick={() => navigateToView('hoje')} />
                <NavButton icon="fi-rr-time-past" label="Registros" active={view === 'historico'} onClick={() => navigateToView('historico')} />
                <NavButton icon="fi-rr-settings-sliders" label="Ajustes" active={view === 'ajustes'} onClick={() => navigateToView('ajustes')} />
              </nav>
              <div className="header-actions">
                <div className="header-alert-wrap">
                  <Button
                    icon="fi fi-tr-rectangle-list"
                    className={`header-alert-button ${activeAlertCount > 0
                      ? 'danger'
                      : alertsActive
                        ? 'active'
                        : notificationPermission === 'default' || !alertsEnabled
                          ? 'pending'
                          : 'unavailable'
                      }`}
                    onClick={openAlertsPanel}
                    aria-label={activeAlertCount > 0
                      ? `Abrir ${activeAlertCount} alerta(s)`
                      : alertsActive
                        ? 'Alertas ativos: abrir painel'
                        : 'Abrir painel de alertas'}
                    title={activeAlertCount > 0
                      ? `Abrir ${activeAlertCount} alerta(s)`
                      : alertsActive
                        ? 'Alertas ativos: abrir painel'
                        : 'Abrir painel de alertas'}
                  />
                  {activeAlertCount > 0 && (
                    <span className="header-alert-badge" aria-hidden="true">
                      {activeAlertCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="header-user-copy">
                    <span className="header-user-caption">Usuário Logado:</span>
                    <span className="header-user-name" title={loggedUserName}><span className="max-width">{loggedUserName}</span></span>
                  </div>
                  <div className="header-user-avatar" aria-hidden="true" title={loggedUserName}>
                    {userInitials(loggedUserName).slice(0, 1)}
                  </div>
                  <button className="logout-button ml-2" type="button" onClick={logout} aria-label="Sair" title="Sair">
                    <i className="fi fi-rr-user-logout" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="app-main mx-auto max-w-screen-xl px-4 py-6 sm:px-6">
        {view === 'hoje' && (
          <TodayView
            summary={summary}
            countableSummary={countableSummary}
            settings={settings}
            progress={countableProgress}
            accumulatedBalance={accumulatedBalance}
            previousRegisteredSummary={previousRegisteredSummary}
            integrationStatus={integrationStatus}
            onRegister={session.workerDaily ? async () => {
              await registerOfficialPunch();
            } : registerPunch}
            officialRegistration={officialRegistration}
            rhidTestMode={rhidTestMode}
            registrationGate={registrationGate}
            journeyCompletion={journeyCompletion}
            lunchReturnGate={lunchReturnGate}
            registrationBlocked={officialRegistrationBlocked}
            registrationMessage={registrationMessage}
            registerBusy={registerBusy}
            validationBusy={syncBusy}
            automaticOfficialPunchIdSet={automaticOfficialPunchIdSet}
            automaticLunchReturnPunchId={automaticLunchReturnPunchId}
            automaticLunchReturnEnabled={automaticLunchReturnEffectiveEnabled}
            automaticLunchReturnDisabledBySettings={automaticLunchReturnDisabledBySettings}
            automaticLunchReturnControlHidden={automaticLunchReturnControlHidden || automaticLunchReturnHiddenForCurrentJourney}
            journeyCompletionLockActive={journeyCompletionLockActive}
            onToggleAutomaticLunchReturn={toggleAutomaticLunchReturn}
            onOpenAutomaticReturnSettings={openAutomaticReturnSettings}
            onOpenJourneySettings={openJourneySettings}
            onOpenRequestDialog={openRequestDialog}
            onValidateRegistration={async () => {
              await synchronize(false, false);
            }}
            onRefreshRegistrationBlock={refreshRegistrationBlock}
            onRequestJourneyReopen={requestJourneyReopen}
            onUndo={removeLastPunch}
            canUndoLocal={punches.some((punch) => dayKey(punch.timestamp) === today)}
            onOpenHistory={openHistory}
            integrationPanel={(
              <RhidIntegrationPanel
                session={session}
                personId={personId}
                onPersonIdChange={setPersonId}
                snapshot={rhidSnapshot}
                busy={syncBusy}
                status={integrationStatus}
                onStatusChange={setIntegrationStatus}
                events={syncEvents}
                message={syncMessage}
                autoSyncRemainingMs={autoSyncRemainingMs}
                onSync={async () => {
                  await synchronize(false);
                }}
                onSessionExpired={expireSession}
                onSelectCompany={selectCompany}
              />
            )}
          />
        )}
        <Suspense fallback={<div className="panel p-5 text-sm text-slate-500">Carregando...</div>}>
          {view === 'historico' && (
            <HistoryView
              history={history}
              rhidSnapshot={session.workerDaily ? rhidHistorySnapshot : rhidSnapshot}
              officialArchive={session.workerDaily ? activeArchive : null}
              automaticOfficialPunchIdSet={automaticOfficialPunchIdSet}
              syncMessage={historySyncMessage}
              selectedPeriod={historyPeriod}
              onPeriodChange={setHistoryPeriod}
              referenceDate={today}
              requesterDisplayName={session.displayName?.trim() || session.email}
              requestsEnabled={Boolean(session.workerDaily)}
              requestDialogSeed={requestDialogSeed}
              onRequestDialogConsumed={() => setRequestDialogSeed(null)}
              onRequestSubmitted={handleRequestSubmitted}
              onRegister={registerFromSettings}
              registerBusy={registerBusy}
              registrationDisabled={rhidTestMode || officialRegistrationBlocked || registerBusy}
              registrationLabel={settingsRegistrationLabel}
            />
          )}
          {view === 'ajustes' && (
            <SettingsView
              settings={settings}
              onChange={handleSettingsChange}
              automaticLunchReturnDisabledBySettings={automaticLunchReturnDisabledBySettings}
              onAutomaticLunchReturnDisabledBySettingsChange={handleAutomaticLunchReturnDisabledBySettingsChange}
              automaticLunchReturnControlHidden={automaticLunchReturnControlHidden}
              onAutomaticLunchReturnControlHiddenChange={setAutomaticLunchReturnControlHidden}
              locationProfile={locationProfile}
              onSaveLocationProfile={updateLocationProfile}
              locationProfileBusy={locationProfileBusy}
              onRegister={registerFromSettings}
              registerBusy={registerBusy}
              registrationDisabled={rhidTestMode || officialRegistrationBlocked || registerBusy}
              registrationLabel={settingsRegistrationLabel}
            />
          )}
        </Suspense>
          </main>
        </div>
      )}
    </>
  );
}

interface TodayViewProps {
  summary: DaySummary;
  countableSummary: DaySummary;
  settings: JornadaSettings;
  progress: number;
  accumulatedBalance: number;
  previousRegisteredSummary: DaySummary | null;
  integrationStatus: IntegrationStatus;
  onRegister: () => void | Promise<void>;
  officialRegistration: boolean;
  rhidTestMode: boolean;
  registrationGate: OfficialPunchGate;
  journeyCompletion: CompletedJourneyGate;
  lunchReturnGate: AutomaticLunchReturnGate;
  registrationBlocked: boolean;
  registrationMessage: string;
  registerBusy: boolean;
  validationBusy: boolean;
  automaticOfficialPunchIdSet: Set<string>;
  automaticLunchReturnPunchId: string | null;
  automaticLunchReturnEnabled: boolean;
  automaticLunchReturnDisabledBySettings: boolean;
  automaticLunchReturnControlHidden: boolean;
  journeyCompletionLockActive: boolean;
  onToggleAutomaticLunchReturn: () => void;
  onOpenAutomaticReturnSettings: () => void;
  onOpenJourneySettings: () => void;
  onOpenRequestDialog: (seed?: RequestDialogSeed) => void;
  onValidateRegistration: () => Promise<void>;
  onRefreshRegistrationBlock: () => Promise<void>;
  onRequestJourneyReopen: () => void;
  onUndo: () => void;
  canUndoLocal: boolean;
  onOpenHistory: (period: HistoryPeriod) => void;
  integrationPanel: ReactNode;
  isMobile?: boolean;
}

export function TodayView({
  summary,
  countableSummary,
  settings,
  progress,
  accumulatedBalance,
  previousRegisteredSummary,
  integrationStatus,
  onRegister,
  officialRegistration,
  rhidTestMode,
  registrationGate,
  journeyCompletion,
  lunchReturnGate,
  registrationBlocked,
  registrationMessage,
  registerBusy,
  validationBusy,
  automaticOfficialPunchIdSet,
  automaticLunchReturnPunchId,
  automaticLunchReturnEnabled,
  automaticLunchReturnDisabledBySettings,
  automaticLunchReturnControlHidden,
  journeyCompletionLockActive,
  onToggleAutomaticLunchReturn,
  onOpenAutomaticReturnSettings,
  onOpenJourneySettings,
  onOpenRequestDialog,
  onValidateRegistration,
  onRefreshRegistrationBlock,
  onRequestJourneyReopen,
  onUndo,
  canUndoLocal,
  onOpenHistory,
  integrationPanel,
  isMobile = false,
}: TodayViewProps) {
  const severity = summary.isWorking ? 'success' : summary.isOnBreak ? 'info' : 'secondary';
  const statusClass = summary.isWorking ? 'working' : summary.isOnBreak ? 'break' : summary.punches.length ? 'closed' : 'pending';
  const excessCount = excessPunchCount(summary.punches);
  const progressLabel = progress.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const hasFirstPunch = summary.punches.length >= 1;
  const hasLunchReturnPunch = summary.punches.some((_, index) => labelForPunch(index) === 'Entrada 2 - Retorno Almoço') || summary.punches.length >= 3;
  const showAutomaticLunchReturnBox = officialRegistration
    && !automaticLunchReturnControlHidden
    && hasFirstPunch
    && !hasLunchReturnPunch;
  const lunchReturnLockActive = lunchReturnGate.manualLockActive && automaticLunchReturnEnabled;
  const cooldownActive = officialRegistration && !journeyCompletionLockActive && registrationGate.state === 'cooldown';
  const cooldownRemainingLabel = cooldownActive ? formatDuration(registrationGate.remainingMs) : '';
  const cooldownBaseMessage = registrationMessage.replace(/\s*Novo registro bloqueado por 25 minutos\.$/, '');
  const journeyStatusLabel = countableSummary.balanceMs > 0
    ? `Jornada concluída: ${formatDuration(countableSummary.balanceMs, true)} acima da jornada`
    : summary.isWorking || summary.isOnBreak
      ? `Jornada em andamento`
      : countableSummary.punches.length > 0
        ? 'Jornada concluída'
        : 'Nenhuma jornada iniciada';
  const registrationStatusMessage = lunchReturnLockActive
    ? (
      <>
        {registrationMessage || 'Entrada 2 protegida contra marcação manual.'}{' '}
        {lunchReturnGate.automaticDue
          ? <>Janela de segurança restante: <strong>{formatDuration(lunchReturnGate.remainingLockMs)}</strong>.</>
          : <>Retorno automático em <strong>{formatDuration(lunchReturnGate.remainingUntilReturnMs)}</strong>.</>}
      </>
    )
    : cooldownActive
      ? cooldownBaseMessage
        ? (
          <>
            {cooldownBaseMessage} Aguarde <strong>{cooldownRemainingLabel}</strong> para novo registro.
          </>
        )
        : (
          <>
            Intervalo mínimo entre registros: aguarde <strong>{cooldownRemainingLabel}</strong>.
          </>
        )
      : registrationMessage;
  const registrationControlMessage = journeyCompletionLockActive
    ? (
      <>
        Novo registro bloqueado por segurança. Liberação em <strong>{formatDuration(journeyCompletion.remainingMs)}</strong>.
      </>
    )
    : registrationStatusMessage;
  const showRegistrationControlMessage = Boolean(registrationControlMessage);
  const automaticReturnTooltip = automaticLunchReturnDisabledBySettings
    ? 'Desativado na sess\u00e3o Ajustes'
    : automaticLunchReturnEnabled
      ? `${lunchReturnLockActive ? registrationMessage || 'Modo auto validado anteriormente.' : 'Modo auto ligado e validado para a próxima Entrada 2.'}`
      : 'Modo auto desligado.';
  const previousWorkedMs = previousRegisteredSummary?.workedMs ?? 0;
  const journeyCompleted = journeyCompletion.completed;
  const targetReached = countableSummary.workedMs >= settings.targetMinutes * 60_000;
  const targetDifferenceMs = targetReached ? Math.max(countableSummary.balanceMs, 0) : countableSummary.remainingMs;
  const previousJourneyCritical = previousRegisteredSummary !== null
    && previousWorkedMs >= 2 * 60 * 60_000
    && previousWorkedMs <= 5 * 60 * 60_000;
  const showRegistrationStatusTools = officialRegistration && showRegistrationControlMessage;
  const [registrationBlockReleaseDialogOpen, setRegistrationBlockReleaseDialogOpen] = useState(false);
  const openPreviousJourneyRequest = () => {
    if (!previousRegisteredSummary) return;
    onOpenRequestDialog({
      startDate: previousRegisteredSummary.date,
      endDate: previousRegisteredSummary.date,
      type: 'inclusao_marcacao',
      notes: `Jornada registrada com ${formatDuration(previousWorkedMs)} em ${dayjs(previousRegisteredSummary.date).format('DD/MM/YYYY')}. Verificar e incluir a marcação ausente.`,
    });
  };

  if (isMobile) {
    return (
      <MobileTodayView
        summary={summary}
        countableSummary={countableSummary}
        settings={settings}
        progress={progress}
        accumulatedBalance={accumulatedBalance}
        previousRegisteredSummary={previousRegisteredSummary}
        integrationStatus={integrationStatus}
        onRegister={onRegister}
        officialRegistration={officialRegistration}
        rhidTestMode={rhidTestMode}
        registrationGate={registrationGate}
        journeyCompletion={journeyCompletion}
        lunchReturnGate={lunchReturnGate}
        registrationBlocked={registrationBlocked}
        registrationMessage={registrationMessage}
        registerBusy={registerBusy}
        validationBusy={validationBusy}
        automaticOfficialPunchIdSet={automaticOfficialPunchIdSet}
        automaticLunchReturnPunchId={automaticLunchReturnPunchId}
        automaticLunchReturnEnabled={automaticLunchReturnEnabled}
        automaticLunchReturnDisabledBySettings={automaticLunchReturnDisabledBySettings}
        automaticLunchReturnControlHidden={automaticLunchReturnControlHidden}
        journeyCompletionLockActive={journeyCompletionLockActive}
        onToggleAutomaticLunchReturn={onToggleAutomaticLunchReturn}
        onOpenAutomaticReturnSettings={onOpenAutomaticReturnSettings}
        onOpenJourneySettings={onOpenJourneySettings}
        onOpenRequestDialog={onOpenRequestDialog}
        onValidateRegistration={onValidateRegistration}
        onRefreshRegistrationBlock={onRefreshRegistrationBlock}
        onRequestJourneyReopen={onRequestJourneyReopen}
        onUndo={onUndo}
        canUndoLocal={canUndoLocal}
        onOpenHistory={onOpenHistory}
      />
    );
  }

  return (
    <div className="today-grid grid grid-cols-1 gap-6 py-4 md:grid-cols-12 relative">
      <div className="today-main order-1 grid gap-5 md:col-span-12 lg:order-2 lg:col-span-8">
        <section
          className={integrationPanelClassName(
            'panel today-journey-card bg-white rounded-3xl shadow-[0_10px_35px_-8px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)] border border-slate-200/80 relative overflow-hidden flex !p-0',
            integrationStatus
          )}
          aria-label="Jornada de hoje"
        >
          {/* Decorative Brand Accent Strip on the Left Side */}
          <div aria-hidden="true" className="w-2.5 bg-[#00A868] flex-shrink-0" />

          {/* Inner Content Area */}
          <div className="flex-1 p-4 md:py-8 md:px-10 space-y-6 sm:space-y-5 min-w-0">
            {/* Header Section */}
            <header className="flex flex-wrap items-center justify-between gap-4 pb-0">
              {/* Date display with calendar icon */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100/70 flex items-center justify-center text-[#00A868] flex-shrink-0">
                  <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <span className="text-xs text-slate-400 font-semibold tracking-wider uppercase block">Data Atual</span>
                  <p className="journey-date text-xl text-[#0F172A] font-medium tracking-tight m-0">
                    Hoje, <strong className="font-bold text-[#0F172A]">{dayjs(summary.date).format('DD/MM/YYYY')}</strong>
                  </p>
                </div>
              </div>

              {/* Real-time Journey Status Badge */}
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-50/80 border border-emerald-200 text-emerald-800 text-sm font-semibold shadow-sm">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00A868]" />
                </span>
                <Tag
                  value={journeyStatusLabel}
                  severity={severity}
                  className={`journey-status ${statusClass} !border-none !bg-transparent !p-0 !text-emerald-800 !text-sm !font-semibold !shadow-none`}
                />
              </div>

              <div className="journey-header-context relative w-full">
                {previousJourneyCritical && previousRegisteredSummary && (
                  <div className="previous-journey-critical" role="alert">
                    <i className="fi fi-rr-triangle-warning" aria-hidden="true" />
                    <span>
                      Alerta crítico: foram registradas somente <strong>{formatDuration(previousWorkedMs)}</strong> em {dayjs(previousRegisteredSummary.date).format('DD/MM/YYYY')}.
                      Verifique se existe marcação ausente e envie uma solicitação ao RHiD.
                    </span>
                    <Button
                      type="button"
                      label="Nova solicitação"
                      icon="fi fi-rr-add"
                      severity="danger"
                      onClick={openPreviousJourneyRequest}
                    />
                  </div>
                )}
              </div>
            </header>

            {rhidTestMode && (
              <p className="login-notice mt-2" role="status">
                Modo de teste ativo: esta tela exibe somente registros recebidos do RHiD e não envia nova marcação.
              </p>
            )}

            {/* Primary Metrics Section */}
            <div className="m-0" aria-label="Resumo prioritário da jornada">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8 items-stretch">
                {/* Card 1: Horas Trabalhadas (Destaque Principal) */}
                <div className="bg-gradient-to-br from-[#F5FDF9] to-[#E9F8F1] border border-[#BDECD5] rounded-2xl p-5 flex flex-col justify-between shadow-[0_2px_10px_rgba(0,168,104,0.04)]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#065F46]">Trabalhado</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/80 text-[#00A868] border border-emerald-200/50">Atual</span>
                  </div>
                  <h2 className="journey-worked-time font-numeral text-4xl sm:text-5xl font-extrabold text-[#0D3B31] tracking-tight py-0 !m-0">
                    {formatDuration(countableSummary.workedMs)}
                  </h2>
                  <div className="text-[10px] font-medium text-emerald-700/80">
                    Contagem atualizada em tempo real
                  </div>
                </div>

                {/* Card 2: Horas Faltantes */}
                <div className="bg-[#FFFBF0] border border-[#FDE68A] rounded-2xl p-5 flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#B45309]">{targetReached ? 'Passaram' : 'Faltam'}</span>
                    <svg aria-hidden="true" className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <strong className="font-numeral text-4xl sm:text-5xl font-extrabold text-[#D97706] tracking-tight py-0 block">
                    {renderSignedNumeral(targetReached ? `+${formatDuration(targetDifferenceMs)}` : formatDuration(targetDifferenceMs))}
                  </strong>
                  <div className="text-[10px] font-medium text-amber-700/75">
                    {targetReached ? 'Acima da meta diária' : `Para atingir ${formatDuration(settings.targetMinutes * 60_000)} diárias`}
                  </div>
                </div>

                {/* Card 3: Saída Prevista */}
                <div className="bg-[#F8FAFC] border border-slate-200 rounded-2xl p-5 flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Saída prevista</span>
                    <svg aria-hidden="true" className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <strong className="font-numeral text-4xl sm:text-5xl font-extrabold text-[#1E293B] tracking-tight py-0 block">
                    {countableSummary.projectedFinish ? dayjs(countableSummary.projectedFinish).format('HH:mm') : '--:--'}
                  </strong>
                  <div className="text-[10px] font-medium text-slate-400">
                    {settings.breakMinutes ? `Base: ${settings.breakMinutes >= 60 ? `${Math.round(settings.breakMinutes / 60)}h` : `${settings.breakMinutes}m`} intervalo` : 'Intervalo'}
                  </div>
                </div>
              </div>

              {/* Progress Indicator Bar with Multi-segment style */}
              <div className="mt-5" aria-label="Progresso da meta trabalhada">
                <div className="flex items-center justify-between text-xs mb-2">
                  <p className="font-semibold text-slate-700 m-0">
                    <strong className="text-[#00A868] font-bold">{progressLabel}%</strong> da meta trabalhada
                  </p>
                  <span className="text-slate-400 font-medium text-[10px]">Meta: {formatDuration(settings.targetMinutes * 60_000)}h</span>
                </div>
                <div
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress}
                  className="h-3 w-full bg-slate-100 rounded-lg p-0.5 flex gap-1 border border-slate-200/60 overflow-hidden"
                  role="progressbar"
                >
                  {Array.from({ length: 10 }).map((_, i) => {
                    const threshold = (i + 1) * 10;
                    const prev = i * 10;
                    let segmentBg = 'bg-emerald-50';
                    if (progress >= threshold) {
                      segmentBg = 'bg-[#00A868]';
                    } else if (progress > prev) {
                      segmentBg = 'bg-[#22C55E]/70';
                    } else if (i === Math.floor(progress / 10) + 1) {
                      segmentBg = 'bg-emerald-100';
                    } else if (i === Math.floor(progress / 10) + 2) {
                      segmentBg = 'bg-emerald-100/70';
                    }
                    return <div key={i} className={`flex-1 rounded-sm transition-colors duration-300 ${segmentBg}`} />;
                  })}
                </div>
              </div>
            </div>

            {/* Secondary Metrics Grid */}
            <div className="metrics-grid grid grid-cols-2 md:grid-cols-4 gap-3.5" aria-label="Métricas da jornada">
              <Metric
                label="Intervalo"
                value={formatDuration(countableSummary.breakMs)}
                icon="fi-rr-mug-hot-alt"
                iconBg="bg-teal-50 text-teal-700"
                valueColor="text-slate-800"
                iconSvg={
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" strokeLinecap="round" strokeLinejoin="round" />
                    <line strokeLinecap="round" x1="6" x2="6" y1="1" y2="4" />
                    <line strokeLinecap="round" x1="10" x2="10" y1="1" y2="4" />
                    <line strokeLinecap="round" x1="14" x2="14" y1="1" y2="4" />
                  </svg>
                }
              />
              <Metric
                label={journeyCompleted ? 'Trabalhado' : 'Último dia'}
                value={journeyCompleted ? formatDuration(countableSummary.workedMs) : previousRegisteredSummary ? formatDuration(previousWorkedMs) : '--:--'}
                icon={journeyCompleted ? 'fi-rr-briefcase' : 'fi-rr-time-past'}
                iconBg="bg-blue-50 text-blue-700"
                valueColor="text-slate-800"
                iconSvg={
                  journeyCompleted ? undefined : (
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )
                }
              />
              <Metric
                label="Saldo dia"
                value={formatDuration(countableSummary.balanceMs, true)}
                icon="fi-rr-chart-line-up"
                iconBg="bg-indigo-50 text-indigo-700"
                valueColor="text-slate-800"
                iconSvg={
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              <Metric
                label="Saldo horas"
                value={formatDuration(accumulatedBalance, true)}
                icon="fi-rr-wallet"
                iconBg="bg-emerald-50 text-[#00A868]"
                valueColor="text-[#00A868]"
                iconSvg={
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" width="20" x="2" y="5" />
                    <path d="M16 12h2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
            </div>

            {/* Divider */}
            {/* <hr className="border-slate-100 my-0" /> */}

            {/* Registration Timeline Section */}
            <div className="space-y-3 py-0">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[#0F172A] tracking-tight m-0">Registro</h3>
                <div className="flex items-center gap-3">
                  {canUndoLocal && (
                    <Button text severity="secondary" size="small" label="Remover anotação local" onClick={onUndo} className="!text-xs" />
                  )}
                  <span className="text-xs text-slate-400">
                    {summary.punches.length === 1 ? '1 batida confirmada' : `${summary.punches.length} batidas confirmadas`}
                  </span>
                </div>
              </div>

              {excessCount > 0 && (
                <p className="extra-punch-alert mb-3" role="status">
                  <i className="fi fi-rr-triangle-warning" aria-hidden="true" />
                  {excessCount === 1
                    ? '1 registro excedente além dos 04 previstos.'
                    : `${excessCount} registros além dos 04 previstos.`}{' '}
                  Confira a apuração no RHiD.
                </p>
              )}

              {summary.punches.length === 0 ? (
                <p className="empty-state">Nenhum registro hoje.</p>
              ) : (
                <div className="space-y-2 relative">
                  {summary.punches.length > 1 && (
                    <div
                      aria-hidden="true"
                      className="absolute left-[23px] top-[26px] bottom-[26px] w-[2px] bg-blue-400 z-0 pointer-events-none"
                    />
                  )}

                  {summary.punches.map((punch, index) => (
                    <div
                      key={punch.id}
                      className="relative bg-slate-50/75 hover:bg-slate-50 transition-colors border border-slate-200/70 rounded-xl p-3.5 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3.5 z-10">
                        {/* Circular Target Node */}
                        <div className="w-6 h-6 rounded-full bg-white border-2 border-red-500 flex items-center justify-center shadow-xs flex-shrink-0">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm">{labelForPunch(index)}</span>
                          {index >= STANDARD_DAILY_PUNCH_LIMIT && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 tracking-wide uppercase">
                              Excedente
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${punch.origin === 'rhid' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-slate-200 text-slate-700'}`}>
                            {punch.origin === 'rhid' ? 'RHiD' : 'Local'}
                          </span>
                          {punch.origin === 'rhid' && (automaticOfficialPunchIdSet.has(punch.id) || punch.id === automaticLunchReturnPunchId) && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 tracking-wide uppercase">
                              auto
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Horizontal Leader line on desktop */}
                      <div className="hidden sm:block flex-1 mx-6 border-b border-dashed border-slate-300" />

                      <time className="font-numeral font-bold text-slate-900 text-lg sm:text-xl tracking-tight">
                        {dayjs(punch.timestamp).format('HH:mm')}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Controls and Security Footer */}
            <footer className="pt-2">
              <div className={showAutomaticLunchReturnBox ? 'grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 items-stretch w-full' : 'w-full'}>
                {showAutomaticLunchReturnBox && (
                  <div className="col-span-1 md:col-span-4 bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        {automaticLunchReturnEnabled ? 'Modo auto' : 'Retorno manual'}
                      </span>
                      {automaticLunchReturnDisabledBySettings && (
                        <>
                          <Tooltip target=".automatic-return-settings-lock" position="top" content="Desativado na sessão Ajustes" />
                          <Button
                            type="button"
                            icon="fi fi-rr-info"
                            text
                            rounded
                            severity="secondary"
                            className="automatic-return-control-tool automatic-return-settings-lock !w-6 !h-6 !p-0"
                            aria-label="Desativado na sessão Ajustes"
                          />
                          <Button
                            type="button"
                            icon="fi fi-rr-arrow-up-right-from-square"
                            text
                            rounded
                            severity="secondary"
                            className="automatic-return-control-tool automatic-return-control-link !w-6 !h-6 !p-0"
                            aria-label="Abrir a configuração do modo auto em Ajustes"
                            onClick={onOpenAutomaticReturnSettings}
                          />
                        </>
                      )}
                    </div>

                    <Tooltip target=".automatic-return-toggle-btn" position="top" content={automaticReturnTooltip} />
                    <button
                      type="button"
                      role="switch"
                      aria-checked={automaticLunchReturnEnabled}
                      aria-label="Modo auto"
                      title={automaticReturnTooltip}
                      onClick={onToggleAutomaticLunchReturn}
                      disabled={registerBusy || automaticLunchReturnDisabledBySettings}
                      className={`automatic-return-toggle-btn w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all cursor-pointer ${automaticLunchReturnEnabled
                        ? 'border-[#00A868] text-[#00A868] bg-emerald-50/50 hover:bg-emerald-100/50'
                        : 'border-slate-300 text-slate-400 bg-slate-50 hover:bg-slate-100'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {automaticLunchReturnEnabled ? (
                        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}

                <div className={`${showAutomaticLunchReturnBox ? 'col-span-1 md:col-span-8' : 'w-full'} flex flex-col justify-center`}>
                  {officialRegistration && !journeyCompletionLockActive && registrationGate.state === 'validation' && (
                    <div className="punch-lock validation p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 mb-2" role="status">
                      <p className="text-xs m-0">Intervalo mínimo concluído. Sincronize o RHiD para liberar a próxima marcação.</p>
                      <Button
                        type="button"
                        label="Sincronizar e liberar"
                        icon="fi fi-rr-refresh"
                        outlined
                        loading={validationBusy}
                        onClick={onValidateRegistration}
                        className="validation-button mt-2 w-full"
                      />
                    </div>
                  )}

                  {showRegistrationControlMessage ? (
                    <div className="registration-status-panel bg-[#F0FDF8] border border-[#B9EED8] rounded-2xl p-4 flex flex-col justify-between shadow-xs !min-h-[72px]" role="status" aria-live="polite">
                      <div className="flex items-center justify-between mb-1.5 registration-status-panel-header">
                        <span className="inline-block bg-[#FEE2E2] text-[#991B1B] text-[10px] font-bold px-2 py-0.5 rounded tracking-wider uppercase registration-status-panel-caption">
                          Bloqueio de segurança
                        </span>
                        <div className="flex items-center gap-1.5 registration-status-panel-actions">
                          {showRegistrationStatusTools && (
                            <>
                              <Button
                                type="button"
                                icon={cooldownActive ? 'fi fi-rr-lock-open-alt' : 'fi fi-rr-refresh'}
                                text
                                rounded
                                severity={cooldownActive ? 'warning' : 'secondary'}
                                className="registration-status-action !w-7 !h-7 !p-0 text-amber-600 hover:bg-amber-100/50"
                                aria-label={cooldownActive ? 'Verificar e liberar bloqueio no RHiD' : 'Atualizar bloqueio no RHiD'}
                                onClick={cooldownActive
                                  ? () => setRegistrationBlockReleaseDialogOpen(true)
                                  : onRefreshRegistrationBlock}
                                loading={validationBusy}
                                disabled={validationBusy}
                              />
                              {journeyCompletionLockActive && (
                                <Button
                                  type="button"
                                  icon="fi fi-rr-lock-open-alt"
                                  text
                                  rounded
                                  severity="warning"
                                  className="registration-status-action reabrir-jornada !w-7 !h-7 !p-0"
                                  aria-label="Reabrir jornada de trabalho"
                                  onClick={onRequestJourneyReopen}
                                />
                              )}
                            </>
                          )}
                          {!showRegistrationStatusTools && (
                            <svg aria-hidden="true" className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
                              <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed m-0 registration-status-panel-message">
                        {registrationControlMessage}
                      </p>
                      {journeyCompletionLockActive && (
                        <ProgressBar className="journey-lock-progressbar mt-2" value={journeyCompletion.progress} showValue={false} />
                      )}
                    </div>
                  ) : !(officialRegistration && !journeyCompletionLockActive && registrationGate.state === 'validation') ? (
                    <Button
                      label={rhidTestMode
                        ? 'Marcação bloqueada (teste)'
                        : registrationGate.state === 'validation'
                          ? 'Sincronize para liberar'
                          : `${officialRegistration ? 'Registrar' : 'Anotar'} ${nextPunchLabel(summary.punches.length).toLocaleLowerCase('pt-BR')}${officialRegistration ? ' no RHiD' : ''}`}
                      icon="fi fi-rr-fingerprint"
                      onClick={onRegister}
                      loading={registerBusy}
                      disabled={rhidTestMode || registrationBlocked || registerBusy}
                      className="register-button mobile-primary-record !min-h-[52px] !rounded-2xl !bg-[#00A868] hover:!bg-[#0A7E74] !border-none !text-white !font-semibold !shadow-sm !w-full"
                    />
                  ) : null}
                </div>
              </div>
            </footer>
          </div>
        </section>


      </div>

      <aside className="today-side order-2 md:col-span-12 lg:order-1 lg:col-span-4">
        <section className={integrationPanelClassName('p-5 panel', integrationStatus, 'balance')} aria-label="Ações rápidas do banco de horas">
          <div className="mx-auto flex items-center gap-8">
            <div className="w-full sm:w-1/2 gap-2 text-center">
              <p className="label">Saldo Banco de Horas</p>
              <p className={`font-heading text-4xl sm:text-5xl font-extrabold tracking-tight pt-2 ${accumulatedBalance < 0 ? 'text-error' : 'text-success'}`}>
                {renderSignedNumeral(formatDuration(accumulatedBalance, true))}
              </p>
            </div>
            <div className="w-full sm:w-1/2 text-center gap-2">
              {/* <p className="label">Nova solicitação</p> */}
              <Button
                label="Nova Solicitação"
                outlined
                severity="secondary"
                icon="fi fi-rr-add-document"
                className="provisional-record-button"
                onClick={() => onOpenRequestDialog()}
              />
            </div>
          </div>
          <div className="journey-plan-row" aria-label="Jornada planejada">
            <div className="journey-plan-values">
              <span>Jornada <strong>{formatDuration(settings.targetMinutes * 60_000)}</strong></span>
              <span>Almoço <strong>{formatDuration(settings.breakMinutes * 60_000)}</strong></span>
              <span>Total previsto <strong>{formatDuration((settings.targetMinutes + settings.breakMinutes) * 60_000)}</strong></span>
            </div>
            <Tooltip target=".journey-settings-link" position="top" content="Alterar jornada e intervalo em Ajustes" />
            <Button
              type="button"
              icon="fi fi-rr-settings"
              text
              rounded
              severity="secondary"
              className="journey-settings-link"
              aria-label="Alterar jornada padrão nos Ajustes"
              title="Alterar jornada e intervalo em Ajustes"
              onClick={onOpenJourneySettings}
            />
          </div>
        </section>
        <section className={integrationPanelClassName('p-5 history-shortcuts panel', integrationStatus, 'history')} aria-label="Histórico de registros">
          <p className="label history-shortcuts-label">Histórico de registros</p>
          <div className="history-shortcut-actions mt-3">
            <Button
              label="Semana"
              icon="fi fi-rr-calendar-week"
              outlined
              severity="secondary"
              className="history-shortcut-button"
              onClick={() => onOpenHistory('week')}
            />
            <Button
              label="Este mês"
              icon="fi fi-rr-calendar"
              outlined
              severity="info"
              className="history-shortcut-button"
              onClick={() => onOpenHistory('month')}
            />
            <Button
              label="Ontem"
              icon="fi fi-rr-time-past"
              outlined
              severity="success"
              className="history-shortcut-button"
              onClick={() => onOpenHistory('yesterday')}
            />
          </div>
        </section>
        {integrationPanel}
      </aside>
      <Dialog
        header="Desativar bloqueio de segurança?"
        visible={registrationBlockReleaseDialogOpen}
        onHide={() => setRegistrationBlockReleaseDialogOpen(false)}
        className="alert-detail-dialog"
        style={{ width: 'min(30rem, 92vw)' }}
        modal
        footer={(
          <div className="alerts-dialog-actions dialog-footer-actions">
            <Button
              type="button"
              label="Não"
              severity="secondary"
              outlined
              onClick={() => setRegistrationBlockReleaseDialogOpen(false)}
            />
            <Button
              type="button"
              label="Sim"
              icon="fi fi-rr-lock-open-alt"
              severity="warning"
              loading={validationBusy}
              disabled={validationBusy}
              onClick={() => {
                setRegistrationBlockReleaseDialogOpen(false);
                void onRefreshRegistrationBlock();
              }}
            />
          </div>
        )}
      >
        <div className="alert-detail-content">
          <p className="alert-detail-body warning">
            Deseja verificar no RHiD e liberar o bloqueio? A liberação só ocorrerá se o intervalo mínimo tiver terminado.
          </p>
        </div>
      </Dialog>
      <span className="absolute -bottom-5 right-0 p-2 text-[0.7rem] text-slate-400 pointer-events-none select-none">
        versão publicada: {formatPublishedVersion()}
      </span>
    </div>
  );
}

function RhidIntegrationPanel({
  session,
  personId,
  onPersonIdChange,
  snapshot,
  busy,
  status,
  onStatusChange,
  events,
  message,
  autoSyncRemainingMs,
  onSync,
  onSessionExpired,
  onSelectCompany,
}: {
  session: AuthSession;
  personId: number | null;
  onPersonIdChange: (id: number | null) => void;
  snapshot: RhidSnapshot | null;
  busy: boolean;
  status: IntegrationStatus;
  onStatusChange: (status: IntegrationStatus) => void;
  events: SyncEvent[];
  message: string;
  autoSyncRemainingMs: number | null;
  onSync: () => Promise<void>;
  onSessionExpired: (notice?: string) => void;
  onSelectCompany: () => Promise<void>;
}) {
  const [people, setPeople] = useState<RhidPerson[]>([]);
  const [peopleMessage, setPeopleMessage] = useState('');
  const [needsCompany, setNeedsCompany] = useState(false);
  const statusPresentation = {
    connected: { label: 'Conectado', icon: 'fi-rr-check-circle' },
    syncing: { label: 'Atualizando', icon: 'fi-rr-refresh' },
    warning: { label: 'Desconectado', icon: 'fi-rr-cloud-disabled' },
    error: { label: 'Falha', icon: 'fi-rr-plug-circle-exclamation' },
  }[status];
  const officialPunchFeatureEnabled = session.officialPunchEnabled ?? true;
  // const integrationDisplayName = session.displayName?.trim() || session.email;
  const visibleSyncEvents = useMemo(() => latestDistinctSyncEvents(events), [events]);

  useEffect(() => {
    if (session.workerDaily) {
      setPeople([]);
      setNeedsCompany(false);
      setPeopleMessage('');
      return;
    }
    if (session.isPerson && session.personId) {
      setPeople([{ id: session.personId, name: 'Trabalhador autenticado' }]);
      setNeedsCompany(false);
      setPeopleMessage('');
      onStatusChange('connected');
      onPersonIdChange(session.personId);
      return;
    }
    onStatusChange('syncing');
    listRhidPeople()
      .then((records) => {
        setPeople(records);
        setNeedsCompany(false);
        setPeopleMessage('');
        onStatusChange('connected');
        if (records.length === 1) {
          onPersonIdChange(records[0].id);
        }
      })
      .catch((error: Error) => {
        if (isAuthRelatedRhidError(error)) {
          onSessionExpired();
          return;
        }
        if (error instanceof RhidApiError && error.status === 403 && !session.domain) {
          setNeedsCompany(true);
          setPeopleMessage('Selecione a empresa no login para liberar a consulta.');
          onStatusChange('warning');
          return;
        }
        setPeopleMessage(error.message);
        onStatusChange('error');
      });
  }, [onPersonIdChange, onSessionExpired, onStatusChange, session.domain, session.isPerson, session.personId, session.workerDaily]);

  return (
    <section
      className={integrationPanelClassName('p-5 panel account-panel', status)}
      aria-label="Conta e sincronização RHiD"
    >
      <div className="account-header">
        <div className="account-identity">
          <span className="account-avatar" aria-hidden="true">
            <i className="fi fi-rr-user" />
          </span>
          <div className="account-identity-copy">
            <span className="account-eyebrow">Conta RHiD</span>
            {/* <strong>{integrationDisplayName}</strong> */}
            <small>{session.email}</small>
          </div>
        </div>
        <span
          className={`account-status-chip ${status}`}
          role="status"
          title={`${statusPresentation.label} ao serviço RHiD`}
        >
          <i className={`fi ${statusPresentation.icon}`} aria-hidden="true" />
          {statusPresentation.label}
        </span>
      </div>
      <div className="integration-body">
        {!session.workerDaily && (
          <label className="field account-person-field">
            <span>Funcionário</span>
            {people.length > 0 ? (
              <select
                className="app-select"
                value={personId ?? ''}
                onChange={(event) => onPersonIdChange(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Selecionar</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name ?? 'Funcionário'} {person.registration ? `- ${person.registration}` : ''} - ID {person.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="app-input"
                type="number"
                min="1"
                placeholder="ID do funcionário"
                value={personId ?? ''}
                onChange={(event) => onPersonIdChange(event.target.value ? Number(event.target.value) : null)}
              />
            )}
          </label>
        )}
        {session.workerDaily && !officialPunchFeatureEnabled && (
          <p className="login-notice" role="status">
            Envio oficial bloqueado no modo de teste. A sincronização apenas consulta registros.
          </p>
        )}
        <div className="account-sync-overview">
          <div className="account-sync-fact">
            <span>Próxima atualização</span>
            <strong>{autoSyncRemainingMs === null ? '--:--' : formatDuration(autoSyncRemainingMs)}</strong>
          </div>
          <div className="account-sync-fact">
            <span>Última sincronização</span>
            <strong>{snapshot?.syncedAt ? dayjs(snapshot.syncedAt).format('HH:mm') : '--:--'}</strong>
          </div>
          <Button
            label="Atualizar agora"
            icon="fi fi-rr-refresh"
            className="p-button-outlined refresh-button account-refresh-button"
            loading={busy}
            disabled={!personId && !session.workerDaily}
            onClick={onSync}
            aria-label="Atualizar registros do RHiD"
            title="Atualizar registros do RHiD"
          />
        </div>
        {snapshot && snapshot.source !== 'portal-daily' && (
          <p className="account-period">
            Período consultado: {snapshot.dataIni ? dayjs(snapshot.dataIni).format('DD/MM/YYYY') : '--'} a {snapshot.dataFinal ? dayjs(snapshot.dataFinal).format('DD/MM/YYYY') : '--'}.
          </p>
        )}
        <div className="account-events">
          <div className="account-events-header">
            <p className="label">Últimas verificações</p>
            <small>{visibleSyncEvents.length} {visibleSyncEvents.length === 1 ? 'registro' : 'registros'}</small>
          </div>
          {visibleSyncEvents.length === 0 ? (
            <p className="sync-event-empty">Nenhuma atualização registrada nesta aplicação.</p>
          ) : (
            <ol className="account-event-list">
              {visibleSyncEvents.map((event) => (
                <li className={event.status} key={event.id}>
                  <span className="account-event-marker" aria-hidden="true" />
                  <div className='whitespace-pre'>
                    <time>{dayjs(event.timestamp).format('DD/MM - HH:mm')}</time>
                    <span>{event.description}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        {peopleMessage && <p className="text-sm text-slate-600">{peopleMessage}</p>}
        {needsCompany && (
          <Button
            label="Selecionar empresa"
            className="p-button-primary primary w-full"
            onClick={onSelectCompany}
          />
        )}
        {message && status !== 'connected' && <p className="text-sm text-slate-600">{message}</p>}
      </div>
    </section>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`navigation-button ${active ? 'active' : ''}`}
      onClick={onClick}
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
    >
      <i className={`fi ${icon}`} aria-hidden="true" />
      <span className="navigation-button-label">{label}</span>
    </button>
  );
}

function Metric({
  label,
  value,
  icon,
  detail,
  iconBg = 'bg-teal-50 text-teal-700',
  valueColor = 'text-slate-800',
  iconSvg,
}: {
  label: string;
  value: string;
  icon?: string | null;
  detail?: string;
  iconBg?: string;
  valueColor?: string;
  iconSvg?: React.ReactNode;
}) {
  return (
    <div className="metric bg-white border border-slate-200/80 hover:border-slate-300 rounded-xl p-4 text-center transition-all shadow-sm flex flex-col items-center justify-between !min-h-0">
      <div className="flex justify-center mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          {iconSvg ? iconSvg : icon ? <i className={`fi ${icon} text-sm`} aria-hidden="true" /> : null}
          {!iconSvg && !icon && detail ? <span className="metric-detail">{detail}</span> : null}
        </div>
      </div>
      <div>
        <span className="label block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</span>
        <span className={`font-heading font-numeral text-xl font-bold ${valueColor}`}>{renderSignedNumeral(value)}</span>
      </div>
    </div>
  );
}

export default App;
