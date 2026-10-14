import { useState, useMemo, type ReactElement } from 'react';
import dayjs from 'dayjs';
import {
  formatDuration,
  officialAccumulatedBalanceAt,
  officialBalanceForPeriod,
} from '../../domain/journey';
import { isCountableWorkday } from '../../domain/workday';
import type {
  DaySummary,
  HistoryPeriod,
  OfficialPunchArchive,
  RhidRequestInput,
  RhidRequestRecord,
  RhidSnapshot,
} from '../../types';

interface MobileHistoryViewProps {
  history: DaySummary[];
  rhidSnapshot: RhidSnapshot | null;
  officialArchive: OfficialPunchArchive | null;
  automaticOfficialPunchIdSet: Set<string>;
  syncMessage?: string;
  selectedPeriod: HistoryPeriod;
  onPeriodChange: (period: HistoryPeriod) => void;
  referenceDate: string;
  requesterDisplayName: string;
  requestsEnabled: boolean;
  onRequestSubmitted: () => void;
  onRegister: () => void | Promise<void>;
  registerBusy: boolean;
  registrationDisabled: boolean;
  registrationLabel: string;
  onOpenNewRequest: (seed?: Partial<RhidRequestInput>) => void;
  pendingRequests: RhidRequestRecord[];
  onOpenPendingRequests: () => void;
}

export function MobileHistoryView({
  history,
  officialArchive,
  automaticOfficialPunchIdSet,
  selectedPeriod,
  onPeriodChange,
  referenceDate,
  onRegister,
  registerBusy,
  registrationDisabled,
  onOpenNewRequest,
  pendingRequests,
  onOpenPendingRequests,
}: MobileHistoryViewProps): ReactElement {
  const [filterMode, setFilterMode] = useState<HistoryPeriod | 'incompletos'>(selectedPeriod);
  const [visibleCount, setVisibleCount] = useState(15);

  const accumulatedBalance = officialArchive?.officialBalanceDays
    ? officialAccumulatedBalanceAt(officialArchive.officialBalanceDays, referenceDate)
    : 0;

  const monthBalance = officialArchive?.officialBalanceDays
    ? officialBalanceForPeriod(officialArchive.officialBalanceDays, dayjs(referenceDate).startOf('month').format('YYYY-MM-DD'), referenceDate)
    : 0;

  // Filtragem de dias
  const filteredDays = useMemo(() => {
    let list = [...history];

    if (filterMode === 'incompletos') {
      list = list.filter((day) => {
        const isCountable = isCountableWorkday(day.date);
        const punchesCount = day.punches.length;
        return isCountable && (punchesCount % 2 !== 0 || punchesCount === 0 || punchesCount < 4);
      });
    }

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [history, filterMode]);

  const displayedDays = filteredDays.slice(0, visibleCount);

  const handleFilterClick = (mode: HistoryPeriod | 'incompletos') => {
    setFilterMode(mode);
    if (mode !== 'incompletos') {
      onPeriodChange(mode);
    }
  };

  const formatBalance = (ms: number): { text: string; positive: boolean } => {
    const isPositive = ms >= 0;
    const text = (isPositive ? '+' : '-') + formatDuration(Math.abs(ms));
    return { text, positive: isPositive };
  };

  const accBalInfo = formatBalance(accumulatedBalance ?? 0);
  const monthBalInfo = formatBalance(monthBalance ?? 0);

  return (
    <div className="flex flex-col w-full gap-md">
      {/* Interactive Pill Filter Row */}
      <div className="flex items-center gap-xs overflow-x-auto no-scrollbar py-0.5 -mx-gutter px-gutter">
        <button
          type="button"
          className={`filter-pill shrink-0 px-md py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all ${
            filterMode === 'month'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
          }`}
          onClick={() => handleFilterClick('month')}
          aria-label="Filtrar registros deste mês"
        >
          Este mês
        </button>
        <button
          type="button"
          className={`filter-pill shrink-0 px-md py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all ${
            filterMode === 'week'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
          }`}
          onClick={() => handleFilterClick('week')}
          aria-label="Filtrar registros desta semana"
        >
          Semana
        </button>
        <button
          type="button"
          className={`filter-pill shrink-0 px-md py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all ${
            filterMode === 'yesterday'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
          }`}
          onClick={() => handleFilterClick('yesterday')}
          aria-label="Filtrar registros de ontem"
        >
          Ontem
        </button>
        <button
          type="button"
          className={`filter-pill shrink-0 px-md py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all ${
            filterMode === 'all'
              ? 'bg-primary text-on-primary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
          }`}
          onClick={() => handleFilterClick('all')}
          aria-label="Exibir todos os registros"
        >
          Todos
        </button>
        <button
          type="button"
          className={`filter-pill shrink-0 px-md py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all flex items-center gap-1 ${
            filterMode === 'incompletos'
              ? 'bg-secondary text-on-secondary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
          }`}
          onClick={() => handleFilterClick('incompletos')}
          aria-label="Filtrar apenas registros incompletos e pendentes"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
          Incompletos
        </button>
      </div>

      {/* KPI Bank of Hours Card */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-[18px]">account_balance_wallet</span>
            <span className="font-label-md text-label-md font-semibold text-on-surface">Banco de Horas</span>
          </div>
          <div className="flex items-center gap-1 text-on-surface-variant">
            <span className="font-label-md text-label-md">{dayjs(referenceDate).format('MMMM YYYY')}</span>
            <span className="material-symbols-outlined text-[16px]">info</span>
          </div>
        </div>

        {/* Dual Metric Display */}
        <div className="grid grid-cols-2 gap-sm pt-1">
          <div className="bg-surface-container-low rounded-lg p-sm flex flex-col">
            <span className="font-label-md text-label-md text-on-surface-variant">Saldo Acumulado</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="font-headline-sm text-headline-sm text-primary font-bold tracking-tight">
                {accBalInfo.text}
              </span>
              <span className="font-label-md text-label-md text-primary font-semibold">hrs</span>
            </div>
          </div>
          <div className="bg-surface-container-low rounded-lg p-sm flex flex-col">
            <span className="font-label-md text-label-md text-on-surface-variant">Saldo do Mês</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="font-headline-sm text-headline-sm text-primary font-bold tracking-tight">
                {monthBalInfo.text}
              </span>
              <span className="font-label-md text-label-md text-primary font-semibold">hrs</span>
            </div>
          </div>
        </div>

        {/* Pending Requests Notice */}
        {pendingRequests.length > 0 && (
          <button
            type="button"
            className="w-full mt-1 flex items-center justify-between bg-tertiary-fixed/40 hover:bg-tertiary-fixed/60 rounded-lg px-sm py-2 transition-colors"
            onClick={onOpenPendingRequests}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-tertiary shrink-0 animate-pulse" />
              <span className="font-label-md text-label-md text-on-tertiary-fixed-variant truncate font-medium">
                {pendingRequests.length} solicitaç{pendingRequests.length > 1 ? 'ões' : 'ão'} aguardando aprovação
              </span>
            </div>
            <div className="flex items-center gap-0.5 shrink-0 text-tertiary">
              <span className="font-label-md text-label-md font-semibold">Ver</span>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </div>
          </button>
        )}
      </div>

      {/* Primary Micro Actions */}
      <div className="grid grid-cols-2 gap-sm">
        <button
          type="button"
          className="flex items-center justify-center gap-1.5 py-2.5 px-sm rounded-xl bg-primary text-on-primary hover:bg-primary-container transition-colors shadow-sm active:scale-[0.98]"
          aria-label="Criar nova solicitação de ajuste ou justificativa"
          onClick={() => onOpenNewRequest()}
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          <span className="font-label-md text-label-md font-semibold">Solicitação</span>
        </button>
        <button
          type="button"
          className="flex items-center justify-center gap-1.5 py-2.5 px-sm rounded-xl bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors active:scale-[0.98] disabled:opacity-50"
          aria-label="Registrar entrada extra fora do expediente"
          onClick={() => void onRegister()}
          disabled={registrationDisabled || registerBusy}
        >
          <span className="material-symbols-outlined text-primary text-[18px]">more_time</span>
          <span className="font-label-md text-label-md font-semibold text-primary">
            {registerBusy ? 'Registrando...' : 'Entrada Extra'}
          </span>
        </button>
      </div>

      {/* Timeline Section Header */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1.5">
          <span className="font-headline-sm text-headline-sm text-on-surface">Espelho Diário</span>
          <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-md text-label-md font-medium">
            {filteredDays.length} registros
          </span>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 text-primary hover:text-primary-container"
          onClick={() => handleFilterClick(filterMode === 'incompletos' ? 'month' : 'incompletos')}
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          <span className="font-label-md text-label-md font-semibold">
            {filterMode === 'incompletos' ? 'Ver todos' : 'Filtrar'}
          </span>
        </button>
      </div>

      {/* Cards List: Registros Timeline */}
      <div className="flex flex-col gap-sm">
        {displayedDays.map((day) => {
          const isToday = day.date === referenceDate;
          const isYesterday = day.date === dayjs(referenceDate).subtract(1, 'day').format('YYYY-MM-DD');
          const isCountable = isCountableWorkday(day.date);
          const punches = day.punches;
          const isIncomplete = isCountable && (punches.length % 2 !== 0 || punches.length < 4);
          const balance = formatBalance(day.balanceMs);

          const punch1 = punches[0];
          const punch2 = punches[1];
          const punch3 = punches[2];
          const punch4 = punches[3];

          const isPunch3Auto = punch3 && automaticOfficialPunchIdSet.has(punch3.id);

          return (
            <div key={day.date} className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-sm transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isIncomplete
                      ? 'bg-error-container text-error'
                      : isToday
                        ? 'bg-primary-fixed-dim/30 text-primary'
                        : 'bg-surface-container text-on-surface-variant'
                  }`}>
                    <span className="material-symbols-outlined text-[18px]">
                      {isIncomplete ? 'warning' : isToday ? 'today' : 'event_available'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="font-body-md text-body-md font-semibold text-on-surface">
                        {isToday ? 'Hoje' : isYesterday ? 'Ontem' : dayjs(day.date).format('DD/MM/YYYY')}
                      </span>
                      {(isToday || isYesterday) && (
                        <span className="font-label-md text-label-md text-on-surface-variant">
                          · {dayjs(day.date).format('DD/MM/YYYY')}
                        </span>
                      )}
                      {isIncomplete && (
                        <span className="px-1.5 py-0.5 rounded bg-error-container text-error font-label-md text-[10px] font-bold">
                          INCOMPLETO
                        </span>
                      )}
                    </div>
                    <span className="font-label-md text-label-md text-on-surface-variant capitalize">
                      {dayjs(day.date).format('dddd')}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className={`px-2 py-0.5 rounded-full font-label-md text-label-md font-bold ${
                    isIncomplete
                      ? 'bg-secondary-fixed text-on-secondary-fixed'
                      : balance.positive
                        ? 'bg-primary-fixed text-on-primary-fixed-variant'
                        : 'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {balance.text}
                  </span>
                  <span className={`font-label-md text-[10px] mt-0.5 ${isIncomplete ? 'text-secondary font-medium' : 'text-on-surface-variant'}`}>
                    {isIncomplete ? 'Ajuste pendente' : 'Saldo diário'}
                  </span>
                </div>
              </div>

              {/* Punches Grid */}
              <div className="grid grid-cols-4 gap-1.5 bg-surface-container-low rounded-lg p-2 text-center">
                <div className="flex flex-col">
                  <span className="font-label-md text-[11px] text-on-surface-variant">Entrada 1</span>
                  <span className="font-mono-time text-[13px] text-on-surface font-semibold mt-0.5">
                    {punch1 ? dayjs(punch1.timestamp).format('HH:mm') : '--:--'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-md text-[11px] text-on-surface-variant">Saída 1</span>
                  <span className="font-mono-time text-[13px] text-on-surface font-semibold mt-0.5">
                    {punch2 ? dayjs(punch2.timestamp).format('HH:mm') : '--:--'}
                  </span>
                </div>
                <div className="flex flex-col relative">
                  <span className="font-label-md text-[11px] text-on-surface-variant">Entrada 2</span>
                  <div className="flex items-center justify-center gap-0.5 mt-0.5">
                    <span className="font-mono-time text-[13px] text-on-surface font-semibold">
                      {punch3 ? dayjs(punch3.timestamp).format('HH:mm') : '--:--'}
                    </span>
                  </div>
                  {isPunch3Auto && (
                    <span className="absolute -top-1 right-0 font-label-md text-[9px] leading-tight px-1 rounded bg-tertiary-fixed text-on-tertiary-fixed font-bold">
                      AUTO
                    </span>
                  )}
                </div>
                <div className={`flex flex-col ${isIncomplete && !punch4 ? 'bg-error-container/40 rounded p-0.5' : ''}`}>
                  <span className={`font-label-md text-[11px] ${isIncomplete && !punch4 ? 'text-error font-medium' : 'text-on-surface-variant'}`}>
                    Saída 2
                  </span>
                  <span className={`font-mono-time text-[13px] font-semibold mt-0.5 ${
                    isIncomplete && !punch4 ? 'text-error font-bold' : 'text-on-surface'
                  }`}>
                    {punch4 ? dayjs(punch4.timestamp).format('HH:mm') : '--:--'}
                  </span>
                </div>
              </div>

              {/* Card Footer Summary */}
              <div className="flex items-center justify-between pt-1 text-on-surface-variant">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">schedule</span>
                    <span className="font-label-md text-label-md">
                      Total: <strong className="text-on-surface font-semibold">{formatDuration(day.workedMs)}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">coffee</span>
                    <span className="font-label-md text-label-md">Int: {formatDuration(day.breakMs)}</span>
                  </div>
                </div>
                {isIncomplete ? (
                  <button
                    type="button"
                    className="px-3 py-1.5 min-h-[36px] rounded-xl bg-primary text-on-primary hover:bg-primary-container font-label-md text-label-md font-semibold flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-all"
                    aria-label={`Regularizar batida pendente de ${dayjs(day.date).format('DD/MM/YYYY')}`}
                    onClick={() => onOpenNewRequest({
                      startDate: day.date,
                      endDate: day.date,
                      type: 'inclusao_marcacao',
                      notes: `Falta de marcação no dia ${dayjs(day.date).format('DD/MM/YYYY')}. Regularização de ponto.`,
                    })}
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_calendar</span>
                    <span>Regularizar</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span className="font-label-md text-label-md font-medium">{punches.length} batidas RHiD</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Micro Pagination / Load Older */}
      {visibleCount < filteredDays.length && (
        <button
          type="button"
          className="w-full h-12 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary font-label-md text-label-md font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-all my-2 shadow-sm"
          aria-label="Carregar registros anteriores"
          onClick={() => setVisibleCount((prev) => prev + 15)}
        >
          <span className="material-symbols-outlined text-[20px]">history</span>
          <span>Carregar registros anteriores</span>
        </button>
      )}
    </div>
  );
}
