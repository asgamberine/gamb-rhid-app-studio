import dayjs from 'dayjs';
import type { RhidRequestRecord } from '../types';

const NATIONAL_HOLIDAY_MONTH_DAYS = [
  '01-01',
  '04-21',
  '05-01',
  '09-07',
  '10-12',
  '11-02',
  '11-15',
  '12-25',
];

const HOLIDAY_CACHE = new Map<number, Set<string>>();

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addUtcDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + (2 * e) + (2 * i) - h - k) % 7;
  const m = Math.floor((a + (11 * h) + (22 * l)) / 451);
  const month = Math.floor((h + l - (7 * m) + 114) / 31);
  const day = ((h + l - (7 * m) + 114) % 31) + 1;
  return formatIsoDate(year, month, day);
}

function holidaysForYear(year: number): Set<string> {
  const cached = HOLIDAY_CACHE.get(year);
  if (cached) {
    return cached;
  }

  const holidays = new Set<string>(NATIONAL_HOLIDAY_MONTH_DAYS.map((suffix) => `${year}-${suffix}`));
  const easter = easterSunday(year);
  holidays.add(addUtcDays(easter, -2));
  holidays.add(addUtcDays(easter, 60));
  HOLIDAY_CACHE.set(year, holidays);
  return holidays;
}

export function isCountableWorkday(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const reference = dayjs(`${date}T12:00:00`);
  if (!reference.isValid()) {
    return false;
  }
  const weekday = reference.day();
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  return !holidaysForYear(reference.year()).has(date);
}

export function filterCountableWorkdays(dates: string[]): string[] {
  return dates.filter((date) => isCountableWorkday(date));
}

const WORK_ABSENCE_TERMS = [
  'atestado',
  'falta',
  'ferias',
  'afastamento',
  'licenca',
];

function normalizedWorkdayText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

export function isWorkAbsenceRequest(request: RhidRequestRecord): boolean {
  if (request.status === 'rejected') {
    return false;
  }
  const normalizedType = normalizedWorkdayText(request.type);
  if (['inclusao', 'ajuste', 'relocar', 'banco de horas', 'abono'].some((term) => normalizedType.includes(term))) {
    return false;
  }
  const searchableText = normalizedWorkdayText(`${request.type} ${request.description}`);
  return WORK_ABSENCE_TERMS.some((term) => searchableText.includes(term));
}

export function previousEligibleWorkday(today: string, requests: RhidRequestRecord[]): string {
  let cursor = dayjs(today).subtract(1, 'day');
  for (let inspectedDays = 0; inspectedDays < 366; inspectedDays += 1) {
    const date = cursor.format('YYYY-MM-DD');
    const coveredByAbsence = requests.some((request) => (
      isWorkAbsenceRequest(request)
      && request.startDate <= date
      && request.endDate >= date
    ));
    if (isCountableWorkday(date) && !coveredByAbsence) {
      return date;
    }
    cursor = cursor.subtract(1, 'day');
  }
  return dayjs(today).subtract(1, 'day').format('YYYY-MM-DD');
}
