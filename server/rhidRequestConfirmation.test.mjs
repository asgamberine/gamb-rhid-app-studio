import { describe, expect, it } from 'vitest';
import {
  isSuccessIndicator,
  remoteRequestError,
  remoteRequestWasConfirmed,
} from './rhidRequestConfirmation.mjs';

describe('remoteRequestWasConfirmed', () => {
  it('confirms the request by remote id even when persisted locally with prefix', () => {
    expect(remoteRequestWasConfirmed({
      records: [
        { id: 4182, description: 'Banco de horas', startDate: '2026-07-14', endDate: '2026-07-14' },
      ],
    }, {
      remoteId: 'rhid:4182',
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      description: 'Banco de horas',
    })).toBe(true);
  });

  it('confirms by date range and note fingerprint when the create response omits the id', () => {
    expect(remoteRequestWasConfirmed({
      data: [{
        classification: 'Inclusao de marcacao',
        observation: 'Horario sugerido 13 00 ajuste de retorno almoco',
        ini: '20260714',
        fim: '20260714',
      }],
    }, {
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      notes: 'Horario sugerido: 13:00. Ajuste de retorno almoco.',
      aliases: ['inclusao de marcacao'],
    })).toBe(true);
  });

  it('does not confirm an unrelated authenticated response', () => {
    expect(remoteRequestWasConfirmed({
      data: [{
        id: 91,
        description: 'Abono',
        startDate: '2026-07-10',
        endDate: '2026-07-10',
      }],
    }, {
      remoteId: 'rhid:99',
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      description: 'Banco de horas',
      notes: 'Compensacao.',
    })).toBe(false);
  });

  it('confirms an inclusion returned in the real AFD-change shape', () => {
    expect(remoteRequestWasConfirmed({
      records: [{
        idAfdChange: 44922,
        dateInsertedStr: '202607161823',
        dateTimeStr: '202607091817',
        abreviationJustification: 'Justificativa',
        reason: 'Falta de marcação por erro no celular',
      }],
    }, {
      startDate: '2026-07-09',
      endDate: '2026-07-09',
      time: '18:17',
      notes: 'Falta de marcação por erro no celular',
      aliases: ['inclusao de marcacao'],
    })).toBe(true);
  });

  it('confirms an inclusion when RHiD returns midnight dateTime for the requested date', () => {
    expect(remoteRequestWasConfirmed({
      records: [{
        idJustification: 55123,
        dateTimeStr: '202609170000',
        abreviationJustification: 'Inclusão de marcação',
        reason: 'Esqueci de bater ponto',
      }],
    }, {
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      time: '13:00',
      notes: 'Esqueci de bater ponto',
      aliases: ['inclusao de marcacao'],
    })).toBe(true);
  });

  it('confirms a request matching by idSolicitacao or idAlteracao', () => {
    expect(remoteRequestWasConfirmed({
      records: [{
        idSolicitacao: 77889,
        startDate: '2026-09-17',
      }],
    }, {
      remoteId: 'rhid:77889',
      startDate: '2026-09-17',
    })).toBe(true);
  });
});

describe('remoteRequestError and isSuccessIndicator', () => {
  it('identifies OK, SUCCESS, and SUCESSO as non-errors', () => {
    expect(isSuccessIndicator('OK')).toBe(true);
    expect(isSuccessIndicator('ok')).toBe(true);
    expect(isSuccessIndicator('SUCCESS')).toBe(true);
    expect(isSuccessIndicator('sucesso')).toBe(true);
    expect(isSuccessIndicator(null)).toBe(true);
    expect(isSuccessIndicator(undefined)).toBe(true);
    expect(isSuccessIndicator(false)).toBe(true);
  });

  it('returns null when RHiD response indicates error: "OK"', () => {
    expect(remoteRequestError({ error: 'OK' })).toBeNull();
    expect(remoteRequestError({ error: 'ok' })).toBeNull();
    expect(remoteRequestError({ message: 'OK' })).toBeNull();
    expect(remoteRequestError({ success: true, message: 'OK', error: 'OK' })).toBeNull();
    expect(remoteRequestError([{ error: 'OK' }])).toBeNull();
  });

  it('returns error message when RHiD returns an actual error', () => {
    expect(remoteRequestError({ error: 'Horário fora da escala' })).toBe('Horário fora da escala');
    expect(remoteRequestError({ success: false, message: 'Data inválida' })).toBe('Data inválida');
    expect(remoteRequestError({ erro: 'Funcionário bloqueado' })).toBe('Funcionário bloqueado');
    expect(remoteRequestError([{ error: 'Falha no cadastro' }])).toBe('Falha no cadastro');
  });
});
