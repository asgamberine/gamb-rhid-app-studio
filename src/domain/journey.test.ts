import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import {
  automaticLunchReturnAt,
  automaticLunchReturnControlHiddenForJourney,
  automaticLunchReturnGate,
  automaticSafetyExitGate,
  balancePeriodEndDate,
  calculateSafetyExitThreshold,
  completedJourneyGate,
  excessPunchCount,
  formatDuration,
  formatDurationWithSeconds,
  mergeOfficialPunches,
  officialAccumulatedBalanceAt,
  officialBalanceForPeriod,
  officialPunchGate,
  replaceOfficialBalanceDaysForPeriod,
  replacePendingDaysForPeriod,
  replacePunchesForPeriod,
  summarizeDay,
} from './journey';
import { automaticLocationAllowed, distanceInMeters, profileReferenceForDate } from './location';
import { buildWorkdayAlerts, findAlerts } from '../services/notifications';
import { parseRhidDailyPunches, parseRhidExcludedPunches, parseRhidOfficialBalanceDays, parseRhidPendingItems, parseRhidPortalHistoryPunches, parseRhidPortalPendingDays, parseRhidPunches, parseRhidRequestRecords, rhidDailyEntries } from '../services/rhidParser';
import type { GeographicPoint, JornadaSettings, LocationProfile, OfficialBalanceDay, Punch } from '../types';

const settings: JornadaSettings = {
  targetMinutes: 480,
  breakMinutes: 60,
  warningMinutes: 5,
  breakWarningMinutes: 2,
};

function mark(timestamp: string): Punch {
  return { id: timestamp, timestamp, origin: 'local' };
}

function officialMark(timestamp: string): Punch {
  return { id: timestamp, timestamp, origin: 'rhid' };
}

describe('summarizeDay', () => {
  it('projects finish with the planned break after the first punch', () => {
    const summary = summarizeDay(
      '2026-05-24',
      [mark('2026-05-24T08:00:00-03:00')],
      settings,
      new Date('2026-05-24T10:00:00-03:00'),
    );

    expect(formatDuration(summary.workedMs)).toBe('02:00');
    expect(summary.projectedFinish?.toISOString()).toBe('2026-05-24T20:00:00.000Z');
  });

  it('recalculates finish after the actual lunch return', () => {
    const summary = summarizeDay(
      '2026-05-24',
      [
        mark('2026-05-24T08:00:00-03:00'),
        mark('2026-05-24T12:00:00-03:00'),
        mark('2026-05-24T12:45:00-03:00'),
      ],
      settings,
      new Date('2026-05-24T13:00:00-03:00'),
    );

    expect(formatDuration(summary.workedMs)).toBe('04:15');
    expect(formatDuration(summary.breakMs)).toBe('00:45');
    expect(summary.projectedFinish?.toISOString()).toBe('2026-05-24T19:45:00.000Z');
  });

  it('calculates a completed eight-hour day', () => {
    const summary = summarizeDay(
      '2026-05-24',
      [
        mark('2026-05-24T08:00:00-03:00'),
        mark('2026-05-24T12:00:00-03:00'),
        mark('2026-05-24T13:00:00-03:00'),
        mark('2026-05-24T17:00:00-03:00'),
      ],
      settings,
      new Date('2026-05-24T17:01:00-03:00'),
    );

    expect(formatDuration(summary.workedMs)).toBe('08:00');
    expect(summary.balanceMs).toBe(0);
    expect(summary.isWorking).toBe(false);
  });

  it('projects 18:05 from a 09:05 entry with eight work hours and one lunch hour', () => {
    const summary = summarizeDay(
      '2026-05-26',
      [mark('2026-05-26T09:05:00-03:00'), mark('2026-05-26T14:04:00-03:00')],
      settings,
      new Date('2026-05-26T14:30:26-03:00'),
    );

    expect(summary.projectedFinish && dayjs(summary.projectedFinish).format('HH:mm')).toBe('18:05');
    expect(formatDurationWithSeconds(summary.breakMs)).toBe('00:26:26');
  });

  it('flags only marks after the four standard daily punches as excess', () => {
    const punches = [
      mark('2026-05-25T09:00:00-03:00'),
      mark('2026-05-25T12:00:00-03:00'),
      mark('2026-05-25T13:00:00-03:00'),
      mark('2026-05-25T18:00:00-03:00'),
      mark('2026-05-25T20:33:00-03:00'),
    ];

    expect(excessPunchCount(punches)).toBe(1);
    expect(excessPunchCount(punches.slice(0, 4))).toBe(0);
  });
});

describe('automaticLunchReturnAt', () => {
  const lunchPunches = [
    mark('2026-06-11T08:00:00-03:00'),
    mark('2026-06-11T12:00:00-03:00'),
  ];

  it('does not return before fifty-nine lunch minutes are complete', () => {
    expect(automaticLunchReturnAt(
      lunchPunches,
      new Date('2026-06-11T12:58:59-03:00'),
    )).toBeNull();
  });

  it('locks manual registration after fifty-eight minutes', () => {
    const gate = automaticLunchReturnGate(
      lunchPunches,
      new Date('2026-06-11T12:58:00-03:00'),
    );

    expect(gate.manualLockActive).toBe(true);
    expect(formatDuration(gate.remainingUntilReturnMs)).toBe('00:01');
  });

  it('runs the lunch refresh at fifty-eight minutes', () => {
    const gate = automaticLunchReturnGate(
      lunchPunches,
      new Date('2026-06-11T12:58:00-03:00'),
    );

    expect(gate.preparationDue).toBe(true);
    expect(gate.automaticDue).toBe(false);
    expect(gate.manualLockActive).toBe(true);
    expect(formatDuration(gate.remainingUntilReturnMs)).toBe('00:01');
  });

  it('does not return without Saída 1', () => {
    expect(automaticLunchReturnAt(
      [lunchPunches[0]],
      new Date('2026-06-11T13:00:00-03:00'),
    )).toBeNull();
  });

  it('returns the automatic Entrada 2 timestamp after fifty-nine lunch minutes', () => {
    expect(automaticLunchReturnAt(
      lunchPunches,
      new Date('2026-06-11T12:59:00-03:00'),
    )).toBe(new Date('2026-06-11T12:59:00-03:00').toISOString());
  });

  it('uses minute precision so a 13:02 lunch exit triggers at 14:01', () => {
    const punches = [
      mark('2026-06-11T08:00:15-03:00'),
      mark('2026-06-11T13:02:45-03:00'),
    ];

    expect(automaticLunchReturnAt(
      punches,
      new Date('2026-06-11T14:01:00-03:00'),
    )).toBe(new Date('2026-06-11T14:01:00-03:00').toISOString());
  });

  it('does not return when Entrada 2 already exists', () => {
    expect(automaticLunchReturnAt(
      [...lunchPunches, mark('2026-06-11T13:00:00-03:00')],
      new Date('2026-06-11T13:10:00-03:00'),
    )).toBeNull();
  });

  it('cancels the automatic lunch flow once a manual Entrada 2 is recognized', () => {
    const gate = automaticLunchReturnGate(
      [...lunchPunches, mark('2026-06-11T13:00:00-03:00')],
      new Date('2026-06-11T13:10:00-03:00'),
    );

    expect(gate.active).toBe(false);
    expect(gate.preparationDue).toBe(false);
    expect(gate.automaticDue).toBe(false);
    expect(gate.manualLockActive).toBe(false);
    expect(gate.lunchExitAt).toBeNull();
  });

  it('does not create a stale automatic return after the safety window', () => {
    expect(automaticLunchReturnAt(
      lunchPunches,
      new Date('2026-06-11T13:24:00-03:00'),
    )).toBeNull();
  });
});

describe('automaticLunchReturnControlHiddenForJourney', () => {
  const accountKey = 'usuario@empresa.com:empresa';

  it('hides the control only for the account and journey that completed the automatic return', () => {
    const hiddenJourneyKey = `${accountKey}|2026-08-13`;

    expect(automaticLunchReturnControlHiddenForJourney(hiddenJourneyKey, accountKey, '2026-08-13')).toBe(true);
    expect(automaticLunchReturnControlHiddenForJourney(hiddenJourneyKey, accountKey, '2026-08-14')).toBe(false);
    expect(automaticLunchReturnControlHiddenForJourney(hiddenJourneyKey, 'outra@empresa.com:empresa', '2026-08-13')).toBe(false);
  });

  it('keeps the control visible without an authenticated account or persisted journey', () => {
    expect(automaticLunchReturnControlHiddenForJourney(null, accountKey, '2026-08-13')).toBe(false);
    expect(automaticLunchReturnControlHiddenForJourney(`${accountKey}|2026-08-13`, '', '2026-08-13')).toBe(false);
  });
});

describe('automaticSafetyExitGate', () => {
  it('identifies when safety exit is eligible and when threshold is due', () => {
    const punches: Punch[] = [
      { id: '1', timestamp: '2026-06-22T08:00:00-03:00', origin: 'rhid' },
      { id: '2', timestamp: '2026-06-22T12:00:00-03:00', origin: 'rhid' },
      { id: '3', timestamp: '2026-06-22T13:00:00-03:00', origin: 'rhid' },
    ];
    // Threshold: 13:00 + 4h = 17:00; 17:00 + 1h45 = 18:45
    const beforeGate = automaticSafetyExitGate(punches, 480, new Date('2026-06-22T18:40:00-03:00'));
    expect(beforeGate.eligible).toBe(true);
    expect(beforeGate.safetyDue).toBe(false);
    expect(beforeGate.remainingUntilSafetyMs).toBe(5 * 60_000);

    const dueGate = automaticSafetyExitGate(punches, 480, new Date('2026-06-22T18:45:00-03:00'));
    expect(dueGate.eligible).toBe(true);
    expect(dueGate.safetyDue).toBe(true);
    expect(dueGate.remainingUntilSafetyMs).toBe(0);
  });

  it('declares not eligible if 4 punches already present', () => {
    const punches: Punch[] = [
      { id: '1', timestamp: '2026-06-22T08:00:00-03:00', origin: 'rhid' },
      { id: '2', timestamp: '2026-06-22T12:00:00-03:00', origin: 'rhid' },
      { id: '3', timestamp: '2026-06-22T13:00:00-03:00', origin: 'rhid' },
      { id: '4', timestamp: '2026-06-22T17:00:00-03:00', origin: 'rhid' },
    ];
    const gate = automaticSafetyExitGate(punches, 480, new Date('2026-06-22T18:45:00-03:00'));
    expect(gate.eligible).toBe(false);
    expect(gate.safetyDue).toBe(false);
  });

  it('declares not eligible if fewer than 3 punches', () => {
    const punches: Punch[] = [
      { id: '1', timestamp: '2026-06-22T08:00:00-03:00', origin: 'rhid' },
      { id: '2', timestamp: '2026-06-22T12:00:00-03:00', origin: 'rhid' },
    ];
    const gate = automaticSafetyExitGate(punches, 480, new Date('2026-06-22T18:45:00-03:00'));
    expect(gate.eligible).toBe(false);
    expect(gate.safetyDue).toBe(false);
  });
});

describe('automatic location validation', () => {
  const home: GeographicPoint = {
    latitude: -23.55052,
    longitude: -46.633308,
    accuracy: 15,
    capturedAt: '2026-06-01T12:00:00.000Z',
  };
  const work: GeographicPoint = {
    latitude: -23.561414,
    longitude: -46.655881,
    accuracy: 12,
    capturedAt: '2026-06-01T12:00:00.000Z',
  };
  const profile: LocationProfile = {
    home: { address: 'Residência', point: home },
    work: { address: 'Trabalho', point: work },
    onsiteDates: ['2026-06-11'],
  };

  it('uses work on an onsite calendar day and home otherwise', () => {
    expect(profileReferenceForDate(profile, '2026-06-11')?.kind).toBe('work');
    expect(profileReferenceForDate(profile, '2026-06-12')?.kind).toBe('home');
  });

  it('accepts the current position inside either authorized range without requiring proximity to both', () => {
    const current = { ...work, latitude: -23.5610 };
    const workReference = profileReferenceForDate(profile, '2026-06-11');
    const homeReference = profileReferenceForDate(profile, '2026-06-12');

    expect(workReference).not.toBeNull();
    expect(homeReference).not.toBeNull();
    expect(distanceInMeters(current, work)).toBeLessThan(100);
    expect(distanceInMeters(current, home)).toBeGreaterThan(100);
    expect(automaticLocationAllowed(current, [homeReference!, workReference!]).allowed).toBe(true);
  });

  it('blocks distant automatic positions', () => {
    const reference = profileReferenceForDate(profile, '2026-06-11');

    expect(automaticLocationAllowed(home, [reference!]).allowed).toBe(false);
    expect(automaticLocationAllowed({ ...work, accuracy: 150 }, [reference!]).allowed).toBe(true);
  });
});

describe('officialPunchGate', () => {
  it('blocks a new official punch for the first 25 minutes', () => {
    const gate = officialPunchGate(
      [officialMark('2026-05-26T14:04:00-03:00')],
      null,
      '2026-05-26T14:04:05-03:00',
      new Date('2026-05-26T14:18:00-03:00'),
    );

    expect(gate.state).toBe('cooldown');
    expect(formatDuration(gate.remainingMs)).toBe('00:11');
  });

  it('requires a fresh daily validation after the minimum interval', () => {
    const gate = officialPunchGate(
      [officialMark('2026-05-26T14:04:00-03:00')],
      null,
      '2026-05-26T14:05:00-03:00',
      new Date('2026-05-26T14:30:00-03:00'),
    );

    expect(gate.state).toBe('validation');
  });

  it('releases the next punch when the validation query is made after 25 minutes', () => {
    const gate = officialPunchGate(
      [officialMark('2026-05-26T14:04:00-03:00')],
      null,
      '2026-05-26T14:29:02-03:00',
      new Date('2026-05-26T14:30:00-03:00'),
    );

    expect(gate.state).toBe('ready');
  });

  it('does not require validation after the 51-minute safety window', () => {
    const gate = officialPunchGate(
      [officialMark('2026-05-26T14:04:00-03:00')],
      null,
      null,
      new Date('2026-05-26T14:55:00-03:00'),
    );

    expect(gate.state).toBe('ready');
  });

  it('keeps the cooldown active from a recently accepted receipt before sync confirms it', () => {
    const gate = officialPunchGate(
      [],
      '2026-05-26T14:04:30-03:00',
      null,
      new Date('2026-05-26T14:05:00-03:00'),
    );

    expect(gate.state).toBe('cooldown');
  });
});

describe('completedJourneyGate', () => {
  const completeDay = [
    officialMark('2026-05-26T08:00:00-03:00'),
    officialMark('2026-05-26T12:00:00-03:00'),
    officialMark('2026-05-26T13:00:00-03:00'),
    officialMark('2026-05-26T17:00:00-03:00'),
  ];

  it('blocks additional punches for four hours after four punches and eight worked hours', () => {
    const gate = completedJourneyGate(completeDay, new Date('2026-05-26T18:00:00-03:00'));

    expect(gate.completed).toBe(true);
    expect(gate.active).toBe(true);
    expect(formatDuration(gate.workedMs)).toBe('08:00');
    expect(formatDuration(gate.remainingMs)).toBe('03:00');
  });

  it('does not close a four-punch day below eight worked hours', () => {
    const gate = completedJourneyGate([
      officialMark('2026-05-26T09:00:00-03:00'),
      officialMark('2026-05-26T12:00:00-03:00'),
      officialMark('2026-05-26T13:00:00-03:00'),
      officialMark('2026-05-26T17:00:00-03:00'),
    ], new Date('2026-05-26T17:01:00-03:00'));

    expect(gate.completed).toBe(false);
    expect(gate.active).toBe(false);
  });

  it('releases an exceptional new punch after the four-hour safety period', () => {
    const gate = completedJourneyGate(completeDay, new Date('2026-05-26T21:00:00-03:00'));

    expect(gate.completed).toBe(true);
    expect(gate.active).toBe(false);
  });
});

describe('findAlerts', () => {
  it('warns two minutes before the planned return from lunch', () => {
    const summary = summarizeDay(
      '2026-05-24',
      [mark('2026-05-24T08:00:00-03:00'), mark('2026-05-24T12:00:00-03:00')],
      settings,
      new Date('2026-05-24T12:58:00-03:00'),
    );

    expect(findAlerts(summary, settings, []).map((alert) => alert.id)).toContain('2026-05-24:break-return');
  });

  it('uses configured timing in a quick notification simulation', () => {
    const quickSettings = { ...settings, breakMinutes: 1, breakWarningMinutes: 1 };
    const summary = summarizeDay(
      '2026-05-24',
      [mark('2026-05-24T08:00:00-03:00'), mark('2026-05-24T12:00:00-03:00')],
      quickSettings,
      new Date('2026-05-24T12:00:00-03:00'),
    );

    expect(findAlerts(summary, quickSettings, [])[0]?.body).toContain('Falta 1 minuto');
  });

  it('does not deliver the same notification twice', () => {
    const summary = summarizeDay(
      '2026-05-24',
      [
        mark('2026-05-24T08:00:00-03:00'),
        mark('2026-05-24T12:00:00-03:00'),
        mark('2026-05-24T13:00:00-03:00'),
      ],
      settings,
      new Date('2026-05-24T16:57:00-03:00'),
    );

    expect(findAlerts(summary, settings, ['2026-05-24:finish-warning'])).toHaveLength(0);
  });

  it('repeats the pending exit reminder every five minutes after 30 minutes of overtime', () => {
    const punches = [
      mark('2026-05-24T08:00:00-03:00'),
      mark('2026-05-24T12:00:00-03:00'),
      mark('2026-05-24T13:00:00-03:00'),
    ];
    const firstSummary = summarizeDay('2026-05-24', punches, settings, new Date('2026-05-24T17:30:00-03:00'));
    const nextSummary = summarizeDay('2026-05-24', punches, settings, new Date('2026-05-24T17:35:00-03:00'));

    expect(findAlerts(firstSummary, settings, []).map((alert) => alert.id))
      .toContain('2026-05-24:overtime-punch-reminder:0');
    expect(findAlerts(nextSummary, settings, ['2026-05-24:overtime-punch-reminder:0']).map((alert) => alert.id))
      .toContain('2026-05-24:overtime-punch-reminder:1');
  });
});

describe('buildWorkdayAlerts', () => {
  it('flags a past day with more than four punches and marks it for later refresh', () => {
    const summary = summarizeDay(
      '2026-06-29',
      [
        mark('2026-06-29T08:00:00-03:00'),
        mark('2026-06-29T12:00:00-03:00'),
        mark('2026-06-29T13:00:00-03:00'),
        mark('2026-06-29T17:00:00-03:00'),
        mark('2026-06-29T18:10:00-03:00'),
      ],
      settings,
      new Date('2026-07-02T10:00:00-03:00'),
    );

    const alerts = buildWorkdayAlerts([summary], settings, [], '2026-07-02');

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.historyRefresh).toBe(true);
    expect(alerts[0]?.body).toContain('5 marcações');
  });

  it('prefills a missing punch request with date, time and remaining journey duration', () => {
    const summary = summarizeDay(
      '2026-07-01',
      [
        mark('2026-07-01T08:00:00-03:00'),
        mark('2026-07-01T12:00:00-03:00'),
        mark('2026-07-01T13:00:00-03:00'),
      ],
      settings,
      new Date('2026-07-02T10:00:00-03:00'),
    );

    const alerts = buildWorkdayAlerts([summary], settings, [], '2026-07-02');

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.requestPrefill).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      type: 'inclusao_marcacao',
      time: '17:00',
    });
    expect(alerts[0]?.requestPrefill?.notes).toContain('17:00');
  });
});

describe('RHiD synchronization', () => {
  it('extracts official date-time markings from the apuracao response', () => {
    const punches = parseRhidPunches({
      retorno: { afdt: [{ dateTimeStr: '202605151016' }] },
      records: [{ batida: '2026-05-15T14:00:00-03:00' }, { dateTimeStr: '202605151645' }],
    });

    expect(punches).toHaveLength(3);
    expect(punches.every((punch) => punch.origin === 'rhid')).toBe(true);
  });

  it('reads only official daily entries from retorno.afdt', () => {
    const response = {
      generatedAt: '2026-05-15T18:00:00-03:00',
      retorno: { afdt: [{ dateTimeStr: '202605150800' }] },
    };

    expect(rhidDailyEntries(response)).toHaveLength(1);
    expect(parseRhidDailyPunches(response).map((punch) => punch.timestamp)).toHaveLength(1);
    expect(parseRhidDailyPunches(response)[0].timestamp).toContain('2026-05-15');
  });

  it('loads an official entry and lunch exit returned by ponto_diario', () => {
    const response = {
      status: true,
      retorno: {
        dateTime: '20260526',
        afdt: [
          { dateTimeStr: '202605260905', _typeEntradaSaida: 'E' },
          { dateTimeStr: '202605261404', _typeEntradaSaida: 'S' },
        ],
      },
    };
    const punches = parseRhidDailyPunches(response);
    const summary = summarizeDay(
      '2026-05-26',
      punches,
      settings,
      new Date('2026-05-26T14:10:00-03:00'),
    );

    expect(punches).toHaveLength(2);
    expect(summary.isOnBreak).toBe(true);
    expect(summary.punches.map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['09:05', '14:04']);
  });

  it('preserves distinct daily portal entries that share the same minute', () => {
    const punches = parseRhidDailyPunches({
      status: true,
      retorno: {
        afdt: [
          { dateTimeStr: '202608271414', _typeEntradaSaida: 'E', seqEmpregadoJornada: 2 },
          { dateTimeStr: '202608271414', _typeEntradaSaida: 'S', seqEmpregadoJornada: 2 },
        ],
      },
    });

    expect(punches).toHaveLength(2);
    expect(punches.map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['14:14', '14:14']);
    expect(new Set(punches.map((punch) => punch.id))).toHaveLength(2);
  });

  it('ignores daily portal metadata outside retorno.afdt', () => {
    const response = {
      status: true,
      retorno: {
        dateTime: '20260526',
        afdt: [
          { dateTimeStr: '202605260905', _typeEntradaSaida: 'E' },
          { dateTimeStr: '202605261404', _typeEntradaSaida: 'S' },
        ],
      },
      auditoria: {
        dateTimeStr: '202605261200',
      },
    };

    expect(parseRhidDailyPunches(response).map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['09:05', '14:04']);
  });

  it('does not treat unrelated response dates as daily punches', () => {
    expect(parseRhidDailyPunches({ updatedAt: '2026-05-15T18:00:00-03:00' })).toHaveLength(0);
  });

  it('loads only official dateTimeStr markings from the portal historical report', () => {
    const punches = parseRhidPortalHistoryPunches({
      generatedAt: '2026-05-26T18:00:00-03:00',
      rows: [
        { date: '20260502', afdt: [{ dateTimeStr: '202605020805' }, { dateTimeStr: '202605021705' }] },
        { date: '20260505', afdt: [{ dateTimeStr: '202605050900' }] },
      ],
    });

    expect(punches.map((punch) => dayjs(punch.timestamp).format('DD/MM HH:mm'))).toEqual([
      '02/05 08:05',
      '02/05 17:05',
      '05/05 09:00',
    ]);
  });

  it('ignores portal history metadata outside afdt collections', () => {
    const punches = parseRhidPortalHistoryPunches({
      rows: [
        {
          dateTimeStr: '20260525',
          possuiPendencias: true,
          afdt: [
            { dateTimeStr: '202605250905' },
            { dateTimeStr: '202605251404' },
          ],
        },
      ],
      afdChanges: [
        { dateTimeStr: '202605251730', descricao: 'Inclusao manual ainda nao oficializada' },
      ],
    });

    expect(punches.map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['09:05', '14:04']);
  });

  it('imports archived official markings exposed as listAfdtManutencao', () => {
    const punches = parseRhidPortalHistoryPunches({
      rows: [{
        dateTimeStr: '20260213',
        listAfdtManutencao: [
          { dateTimeStr: '202602131010', idAfd: 488184 },
          { dateTimeStr: '202602131332', idAfd: 489028 },
          { dateTimeStr: '202602131432', idAfd: 489192 },
          { dateTimeStr: '202602131700', idAfd: null, reason: 'Horário previsto' },
        ],
      }],
    });

    expect(punches.map((punch) => dayjs(punch.timestamp).format('DD/MM HH:mm'))).toEqual([
      '13/02 10:10',
      '13/02 13:32',
      '13/02 14:32',
    ]);
  });

  it('does not import planned schedule collections as authenticated punches', () => {
    const punches = parseRhidPortalHistoryPunches({
      rows: [{
        afdt: [{ dateTimeStr: '202607091218' }, { dateTimeStr: '202607091559' }],
        afdtPrevisto: [{ dateTimeStr: '202607092000' }],
      }],
    });

    expect(punches.map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['12:18', '15:59']);
  });

  it('ignores excluded marks when the RHiD exposes listAfdtExcluidos', () => {
    const response = {
      retorno: {
        afdt: [
          { dateTimeStr: '202605260905', _typeEntradaSaida: 'E' },
          { dateTimeStr: '202605261404', _typeEntradaSaida: 'S', _typeRegister: 'O', idAfdChange: 77 },
        ],
        listAfdtExcluidos: [
          { dateTimeStr: '202605261404', _typeRegister: 'O', idAfdChange: 77, motivo: 'duplicidade' },
        ],
      },
    };

    expect(parseRhidPortalHistoryPunches(response).map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['09:05']);
    expect(parseRhidExcludedPunches(response).map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['14:04']);
  });

  it('imports the possuiPendencias flag from a historical RHiD row', () => {
    const pendingDays = parseRhidPortalPendingDays([
      { dateTimeStr: '20260525', idPerson: 2226, possuiPendencias: true },
      { dateTimeStr: '20260524', idPerson: 2226, possuiPendencias: false },
    ]);

    expect(pendingDays).toEqual([{ date: '2026-05-25', idPerson: 2226 }]);
  });

  it('imports the official cumulative bank balance by day from the portal history', () => {
    const balanceDays = parseRhidOfficialBalanceDays([
      { dateTimeStr: '20260524', saldoBancoFinalDia: 312 },
      { dateTimeStr: '20260525', saldoBancoFinalDia: '06:38' },
      { dateTimeStr: '20260526', saldoBancoAjustadoMaisCredDeb: '-00:10' },
    ]);

    expect(balanceDays).toEqual<OfficialBalanceDay[]>([
      { date: '2026-05-24', cumulativeBalanceMinutes: 312 },
      { date: '2026-05-25', cumulativeBalanceMinutes: 398 },
      { date: '2026-05-26', cumulativeBalanceMinutes: -10 },
    ]);
  });

  it('imports descriptions returned by the approval pending-detail query', () => {
    const items = parseRhidPendingItems([{
      id: 3,
      classification: 'Inclusão de Marcação',
      description: 'Inclusão de marcação manual em 25/05/2026 09:00 (Incluir marcação da primeira entrada.)',
      filesUrl: [],
    }]);

    expect(items[0]?.description).toContain('Inclusão de marcação manual em 25/05/2026 09:00');
  });

  it('uses the official opening date instead of inventing today for requests', () => {
    const requests = parseRhidRequestRecords([{
      id: 77,
      classification: 'Inclusão de marcação',
      observation: 'Falta de marcação',
      ini: '20260709',
      fim: '20260709',
      dataInclusao: '2026-07-10T08:35:00',
    }]);

    expect(requests[0]?.requestedAt).toBe('2026-07-10');
    expect(requests[0]?.startDate).toBe('2026-07-09');
  });

  it('parses the real AFD-change request fields returned by RHiD', () => {
    const requests = parseRhidRequestRecords([{
      idAfdChange: 44922,
      dateInsertedStr: '202607161823',
      dateTimeStr: '202607091817',
      abreviationJustification: 'Inclusão de Marcação',
      reason: 'Falta de marcação por erro no celular',
      approvalStatus: 1,
    }]);

    expect(requests[0]).toMatchObject({
      id: '44922',
      type: 'Inclusão de Marcação',
      requestedAt: '2026-07-16',
      startDate: '2026-07-09',
      endDate: '2026-07-09',
      description: 'Falta de marcação por erro no celular',
      status: 'pending',
    });
  });

  it('uses the valid opening date when an earlier RHiD date field is blank', () => {
    const requests = parseRhidRequestRecords([{
      idAfdChange: 44923,
      requestedAt: '',
      createdAt: '',
      dateInsertedStr: '202607171015',
      dateTimeStr: '202607091817',
      abreviationJustification: 'Justificativa',
      reason: 'Ajuste solicitado',
    }]);

    expect(requests[0]?.requestedAt).toBe('2026-07-17');
  });

  it('recognizes the opening date even when RHiD changes field casing or adds a prefix', () => {
    const requests = parseRhidRequestRecords([{
      idAfdChange: 44924,
      requestedAt: '',
      _DateInsertedStr: '202607181140',
      dateTimeStr: '202607101817',
      abreviationJustification: 'Justificativa',
      reason: 'Ajuste solicitado',
    }]);

    expect(requests[0]?.requestedAt).toBe('2026-07-18');
  });

  it('recognizes alternate insertion timestamp names returned by RHiD', () => {
    const requests = parseRhidRequestRecords([{
      idAfdChange: 44925,
      dateTimeInsertedStr: '202607191245',
      dateTimeStr: '202607111817',
      abreviationJustification: 'Justificativa',
      reason: 'Ajuste solicitado',
    }]);

    expect(requests[0]?.requestedAt).toBe('2026-07-19');
  });

  it('normalizes a Brazilian opening date returned by RHiD', () => {
    const requests = parseRhidRequestRecords([{
      idAfdChange: 44926,
      dataHoraInclusao: '20/07/2026 13:50',
      dateTimeStr: '202607121817',
      abreviationJustification: 'Justificativa',
      reason: 'Ajuste solicitado',
    }]);

    expect(requests[0]?.requestedAt).toBe('2026-07-20');
  });

  it('does not invent an opening date from the request period', () => {
    const requests = parseRhidRequestRecords([{
      id: 78,
      classification: 'Atestado',
      observation: 'Documento enviado',
      ini: '20260708',
      fim: '20260709',
    }]);

    expect(requests[0]?.requestedAt).toBe('');
  });

  it('lets the daily official response replace a cached historical version of today', () => {
    const historical = parseRhidPortalHistoryPunches({
      afdt: [{ dateTimeStr: '202605260905' }],
    });
    const daily = parseRhidDailyPunches({
      retorno: { afdt: [{ dateTimeStr: '202605260905' }, { dateTimeStr: '202605261404' }] },
    });

    const merged = mergeOfficialPunches(historical, daily);

    expect(merged.map((punch) => dayjs(punch.timestamp).format('HH:mm'))).toEqual(['09:05', '14:04']);
  });

  it('replaces only the synchronized period when saving official punches', () => {
    const saved = replacePunchesForPeriod(
      [
        { ...mark('2026-04-30T08:00:00-03:00'), origin: 'rhid' },
        { ...mark('2026-05-02T08:00:00-03:00'), origin: 'rhid' },
        { ...mark('2026-05-02T17:00:00-03:00'), origin: 'rhid' },
      ],
      [{ ...mark('2026-05-02T08:05:00-03:00'), origin: 'rhid' }],
      '2026-05-01',
      '2026-05-26',
    );

    expect(saved.map((punch) => dayjs(punch.timestamp).format('DD/MM HH:mm'))).toEqual([
      '30/04 08:00',
      '02/05 08:05',
    ]);
  });

  it('replaces pending indicators only inside the synchronized period', () => {
    const pendingDays = replacePendingDaysForPeriod(
      [{ date: '2026-04-30', idPerson: 2226 }, { date: '2026-05-02', idPerson: 2226 }],
      [{ date: '2026-05-25', idPerson: 2226 }],
      '2026-05-01',
      '2026-05-26',
    );

    expect(pendingDays.map((day) => day.date)).toEqual(['2026-05-25', '2026-04-30']);
  });

  it('replaces official cumulative balances only inside the synchronized period', () => {
    const balanceDays = replaceOfficialBalanceDaysForPeriod(
      [{ date: '2026-04-30', cumulativeBalanceMinutes: 120 }, { date: '2026-05-02', cumulativeBalanceMinutes: 240 }],
      [{ date: '2026-05-25', cumulativeBalanceMinutes: 398 }],
      '2026-05-01',
      '2026-05-26',
    );

    expect(balanceDays).toEqual<OfficialBalanceDay[]>([
      { date: '2026-04-30', cumulativeBalanceMinutes: 120 },
      { date: '2026-05-25', cumulativeBalanceMinutes: 398 },
    ]);
  });

  it('uses official cumulative balances to calculate the balance of a filtered period', () => {
    const balanceMs = officialBalanceForPeriod([
      { date: '2026-05-23', cumulativeBalanceMinutes: 300 },
      { date: '2026-05-24', cumulativeBalanceMinutes: 312 },
      { date: '2026-05-25', cumulativeBalanceMinutes: 398 },
    ], '2026-05-24', '2026-05-25');

    expect(formatDuration(balanceMs ?? 0, true)).toBe('+01:38');
  });

  it('uses the latest official cumulative balance for the home bank balance', () => {
    const balanceMs = officialAccumulatedBalanceAt([
      { date: '2026-02-16', cumulativeBalanceMinutes: -1200 },
      { date: '2026-07-15', cumulativeBalanceMinutes: -235 },
      { date: '2026-07-17', cumulativeBalanceMinutes: -180 },
    ], '2026-07-16');

    expect(formatDuration(balanceMs ?? 0, true)).toBe('-03:55');
  });

  it('includes today in the balance period when the day is already closed', () => {
    expect(balancePeriodEndDate({
      date: '2026-07-02',
      punches: [
        mark('2026-07-02T11:33:00-03:00'),
        mark('2026-07-02T16:37:00-03:00'),
        mark('2026-07-02T17:36:00-03:00'),
        mark('2026-07-02T20:00:00-03:00'),
      ],
      isWorking: false,
      isOnBreak: false,
    }, '2026-07-02', true)).toBe('2026-07-02');
  });

  it('falls back to yesterday when today is still open or excluded from the selected period', () => {
    expect(balancePeriodEndDate({
      date: '2026-07-02',
      punches: [mark('2026-07-02T11:33:00-03:00')],
      isWorking: true,
      isOnBreak: false,
    }, '2026-07-02', true)).toBe('2026-07-01');

    expect(balancePeriodEndDate({
      date: '2026-07-02',
      punches: [mark('2026-07-02T11:33:00-03:00')],
      isWorking: false,
      isOnBreak: false,
    }, '2026-07-02', true)).toBe('2026-07-01');

    expect(balancePeriodEndDate({
      date: '2026-07-02',
      punches: [
        mark('2026-07-02T11:33:00-03:00'),
        mark('2026-07-02T16:37:00-03:00'),
        mark('2026-07-02T17:36:00-03:00'),
        mark('2026-07-02T20:00:00-03:00'),
      ],
      isWorking: false,
      isOnBreak: false,
    }, '2026-07-02', false)).toBe('2026-07-01');
  });

  it('prefers official punches for a day already synchronized', () => {
    const merged = mergeOfficialPunches(
      [mark('2026-05-24T08:01:00-03:00'), mark('2026-05-23T08:00:00-03:00')],
      [{ ...mark('2026-05-24T08:00:00-03:00'), origin: 'rhid' }],
    );

    expect(merged.map((punch) => punch.origin)).toEqual(['local', 'rhid']);
    expect(merged.some((punch) => punch.timestamp.includes('08:01'))).toBe(false);
  });

  describe('automaticSafetyExitGate', () => {
    it('calculates safety threshold accurately based on planned finish + 105 min', () => {
      const punches = [
        mark('2026-06-22T08:00:00-03:00'),
        mark('2026-06-22T12:00:00-03:00'),
        mark('2026-06-22T13:00:00-03:00'),
      ];
      // 8h workday (480 min). Morning: 4h. Remaining: 4h.
      // Planned finish: 13:00 + 4h = 17:00:00.
      // Threshold: 17:00 + 1h45 = 18:45:00.
      const threshold = calculateSafetyExitThreshold(punches, 480);
      expect(threshold).toBe(new Date('2026-06-22T18:45:00-03:00').getTime());

      const gateBefore = automaticSafetyExitGate(punches, 480, new Date('2026-06-22T18:44:00-03:00'));
      expect(gateBefore.eligible).toBe(true);
      expect(gateBefore.safetyDue).toBe(false);
      expect(gateBefore.remainingUntilSafetyMs).toBe(60_000);

      const gateAt = automaticSafetyExitGate(punches, 480, new Date('2026-06-22T18:45:00-03:00'));
      expect(gateAt.eligible).toBe(true);
      expect(gateAt.safetyDue).toBe(true);
      expect(gateAt.remainingUntilSafetyMs).toBe(0);
    });

    it('denies execution when punches sequence is incomplete or already has 4 punches', () => {
      expect(automaticSafetyExitGate([mark('2026-06-22T08:00:00-03:00')]).eligible).toBe(false);
      expect(automaticSafetyExitGate([
        mark('2026-06-22T08:00:00-03:00'),
        mark('2026-06-22T12:00:00-03:00'),
        mark('2026-06-22T13:00:00-03:00'),
        mark('2026-06-22T17:00:00-03:00'),
      ]).eligible).toBe(false);
    });
  });
});
