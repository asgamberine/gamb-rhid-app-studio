import Database from 'better-sqlite3';

const database = new Database('.data/rhid.sqlite');
const before = database.prepare(`
  SELECT payload_hash FROM official_history_freezes WHERE freeze_end = '2026-06-30'
`).get();
let blocked = false;
try {
  database.prepare(`
    UPDATE official_history_freezes SET frozen_at = frozen_at WHERE freeze_end = '2026-06-30'
  `).run();
} catch (error) {
  blocked = String(error?.message ?? error).includes('Histórico congelado não pode ser alterado');
}
const after = database.prepare(`
  SELECT payload_hash FROM official_history_freezes WHERE freeze_end = '2026-06-30'
`).get();
database.close();

if (!blocked || !before?.payload_hash || before.payload_hash !== after?.payload_hash) {
  throw new Error('A proteção imutável do histórico não foi comprovada.');
}
console.log(JSON.stringify({ blocked: true, freezeEnd: '2026-06-30', payloadHash: after.payload_hash }));
