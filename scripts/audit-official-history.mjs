import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dataDir = join(process.cwd(), '.data');
const databasePath = join(dataDir, 'rhid.sqlite');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const backupPath = join(dataDir, `rhid.sqlite.before-freeze-${stamp}.bak`);
const database = new Database(databasePath, { readonly: true });

await database.backup(backupPath);
const hash = createHash('sha256').update(await readFile(backupPath)).digest('hex');
const archives = database.prepare(`
  SELECT account_key, id_person, data_ini, data_final, saved_at,
         json_array_length(punches_json) AS punches,
         json_array_length(pending_days_json) AS pending_days
  FROM official_archives
`).all();
const dailyCounts = database.prepare(`
  SELECT account_key,
         substr(json_extract(entry.value, '$.timestamp'), 1, 10) AS day,
         count(*) AS punches
  FROM official_archives, json_each(official_archives.punches_json) AS entry
  GROUP BY account_key, day
  ORDER BY account_key, day
`).all();
const backupColumns = database.prepare('PRAGMA table_info(official_history_backups)').all();
const backupSlices = database.prepare(`
  SELECT account_key, id_person, data_ini, data_final, count(*) AS versions,
         min(saved_at) AS first_saved_at, max(saved_at) AS last_saved_at
  FROM official_history_backups
  GROUP BY account_key, id_person, data_ini, data_final
`).all();
const anomalousDays = dailyCounts.filter((row) => row.punches !== 4).map((row) => ({
  ...row,
  timestamps: database.prepare(`
    SELECT json_extract(entry.value, '$.timestamp') AS timestamp
    FROM official_archives, json_each(official_archives.punches_json) AS entry
    WHERE official_archives.account_key = ?
      AND substr(json_extract(entry.value, '$.timestamp'), 1, 10) = ?
    ORDER BY timestamp
  `).all(row.account_key, row.day).map((entry) => entry.timestamp),
}));
const freezes = database.prepare(`
  SELECT account_key, id_person, freeze_end, payload_hash, frozen_at,
         json_array_length(punches_json) AS punches,
         json_array_length(pending_days_json) AS pending_days,
         json_array_length(balance_days_json) AS balance_days
  FROM official_history_freezes
`).all();
const freezeTriggers = database.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'trigger' AND tbl_name = 'official_history_freezes'
  ORDER BY name
`).all();

database.close();
console.log(JSON.stringify({ backupPath, sha256: hash, archives, dailyRange: { first: dailyCounts[0], last: dailyCounts.at(-1), days: dailyCounts.length }, anomalousDays, backupColumns, backupSlices, freezes, freezeTriggers }, null, 2));
