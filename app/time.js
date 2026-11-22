// Formats an incident time for the viewer: their time zone, their locale's day/month order.

/**
 * @param {string} iso  UTC timestamp from the API
 * @param {object} [opts]
 * @param {string|string[]} [opts.locale]  defaults to the browser's languages
 * @param {string} [opts.timeZone]         defaults to the browser's zone
 */
export function formatLocal(iso, { locale, timeZone } = {}) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locales = locale ?? (typeof navigator !== 'undefined' ? navigator.languages : undefined);
  const fmt = new Intl.DateTimeFormat(locales, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
  return fmt.format(date);
}
