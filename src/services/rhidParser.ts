import dayjs from 'dayjs';
import type { OfficialBalanceDay, Punch, RhidPendingDay, RhidPendingItem, RhidRequestRecord, RhidRequestStatus } from '../types';

const brazilianDateTime = /\b(\d{2})\/(\d{2})\/(\d{4})[ T,]+(\d{2}):(\d{2})(?::(\d{2}))?\b/g;
const isoDateTime = /\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const compactDateTime = /\b(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\b/g;

interface PunchCollections {
  active: Map<string, Punch>;
  excluded: Map<string, Punch>;
}

function sortPunchCollections(collections: PunchCollections): { punches: Punch[]; excludedPunches: Punch[] } {
  return {
    punches: [...collections.active.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    excludedPunches: [...collections.excluded.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
}

function pushPunch(
  target: Map<string, Punch>,
  value: string,
  excluded = false,
  exclusionReason: string | null = null,
  identity: string | null = null,
) {
  const timestamp = dayjs(value);
  if (!timestamp.isValid()) {
    return;
  }
  const iso = timestamp.toISOString();
  const punch: Punch = { id: `rhid:${iso}${identity ? `:${identity}` : ''}`, timestamp: iso, origin: 'rhid' };
  if (excluded) {
    punch.excluded = true;
    punch.exclusionReason = exclusionReason;
  }
  target.set(identity ?? iso, punch);
}

function parsedPayload(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExcludedPunchObject(value: Record<string, unknown>): boolean {
  if (value.excluido === true || value.excluida === true || value.excluded === true || value.isExcluded === true) {
    return true;
  }
  if (String(value.status ?? '').trim().toLowerCase() === 'excluido') {
    return true;
  }
  const typeRegister = String(value._typeRegister ?? '').trim().toUpperCase();
  if (typeRegister === 'O' && value.idAfdChange != null) {
    return true;
  }
  return false;
}

function isPunchStringKey(key: string): boolean {
  return /^(dateTimeStr|batida|timestamp|dateTime|datetime|dataHora|hora)$/i.test(key);
}

function collectPunches(data: unknown, collections: PunchCollections, excludedContext = false) {
  if (typeof data === 'string') {
    if (!excludedContext) {
      collectPunchRegex(data, collections);
    }
    return;
  }
  if (Array.isArray(data)) {
    data.forEach((entry) => collectPunches(entry, collections, excludedContext));
    return;
  }
  if (!isPlainObject(data)) {
    return;
  }

  const rowExcluded = excludedContext || isExcludedPunchObject(data);
  if (typeof data.dateTimeStr === 'string') {
    pushPunch(rowExcluded ? collections.excluded : collections.active, data.dateTimeStr, rowExcluded);
  }

  Object.entries(data).forEach(([key, value]) => {
    if (key === 'dateTimeStr') {
      return;
    }
    if (typeof value === 'string') {
      if (!rowExcluded && isPunchStringKey(key)) {
        collectPunchRegex(value, collections);
      }
      return;
    }
    collectPunches(value, collections, rowExcluded || /exclu/i.test(key));
  });
}

function collectPunchRegex(text: string, collections: PunchCollections) {
  for (const match of text.matchAll(brazilianDateTime)) {
    const [, date, month, year, hours, minutes, seconds = '00'] = match;
    pushPunch(collections.active, `${year}-${month}-${date}T${hours}:${minutes}:${seconds}`);
  }

  for (const match of text.matchAll(isoDateTime)) {
    pushPunch(collections.active, match[0]);
  }

  for (const match of text.matchAll(compactDateTime)) {
    const [, year, month, date, hours, minutes, seconds = '00'] = match;
    pushPunch(collections.active, `${year}-${month}-${date}T${hours}:${minutes}:${seconds}`);
  }
}

function portalDateTimeValue(value: string): string | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/);
  if (!match) {
    return null;
  }
  const [, year, month, date, hours, minutes, seconds = '00'] = match;
  return `${year}-${month}-${date}T${hours}:${minutes}:${seconds}`;
}

function pushPortalDateTimeStr(
  target: Map<string, Punch>,
  value: string,
  excluded = false,
  exclusionReason: string | null = null,
  identity: string | null = null,
) {
  const timestamp = portalDateTimeValue(value);
  if (!timestamp) {
    return;
  }
  pushPunch(target, timestamp, excluded, exclusionReason, identity);
}

function collectPortalPunchEntries(
  data: unknown,
  collections: PunchCollections,
  excludedContext = false,
  requireOfficialId = false,
  identity: string | null = null,
) {
  if (Array.isArray(data)) {
    data.forEach((entry, index) => collectPortalPunchEntries(
      entry,
      collections,
      excludedContext,
      requireOfficialId,
      identity ? `${identity}:${index}` : null,
    ));
    return;
  }
  if (!isPlainObject(data)) {
    return;
  }

  const rowExcluded = excludedContext || isExcludedPunchObject(data);
  if (typeof data.dateTimeStr === 'string' && (!requireOfficialId || Number(data.idAfd) > 0)) {
    pushPortalDateTimeStr(rowExcluded ? collections.excluded : collections.active, data.dateTimeStr, rowExcluded, null, identity);
  }

  Object.entries(data).forEach(([key, value]) => {
    if (key === 'dateTimeStr') {
      return;
    }
    collectPortalPunchEntries(
      value,
      collections,
      rowExcluded || /exclu/i.test(key),
      requireOfficialId,
      identity ? `${identity}:${key}` : null,
    );
  });
}

function collectPortalPunchArrays(data: unknown, collections: PunchCollections) {
  if (Array.isArray(data)) {
    data.forEach((entry) => collectPortalPunchArrays(entry, collections));
    return;
  }
  if (!isPlainObject(data)) {
    return;
  }

  Object.entries(data).forEach(([key, value]) => {
    if (Array.isArray(value) && /^(?:list)?afdt(?:manutencao|excluidos?)?$/i.test(key)) {
      collectPortalPunchEntries(value, collections, /exclu/i.test(key), /manutencao/i.test(key));
      return;
    }
    collectPortalPunchArrays(value, collections);
  });
}

function collectPunchCollections(data: unknown): PunchCollections {
  const collections: PunchCollections = {
    active: new Map<string, Punch>(),
    excluded: new Map<string, Punch>(),
  };

  const payload = parsedPayload(data);
  if (typeof payload === 'string') {
    collectPunchRegex(payload, collections);
    return collections;
  }

  collectPunches(payload, collections);
  return collections;
}

function collectPortalPunchCollections(data: unknown, source: 'daily' | 'history'): PunchCollections {
  const collections: PunchCollections = {
    active: new Map<string, Punch>(),
    excluded: new Map<string, Punch>(),
  };

  const payload = parsedPayload(data);
  if (source === 'daily') {
    const entries = rhidDailyEntries(payload);
    if (entries) {
      collectPortalPunchEntries(entries, collections, false, false, 'daily');
    }
    if (isPlainObject(payload) && isPlainObject(payload.retorno)) {
      Object.entries(payload.retorno).forEach(([key, value]) => {
        if (key !== 'afdt' && Array.isArray(value) && /afdt/i.test(key)) {
          collectPortalPunchEntries(value, collections, /exclu/i.test(key));
        }
      });
    }
    return collections;
  }

  collectPortalPunchArrays(payload, collections);
  return collections;
}

export function rhidDailyEntries(data: unknown): unknown[] | null {
  let payload = data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object' || !('retorno' in payload)) {
    return null;
  }
  const retorno = payload.retorno;
  if (!retorno || typeof retorno !== 'object' || !('afdt' in retorno) || !Array.isArray(retorno.afdt)) {
    return null;
  }
  return retorno.afdt;
}

export function parseRhidPunchCollections(data: unknown): { punches: Punch[]; excludedPunches: Punch[] } {
  return sortPunchCollections(collectPunchCollections(data));
}

export function parseRhidPunches(data: unknown): Punch[] {
  return parseRhidPunchCollections(data).punches;
}

export function parseRhidDateTimeStrPunches(data: unknown): Punch[] {
  return parseRhidPunches(data);
}

export function parseRhidDailyPunchCollections(data: unknown): { punches: Punch[]; excludedPunches: Punch[] } {
  return sortPunchCollections(collectPortalPunchCollections(data, 'daily'));
}

export function parseRhidDailyPunches(data: unknown): Punch[] {
  return parseRhidDailyPunchCollections(data).punches;
}

export function parseRhidPortalHistoryPunchCollections(data: unknown): { punches: Punch[]; excludedPunches: Punch[] } {
  return sortPunchCollections(collectPortalPunchCollections(data, 'history'));
}

export function parseRhidPortalHistoryPunches(data: unknown): Punch[] {
  return parseRhidPortalHistoryPunchCollections(data).punches;
}

export function parseRhidExcludedPunches(data: unknown): Punch[] {
  return parseRhidPunchCollections(data).excludedPunches;
}

function pendingDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) {
    return null;
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return dayjs(date).isValid() ? date : null;
}

function parseBalanceMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const match = trimmed.match(/^([+-])?(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4] ?? '0');
  return sign * Math.round(hours * 60 + minutes + seconds / 60);
}

function officialBalanceValue(row: Record<string, unknown>): number | null {
  for (const key of ['saldoBancoFinalDia', 'saldoBancoAjustadoMaisCredDeb', 'saldoBancoHoras']) {
    const parsed = parseBalanceMinutes(row[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function collectOfficialBalanceDays(data: unknown, days: Map<string, OfficialBalanceDay>) {
  if (Array.isArray(data)) {
    data.forEach((entry) => collectOfficialBalanceDays(entry, days));
    return;
  }
  if (!data || typeof data !== 'object') {
    return;
  }
  const row = data as Record<string, unknown>;
  const date = pendingDate(row.dateTimeStr ?? row.date);
  const cumulativeBalanceMinutes = officialBalanceValue(row);
  if (date && cumulativeBalanceMinutes !== null) {
    days.set(date, { date, cumulativeBalanceMinutes });
  }
  Object.values(row).forEach((value) => collectOfficialBalanceDays(value, days));
}

function collectPendingDays(data: unknown, days: Map<string, RhidPendingDay>) {
  if (Array.isArray(data)) {
    data.forEach((entry) => collectPendingDays(entry, days));
    return;
  }
  if (!data || typeof data !== 'object') {
    return;
  }
  const row = data as Record<string, unknown>;
  const pending = row.possuiPendencias === true
    || row.possuiPendencias === 1
    || row.possuiPendencias === 'true';
  const date = pendingDate(row.dateTimeStr ?? row.date);
  if (pending && date) {
    const numericId = Number(row.idPerson);
    days.set(date, {
      date,
      idPerson: Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null,
    });
  }
  Object.values(row).forEach((value) => collectPendingDays(value, days));
}

export function parseRhidPortalPendingDays(data: unknown): RhidPendingDay[] {
  const days = new Map<string, RhidPendingDay>();
  collectPendingDays(parsedPayload(data), days);
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function parseRhidOfficialBalanceDays(data: unknown): OfficialBalanceDay[] {
  const days = new Map<string, OfficialBalanceDay>();
  collectOfficialBalanceDays(parsedPayload(data), days);
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function collectPendingItems(data: unknown, items: Map<string, RhidPendingItem>) {
  if (Array.isArray(data)) {
    data.forEach((entry) => collectPendingItems(entry, items));
    return;
  }
  if (!data || typeof data !== 'object') {
    return;
  }
  const item = data as Record<string, unknown>;
  if (typeof item.description === 'string' && item.description.trim()) {
    const id = typeof item.id === 'number' || typeof item.id === 'string' ? item.id : null;
    const classification = typeof item.classification === 'string' ? item.classification : undefined;
    const filesUrl = Array.isArray(item.filesUrl)
      ? item.filesUrl.filter((url): url is string => typeof url === 'string')
      : [];
    items.set(`${String(id)}:${item.description}`, {
      id,
      description: item.description,
      classification,
      filesUrl,
    });
  }
  Object.values(item).forEach((value) => collectPendingItems(value, items));
}

export function parseRhidPendingItems(data: unknown): RhidPendingItem[] {
  const items = new Map<string, RhidPendingItem>();
  collectPendingItems(parsedPayload(data), items);
  return [...items.values()];
}

function normalizeRequestDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const dotNetTimestamp = value.match(/^\/Date\((\d+)/);
  if (dotNetTimestamp) {
    const parsed = dayjs(Number(dotNetTimestamp[1]));
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
  }
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    const date = `${compact[1]}-${compact[2]}-${compact[3]}`;
    return dayjs(date).isValid() ? date : null;
  }
  const brazilian = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\D|$)/);
  if (brazilian) {
    const date = `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
    return dayjs(date).isValid() ? date : null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

function requestOpenedAt(item: Record<string, unknown>): string | null {
  const candidates = [
    item.requestedAt,
    item.createdAt,
    item.creationDate,
    item.created,
    item.insertedAt,
    item.insertedDate,
    item.dateInserted,
    item.dateInsertedStr,
    item.dateTimeInserted,
    item.dateTimeInsertedStr,
    item.insertDate,
    item.insertDateStr,
    item.dateTimeCreated,
    item.createdDate,
    item.createdDateStr,
    item.creationDateStr,
    item.openedAt,
    item.openingDate,
    item.openingDateStr,
    item.dateOpened,
    item.requestDate,
    item.dataAbertura,
    item.dataCriacao,
    item.dataInclusao,
    item.dataHoraInclusao,
    item.dataInsercao,
    item.dataSolicitacao,
    item.dtAbertura,
    item.dtCriacao,
    item.dtInclusao,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeRequestDate(candidate);
    if (normalized) {
      return normalized;
    }
  }
  const openingDateKeys = new Set([
    'requestedat',
    'createdat',
    'creationdate',
    'dateinserted',
    'dateinsertedstr',
    'datetimeinserted',
    'datetimeinsertedstr',
    'insertdate',
    'insertdatestr',
    'datetimecreated',
    'createddate',
    'createddatestr',
    'creationdatestr',
    'insertedat',
    'inserteddate',
    'openedat',
    'openingdate',
    'openingdatestr',
    'dateopened',
    'requestdate',
    'dataabertura',
    'datacriacao',
    'datainclusao',
    'datahorainclusao',
    'datainsercao',
    'datasolicitacao',
    'dtabertura',
    'dtcriacao',
    'dtinclusao',
  ]);
  for (const [key, value] of Object.entries(item)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const looksLikeOpeningDate = /(?:date|data|dt)/.test(normalizedKey)
      && /(?:request|creat|insert|open|abertura|criacao|inclusao|insercao|solicitacao)/.test(normalizedKey);
    if (!openingDateKeys.has(normalizedKey) && !looksLikeOpeningDate) {
      continue;
    }
    const normalized = normalizeRequestDate(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeRequestStatus(value: unknown): RhidRequestStatus {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase()
    : typeof value === 'number'
      ? String(value)
      : '';
  if (['approved', 'aprovado', 'verde', 'v', '2'].includes(normalized)) {
    return 'approved';
  }
  if (['rejected', 'recusado', 'negado', 'x', '3'].includes(normalized)) {
    return 'rejected';
  }
  if (['queued', 'draft', 'queued_local'].includes(normalized)) {
    return 'queued';
  }
  return 'pending';
}

function inferRequestRange(item: Record<string, unknown>, fallbackDate: string): { startDate: string; endDate: string } {
  const startDate = normalizeRequestDate(item.startDate ?? item.ini ?? item.dataIni ?? item.requestedAt ?? item.dateTimeStr ?? item.date) ?? fallbackDate;
  const endDate = normalizeRequestDate(item.endDate ?? item.fim ?? item.dataFinal ?? item.requestedAt ?? item.dateTimeStr ?? item.date) ?? startDate;
  return {
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
  };
}

function collectRequestRecords(data: unknown, items: Map<string, RhidRequestRecord>) {
  if (Array.isArray(data)) {
    data.forEach((entry) => collectRequestRecords(entry, items));
    return;
  }
  if (!data || typeof data !== 'object') {
    return;
  }
  const item = data as Record<string, unknown>;
  const description = typeof item.description === 'string' && item.description.trim()
    ? item.description.trim()
    : typeof item.observation === 'string' && item.observation.trim()
      ? item.observation.trim()
      : typeof item.reason === 'string' && item.reason.trim()
        ? item.reason.trim()
      : '';
  const classification = typeof item.classification === 'string' && item.classification.trim()
    ? item.classification.trim()
    : typeof item.type === 'string' && item.type.trim()
      ? item.type.trim()
      : typeof item.abreviationJustification === 'string' && item.abreviationJustification.trim()
        ? item.abreviationJustification.trim()
      : '';
  const openedAt = requestOpenedAt(item);
  const range = inferRequestRange(item, openedAt ?? '');
  const requestedAt = openedAt ?? '';
  const requestId = item.id ?? item.idAfdChange ?? item.idJustification;
  const id = typeof requestId === 'number' || typeof requestId === 'string'
    ? String(requestId)
    : `${classification || 'solicitacao'}:${requestedAt}:${description}`.slice(0, 160);
  const source = typeof item.source === 'string' && ['local', 'rhid'].includes(item.source.trim().toLowerCase())
    ? item.source.trim().toLowerCase() as 'local' | 'rhid'
    : 'rhid';
  const filesUrl = Array.isArray(item.filesUrl)
    ? item.filesUrl.filter((url): url is string => typeof url === 'string')
    : Array.isArray(item.attachments)
      ? item.attachments.filter((url): url is string => typeof url === 'string')
      : [];
  const status = normalizeRequestStatus(
    item.status
    ?? item.statusAprovacao
    ?? item.approvalStatus
    ?? item.situacao
    ?? item.approved
    ?? item.rejected,
  );
  if (description || classification) {
    items.set(id, {
      id,
      type: classification || description || 'Solicitação',
      status,
      requestedAt,
      startDate: range.startDate,
      endDate: range.endDate,
      description: description || classification || 'Solicitação',
      notes: typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : undefined,
      filesUrl,
      source,
    });
  }
  Object.values(item).forEach((value) => collectRequestRecords(value, items));
}

export function parseRhidRequestRecords(data: unknown): RhidRequestRecord[] {
  const items = new Map<string, RhidRequestRecord>();
  collectRequestRecords(parsedPayload(data), items);
  return [...items.values()].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
}
