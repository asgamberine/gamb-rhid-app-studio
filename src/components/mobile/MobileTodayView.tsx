import { useState, useEffect, type ReactElement } from 'react';
import dayjs from 'dayjs';
import type {
  AutomaticLunchReturnGate,
  CompletedJourneyGate,
  OfficialPunchGate,
} from '../../domain/journey';
import {
  formatDuration,
  nextPunchLabel,
} from '../../domain/journey';
import type { DaySummary, HistoryPeriod, JornadaSettings } from '../../types';

interface MobileTodayViewProps {
  summary: DaySummary;
  countableSummary: DaySummary;
  settings: JornadaSettings;
  progress: number;
  accumulatedBalance: number;
  previousRegisteredSummary: DaySummary | null;
  integrationStatus: 'connected' | 'syncing' | 'warning' | 'error';
  onRegister: () => void | Promise<void>;
  officialRegistration: boolean;
  rhidTestMode: boolean;
  registrationGate: OfficialPunchGate;
  journeyCompletion: CompletedJourneyGate;
  lunchReturnGate: AutomaticLunchReturnGate;
  registrationBlocked: boolean;
  registrationMessage?: string;
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
  onOpenRequestDialog: (seed?: { startDate: string; endDate: string; type: string; notes: string }) => void;
  onValidateRegistration: () => void | Promise<void>;
  onRefreshRegistrationBlock: () => void | Promise<void>;
  onRequestJourneyReopen: () => void;
  onUndo: () => void;
  canUndoLocal: boolean;
  onOpenHistory: (period: HistoryPeriod) => void;
}

export function MobileTodayView({
  summary,
  countableSummary,
  settings,
  accumulatedBalance,
  onRegister,
  rhidTestMode,
  registrationGate,
  journeyCompletion,
  registrationBlocked,
  registerBusy,
  validationBusy,
  automaticOfficialPunchIdSet,
  automaticLunchReturnPunchId,
  automaticLunchReturnEnabled,
  automaticLunchReturnControlHidden,
  onToggleAutomaticLunchReturn,
  onOpenHistory,
  onRefreshRegistrationBlock,
}: MobileTodayViewProps): ReactElement {
  const [selectedContextTab, setSelectedContextTab] = useState<'hoje' | 'semana' | 'mes'>('hoje');
  const [toastVisible, setToastVisible] = useState(false);

  // Status da jornada
  const isWorking = summary.punches.length % 2 === 1;
  const isOnBreak = summary.punches.length === 2;
  const journeyCompleted = journeyCompletion.completed;

  let journeyStatusLabel = 'Não iniciada';
  if (journeyCompleted) {
    journeyStatusLabel = 'Finalizada';
  } else if (isOnBreak) {
    journeyStatusLabel = 'Em intervalo';
  } else if (isWorking) {
    journeyStatusLabel = 'Em andamento';
  } else if (summary.punches.length > 0) {
    journeyStatusLabel = 'Em andamento';
  }

  // Métricas
  const targetReached = countableSummary.workedMs >= settings.targetMinutes * 60_000;
  const targetDifferenceMs = targetReached ? Math.max(countableSummary.balanceMs, 0) : countableSummary.remainingMs;
  const workedPercent = Math.min(100, Math.max(0, (countableSummary.workedMs / (settings.targetMinutes * 60_000)) * 100));

  // 4 segmentos de barra de progresso (cada um vale 25%)
  const segmentFills = [0, 1, 2, 3].map((index) => {
    const min = index * 25;
    if (workedPercent >= min + 25) return 100;
    if (workedPercent <= min) return 0;
    return ((workedPercent - min) / 25) * 100;
  });

  // Countdown para anti-duplicidade
  const cooldownRemainingSec = Math.ceil(registrationGate.remainingMs / 1000);
  const [countdown, setCountdown] = useState(cooldownRemainingSec);

  useEffect(() => {
    setCountdown(Math.ceil(registrationGate.remainingMs / 1000));
  }, [registrationGate.remainingMs]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const triggerPunch = async () => {
    await onRegister();
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, 3200);
  };

  const handleContextTabClick = (tab: 'hoje' | 'semana' | 'mes') => {
    setSelectedContextTab(tab);
    if (tab === 'semana') {
      onOpenHistory('week');
    } else if (tab === 'mes') {
      onOpenHistory('month');
    }
  };

  const formatBalance = (ms: number): { text: string; positive: boolean } => {
    const isPositive = ms >= 0;
    const text = (isPositive ? '+' : '-') + formatDuration(Math.abs(ms));
    return { text, positive: isPositive };
  };

  const balanceInfo = formatBalance(accumulatedBalance);

  // Helper para slots de batida
  const punches = summary.punches;
  const punch1 = punches[0];
  const punch2 = punches[1];
  const punch3 = punches[2];
  const punch4 = punches[3];
  const extraPunches = punches.slice(4);

  const isPunch3Auto = punch3 && (automaticOfficialPunchIdSet.has(punch3.id) || automaticLunchReturnPunchId === punch3.id);

  return (
    <div className="flex flex-col w-full gap-md relative">
      {/* Top Glanceable Summary Hero */}
      <section className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-md">
        {/* Header: Date & Status */}
        <div className="flex items-center justify-between gap-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center text-primary" aria-hidden="true">
              <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            </div>
            <div className="flex flex-col">
              <span className="font-label-md text-label-md text-on-surface font-medium">Data de hoje</span>
              <span className="font-headline-sm text-[16px] text-on-surface leading-tight font-semibold">
                {dayjs(summary.date).format('ddd, DD MMM YYYY')}
              </span>
            </div>
          </div>
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-fixed/50"
            role="status"
            aria-label={`Status da jornada: ${journeyStatusLabel}`}
          >
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" aria-hidden="true" />
            <span className="font-label-md text-label-md text-primary font-bold">{journeyStatusLabel}</span>
          </div>
        </div>

        {/* Main Clock Counter Card */}
        <div className="bg-surface-container-low rounded-xl p-md flex flex-col gap-sm">
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <span className="font-label-md text-label-md text-on-surface font-semibold uppercase tracking-wider">Tempo trabalhado</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-display-time text-[40px] text-on-surface font-bold tracking-tight leading-none" id="live-timer">
                  {formatDuration(countableSummary.workedMs)}
                </span>
                <span className="font-label-md text-label-md text-on-surface font-semibold" aria-label={`de ${formatDuration(settings.targetMinutes * 60_000)} diárias`}>
                  / {formatDuration(settings.targetMinutes * 60_000)}
                </span>
              </div>
            </div>
            <div className="px-2.5 py-1 rounded-full bg-primary/10 text-primary flex items-center gap-1 mb-1" aria-label={`${workedPercent.toFixed(1)}% da meta cumprida`}>
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">trending_up</span>
              <span className="font-label-md text-label-md font-bold">{workedPercent.toFixed(1)}% da meta</span>
            </div>
          </div>

          {/* Segmented Progress Bar */}
          <div
            className="grid grid-cols-4 gap-1 w-full pt-1"
            role="progressbar"
            aria-valuenow={workedPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso da jornada de trabalho"
          >
            {segmentFills.map((fill, i) => (
              <div key={i} className="h-2 rounded-full bg-primary/25 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${fill}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Quick Stats Metric Row */}
        <div className="grid grid-cols-3 gap-2">
          {/* Faltam / Passaram */}
          <div className="bg-tertiary-fixed/30 rounded-lg p-2.5 flex flex-col justify-between border border-tertiary/20">
            <div className="flex items-center gap-1 text-tertiary">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">hourglass_top</span>
              <span className="font-label-md text-[11px] font-bold uppercase text-tertiary">
                {targetReached ? 'Passaram' : 'Faltam'}
              </span>
            </div>
            <span className="font-mono-time text-[17px] text-tertiary font-bold tracking-tight mt-1">
              {targetReached ? `+${formatDuration(targetDifferenceMs)}` : formatDuration(targetDifferenceMs)}
            </span>
            <span className="font-label-md text-[10px] text-on-surface font-medium line-clamp-1">
              {targetReached ? 'Acima da meta' : 'Até meta diária'}
            </span>
          </div>

          {/* Saída Prevista */}
          <div className="bg-surface-container rounded-lg p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1 text-primary">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">logout</span>
              <span className="font-label-md text-[11px] font-bold uppercase text-primary">Saída</span>
            </div>
            <span className="font-mono-time text-[17px] text-on-surface font-bold tracking-tight mt-1">
              {countableSummary.projectedFinish ? dayjs(countableSummary.projectedFinish).format('HH:mm') : '--:--'}
            </span>
            <span className="font-label-md text-[10px] text-on-surface font-medium line-clamp-1">
              Ref. {settings.breakMinutes ? (settings.breakMinutes >= 60 ? `${Math.round(settings.breakMinutes / 60)}h` : `${settings.breakMinutes}m`) : '1h'} almoço
            </span>
          </div>

          {/* Intervalo / Pausa */}
          <div className="bg-surface-container rounded-lg p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1 text-on-surface">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">coffee</span>
              <span className="font-label-md text-[11px] font-bold uppercase text-on-surface">Pausa</span>
            </div>
            <span className="font-mono-time text-[17px] text-on-surface font-bold tracking-tight mt-1">
              {formatDuration(summary.breakMs)}
            </span>
            <span className="font-label-md text-[10px] text-on-surface font-medium line-clamp-1">
              {summary.isOnBreak ? 'Em andamento' : 'Regularizado'}
            </span>
          </div>
        </div>
      </section>

      {/* Segmented Context Filter & Bank of Hours */}
      <section className="flex flex-col gap-sm">
        {/* Switcher */}
        <div className="bg-surface-container-high p-1 rounded-xl flex items-center text-center min-h-[44px]" role="tablist" aria-label="Período de visualização">
          <button
            type="button"
            role="tab"
            aria-selected={selectedContextTab === 'hoje'}
            className={`flex-1 min-h-[40px] py-2 rounded-lg font-semibold text-label-md shadow-sm transition-all flex items-center justify-center focus:outline-none ${
              selectedContextTab === 'hoje'
                ? 'bg-surface-container-lowest text-primary'
                : 'text-on-surface font-medium hover:text-primary'
            }`}
            onClick={() => handleContextTabClick('hoje')}
          >
            Hoje
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedContextTab === 'semana'}
            className={`flex-1 min-h-[40px] py-2 rounded-lg text-label-md transition-all flex items-center justify-center focus:outline-none ${
              selectedContextTab === 'semana'
                ? 'bg-surface-container-lowest text-primary font-semibold'
                : 'text-on-surface font-medium hover:text-primary'
            }`}
            onClick={() => handleContextTabClick('semana')}
          >
            Esta Semana
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedContextTab === 'mes'}
            className={`flex-1 min-h-[40px] py-2 rounded-lg text-label-md transition-all flex items-center justify-center focus:outline-none ${
              selectedContextTab === 'mes'
                ? 'bg-surface-container-lowest text-primary font-semibold'
                : 'text-on-surface font-medium hover:text-primary'
            }`}
            onClick={() => handleContextTabClick('mes')}
          >
            Mês Atual
          </button>
        </div>

        {/* Saldo Banco de Horas Card */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed/40 flex items-center justify-center text-primary" aria-hidden="true">
              <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
            </div>
            <div className="flex flex-col">
              <span className="font-label-md text-label-md text-on-surface font-medium">Saldo Banco de Horas</span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-headline-sm text-headline-sm text-primary font-bold tracking-tight">
                  {balanceInfo.text}
                </span>
                <span className={`font-label-md text-[11px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  balanceInfo.positive ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'
                }`}>
                  {balanceInfo.positive ? 'Positivo' : 'Negativo'}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 min-h-[44px] py-2 px-3 rounded-lg bg-surface-container-low text-primary hover:bg-surface-container font-label-md text-label-md font-semibold transition-colors focus:outline-none"
            aria-label="Ver extrato do banco de horas"
            onClick={() => onOpenHistory('month')}
          >
            <span>Extrato</span>
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      </section>

      {/* Batidas Confirmadas Timeline */}
      <section className="bg-surface-container-lowest rounded-xl p-md shadow-sm flex flex-col gap-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">fact_check</span>
            <h2 className="font-headline-sm text-[16px] text-on-surface font-semibold">Batidas do Dia</h2>
          </div>
          <span className="font-label-md text-label-md font-semibold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface" aria-label={`${punches.length} de 4 batidas registradas`}>
            {punches.length} de 4
          </span>
        </div>

        {/* Interactive Stepper Slots */}
        <div className="flex flex-col gap-3 relative" role="list" aria-label="Lista de batidas do dia">
          {/* Vertical connecting line segment */}
          <div className="absolute left-4 top-4 bottom-8 w-0.5 bg-surface-container-highest -z-0" aria-hidden="true" />

          {/* Slot 1: Entrada 1 */}
          <div className="flex items-center justify-between relative z-10 bg-surface-container-lowest" role="listitem">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-xs ${
                punch1 ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`} aria-hidden="true">
                <span className="material-symbols-outlined text-[16px]">login</span>
              </div>
              <div className="flex flex-col">
                <span className="font-body-md text-body-md text-on-surface font-medium leading-none">Entrada 1</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide uppercase bg-primary-fixed/50 text-primary">RHiD</span>
                  <span className="font-label-md text-[11px] text-on-surface font-medium">Local verificado</span>
                </div>
              </div>
            </div>
            <span className="font-mono-time text-[15px] text-on-surface font-bold tracking-tight">
              {punch1 ? dayjs(punch1.timestamp).format('HH:mm') : '--:--'}
            </span>
          </div>

          {/* Slot 2: Saída Almoço */}
          <div className="flex items-center justify-between relative z-10 bg-surface-container-lowest" role="listitem">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-xs ${
                punch2 ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`} aria-hidden="true">
                <span className="material-symbols-outlined text-[16px]">restaurant</span>
              </div>
              <div className="flex flex-col">
                <span className="font-body-md text-body-md text-on-surface font-medium leading-none">Saída Almoço</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide uppercase bg-primary-fixed/50 text-primary">RHiD</span>
                  <span className="font-label-md text-[11px] text-on-surface font-medium">Biometria facial</span>
                </div>
              </div>
            </div>
            <span className="font-mono-time text-[15px] text-on-surface font-bold tracking-tight">
              {punch2 ? dayjs(punch2.timestamp).format('HH:mm') : '--:--'}
            </span>
          </div>

          {/* Slot 3: Retorno Almoço */}
          <div className="flex items-center justify-between relative z-10 bg-surface-container-lowest" role="listitem">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-xs ${
                punch3 ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`} aria-hidden="true">
                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              </div>
              <div className="flex flex-col">
                <span className="font-body-md text-body-md text-on-surface font-medium leading-none">Retorno Almoço</span>
                <div className="flex items-center gap-1 mt-1">
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide uppercase bg-primary-fixed/50 text-primary">RHiD</span>
                  {isPunch3Auto && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide uppercase bg-tertiary-fixed/70 text-tertiary">AUTO</span>
                  )}
                </div>
              </div>
            </div>
            <span className="font-mono-time text-[15px] text-on-surface font-bold tracking-tight">
              {punch3 ? dayjs(punch3.timestamp).format('HH:mm') : '--:--'}
            </span>
          </div>

          {/* Slot 4: Saída Fim de Jornada */}
          {punch4 ? (
            <div className="flex items-center justify-between relative z-10 bg-surface-container-lowest" role="listitem">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xs" aria-hidden="true">
                  <span className="material-symbols-outlined text-[16px]">logout</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-body-md text-body-md text-on-surface font-medium leading-none">Fim de Jornada</span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide uppercase bg-primary-fixed/50 text-primary">RHiD</span>
                    <span className="font-label-md text-[11px] text-on-surface font-medium">Jornada concluída</span>
                  </div>
                </div>
              </div>
              <span className="font-mono-time text-[15px] text-on-surface font-bold tracking-tight">
                {dayjs(punch4.timestamp).format('HH:mm')}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between relative z-10 bg-surface-container-low rounded-lg p-2.5 border border-surface-container-high" role="listitem">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center" aria-hidden="true">
                  <span className="material-symbols-outlined text-[15px]">schedule</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-body-md text-[13px] text-on-surface font-semibold leading-none">Fim de Jornada</span>
                  <span className="font-label-md text-[11px] text-on-surface-variant font-medium mt-0.5">Aguardando registro</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-label-md text-[11px] text-on-surface font-medium">Prev:</span>
                <span className="font-mono-time text-[14px] text-primary font-bold">
                  {countableSummary.projectedFinish ? dayjs(countableSummary.projectedFinish).format('HH:mm') : '--:--'}
                </span>
              </div>
            </div>
          )}

          {/* Batidas Extras se houver */}
          {extraPunches.map((punch, idx) => (
            <div key={punch.id} className="flex items-center justify-between relative z-10 bg-surface-container-lowest" role="listitem">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xs" aria-hidden="true">
                  <span className="material-symbols-outlined text-[16px]">more_time</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-body-md text-body-md text-on-surface font-medium leading-none">
                    Batida Extra {idx + 1}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wide uppercase bg-primary-fixed/50 text-primary">RHiD</span>
                  </div>
                </div>
              </div>
              <span className="font-mono-time text-[15px] text-on-surface font-bold tracking-tight">
                {dayjs(punch.timestamp).format('HH:mm')}
              </span>
            </div>
          ))}
        </div>

        {/* Security Duplication Block Banner */}
        <div className="bg-surface-container-low rounded-lg p-2.5 flex items-start justify-between gap-2.5 border border-surface-container" role="status">
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5" aria-hidden="true">lock_clock</span>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-label-md text-[11px] font-bold uppercase tracking-wider text-on-surface">Proteção Anti-Duplicidade</span>
                <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
              </div>
              <p className="font-label-md text-[11px] text-on-surface mt-0.5 leading-snug font-medium">
                {punches.length > 0
                  ? `Último registro confirmado às ${dayjs(punches[punches.length - 1].timestamp).format('HH:mm')}. `
                  : 'Nenhum registro efetuado hoje. '}
                Próxima batida liberada em{' '}
                <span className="font-semibold text-primary" id="countdown">
                  {countdown > 0 ? `00:${countdown.toString().padStart(2, '0')}` : 'Liberado'}
                </span>.
              </p>
            </div>
          </div>
          {registrationBlocked && (
            <button
              type="button"
              className="px-2 py-1 rounded bg-surface-container-high text-primary font-label-md text-[11px] font-semibold shrink-0 active:scale-95 transition-all"
              onClick={() => void onRefreshRegistrationBlock()}
              disabled={validationBusy}
            >
              Verificar
            </button>
          )}
        </div>
      </section>

      {/* Floating Thumb-Friendly Action Button Container (Fixed at thumb zone above tabbar) */}
      <div className="sticky bottom-4 z-40 w-full flex items-center justify-between pointer-events-none px-1">
        {/* Toggle Modo Auto */}
        {!automaticLunchReturnControlHidden && (
          <div className="pointer-events-auto flex flex-col items-center justify-center bg-surface-container-lowest/90 backdrop-blur-xl px-3 py-2 rounded-2xl shadow-sm">
            <label htmlFor="toggle-auto" className="font-label-md text-[11px] text-on-surface font-semibold leading-none mb-1 cursor-pointer">
              Modo auto
            </label>
            <button
              type="button"
              id="toggle-auto"
              role="switch"
              aria-checked={automaticLunchReturnEnabled}
              aria-label="Modo automático de registro"
              className={`w-11 h-6 rounded-full relative transition-colors focus:outline-none flex items-center px-0.5 shadow-xs ${
                automaticLunchReturnEnabled ? 'bg-primary' : 'bg-surface-container-highest'
              }`}
              onClick={onToggleAutomaticLunchReturn}
            >
              <span
                className={`w-4 h-4 bg-surface-container-lowest rounded-full shadow-sm transform transition-transform duration-200 pointer-events-none block ${
                  automaticLunchReturnEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}

        {/* Botão Principal Registrar Ponto */}
        <button
          type="button"
          className="pointer-events-auto ml-auto min-h-[48px] flex items-center gap-3 px-5 py-3.5 rounded-full bg-primary hover:bg-primary-container text-on-primary shadow-xl hover:shadow-2xl transition-all transform active:scale-95 group focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          id="btn-punch"
          aria-label={rhidTestMode ? 'Marcação bloqueada (teste)' : nextPunchLabel(punches.length)}
          onClick={triggerPunch}
          disabled={registerBusy || registrationBlocked}
        >
          <div className="w-7 h-7 rounded-full bg-on-primary/15 flex items-center justify-center" aria-hidden="true">
            <span className="material-symbols-outlined text-[20px] text-on-primary">fingerprint</span>
          </div>
          <span className="font-headline-sm text-[15px] font-semibold text-on-primary tracking-tight">
            {registerBusy ? 'Registrando...' : rhidTestMode ? 'Marcação bloqueada (teste)' : nextPunchLabel(punches.length)}
          </span>
          <span className="material-symbols-outlined text-[18px] text-on-primary/80 group-hover:translate-x-0.5 transition-transform" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      </div>

      {/* Micro-interaction punch confirmation modal */}
      <div
        className={`fixed top-20 inset-x-4 z-50 bg-surface-container-lowest rounded-xl p-3.5 shadow-xl flex items-center gap-3 transform transition-all duration-300 pointer-events-none ${
          toastVisible ? 'translate-y-0 opacity-100' : '-translate-y-28 opacity-0'
        }`}
        id="punch-toast"
      >
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary shrink-0">
          <span className="material-symbols-outlined text-[22px]">check_circle</span>
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="font-headline-sm text-[14px] font-semibold text-on-surface">Ponto registrado com sucesso!</span>
          <span className="font-label-md text-[12px] text-on-surface-variant">Comprovante gerado e assinado via RHiD.</span>
        </div>
      </div>
    </div>
  );
}
