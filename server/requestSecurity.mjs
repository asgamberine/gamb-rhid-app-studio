function firstForwardedValue(value) {
  return String(value ?? '').split(',')[0].trim();
}

function managedProduction() {
  return process.env.NODE_ENV === 'production' && Boolean(process.env.PORT);
}

function proxyIsTrusted() {
  const configured = String(process.env.TRUST_PROXY ?? '').toLowerCase();
  return ['true', '1', 'yes'].includes(configured) || (configured === '' && managedProduction());
}

function configuredOrigins(request) {
  const configured = String(process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const forwardedHost = proxyIsTrusted() ? firstForwardedValue(request.headers['x-forwarded-host']) : '';
  const hostname = (forwardedHost || firstForwardedValue(request.headers.host)).split(':')[0].toLowerCase();
  const productionFrontend = managedProduction() && hostname === 'gambrhid-api.gamberine.com.br'
    ? ['https://gamberine.com.br']
    : [];
  return [...new Set([...configured, ...productionFrontend])];
}

export function expectedRequestOrigins(request) {
  const trustProxy = proxyIsTrusted();
  const forwardedHost = trustProxy ? firstForwardedValue(request.headers['x-forwarded-host']) : '';
  const host = forwardedHost || firstForwardedValue(request.headers.host);
  if (!host) {
    return configuredOrigins(request);
  }

  const forwardedProto = trustProxy ? firstForwardedValue(request.headers['x-forwarded-proto']).toLowerCase() : '';
  const protocol = forwardedProto || (request.socket?.encrypted ? 'https' : 'http');
  return [...new Set([`${protocol}://${host}`, ...configuredOrigins(request)])];
}

export function isTrustedMutationRequest(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) {
    return true;
  }

  const origin = firstForwardedValue(request.headers.origin);
  return Boolean(origin && expectedRequestOrigins(request).includes(origin));
}

export function trustedCorsOrigin(request) {
  const origin = firstForwardedValue(request.headers.origin);
  return origin && expectedRequestOrigins(request).includes(origin) ? origin : null;
}

