import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PrimeReactProvider } from 'primereact/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayView } from './App';
import { formatPublishedVersion } from './version';
import type { OfficialPunchGate } from './domain/journey';
import type { DaySummary, Punch } from './types';

afterEach(cleanup);

const date = '2026-08-21';

function summaryWith(punches: Punch[], workedMs = 0, balanceMs = 0): DaySummary {
  return {
    date,
    punches,
    workedMs,
    breakMs: punches.length >= 3 ? 59 * 60_000 : 0,
    remainingMs: Math.max(8 * 60 * 60_000 - workedMs, 0),
    balanceMs,
    breakRemainingMs: 0,
    isWorking: punches.length % 2 === 1,
    isOnBreak: punches.length === 2,
    projectedFinish: punches.length ? new Date(`${date}T19:02:00-03:00`) : null,
  };
}

function renderToday(
  summary: DaySummary,
  completed = false,
  registrationGate: OfficialPunchGate = { state: 'ready', referenceAt: null, nextAllowedAt: null, validationUntil: null, remainingMs: 0, progress: 100 },
  onRefreshRegistrationBlock = vi.fn(async () => undefined),
  registrationMessage = '',
  automaticOfficialPunchIdSet: Set<string> = new Set(),
  automaticLunchReturnPunchId: string | null = null,
) {
  return render(
    <PrimeReactProvider value={{ unstyled: true }}>
      <TodayView
      summary={summary}
      countableSummary={summary}
      settings={{ targetMinutes: 480, breakMinutes: 60, warningMinutes: 5, breakWarningMinutes: 2 }}
      progress={completed ? 100 : 0}
      accumulatedBalance={199 * 60_000}
      previousRegisteredSummary={summaryWith([], 9 * 60 * 60_000, 60 * 60_000)}
      integrationStatus="connected"
      onRegister={vi.fn()}
      officialRegistration
      rhidTestMode={false}
      registrationGate={registrationGate}
      journeyCompletion={{ completed, active: completed, completedAt: completed ? summary.punches[summary.punches.length - 1]?.timestamp ?? null : null, workedMs: summary.workedMs, remainingMs: completed ? 52_000 : 0, progress: completed ? 70 : 0 }}
      lunchReturnGate={{ active: false, preparationDue: false, automaticDue: false, manualLockActive: false, lunchExitAt: null, preparationAt: null, returnAt: null, lockUntil: null, remainingUntilReturnMs: 0, remainingLockMs: 0 }}
      registrationBlocked={completed}
      registrationMessage={registrationMessage}
      registerBusy={false}
      validationBusy={false}
      automaticOfficialPunchIdSet={automaticOfficialPunchIdSet}
      automaticLunchReturnPunchId={automaticLunchReturnPunchId}
      automaticLunchReturnEnabled
      automaticLunchReturnDisabledBySettings={false}
      automaticLunchReturnControlHidden={false}
      journeyCompletionLockActive={completed}
      onToggleAutomaticLunchReturn={vi.fn()}
      onOpenAutomaticReturnSettings={vi.fn()}
      onOpenJourneySettings={vi.fn()}
      onOpenRequestDialog={vi.fn()}
      onValidateRegistration={vi.fn(async () => undefined)}
      onRefreshRegistrationBlock={onRefreshRegistrationBlock}
      onRequestJourneyReopen={vi.fn()}
      onUndo={vi.fn()}
      canUndoLocal={false}
      onOpenHistory={vi.fn()}
        integrationPanel={<section aria-label="Integração de teste" />}
      />
    </PrimeReactProvider>,
  );
}

describe('TodayView em homologacao', () => {
  it('prioriza acompanhamento vivo e mostra o ultimo dia nos cards enquanto a jornada esta aberta', () => {
    renderToday(summaryWith([]));

    const prioritySummary = screen.getByLabelText('Resumo prioritário da jornada');
    expect(within(prioritySummary).getByText('Trabalhado')).toBeTruthy();
    expect(within(prioritySummary).getByText('Faltam')).toBeTruthy();
    expect(within(prioritySummary).getByText('Saída prevista')).toBeTruthy();

    const cards = screen.getByLabelText('Métricas da jornada');
    expect(within(cards).getByText('Intervalo')).toBeTruthy();
    expect(within(cards).getByText('Último dia')).toBeTruthy();
    expect(within(cards).queryByText('Trabalhado')).toBeNull();
    expect(within(cards).getByText('Saldo dia')).toBeTruthy();
    expect(within(cards).getByText('Saldo horas')).toBeTruthy();

    const plannedJourney = screen.getByLabelText('Jornada planejada');
    expect(within(plannedJourney).getByText('Jornada')).toBeTruthy();
    expect(within(plannedJourney).getByText('Almoço')).toBeTruthy();
    expect(within(plannedJourney).getByText('Total previsto')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alterar jornada padrão nos Ajustes' })).toBeTruthy();
    const historyShortcuts = screen.getByLabelText('Histórico de registros');
    expect(within(historyShortcuts).queryByText('Último dia:')).toBeNull();
    expect(within(historyShortcuts).queryByText('Status hoje:')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Modo auto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Registrar entrada no RHiD' })).toBeTruthy();
  });

  it('exibe o box do modo auto apenas apos a marcacao da entrada e oculta a partir da entrada 2', () => {
    // 0 batidas (novo dia antes da entrada): oculto
    const { unmount: unmount0 } = renderToday(summaryWith([]));
    expect(screen.queryByRole('switch', { name: 'Modo auto' })).toBeNull();
    unmount0();

    // 1 batida (Entrada realizada): visivel
    const { unmount: unmount1 } = renderToday(summaryWith([
      { id: '1', timestamp: `${date}T08:00:00-03:00`, origin: 'rhid' },
    ]));
    expect(screen.getByRole('switch', { name: 'Modo auto' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Modo auto' }).getAttribute('aria-checked')).toBe('true');
    unmount1();

    // 2 batidas (Saida 1 - Almoco realizada): visivel
    const { unmount: unmount2 } = renderToday(summaryWith([
      { id: '1', timestamp: `${date}T08:00:00-03:00`, origin: 'rhid' },
      { id: '2', timestamp: `${date}T12:00:00-03:00`, origin: 'rhid' },
    ]));
    expect(screen.getByRole('switch', { name: 'Modo auto' })).toBeTruthy();
    unmount2();

    // 3 batidas (Entrada 2 realizada): oculto
    const { unmount: unmount3 } = renderToday(summaryWith([
      { id: '1', timestamp: `${date}T08:00:00-03:00`, origin: 'rhid' },
      { id: '2', timestamp: `${date}T12:00:00-03:00`, origin: 'rhid' },
      { id: '3', timestamp: `${date}T13:00:00-03:00`, origin: 'rhid' },
    ]));
    expect(screen.queryByRole('switch', { name: 'Modo auto' })).toBeNull();
    unmount3();
  });

  it('exibe a badge auto laranja quando a Entrada 2 for automatica e nao exibe quando for manual', () => {
    const punches: Punch[] = [
      { id: '1', timestamp: `${date}T08:00:00-03:00`, origin: 'rhid' },
      { id: '2', timestamp: `${date}T12:00:00-03:00`, origin: 'rhid' },
      { id: '3', timestamp: `${date}T13:00:00-03:00`, origin: 'rhid' },
    ];

    // Entrada 2 automatica: exibe badge auto laranja
    const { unmount: unmountAuto } = renderToday(
      summaryWith(punches),
      false,
      undefined,
      undefined,
      '',
      new Set(['3']),
    );
    const autoBadge = screen.getByText('auto');
    expect(autoBadge).toBeTruthy();
    expect(autoBadge.className).toContain('bg-orange-100');
    expect(autoBadge.className).toContain('text-orange-800');
    unmountAuto();

    // Entrada 2 manual: nao exibe badge auto
    const { unmount: unmountManual } = renderToday(
      summaryWith(punches),
      false,
      undefined,
      undefined,
      '',
      new Set(),
    );
    expect(screen.queryByText('auto')).toBeNull();
    unmountManual();
  });

  it('mantem a timeline completa e o bloqueio seguro depois da quarta marcacao', () => {
    const punches: Punch[] = [
      { id: '1', timestamp: `${date}T08:58:00-03:00`, origin: 'rhid' },
      { id: '2', timestamp: `${date}T12:50:00-03:00`, origin: 'rhid' },
      { id: '3', timestamp: `${date}T13:49:00-03:00`, origin: 'rhid' },
      { id: '4', timestamp: `${date}T19:02:00-03:00`, origin: 'rhid' },
    ];
    renderToday(summaryWith(punches, 9 * 60 * 60_000 + 5 * 60_000, 65 * 60_000), true);

    const cards = screen.getByLabelText('Métricas da jornada');
    expect(within(cards).getByText('Trabalhado')).toBeTruthy();
    expect(within(cards).queryByText('Último dia')).toBeNull();

    expect(screen.getByText('Entrada')).toBeTruthy();
    expect(screen.getByText('Saída 1 - Almoço')).toBeTruthy();
    expect(screen.getByText('Entrada 2 - Retorno Almoço')).toBeTruthy();
    expect(screen.getByText('Saída 2 - Fim Jornada')).toBeTruthy();
    expect(screen.getByText('Bloqueio de segurança')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Registrar .* no RHiD/ })).toBeNull();
  });

  it('exibe a acao para verificar e liberar o bloqueio durante o intervalo minimo', () => {
    const onRefreshRegistrationBlock = vi.fn(async () => undefined);
    const cooldownGate: OfficialPunchGate = {
      state: 'cooldown',
      referenceAt: `${date}T08:58:00-03:00`,
      nextAllowedAt: new Date(`${date}T09:23:00-03:00`).getTime(),
      validationUntil: null,
      remainingMs: 20 * 60_000,
      progress: 99,
    };

    renderToday(
      summaryWith([{ id: '1', timestamp: `${date}T08:58:00-03:00`, origin: 'rhid' }]),
      false,
      cooldownGate,
      onRefreshRegistrationBlock,
      'Conferindo novamente no RHiD para validar a liberação...',
    );

    const securityPanel = screen.getByText('Bloqueio de segurança').closest('.registration-status-panel');
    expect(securityPanel?.textContent).toContain('Conferindo novamente no RHiD para validar a liberação...');
    expect(screen.getByText('00:20')).toBeTruthy();
    const unlockButton = screen.getByRole('button', { name: 'Verificar e liberar bloqueio no RHiD' });
    expect(unlockButton.querySelector('.fi-rr-lock-open-alt')).toBeTruthy();

    fireEvent.click(unlockButton);
    expect(onRefreshRegistrationBlock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Desativar bloqueio de segurança?' })).toBeTruthy();

    const noButton = screen.getByRole('button', { name: 'Não' });
    const yesButton = screen.getByRole('button', { name: 'Sim' });
    expect(noButton.compareDocumentPosition(yesButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(yesButton);
    expect(onRefreshRegistrationBlock).toHaveBeenCalledOnce();
  });

  it('formata e exibe a versao publicada com data e hora de deploy', () => {
    expect(formatPublishedVersion('0.2.5', '2026-09-15T19:30:00-03:00')).toBe('v0.2.5 • 15/09/2026 às 19:30');

    renderToday(summaryWith([]));
    expect(screen.getByText(/versão publicada:/i)).toBeTruthy();
  });
});
