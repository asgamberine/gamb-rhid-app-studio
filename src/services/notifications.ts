import dayjs from 'dayjs';
import type { DaySummary, JornadaSettings } from '../types';
import { formatDuration, MINUTE_MS } from '../domain/journey';
import { isCountableWorkday } from '../domain/workday';
import { nextPunchLabel, STANDARD_DAILY_PUNCH_LIMIT } from '../domain/journey';

export interface Alert {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warn';
  kind?: 'reminder' | 'anomaly' | 'followup';
  requestPrefill?: {
    startDate: string;
    endDate: string;
    type: string;
    time?: string;
    notes: string;
  };
  emailSubject?: string;
  emailBody?: string;
  historyRefresh?: boolean;
}

export function availableNotificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.requestPermission();
}

function minuteMessage(minutes: number): string {
  return minutes === 1 ? 'Falta 1 minuto' : `Faltam ${minutes} minutos`;
}

export function findAlerts(
  summary: DaySummary,
  settings: JornadaSettings,
  delivered: string[],
): Alert[] {
  const alerts: Alert[] = [];
  const warningMs = settings.warningMinutes * MINUTE_MS;
  const breakWarningMs = settings.breakWarningMinutes * MINUTE_MS;

  if (summary.isOnBreak && summary.breakRemainingMs <= breakWarningMs) {
    alerts.push({
      id: `${summary.date}:break-return`,
      title: 'Retorno em breve',
      body: `${minuteMessage(settings.breakWarningMinutes)} para completar o intervalo planejado.`,
      severity: 'info',
      kind: 'reminder',
    });
  }

  if (summary.isWorking && summary.remainingMs > 0 && summary.remainingMs <= warningMs) {
    alerts.push({
      id: `${summary.date}:finish-warning`,
      title: 'Jornada quase concluída',
      body: `${minuteMessage(settings.warningMinutes)} para completar sua carga de hoje.`,
      severity: 'info',
      kind: 'reminder',
    });
  }

  if (summary.isWorking && summary.remainingMs === 0) {
    alerts.push({
      id: `${summary.date}:finish`,
      title: 'Jornada concluída',
      body: `Você completou ${formatDuration(settings.targetMinutes * MINUTE_MS)} de trabalho. Confira e registre sua saída.`,
      severity: 'success',
      kind: 'reminder',
    });

    const overtimeMs = summary.workedMs - settings.targetMinutes * MINUTE_MS;
    if (overtimeMs >= 30 * MINUTE_MS) {
      const reminderBucket = Math.floor((overtimeMs - 30 * MINUTE_MS) / (5 * MINUTE_MS));
      alerts.push({
        id: `${summary.date}:overtime-punch-reminder:${reminderBucket}`,
        title: 'Marcação de saída pendente',
        body: `Sua jornada padrão terminou há ${formatDuration(overtimeMs)}. Se ainda estiver trabalhando, acompanhe o tempo extra; caso contrário, confira e registre a saída no RHiD.`,
        severity: 'warn',
        kind: 'reminder',
      });
    }
  }

  return alerts.filter((alert) => !delivered.includes(alert.id));
}

export function buildWorkdayAlerts(
  history: DaySummary[],
  settings: JornadaSettings,
  dismissed: string[],
  today: string,
): Alert[] {
  const alerts: Alert[] = [];
  for (const day of history) {
    if (!isCountableWorkday(day.date)) {
      continue;
    }
    if (day.date > today) {
      continue;
    }

    const punchCount = day.punches.length;
    if (punchCount === STANDARD_DAILY_PUNCH_LIMIT) {
      continue;
    }

    const isPastDay = day.date < today;
    const ageDays = Math.max(dayjs(today).diff(dayjs(day.date), 'day'), 0);
    const missingDurationMs = Math.max(settings.targetMinutes * MINUTE_MS - day.workedMs, 0);
    const missingMinutes = Math.round(missingDurationMs / MINUTE_MS);

    if (punchCount > STANDARD_DAILY_PUNCH_LIMIT) {
      alerts.push({
        id: `${day.date}:excess-punches`,
        title: `Excesso de marcações em ${dayjs(day.date).format('DD/MM')}`,
        body: `Foram reconhecidas ${punchCount} marcações em ${dayjs(day.date).format('DD/MM/YYYY')}. A notificação fica fixa até você fechar e o relatório pode ser revalidado após 3 dias.`,
        severity: 'warn',
        kind: 'anomaly',
        historyRefresh: isPastDay && ageDays >= 3,
      });
      continue;
    }

    if (isPastDay && punchCount < STANDARD_DAILY_PUNCH_LIMIT) {
      const missingTime = punchCount === 3 && day.punches.length > 0
        ? dayjs(day.punches[day.punches.length - 1].timestamp)
          .add(missingMinutes, 'minute')
          .format('HH:mm')
        : undefined;
      const missingLabel = nextPunchLabel(punchCount);
      const baseNotes = `Faltou ${missingLabel} em ${dayjs(day.date).format('DD/MM/YYYY')}.`;
      const timeNotes = missingTime ? `Horário estimado da última marcação: ${missingTime}.` : '';
      alerts.push({
        id: `${day.date}:missing-punches`,
        title: `Faltam marcações em ${dayjs(day.date).format('DD/MM')}`,
        body: `Foram reconhecidas ${punchCount} de ${STANDARD_DAILY_PUNCH_LIMIT} marcações em ${dayjs(day.date).format('DD/MM/YYYY')}. Faltou ${missingLabel} e ainda restam ${formatDuration(missingDurationMs)} para completar 8h de jornada.`,
        severity: 'warn',
        kind: 'anomaly',
        requestPrefill: {
          startDate: day.date,
          endDate: day.date,
          type: 'inclusao_marcacao',
          time: missingTime,
          notes: timeNotes ? `${baseNotes} ${timeNotes}` : `${baseNotes} Faltam ${formatDuration(missingDurationMs)} para completar 8h de jornada.`,
        },
      });
    }
  }

  return alerts.filter((alert) => !dismissed.includes(alert.id));
}

export async function pushBrowserNotification(alert: Alert): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }
  const options = {
    body: alert.body,
    tag: alert.id,
    renotify: true,
    badge: `${import.meta.env.BASE_URL}pwa-64x64-73b2f8ad.png`,
  };
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
    if (registration) {
      await registration.showNotification(alert.title, options).catch(() => undefined);
      return;
    }
  }
  new Notification(alert.title, options);
}
