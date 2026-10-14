import dayjs from 'dayjs';

export function formatPublishedVersion(
  version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.5',
  buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString()
): string {
  const formattedDate = dayjs(buildTime).isValid()
    ? dayjs(buildTime).format('DD/MM/YYYY [às] HH:mm')
    : buildTime;
  return `v${version} • ${formattedDate}`;
}
