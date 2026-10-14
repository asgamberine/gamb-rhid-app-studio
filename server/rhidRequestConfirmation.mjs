function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeRequestId(value) {
  return String(value ?? '')
    .trim()
    .replace(/^rhid:/i, '');
}

function normalizeDate(value) {
  const text = String(value ?? '').trim();
  const compact = text.replace(/[^0-9]/g, '');
  if (compact.length >= 8) {
    const year = compact.slice(0, 4);
    const month = compact.slice(4, 6);
    const day = compact.slice(6, 8);
    return `${year}-${month}-${day}`;
  }
  return '';
}

function normalizeDateTime(value) {
  const compact = String(value ?? '').replace(/[^0-9]/g, '');
  return compact.length >= 12 ? compact.slice(0, 12) : '';
}

function collectCandidates(value, items) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectCandidates(entry, items));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const item = value;
  const id = normalizeRequestId(item.id ?? item.idAfdChange ?? item.idJustification ?? item.newID ?? item.codigo ?? item.requestId ?? item.idSolicitacao ?? item.idAlteracao);
  const startDate = normalizeDate(item.startDate ?? item.ini ?? item.dataIni ?? item.inicioStr ?? item.dateTimeStr ?? item.date);
  const endDate = normalizeDate(item.endDate ?? item.fim ?? item.dataFinal ?? item.fimStr ?? item.dateTimeStr ?? item.date);
  const requestedAt = normalizeDate(item.requestedAt ?? item.createdAt ?? item.dateInsertedStr ?? item.dateTimeStr ?? item.date);
  const dateTime = normalizeDateTime(item.dateTimeStr ?? item.inicioStr);
  const text = normalizeText([
    item.description,
    item.observation,
    item.notes,
    item.reason,
    item.motivo,
    item.justificativa,
    item.classification,
    item.type,
    item.name,
    item.abreviation,
    item.abreviationJustification,
  ].filter((entry) => typeof entry === 'string' && entry.trim()).join(' '));

  if (id || startDate || endDate || requestedAt || text) {
    items.push({
      id,
      startDate,
      endDate,
      requestedAt,
      dateTime,
      text,
    });
  }

  Object.values(item).forEach((entry) => collectCandidates(entry, items));
}

function sameRange(candidate, expectedStartDate, expectedEndDate) {
  const candidateStartDate = candidate.startDate || candidate.requestedAt;
  const candidateEndDate = candidate.endDate || candidateStartDate;
  if (expectedStartDate && candidateStartDate && candidateStartDate !== expectedStartDate) {
    return false;
  }
  if (expectedEndDate && candidateEndDate && candidateEndDate !== expectedEndDate) {
    return false;
  }
  return Boolean(candidateStartDate || candidateEndDate);
}

export function remoteRequestWasConfirmed(data, expected) {
  const remoteId = normalizeRequestId(expected?.remoteId);
  const expectedStartDate = normalizeDate(expected?.startDate);
  const expectedEndDate = normalizeDate(expected?.endDate ?? expected?.startDate);
  const expectedDateTime = normalizeDateTime(`${expected?.startDate ?? ''}${expected?.time ?? ''}`);
  const expectedTexts = [
    expected?.description,
    expected?.notes,
    ...(Array.isArray(expected?.aliases) ? expected.aliases : []),
  ]
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length >= 5);

  const candidates = [];
  collectCandidates(data, candidates);

  if (remoteId && candidates.some((candidate) => candidate.id === remoteId)) {
    return true;
  }

  return candidates.some((candidate) => {
    if (!sameRange(candidate, expectedStartDate, expectedEndDate)) {
      return false;
    }
    if (
      expectedDateTime &&
      candidate.dateTime &&
      candidate.dateTime !== expectedDateTime &&
      !candidate.dateTime.endsWith('0000')
    ) {
      return false;
    }
    if (!expectedTexts.length) {
      return true;
    }
    return expectedTexts.some((entry) => candidate.text.includes(entry));
  });
}

export function isSuccessIndicator(val) {
  if (typeof val === 'string') {
    const norm = val.trim().toUpperCase();
    return norm === 'OK' || norm === 'SUCCESS' || norm === 'SUCESSO';
  }
  return val === false || val === null || val === undefined;
}

export function remoteRequestError(body) {
  if (!body) return null;
  if (body?.success === false) {
    return body.error ?? body.message ?? 'O RHiD recusou a solicitação.';
  }
  if (body?.error && !isSuccessIndicator(body.error)) {
    return String(body.error);
  }
  if (body?.erro && !isSuccessIndicator(body.erro)) {
    return String(body.erro);
  }
  if (Array.isArray(body)) {
    const failed = body.find((entry) => entry?.error && !isSuccessIndicator(entry.error));
    if (failed) return String(failed.error);
  }
  return null;
}
