import React, { useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrimeReactProvider } from 'primereact/api';
import { Toast } from 'primereact/toast';
import { Button } from 'primereact/button';
import 'primereact/resources/themes/lara-light-teal/theme.css';
import 'primereact/resources/primereact.min.css';
import '../index.css';
import { TodayView } from '../App';
import ConfirmPunchDialog from '../components/ConfirmPunchDialog';
import type { DaySummary, Punch } from '../types';

export function IntegrationPreview() {
  return (
    <section className="p-5 panel integration-panel account-panel connected status-border-integration" aria-label="Conta e sincronização RHiD">
      <div className="account-header">
        <div className="account-identity">
          <span className="account-avatar" aria-hidden="true"><i className="fi fi-rr-user" /></span>
          <div className="account-identity-copy">
            <span className="account-eyebrow">Conta RHiD</span>
            {/* <strong>WESLLEY GAMBERINE M...</strong> */}
            <small>gamberine@gmail.com</small>
          </div>
        </div>
        <span className="account-status-chip connected"><i className="fi fi-rr-check-circle" aria-hidden="true" />Conectado (Simulado)</span>
      </div>
      <div className="integration-body">
        <div className="account-sync-overview">
          <div className="account-sync-fact"><span>Próxima atualização</span><strong>00:09</strong></div>
          <div className="account-sync-fact"><span>Última sincronização</span><strong>18:49</strong></div>
          <button type="button" className="p-button p-component p-button-outlined refresh-button account-refresh-button">
            <i className="fi fi-rr-refresh p-button-icon" aria-hidden="true" /><span className="p-button-label">Atualizar agora</span>
          </button>
        </div>
        <div className="account-events">
          <div className="account-events-header"><p className="label">Últimas verificações</p><small>3 registros</small></div>
          <ol className="account-event-list">
            <li className="connected"><span className="account-event-marker" /><div><span>Hoje: 3 válido(s) | Total: 390</span><time>Hoje às 18:49</time></div></li>
            <li className="connected"><span className="account-event-marker" /><div><span>Ponto diário: 3 válido(s).</span><time>Hoje às 18:00</time></div></li>
            <li className="connected"><span className="account-event-marker" /><div><span>Marcação confirmada pelo RHiD às 14:58.</span><time>Hoje às 14:58</time></div></li>
          </ol>
        </div>
      </div>
    </section>
  );
}

const INITIAL_DATE = '2026-09-04';
const THREE_PUNCHES: Punch[] = [
  { id: 'punch-1', timestamp: `${INITIAL_DATE}T09:15:00-03:00`, origin: 'rhid' },
  { id: 'punch-2', timestamp: `${INITIAL_DATE}T13:59:00-03:00`, origin: 'rhid' },
  { id: 'punch-3', timestamp: `${INITIAL_DATE}T14:58:00-03:00`, origin: 'rhid' },
];

function HomologPreviewApp() {
  const toast = useRef<Toast>(null);
  const [punches, setPunches] = useState<Punch[]>(THREE_PUNCHES);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogMessage, setDialogMessage] = useState(
    'Confirmar saída 2 - fim jornada no RHiD? Sua localização atual será enviada para registrar a marcação oficial.',
  );

  const completed = punches.length >= 4;

  const summary: DaySummary = {
    date: INITIAL_DATE,
    punches,
    workedMs: 8 * 60 * 60_000 + 37 * 60_000,
    breakMs: 59 * 60_000,
    remainingMs: completed ? 0 : 0,
    balanceMs: 37 * 60_000,
    breakRemainingMs: 0,
    isWorking: !completed,
    isOnBreak: false,
    projectedFinish: new Date(`${INITIAL_DATE}T18:00:00-03:00`),
  };

  const previousSummary: DaySummary = {
    ...summary,
    date: '2026-09-03',
    punches: [
      { id: 'prev-1', timestamp: '2026-09-03T09:00:00-03:00', origin: 'rhid' },
      { id: 'prev-2', timestamp: '2026-09-03T18:00:00-03:00', origin: 'rhid' },
    ],
    workedMs: 8 * 60 * 60_000 + 32 * 60_000,
    balanceMs: 32 * 60_000,
  };

  function handleTriggerRegister() {
    setDialogMessage(
      'Confirmar saída 2 - fim jornada no RHiD? Sua localização atual será enviada para registrar a marcação oficial.',
    );
    setDialogVisible(true);
  }

  function handleConfirmPunch() {
    setDialogVisible(false);
    toast.current?.show({
      severity: 'success',
      summary: 'Marcação confirmada no teste',
      detail: 'Modal aceito com sucesso! Zero chamadas enviadas ao RHiD.',
      life: 5000,
    });
    setPunches((prev) => [
      ...prev,
      { id: `punch-${prev.length + 1}`, timestamp: new Date().toISOString(), origin: 'local' },
    ]);
  }

  function handleCancelPunch() {
    setDialogVisible(false);
    toast.current?.show({
      severity: 'info',
      summary: 'Confirmação cancelada',
      detail: 'A marcação foi cancelada pelo usuário. Nenhum ponto registrado.',
      life: 4000,
    });
  }

  function handleResetPunches() {
    setPunches(THREE_PUNCHES);
    toast.current?.show({
      severity: 'info',
      summary: 'Estado restaurado',
      detail: 'Restauradas as 3 marcações (reprodução exata do print).',
      life: 3000,
    });
  }

  return (
    <div className="app-shell min-h-screen bg-canvas text-ink">
      <Toast ref={toast} />

      {/* Barra de controle de teste e homologação */}
      <div
        style={{
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          borderBottom: '2px solid #3b82f6',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span
            style={{
              backgroundColor: '#10b981',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.25rem 0.5rem',
              borderRadius: '9999px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Modo Homologação Ativo
          </span>
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
            Ambiente de Teste Seguro (Desconectado do RHiD)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Button
            type="button"
            label="Abrir Modal de Confirmação"
            icon="fi fi-rr-bell"
            size="small"
            onClick={handleTriggerRegister}
            style={{ backgroundColor: '#2563eb', borderColor: '#2563eb', color: '#fff' }}
          />
          <Button
            type="button"
            label="Restaurar 3 marcações (Print)"
            icon="fi fi-rr-refresh"
            size="small"
            severity="secondary"
            outlined
            onClick={handleResetPunches}
            style={{ color: '#94a3b8', borderColor: '#475569' }}
          />
        </div>
      </div>

      <header className="app-header border-b border-line bg-white">
        <div className="app-header-row mx-auto max-w-screen-xl px-4 sm:px-6">
          <div className="app-brand">
            <div className="brand-mark" aria-hidden="true"><i className="fi fi-rr-clock-three" /></div>
            <div className="app-brand-copy">
              <h1 className="font-heading text-xl font-bold text-secondary">Gamb RHiD Plus</h1>
              <p className="app-brand-subtitle text-xs text-slate-500">Homologação visual &middot; Teste de Modal</p>
            </div>
          </div>
        </div>
      </header>

      <main className="app-main mx-auto max-w-screen-xl px-4 py-6 sm:px-6">
        <TodayView
          summary={summary}
          countableSummary={summary}
          settings={{ targetMinutes: 480, breakMinutes: 60, warningMinutes: 5, breakWarningMinutes: 2 }}
          progress={100}
          accumulatedBalance={5 * 60 * 60_000 + 34 * 60_000}
          previousRegisteredSummary={previousSummary}
          integrationStatus="connected"
          onRegister={handleTriggerRegister}
          officialRegistration
          rhidTestMode={false}
          registrationGate={{ state: 'ready', referenceAt: null, nextAllowedAt: null, validationUntil: null, remainingMs: 0, progress: 100 }}
          journeyCompletion={{ completed, active: completed, completedAt: completed ? punches[punches.length - 1].timestamp : null, workedMs: summary.workedMs, remainingMs: 0, progress: 100 }}
          lunchReturnGate={{ active: false, preparationDue: false, automaticDue: false, manualLockActive: false, lunchExitAt: null, preparationAt: null, returnAt: null, lockUntil: null, remainingUntilReturnMs: 0, remainingLockMs: 0 }}
          registrationBlocked={completed}
          registrationMessage={completed ? 'Jornada concluída para testes.' : ''}
          registerBusy={false}
          validationBusy={false}
          automaticOfficialPunchIdSet={new Set(['punch-3'])}
          automaticLunchReturnPunchId="punch-3"
          automaticLunchReturnEnabled
          automaticLunchReturnDisabledBySettings={false}
          automaticLunchReturnControlHidden={false}
          journeyCompletionLockActive={completed}
          onToggleAutomaticLunchReturn={() => undefined}
          onOpenAutomaticReturnSettings={() => undefined}
          onOpenJourneySettings={() => undefined}
          onOpenRequestDialog={() => undefined}
          onValidateRegistration={async () => undefined}
          onRefreshRegistrationBlock={async () => undefined}
          onRequestJourneyReopen={() => setPunches(THREE_PUNCHES)}
          onUndo={() => undefined}
          canUndoLocal={false}
          onOpenHistory={() => undefined}
          integrationPanel={<IntegrationPreview />}
        />
      </main>

      {/* Modal Customizado sendo homologado */}
      <ConfirmPunchDialog
        visible={dialogVisible}
        message={dialogMessage}
        onConfirm={handleConfirmPunch}
        onCancel={handleCancelPunch}
      />
    </div>
  );
}

const rootElement = document.getElementById('root')!;
const root = (import.meta.hot?.data.root as Root | undefined) ?? createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.root = root;

root.render(
  <React.StrictMode>
    <PrimeReactProvider value={{ ripple: true }}>
      <HomologPreviewApp />
    </PrimeReactProvider>
  </React.StrictMode>,
);
