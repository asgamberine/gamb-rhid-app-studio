import { useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Button } from 'primereact/button';
import { Column } from 'primereact/column';
import { DataTable } from 'primereact/datatable';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Tooltip } from 'primereact/tooltip';
import { balancePeriodEndDate, excessPunchCount, formatDuration, officialAccumulatedBalanceAt, officialBalanceForPeriod, STANDARD_DAILY_PUNCH_LIMIT } from '../domain/journey';
import { isCountableWorkday } from '../domain/workday';
import { createRhidRequest, readRhidPendingItems, readRhidRequests } from '../services/rhidApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { MobileHistoryView } from './mobile/MobileHistoryView';
import type { DaySummary, HistoryPeriod, OfficialPunchArchive, RhidPendingItem, RhidRequestInput, RhidRequestRecord, RhidSnapshot } from '../types';

type HistorySort = 'newest' | 'oldest';
type HistoryPunchFilter = 'all' | 'less-than-four-rhid';
type YesterdayNoticeSeverity = 'success' | 'info' | 'warning' | 'error';
type RequestSubmissionNotice = {
  status: 'submitting' | 'success' | 'error';
  title: string;
  message: string;
  request?: RhidRequestRecord;
};

const periodOptions: { label: string; value: HistoryPeriod }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Ontem', value: 'yesterday' },
  { label: 'Semana', value: 'week' },
  { label: 'Este mês', value: 'month' },
];

const requestTypeOptions = [
  { label: 'Inclusão de marcação', value: 'inclusao_marcacao' },
  { label: 'Atestado', value: 'atestado' },
  { label: 'Atestado INSS', value: 'atestado_inss' },
  { label: 'Banco de horas', value: 'banco_horas' },
  { label: 'Faltas', value: 'faltas' },
  { label: 'Abono', value: 'abono' },
  { label: 'Ajuste de horas', value: 'ajuste_horas' },
  { label: 'Relocar extra/falta', value: 'relocar_extra_falta' },
] as const;

const historyPunchColumns = [
  { header: 'Entrada 1', index: 0 },
  { header: 'Saída 1', index: 1 },
  { header: 'Entrada 2', index: 2 },
  { header: 'Saída 2', index: 3 },
] as const;

function requestTypeLabel(value: string): string {
  return requestTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function requestDateLabel(value: string): string {
  const date = dayjs(value);
  return date.isValid() ? date.format('DD/MM/YYYY') : 'Data não informada';
}

function requestStatusLabel(status: RhidRequestRecord['status']): string {
  if (status === 'approved') return 'Aprovado';
  if (status === 'rejected') return 'Recusado';
  if (status === 'queued') return 'Fila local';
  return 'Em análise';
}

function requestStatusSurfaceClass(status: RhidRequestRecord['status']): string {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'queued') return 'border-slate-200 bg-slate-100 text-slate-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function requestSourceLabel(source: RhidRequestRecord['source']): string {
  return source === 'local' ? 'Fila local' : 'RHiD';
}

function requestPeriodBounds(period: HistoryPeriod, referenceDate: string, fallbackStart: string): { startDate: string; endDate: string } {
  const reference = dayjs(referenceDate);
  if (period === 'yesterday') {
    const day = reference.subtract(1, 'day').format('YYYY-MM-DD');
    return { startDate: day, endDate: day };
  }
  if (period === 'week') {
    return {
      startDate: reference.subtract((reference.day() + 6) % 7, 'day').format('YYYY-MM-DD'),
      endDate: reference.format('YYYY-MM-DD'),
    };
  }
  if (period === 'month') {
    return {
      startDate: reference.startOf('month').format('YYYY-MM-DD'),
      endDate: reference.format('YYYY-MM-DD'),
    };
  }
  return { startDate: fallbackStart || reference.format('YYYY-MM-DD'), endDate: reference.format('YYYY-MM-DD') };
}

function mondayOfWeek(date: Dayjs): Dayjs {
  return date.subtract((date.day() + 6) % 7, 'day').startOf('day');
}

function includesPeriod(date: string, period: HistoryPeriod, referenceDate: string): boolean {
  const current = dayjs(date);
  const reference = dayjs(referenceDate);
  if (period === 'yesterday') {
    return current.isSame(reference.subtract(1, 'day'), 'day');
  }
  if (period === 'week') {
    return !current.isBefore(mondayOfWeek(reference), 'day') && !current.isAfter(reference, 'day');
  }
  if (period === 'month') {
    return !current.isBefore(reference.startOf('month'), 'day') && !current.isAfter(reference, 'day');
  }
  return true;
}

function intersectsPeriod(startDate: string, endDate: string, periodStart: string, periodEnd: string): boolean {
  return startDate <= periodEnd && endDate >= periodStart;
}

function HistoryView({
  history,
  rhidSnapshot,
  officialArchive,
  syncMessage,
  selectedPeriod,
  onPeriodChange,
  referenceDate,
  requesterDisplayName,
  requestsEnabled = false,
  requestDialogSeed,
  onRequestDialogConsumed,
  onRequestSubmitted,
  onRegister,
  registerBusy,
  registrationDisabled,
  registrationLabel,
  automaticOfficialPunchIdSet,
}: {
  history: DaySummary[];
  rhidSnapshot: RhidSnapshot | null;
  officialArchive?: OfficialPunchArchive | null;
  syncMessage?: string;
  selectedPeriod: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  referenceDate: string;
  requesterDisplayName?: string;
  requestsEnabled?: boolean;
  requestDialogSeed?: { startDate: string; endDate: string; type: string; time?: string; notes: string } | null;
  onRequestDialogConsumed?: () => void;
  onRequestSubmitted?: (request: RhidRequestRecord) => void;
  onRegister: () => void | Promise<void>;
  registerBusy: boolean;
  registrationDisabled: boolean;
  registrationLabel: string;
  automaticOfficialPunchIdSet?: Set<string>;
}) {
  const isMobile = useIsMobile(1249);
  const [sort, setSort] = useState<HistorySort>('newest');
  const [punchFilter, setPunchFilter] = useState<HistoryPunchFilter>('all');
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<RhidPendingItem[]>([]);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [allRequests, setAllRequests] = useState<RhidRequestRecord[]>([]);
  const [requestsBusy, setRequestsBusy] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [requestsPeriod, setRequestsPeriod] = useState<HistoryPeriod>('month');
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestsListOpen, setRequestsListOpen] = useState(false);
  const [requestDetail, setRequestDetail] = useState<RhidRequestRecord | null>(null);
  const [requestType, setRequestType] = useState(requestTypeOptions[0].value);
  const [requestStartDate, setRequestStartDate] = useState(referenceDate);
  const [requestEndDate, setRequestEndDate] = useState(referenceDate);
  const [requestTime, setRequestTime] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSubmissionNotice, setRequestSubmissionNotice] = useState<RequestSubmissionNotice | null>(null);
  const [requestRetryOf, setRequestRetryOf] = useState<string | null>(null);
  const [dismissedYesterdayNoticeKey, setDismissedYesterdayNoticeKey] = useState<string | null>(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyDialogSection, setHistoryDialogSection] = useState<'records' | 'raw'>('records');
  const officialPunchCount = history.reduce((total, day) => total + day.punches.length, 0);
  const excludedPunchCount = officialArchive?.excludedPunchCount ?? rhidSnapshot?.excludedPunchCount ?? 0;
  const lastOfficialUpdate = officialArchive?.savedAt ?? rhidSnapshot?.syncedAt;
  const pendingDaySet = useMemo(
    () => new Set([
      ...(officialArchive?.pendingDays ?? []),
      ...(rhidSnapshot?.pendingDays ?? []),
    ].map((day) => day.date)),
    [officialArchive?.pendingDays, rhidSnapshot?.pendingDays],
  );
  const officialBalanceDays = useMemo(
    () => officialArchive?.officialBalanceDays ?? rhidSnapshot?.officialBalanceDays ?? [],
    [officialArchive?.officialBalanceDays, rhidSnapshot?.officialBalanceDays],
  );
  const yesterdayFilterResult = useMemo(() => {
    const civilYesterday = dayjs(referenceDate).subtract(1, 'day').format('YYYY-MM-DD');
    const selectedDay = [...history]
      .filter((row) => row.date <= civilYesterday && row.punches.length > 0)
      .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
    if (!selectedDay) {
      return {
        date: null,
        severity: 'error' as YesterdayNoticeSeverity,
        message: `Crítico: nenhuma marcação anterior a ${dayjs(referenceDate).format('DD/MM/YYYY')} foi encontrada no histórico disponível.`,
      };
    }
    if (selectedDay.date === civilYesterday) {
      return {
        date: selectedDay.date,
        severity: 'success' as YesterdayNoticeSeverity,
        message: `Ontem: exibindo ${dayjs(selectedDay.date).format('DD/MM/YYYY')}, com marcações encontradas.`,
      };
    }
    let cursor = dayjs(civilYesterday);
    let skippedCountableWorkday = false;
    while (cursor.isAfter(dayjs(selectedDay.date), 'day')) {
      if (isCountableWorkday(cursor.format('YYYY-MM-DD'))) {
        skippedCountableWorkday = true;
        break;
      }
      cursor = cursor.subtract(1, 'day');
    }
    return skippedCountableWorkday
      ? {
        date: selectedDay.date,
        severity: 'warning' as YesterdayNoticeSeverity,
        message: `Atenção: não houve marcação em um ou mais dias úteis anteriores. Exibindo o último dia com marcação: ${dayjs(selectedDay.date).format('DD/MM/YYYY')}.`,
      }
      : {
        date: selectedDay.date,
        severity: 'info' as YesterdayNoticeSeverity,
        message: `Ontem ajustado: ${dayjs(selectedDay.date).format('DD/MM/YYYY')} foi o último dia útil com marcação. Os dias posteriores não possuem jornada.`,
      };
  }, [history, referenceDate]);
  const filteredHistory = useMemo(() => {
    const rows = history.filter((row) => {
      const belongsToPeriod = selectedPeriod === 'yesterday'
        ? row.date === yesterdayFilterResult.date
        : includesPeriod(row.date, selectedPeriod, referenceDate);
      if (!belongsToPeriod) {
        return false;
      }
      if (punchFilter === 'less-than-four-rhid') {
        const rhidPunchCount = row.punches.filter((punch) => punch.origin === 'rhid').length;
        if (rhidPunchCount >= STANDARD_DAILY_PUNCH_LIMIT) {
          return false;
        }
      }
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === 'oldest') return a.date.localeCompare(b.date);
      return b.date.localeCompare(a.date);
    });
  }, [history, punchFilter, referenceDate, selectedPeriod, sort, yesterdayFilterResult.date]);
  const hasOfficialHistory = Boolean(syncMessage || rhidSnapshot || officialArchive);
  const earliestHistoryDate = history.reduce(
    (earliest, day) => !earliest || day.date < earliest ? day.date : earliest,
    '',
  );
  const latestHistoryDate = history.reduce(
    (latest, day) => !latest || day.date > latest ? day.date : latest,
    '',
  );
  const historyStartDate = (officialArchive?.dataIni ?? rhidSnapshot?.dataIni ?? earliestHistoryDate) || referenceDate;
  const historyEndDate = (officialArchive?.dataFinal ?? rhidSnapshot?.dataFinal ?? latestHistoryDate) || referenceDate;
  const historyPeriodLabel = `${dayjs(historyStartDate).format('DD/MM/YY')} a ${dayjs(historyEndDate).format('DD/MM/YY')}`;
  const requestPeriod = requestsPeriod === 'yesterday' && yesterdayFilterResult.date
    ? { startDate: yesterdayFilterResult.date, endDate: yesterdayFilterResult.date }
    : requestPeriodBounds(requestsPeriod, referenceDate, historyStartDate);
  const yesterdayNoticeKey = `${referenceDate}:${yesterdayFilterResult.date ?? 'none'}:${yesterdayFilterResult.severity}`;
  const showYesterdayNotice = selectedPeriod === 'yesterday'
    && dismissedYesterdayNoticeKey !== yesterdayNoticeKey;
  const todaySummary = history.find((day) => day.date === referenceDate) ?? null;
  const generalBalanceEndDate = balancePeriodEndDate(
    todaySummary,
    referenceDate,
    true,
  );
  const currentMonthStartDate = dayjs(referenceDate).startOf('month').format('YYYY-MM-DD');
  const fallbackBalanceForPeriod = (startDate: string, endDate: string) => history
    .filter((day) => (
      day.date >= startDate
      && day.date <= endDate
      && day.punches.length > 0
      && !day.isWorking
      && !day.isOnBreak
    ))
    .reduce((total, day) => total + day.balanceMs, 0);
  const generalBalance = officialAccumulatedBalanceAt(
    officialBalanceDays,
    generalBalanceEndDate,
  ) ?? fallbackBalanceForPeriod(historyStartDate, generalBalanceEndDate);
  const monthlyBalance = officialBalanceForPeriod(
    officialBalanceDays,
    currentMonthStartDate,
    generalBalanceEndDate,
  ) ?? fallbackBalanceForPeriod(currentMonthStartDate, generalBalanceEndDate);
  const generalBalanceHelp = `Saldo acumulado geral até ${dayjs(generalBalanceEndDate).format('DD/MM/YYYY')}. Período disponível: ${historyPeriodLabel}.`;
  const monthlyBalanceHelp = `Resultado acumulado no mês atual, de ${dayjs(currentMonthStartDate).format('DD/MM/YYYY')} até ${dayjs(generalBalanceEndDate).format('DD/MM/YYYY')}, considerando jornadas concluídas.`;
  const sortedRequests = useMemo(
    () => [...allRequests].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
    [allRequests],
  );
  const requestRows = useMemo(() => {
    return sortedRequests.filter((request) => (
      intersectsPeriod(
        request.startDate,
        request.endDate,
        requestPeriod.startDate,
        requestPeriod.endDate,
      )
    ));
  }, [requestPeriod.endDate, requestPeriod.startDate, sortedRequests]);
  const latestPendingRequests = useMemo(
    () => sortedRequests
      .filter((request) => request.status === 'pending' || request.status === 'queued')
      .filter((request) => dayjs(request.requestedAt).isValid())
      .slice(0, 3),
    [sortedRequests],
  );
  async function showPendingDetails(date: string) {
    setPendingDate(date);
    setPendingItems([]);
    setPendingError('');
    setPendingBusy(true);
    try {
      const items = await readRhidPendingItems(date);
      setPendingItems(items);
      if (items.length === 0) {
        setPendingError('O RHiD sinalizou pendência para este dia, mas não retornou detalhe disponível.');
      }
    } catch (error) {
      setPendingError(error instanceof Error ? error.message : 'Não foi possível carregar as pendências do RHiD.');
    } finally {
      setPendingBusy(false);
    }
  }

  useEffect(() => {
    setRequestStartDate(referenceDate);
    setRequestEndDate(referenceDate);
  }, [referenceDate]);

  useEffect(() => {
    if (!requestDialogSeed) {
      return;
    }
    setRequestType(requestDialogSeed.type as typeof requestType);
    setRequestStartDate(requestDialogSeed.startDate);
    setRequestEndDate(requestDialogSeed.endDate);
    setRequestTime(requestDialogSeed.time ?? '');
    setRequestNotes(requestDialogSeed.notes);
    setRequestsListOpen(false);
    setRequestDialogOpen(true);
    onRequestDialogConsumed?.();
  }, [onRequestDialogConsumed, requestDialogSeed]);

  function openRequestDialog() {
    setRequestType(requestTypeOptions[0].value);
    setRequestStartDate(referenceDate);
    setRequestEndDate(referenceDate);
    setRequestTime('');
    setRequestNotes('');
    setRequestRetryOf(null);
    setRequestsListOpen(false);
    setRequestDialogOpen(true);
  }

  function retryQueuedRequest(request: RhidRequestRecord) {
    setRequestDetail(null);
    const suggestedTime = request.notes?.match(/Horário sugerido:\s*([0-2]\d:[0-5]\d)/i)?.[1] ?? '';
    setRequestType(request.type as typeof requestType);
    setRequestStartDate(request.startDate);
    setRequestEndDate(request.endDate);
    setRequestTime(suggestedTime);
    setRequestNotes(request.notes?.replace(/\s*Horário sugerido:\s*[0-2]\d:[0-5]\d\.\s*/i, ' ').trim() ?? '');
    setRequestRetryOf(request.id);
    setRequestDialogOpen(true);
  }

  function openRequestDetail(request: RhidRequestRecord) {
    setRequestsListOpen(false);
    setRequestDetail(request);
  }

  function closeRequestDetail() {
    setRequestDetail(null);
  }

  function closeRequestSubmissionNotice() {
    if (!requestSubmissionNotice || requestSubmissionNotice.status === 'submitting') {
      return;
    }
    const submittedRequest = requestSubmissionNotice.request;
    setRequestSubmissionNotice(null);
    if (submittedRequest) {
      onRequestSubmitted?.(submittedRequest);
    }
  }

  function reopenRequestAfterFailure() {
    setRequestSubmissionNotice(null);
    setRequestDialogOpen(true);
  }

  function toggleDateSort() {
    setSort((current) => (current === 'newest' ? 'oldest' : 'newest'));
  }

  useEffect(() => {
    if (!requestsEnabled) {
      setAllRequests([]);
      setRequestsError('');
      return;
    }
    let cancelled = false;
    setRequestsBusy(true);
    setRequestsError('');
    readRhidRequests(historyStartDate, referenceDate)
      .then((items) => {
        if (cancelled) return;
        setAllRequests(items);
      })
      .catch((error) => {
        if (cancelled) return;
        setRequestsError(error instanceof Error ? error.message : 'Não foi possível carregar as solicitações do RHiD.');
        setAllRequests([]);
      })
      .finally(() => {
        if (!cancelled) {
          setRequestsBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [historyStartDate, referenceDate, requestsEnabled]);

  async function submitRequest() {
    setRequestSubmitting(true);
    setRequestsError('');
    try {
      const startDate = requestStartDate || referenceDate;
      const endDate = requestEndDate || startDate;
      if (!requestType || !startDate || !endDate) {
        setRequestSubmissionNotice({
          status: 'error',
          title: 'Solicitação não enviada',
          message: 'Revise o tipo e o período da solicitação antes de enviar.',
        });
        return;
      }
      if (requestType === 'inclusao_marcacao' && (!requestTime.trim() || startDate !== endDate)) {
        setRequestSubmissionNotice({
          status: 'error',
          title: 'Horário obrigatório',
          message: 'Para inclusão de marcação, informe uma única data e o horário que deve ser registrado no RHiD.',
        });
        return;
      }
      const typeLabel = requestTypeLabel(requestType);
      const notes = requestNotes.trim();
      const timeLabel = requestTime.trim();
      const noteSuffix = timeLabel ? `Horário sugerido: ${timeLabel}.` : '';
      const finalNotes = [notes, noteSuffix].filter(Boolean).join(' ');
      const payload: RhidRequestInput = {
        type: requestType,
        startDate,
        endDate,
        time: timeLabel || undefined,
        retryOf: requestRetryOf ?? undefined,
        description: finalNotes ? `${typeLabel} - ${finalNotes}` : typeLabel,
        notes: finalNotes || undefined,
      };
      setRequestDialogOpen(false);
      setRequestSubmissionNotice({
        status: 'submitting',
        title: 'Enviando ao RHiD',
        message: 'Validando a sessão, enviando a solicitação e aguardando a confirmação oficial no RHiD.',
      });
      const created = await createRhidRequest(payload);
      setAllRequests((current) => [created, ...current.filter((request) => request.id !== requestRetryOf)]);
      setRequestSubmissionNotice({
        status: 'success',
        title: 'Solicitação registrada no RHiD',
        message: 'O RHiD recebeu e confirmou a solicitação. Feche esta notificação para visualizar os passos de envio do e-mail.',
        request: created,
      });
      setRequestNotes('');
      setRequestTime('');
      setRequestRetryOf(null);
      setRequestType(requestTypeOptions[0].value);
      setRequestStartDate(referenceDate);
      setRequestEndDate(referenceDate);
    } catch (error) {
      setRequestSubmissionNotice({
        status: 'error',
        title: 'Falha ao registrar no RHiD',
        message: error instanceof Error ? error.message : 'Não foi possível criar a solicitação.',
      });
    } finally {
      setRequestSubmitting(false);
    }
  }

  return (
    <div className={isMobile ? 'history-mobile-container' : 'grid gap-5'}>
      {isMobile ? (
        <MobileHistoryView
          history={history}
          rhidSnapshot={rhidSnapshot}
          officialArchive={officialArchive ?? null}
          automaticOfficialPunchIdSet={automaticOfficialPunchIdSet ?? new Set()}
          syncMessage={syncMessage}
          selectedPeriod={selectedPeriod}
          onPeriodChange={onPeriodChange}
          referenceDate={referenceDate}
          requesterDisplayName={requesterDisplayName ?? ''}
          requestsEnabled={requestsEnabled ?? true}
          onRequestSubmitted={() => {}}
          onRegister={onRegister}
          registerBusy={registerBusy}
          registrationDisabled={registrationDisabled}
          registrationLabel={registrationLabel}
          onOpenNewRequest={(seed) => {
            if (seed) {
              setRequestType((seed.type as typeof requestType) ?? requestTypeOptions[0].value);
              setRequestStartDate(seed.startDate ?? referenceDate);
              setRequestEndDate(seed.endDate ?? referenceDate);
              setRequestTime(seed.time ?? '');
              setRequestNotes(seed.notes ?? '');
              setRequestRetryOf(null);
            } else {
              openRequestDialog();
            }
            setRequestDialogOpen(true);
          }}
          pendingRequests={allRequests.filter((r) => r.status === 'pending' || r.status === 'queued')}
          onOpenPendingRequests={() => setRequestsListOpen(true)}
        />
      ) : (
        <>
          {requestsEnabled && (
            <section className="panel p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600">Solicitações pendentes:</span>
              {latestPendingRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  className="rounded-md border border-line bg-white px-2 py-1 text-left text-xs text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                  onClick={() => openRequestDetail(request)}
                  title={`Abrir solicitação criada em ${requestDateLabel(request.requestedAt)}`}
                >
                  {requestDateLabel(request.requestedAt)}
                </button>
              ))}
              {!requestsBusy && latestPendingRequests.length === 0 && (
                <span className="text-sm text-slate-500">Nenhuma</span>
              )}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-4">
              <Button
                label="Nova solicitação"
                icon="fi fi-rr-add"
                severity="secondary"
                outlined
                onClick={openRequestDialog}
              />
              <span
                className="inline-flex"
                style={{ cursor: registrationDisabled ? 'not-allowed' : undefined }}
              >
                <Button
                  type="button"
                  label={registrationLabel}
                  icon="fi fi-rr-fingerprint"
                  onClick={onRegister}
                  loading={registerBusy}
                  disabled={registrationDisabled}
                  className="history-register-button"
                />
              </span>
            </div>
          </div>
          {requestsBusy && <p className="mt-4 text-sm text-slate-500">Consultando solicitações no RHiD...</p>}
          {!requestsBusy && requestsError && <p className="mt-4 login-error">{requestsError}</p>}
        </section>
      )}
      <section className="panel overflow-hidden" aria-label="Banco de horas">
        <div className="history-toolbar">
          <div className="history-controls">
            <div className="history-periods" role="group" aria-label="Filtrar período">
              {periodOptions.map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  outlined={selectedPeriod !== option.value}
                  severity="secondary"
                  className="history-filter-button"
                  onClick={() => onPeriodChange(option.value)}
                />
              ))}
              <Button
                label="Menos de 4 RHiD"
                outlined={punchFilter !== 'less-than-four-rhid'}
                severity="secondary"
                className="history-filter-button"
                aria-pressed={punchFilter === 'less-than-four-rhid'}
                onClick={() => setPunchFilter((current) => (
                  current === 'less-than-four-rhid' ? 'all' : 'less-than-four-rhid'
                ))}
              />
            </div>
          </div>
          <div className="history-summary">
            <div className="history-balances">
              <div className="history-balance">
                <Tooltip target=".history-balance-info-general" position="top" content={generalBalanceHelp} />
                <div className="history-balance-heading">
                  <p className="label">Saldo Banco</p>
                  <button
                    type="button"
                    className="history-balance-info history-balance-info-general"
                    aria-label="Explicar o saldo geral do banco de horas"
                  >
                    <i className="fi fi-rr-info" aria-hidden="true" />
                  </button>
                </div>
                <p className={`font-heading text-2xl font-bold ${generalBalance < 0 ? 'text-error' : 'text-success'}`}>
                  {formatDuration(generalBalance, true)}
                </p>
              </div>
              <div className="history-balance history-balance-month">
                <Tooltip target=".history-balance-info-month" position="top" content={monthlyBalanceHelp} />
                <div className="history-balance-heading">
                  <p className="label">Saldo mês</p>
                  <button
                    type="button"
                    className="history-balance-info history-balance-info-month"
                    aria-label="Explicar o saldo do mês"
                  >
                    <i className="fi fi-rr-info" aria-hidden="true" />
                  </button>
                </div>
                <p className={`font-heading text-2xl font-bold ${monthlyBalance < 0 ? 'text-error' : 'text-success'}`}>
                  {formatDuration(monthlyBalance, true)}
                </p>
              </div>
            </div>
              {hasOfficialHistory && (
                <div className="history-access">
                  <Button
                    type="button"
                    icon="fi fi-rr-time-past"
                    severity="secondary"
                    outlined
                    rounded
                    aria-label="Ver histórico"
                    title="Ver histórico"
                    onClick={() => setHistoryDialogOpen(true)}
                  />
                </div>
              )}
          </div>
        </div>
        {showYesterdayNotice && (
          <div
            className={`history-filter-notice ${yesterdayFilterResult.severity}`}
            role={yesterdayFilterResult.severity === 'error' || yesterdayFilterResult.severity === 'warning' ? 'alert' : 'status'}
          >
            <i
              className={yesterdayFilterResult.severity === 'success'
                ? 'fi fi-rr-check-circle'
                : yesterdayFilterResult.severity === 'info'
                  ? 'fi fi-rr-info'
                  : 'fi fi-rr-triangle-warning'}
              aria-hidden="true"
            />
            <span>{yesterdayFilterResult.message}</span>
            <button
              type="button"
              aria-label="Fechar informação do filtro Ontem"
              title="Fechar"
              onClick={() => setDismissedYesterdayNoticeKey(yesterdayNoticeKey)}
            >
              <i className="fi fi-rr-cross-small" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="history-table-box">
          {filteredHistory.length === 0 ? (
            <p className="empty-state m-5">Nenhuma jornada encontrada para o filtro selecionado.</p>
          ) : (
            <DataTable value={filteredHistory} responsiveLayout="scroll" className="history-table">
              <Column
                header={(
                  <button
                    type="button"
                    className="history-column-sort"
                    onClick={toggleDateSort}
                    aria-label={sort === 'oldest' ? 'Classificar data em ordem decrescente' : 'Classificar data em ordem crescente'}
                    title={sort === 'oldest' ? 'Mais antigos primeiro' : 'Mais recentes primeiro'}
                  >
                    <span>Data</span>
                    <span className="history-column-sort-icon" aria-hidden="true">
                      {sort === 'oldest' ? '↑' : '↓'}
                    </span>
                  </button>
                )}
                body={(row: DaySummary) => (
                  <div className="history-date">
                    <span>{dayjs(row.date).format('DD/MM/YYYY')}</span>
                    {/* {pendingDaySet.has(row.date) && (
                    <button
                      className="pending-button"
                      type="button"
                      title="Clique para ver as pendências"
                      aria-label={`Ver pendências de ${dayjs(row.date).format('DD/MM/YYYY')}`}
                      onClick={() => void showPendingDetails(row.date)}
                    >
                      <i className="fi fi-rr-triangle-warning" aria-hidden="true" />
                    </button>
                  )} */}
                  </div>
                )}
              />
              {historyPunchColumns.map((column) => (
                <Column
                  key={column.header}
                  header={column.header}
                  body={(row: DaySummary) => {
                    const punch = row.punches[column.index];
                    if (!punch) return '--';
                    const isAuto = punch.origin === 'rhid' && Boolean(automaticOfficialPunchIdSet?.has(punch.id));
                    return (
                      <div className="inline-flex items-center gap-1.5 flex-wrap">
                        <span>{dayjs(punch.timestamp).format('HH:mm')}</span>
                        {isAuto && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 tracking-wide uppercase">
                            auto
                          </span>
                        )}
                      </div>
                    );
                  }}
                />
              ))}
              <Column header="Trabalhado" body={(row: DaySummary) => row.punches.length ? formatDuration(row.workedMs) : '--'} />
              <Column header="Intervalo" body={(row: DaySummary) => row.punches.length ? formatDuration(row.breakMs) : '--'} />
              <Column
                header="Saldo"
                body={(row: DaySummary) => (
                  row.punches.length
                    ? <span className={row.balanceMs < 0 ? 'text-error' : 'text-success'}>{formatDuration(row.balanceMs, true)}</span>
                    : <span>--</span>
                )}
              />
              <Column
                header="Marcações"
                body={(row: DaySummary) => {
                  const rhidPunchCount = row.punches.filter((punch) => punch.origin === 'rhid').length;
                  return (
                    <div className="history-punch-count">
                      <span className={rhidPunchCount < STANDARD_DAILY_PUNCH_LIMIT ? 'history-punch-count-short' : undefined}>
                        {rhidPunchCount} RHiD
                      </span>
                      {excessPunchCount(row.punches) > 0 && (
                        <span className="history-extra-punches">
                          <i className="fi fi-rr-triangle-warning" aria-hidden="true" />
                          +{excessPunchCount(row.punches)} excedente{excessPunchCount(row.punches) > 1 ? 's' : ''}: {' '}
                          {row.punches
                            .slice(STANDARD_DAILY_PUNCH_LIMIT)
                            .map((punch) => dayjs(punch.timestamp).format('HH:mm'))
                            .join(', ')}
                        </span>
                      )}
                      {pendingDaySet.has(row.date) && (
                        <button
                          className="pending-button"
                          type="button"
                          title="Clique para ver as pendências"
                          aria-label={`Ver pendências de ${dayjs(row.date).format('DD/MM/YYYY')}`}
                          onClick={() => void showPendingDetails(row.date)}
                        >
                          <i className="fi fi-rr-triangle-warning" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                }}
              />
            </DataTable>
          )}
        </div>
      </section>
      </>
      )}
      <Dialog
        header="Histórico oficial"
        visible={historyDialogOpen}
        onHide={() => setHistoryDialogOpen(false)}
        className="history-official-dialog"
      >
        <div className="history-dialog-accordions background-slate-500">
          <section className={`history-dialog-accordion ${historyDialogSection === 'records' ? 'open' : ''}`}>
            <button
              type="button"
              className="history-dialog-accordion-trigger"
              aria-expanded={historyDialogSection === 'records'}
              onClick={() => setHistoryDialogSection('records')}
            >
              <span>Marcações oficiais armazenadas</span>
              <i className={historyDialogSection === 'records' ? 'fi fi-rr-angle-small-up' : 'fi fi-rr-angle-small-down'} aria-hidden="true" />
            </button>
            {historyDialogSection === 'records' && (
              <div className="history-dialog-accordion-content">
                {syncMessage && <p className="history-official-message text-sm text-slate-600">{syncMessage}</p>}
                <p className="label">Registros gravados na aplicação</p>
                <h2 className="mt-1 font-heading text-lg font-semibold">Marcações oficiais armazenadas: {officialPunchCount}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {lastOfficialUpdate ? `Gravado em ${dayjs(lastOfficialUpdate).format('DD/MM/YYYY HH:mm')}. ` : ''}
                  {officialBalanceDays.length > 0
                    ? 'O resumo do banco usa o acumulado oficial do RHiD até ontem quando esse valor estiver disponível.'
                    : 'O saldo abaixo é calculado a partir das marcações reconhecidas e da meta configurada.'}
                </p>
                {excludedPunchCount > 0 && (
                  <p className="mt-2 text-sm text-slate-500">Exclusões reconhecidas pelo RHiD: {excludedPunchCount}. Elas são ignoradas no saldo.</p>
                )}
                <p className="mt-2 text-sm text-slate-500">Dias com pendência informada pelo RHiD: {pendingDaySet.size}.</p>
                {officialArchive && (
                  <p className="mt-2 text-sm text-slate-500">
                    Período persistido: {dayjs(officialArchive.dataIni).format('DD/MM/YYYY')} a {dayjs(officialArchive.dataFinal).format('DD/MM/YYYY')}. A plataforma armazena horários e indicadores de pendência reconhecidos; o retorno bruto do RHiD permanece somente nesta sessão.
                  </p>
                )}
              </div>
            )}
          </section>
          <section className={`history-dialog-accordion ${historyDialogSection === 'raw' ? 'open' : ''}`}>
            <button
              type="button"
              className="history-dialog-accordion-trigger"
              aria-expanded={historyDialogSection === 'raw'}
              onClick={() => setHistoryDialogSection('raw')}
            >
              <span>Ver retorno histórico do RHiD nesta sessão</span>
              <i className={historyDialogSection === 'raw' ? 'fi fi-rr-angle-small-up' : 'fi fi-rr-angle-small-down'} aria-hidden="true" />
            </button>
            {historyDialogSection === 'raw' && (
              <div className="history-dialog-accordion-content raw">
                {rhidSnapshot
                  ? <pre>{typeof rhidSnapshot.data === 'string' ? rhidSnapshot.data : JSON.stringify(rhidSnapshot.data, null, 2)}</pre>
                  : <p className="text-sm text-slate-500">Nenhum retorno histórico disponível nesta sessão.</p>}
              </div>
            )}
          </section>
        </div>
      </Dialog>
      <Dialog
        header="Solicitações"
        visible={requestsListOpen}
        onHide={() => setRequestsListOpen(false)}
        className="pending-dialog request-dialog"
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              label="Fechar"
              severity="secondary"
              outlined
              type="button"
              onClick={() => setRequestsListOpen(false)}
            />
          </div>
        )}
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-4 justify-between">
            <p className="text-sm text-slate-500">
              {requesterDisplayName ?? 'Usuário'} · período {dayjs(requestPeriod.startDate).format('DD/MM/YYYY')} a {dayjs(requestPeriod.endDate).format('DD/MM/YYYY')}.
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar solicitações">
              {periodOptions.map((option) => (
                <Button
                  key={`request-period:${option.value}`}
                  label={option.label}
                  outlined={requestsPeriod !== option.value}
                  severity="secondary"
                  className="history-filter-button"
                  onClick={() => setRequestsPeriod(option.value)}
                />
              ))}
            </div>
          </div>
          {requestsBusy && <p className="text-sm text-slate-500">Consultando solicitações no RHiD...</p>}
          {!requestsBusy && requestsError && <p className="login-error">{requestsError}</p>}
          {!requestsBusy && !requestsError && requestRows.length === 0 && (
            <p className="text-sm text-slate-500">Nenhuma solicitação encontrada para o período selecionado.</p>
          )}
          {!requestsBusy && requestRows.length > 0 && (
            <div className="grid gap-3">
              {requestRows.map((request) => (
                <article key={`${request.source}:${request.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{requestTypeLabel(request.type)}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {dayjs(request.startDate).format('DD/MM/YYYY')}
                        {request.startDate === request.endDate ? '' : ` a ${dayjs(request.endDate).format('DD/MM/YYYY')}`}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">Solicitada em {requestDateLabel(request.requestedAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${requestStatusSurfaceClass(request.status)}`}>
                        {requestStatusLabel(request.status)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {requestSourceLabel(request.source)}
                      </span>
                    </div>
                  </div>
                  {request.notes?.trim() && (
                    <p className="mt-3 text-sm leading-6 text-slate-700">{request.notes.trim()}</p>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {request.status === 'queued' && request.source === 'local' && (
                      <Button
                        type="button"
                        label="Reenviar ao RHiD"
                        icon="fi fi-rr-refresh"
                        severity="warning"
                        outlined
                        onClick={() => retryQueuedRequest(request)}
                      />
                    )}
                    <Button
                      type="button"
                      label="Ver detalhes"
                      severity="secondary"
                      outlined
                      onClick={() => openRequestDetail(request)}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Dialog>
      <Dialog
        visible={requestDetail !== null}
        onHide={closeRequestDetail}
        showHeader={false}
        modal
        draggable={false}
        resizable={false}
        className="pending-dialog"
        contentClassName="!p-0"
      >
        {requestDetail && (
          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Solicitação</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-900">{requestTypeLabel(requestDetail.type)}</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Dados da solicitação selecionada.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${requestStatusSurfaceClass(requestDetail.status)}`}>
                  {requestStatusLabel(requestDetail.status)}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {requestSourceLabel(requestDetail.source)}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Solicitada em</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{requestDateLabel(requestDetail.requestedAt)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Período</p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {dayjs(requestDetail.startDate).format('DD/MM/YYYY')}
                  {requestDetail.startDate === requestDetail.endDate
                    ? ''
                    : ` a ${dayjs(requestDetail.endDate).format('DD/MM/YYYY')}`}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descrição</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{requestDetail.description}</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Observações</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {requestDetail.notes?.trim() || 'Nenhuma observação informada.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {requestDetail.status === 'queued' && requestDetail.source === 'local' && (
                <Button
                  type="button"
                  label="Reenviar ao RHiD"
                  icon="fi fi-rr-refresh"
                  severity="warning"
                  outlined
                  onClick={() => retryQueuedRequest(requestDetail)}
                />
              )}
              <Button
                type="button"
                label="Fechar"
                severity="secondary"
                outlined
                onClick={closeRequestDetail}
              />
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        header="Nova Solicitação"
        visible={requestDialogOpen}
        className="pending-dialog request-dialog"
        style={{ width: 'min(34rem, 94vw)' }}
        modal
        onHide={() => setRequestDialogOpen(false)}
        footer={(
          <div className="dialog-footer-actions flex justify-end gap-2">
            <Button
              label="Cancelar"
              severity="secondary"
              outlined
              type="button"
              onClick={() => setRequestDialogOpen(false)}
            />
            <Button
              label="Enviar"
              type="button"
              severity="success"
              loading={requestSubmitting}
              onClick={() => void submitRequest()}
            />
          </div>
        )}
      >
        <div className="grid gap-4">
          <p className="text-sm text-slate-500">
            {requesterDisplayName ?? 'Usuário'} pode registrar a solicitação para o período selecionado.
          </p>
          <label className="grid gap-2">
            <span className="label">Tipo de solicitação</span>
            <select
              className="app-select"
              value={requestType}
              onChange={(event) => setRequestType(event.target.value as typeof requestType)}
            >
              {requestTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="label">Data inicial</span>
              <InputText
                type="date"
                value={requestStartDate}
                onChange={(event) => {
                  const date = event.target.value;
                  setRequestStartDate(date);
                  setRequestEndDate(date);
                }}
              />
            </label>
            <label className="grid gap-2">
              <span className="label">Data final</span>
              <InputText
                type="date"
                value={requestEndDate}
                onChange={(event) => setRequestEndDate(event.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-2">
            <span className="label">Hora da marcação</span>
            <InputText
              type="time"
              value={requestTime}
              required={requestType === 'inclusao_marcacao'}
              aria-required={requestType === 'inclusao_marcacao'}
              onChange={(event) => setRequestTime(event.target.value)}
            />
            {requestType === 'inclusao_marcacao' && (
              <small className="text-xs text-slate-500">Obrigatório para registrar a marcação no RHiD.</small>
            )}
          </label>
          <label className="grid gap-2">
            <span className="label">Justificativa</span>
            <textarea
              className="app-input min-h-28 resize-y"
              value={requestNotes}
              onChange={(event) => setRequestNotes(event.target.value)}
              placeholder="Descreva o motivo da solicitação"
            />
          </label>
        </div>
      </Dialog>
      <Dialog
        header={requestSubmissionNotice?.title ?? 'Resultado da solicitação'}
        visible={requestSubmissionNotice !== null}
        onHide={closeRequestSubmissionNotice}
        modal
        draggable={false}
        resizable={false}
        closable={requestSubmissionNotice?.status !== 'submitting'}
        closeOnEscape={requestSubmissionNotice?.status !== 'submitting'}
        dismissableMask={false}
        baseZIndex={20000}
        className={`request-result-dialog ${requestSubmissionNotice?.status ?? ''}`}
        style={{ width: 'min(32rem, 92vw)' }}
        footer={requestSubmissionNotice?.status === 'submitting' ? null : (
          <div className="flex flex-wrap justify-end gap-2">
            {requestSubmissionNotice?.status === 'error' && !requestDialogOpen && (
              <Button
                type="button"
                label="Voltar e corrigir"
                severity="secondary"
                outlined
                onClick={reopenRequestAfterFailure}
              />
            )}
            <Button
              type="button"
              label={requestSubmissionNotice?.status === 'success' ? 'Fechar e ver passos do e-mail' : 'Fechar'}
              severity={requestSubmissionNotice?.status === 'success' ? 'success' : 'secondary'}
              outlined={requestSubmissionNotice?.status !== 'success'}
              onClick={closeRequestSubmissionNotice}
            />
          </div>
        )}
      >
        {requestSubmissionNotice && (
          <div className="request-result-content">
            <div className={`request-result-icon ${requestSubmissionNotice.status}`} aria-hidden="true">
              <i className={requestSubmissionNotice.status === 'submitting'
                ? 'fi fi-rr-refresh'
                : requestSubmissionNotice.status === 'success'
                  ? 'fi fi-rr-check-circle'
                  : 'fi fi-rr-triangle-warning'} />
            </div>
            <p>{requestSubmissionNotice.message}</p>
            {requestSubmissionNotice.status === 'submitting' && (
              <ol className="request-result-steps">
                <li>Validar sessão e funcionário.</li>
                <li>Enviar a solicitação oficial.</li>
                <li>Confirmar o registro consultando novamente o RHiD.</li>
              </ol>
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        header="Pendências de Aprovação"
        visible={pendingDate !== null}
        className="pending-dialog"
        onHide={() => setPendingDate(null)}
        footer={<Button label="Fechar" onClick={() => setPendingDate(null)} />}
      >
        {pendingDate && <p className="mb-4 text-sm text-slate-500">{dayjs(pendingDate).format('DD/MM/YYYY')}</p>}
        {pendingBusy && <p className="text-sm text-slate-500">Consultando pendências no RHiD...</p>}
        {!pendingBusy && pendingError && <p className="login-error">{pendingError}</p>}
        {!pendingBusy && pendingItems.length > 0 && (
          <ul className="pending-items">
            {pendingItems.map((item) => (
              <li key={`${String(item.id)}:${item.description}`}>
                <p>{item.description}</p>
                {item.filesUrl.map((file) => (
                  <a key={file} href={file} target="_blank" rel="noopener noreferrer">Abrir anexo</a>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

export default HistoryView;
