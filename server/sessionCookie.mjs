export const SESSION_COOKIE_NAME = 'gamb_rhid_session_v2';

export function sessionCookieHeader(value, { secure, maxAgeSeconds }) {
  const secureAttribute = secure ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureAttribute}`;
}

export function clearSessionCookieHeader({ secure }) {
  const secureAttribute = secure ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`;
}
