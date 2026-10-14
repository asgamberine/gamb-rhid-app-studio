import { describe, expect, it } from 'vitest';
import { officialPunchInclusionPayload, portalRequestListPayload } from './rhidRequestFlow.mjs';

describe('RHiD request flow payloads', () => {
  it('uses the compact date contract for reads and post-send confirmation', () => {
    const expected = expect.objectContaining({ ini: '20260709', fim: '20260709', people: [2226] });
    expect(portalRequestListPayload(2226, '2026-07-09', '2026-07-09')).toEqual(expected);
    expect(portalRequestListPayload(2226, '20260709', '20260709')).toEqual(expected);
  });

  it('builds the exact inclusion payload with date, time and justification', () => {
    expect(officialPunchInclusionPayload({ personId: 2226 }, {
      startDate: '2026-07-09',
      endDate: '2026-07-09',
      time: '18:17',
      description: 'Inclusão de marcação',
      notes: 'Falta de marcação por erro no celular',
    })).toEqual({
      idPerson: [2226],
      ini: '20260709',
      fim: '20260709',
      afdChanges: [{
        idPerson: 2226,
        idAfd: 0,
        dateTimeStr: '202607091817',
        reason: 'Falta de marcação por erro no celular',
        excluded: 0,
        _typeAfdChange: 'I',
        deslocamento: 0,
      }],
    });
  });

  it('rejects malformed ranges before calling the portal', () => {
    expect(portalRequestListPayload(2226, '2026-07-10', '2026-07-09')).toBeNull();
    expect(officialPunchInclusionPayload({ personId: 2226 }, {
      startDate: '2026-07-09', endDate: '2026-07-10', time: '18:17', description: 'Inclusão',
    })).toBeNull();
  });
});
