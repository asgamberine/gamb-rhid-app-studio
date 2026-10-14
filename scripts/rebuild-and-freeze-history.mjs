import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

const FREEZE_END = '2026-06-30';
const database = new Database('.data/rhid.sqlite');
const archiveRows = database.prepare('SELECT * FROM official_archives').all();

function dateFromTimestamp(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp));
}

function timestampFromCompact(value) {
  const match = typeof value === 'string' ? value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`).toISOString();
  return Number.isNaN(Date.parse(timestamp)) ? null : timestamp;
}

function excluded(row, context) {
  return context || row?.excluded === true || row?.excluido === true || row?.excluida === true || row?.isExcluded === true;
}

function collectPunchEntries(value, target, excludedContext = false, requireOfficialId = false) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPunchEntries(entry, target, excludedContext, requireOfficialId));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const rowExcluded = excluded(value, excludedContext);
  const timestamp = rowExcluded || (requireOfficialId && !(Number(value.idAfd) > 0)) ? null : timestampFromCompact(value.dateTimeStr);
  if (timestamp) target.set(timestamp, { id: `rhid:${timestamp}`, timestamp, origin: 'rhid' });
  Object.entries(value).forEach(([key, entry]) => {
    if (key !== 'dateTimeStr') collectPunchEntries(entry, target, rowExcluded || /exclu/i.test(key), requireOfficialId);
  });
}

function collectPunchArrays(value, target) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPunchArrays(entry, target));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, entry]) => {
    if (Array.isArray(entry) && /^(?:list)?afdt(?:manutencao|excluidos?)?$/i.test(key)) {
      collectPunchEntries(entry, target, /exclu/i.test(key), /manutencao/i.test(key));
    } else {
      collectPunchArrays(entry, target);
    }
  });
}

function collectRows(value, pending, balances) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRows(entry, pending, balances));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const match = String(value.dateTimeStr ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (value.possuiPendencias === true || value.possuiPendencias === 1 || value.possuiPendencias === 'true') {
      pending.set(date, { date, idPerson: Number(value.idPerson) || null });
    }
    const balance = Number(value.saldoBancoFinalDia);
    if (Number.isFinite(balance)) balances.set(date, { date, cumulativeBalanceMinutes: Math.round(balance) });
  }
  Object.values(value).forEach((entry) => collectRows(entry, pending, balances));
}

database.exec(`
  CREATE TABLE IF NOT EXISTS official_history_freezes (
    account_key TEXT NOT NULL,
    id_person INTEGER NOT NULL,
    freeze_end TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    punches_json TEXT NOT NULL,
    pending_days_json TEXT NOT NULL,
    balance_days_json TEXT NOT NULL,
    frozen_at TEXT NOT NULL,
    PRIMARY KEY (account_key, freeze_end)
  );
  CREATE TRIGGER IF NOT EXISTS official_history_freezes_no_update
  BEFORE UPDATE ON official_history_freezes BEGIN SELECT RAISE(ABORT, 'Histórico congelado não pode ser alterado'); END;
  CREATE TRIGGER IF NOT EXISTS official_history_freezes_no_delete
  BEFORE DELETE ON official_history_freezes BEGIN SELECT RAISE(ABORT, 'Histórico congelado não pode ser excluído'); END;
`);

for (const archiveRow of archiveRows) {
  const snapshots = database.prepare(`
    SELECT * FROM official_history_backups
    WHERE account_key = ?
    ORDER BY saved_at DESC
  `).all(archiveRow.account_key);
  const latestPeriods = new Map();
  snapshots.forEach((row) => {
    const key = `${row.data_ini}:${row.data_final}`;
    if (!latestPeriods.has(key)) latestPeriods.set(key, row);
  });
  const punches = new Map();
  const pending = new Map();
  const balances = new Map();
  for (const snapshot of latestPeriods.values()) {
    const payload = JSON.parse(snapshot.payload_json);
    collectPunchArrays(payload, punches);
    collectRows(payload, pending, balances);
  }
  const collectedPunches = [...punches.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const collectedPending = [...pending.values()].sort((left, right) => right.date.localeCompare(left.date));
  const collectedBalances = [...balances.values()].sort((left, right) => left.date.localeCompare(right.date));
  const existingFreeze = database.prepare(`
    SELECT * FROM official_history_freezes WHERE account_key = ? AND freeze_end = ?
  `).get(archiveRow.account_key, FREEZE_END);
  const frozen = existingFreeze ? {
    punches: JSON.parse(existingFreeze.punches_json),
    pendingDays: JSON.parse(existingFreeze.pending_days_json),
    officialBalanceDays: JSON.parse(existingFreeze.balance_days_json),
  } : {
    punches: collectedPunches.filter((punch) => dateFromTimestamp(punch.timestamp) <= FREEZE_END),
    pendingDays: collectedPending.filter((day) => day.date <= FREEZE_END),
    officialBalanceDays: collectedBalances.filter((day) => day.date <= FREEZE_END),
  };
  const rebuiltPunches = [...frozen.punches, ...collectedPunches.filter((punch) => dateFromTimestamp(punch.timestamp) > FREEZE_END)];
  const rebuiltPending = [...frozen.pendingDays, ...collectedPending.filter((day) => day.date > FREEZE_END)];
  const rebuiltBalances = [...frozen.officialBalanceDays, ...collectedBalances.filter((day) => day.date > FREEZE_END)];
  const frozenJson = JSON.stringify(frozen);
  const hash = existingFreeze?.payload_hash ?? createHash('sha256').update(frozenJson).digest('hex');
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`
      INSERT OR IGNORE INTO official_history_freezes
        (account_key, id_person, freeze_end, payload_hash, punches_json, pending_days_json, balance_days_json, frozen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(archiveRow.account_key, archiveRow.id_person, FREEZE_END, hash, JSON.stringify(frozen.punches), JSON.stringify(frozen.pendingDays), JSON.stringify(frozen.officialBalanceDays), now);
    database.prepare(`
      UPDATE official_archives
      SET punches_json = ?, pending_days_json = ?, balance_days_json = ?, saved_at = ?
      WHERE account_key = ?
    `).run(JSON.stringify(rebuiltPunches), JSON.stringify(rebuiltPending), JSON.stringify(rebuiltBalances), now, archiveRow.account_key);
  })();
  console.log(JSON.stringify({
    accountKey: archiveRow.account_key,
    freezeEnd: FREEZE_END,
    frozenHash: hash,
    freezeCreated: !existingFreeze,
    frozenPunches: frozen.punches.length,
    totalPunches: rebuiltPunches.length,
    firstPunch: rebuiltPunches[0]?.timestamp ?? null,
    lastPunch: rebuiltPunches.at(-1)?.timestamp ?? null,
    latestBalance: rebuiltBalances.at(-1) ?? null,
  }));
}

database.close();
