function compactDate(value) {
  const normalized = String(value ?? '').replace(/[^0-9]/g, '');
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

export function portalRequestListPayload(idPerson, startDate, endDate) {
  const ini = compactDate(startDate);
  const fim = compactDate(endDate);
  if (!Number.isSafeInteger(Number(idPerson)) || Number(idPerson) <= 0 || !ini || !fim || ini > fim) {
    return null;
  }
  return {
    approvalStatus: [1, 2, 3],
    departments: [],
    companies: [],
    people: [Number(idPerson)],
    ini,
    fim,
    insertedIni: '',
    insertedFim: '',
    classification: 'any',
    pendenciesOnly: false,
  };
}

export function officialPunchInclusionPayload(session, input) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time ?? '') ? input.time : null;
  const date = compactDate(input.startDate);
  if (!time || !date || compactDate(input.endDate) !== date) return null;
  return {
    idPerson: [Number(session.personId)],
    ini: date,
    fim: date,
    afdChanges: [{
      idPerson: Number(session.personId),
      idAfd: 0,
      dateTimeStr: `${date}${time.replace(':', '')}`,
      reason: input.notes ?? input.description,
      excluded: 0,
      _typeAfdChange: 'I',
      deslocamento: 0,
    }],
  };
}
