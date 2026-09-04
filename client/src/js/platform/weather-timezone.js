const ZERO_OFFSET_ALIASES = new Set(['Z', '+00:00', '-00:00', '+0000', '-0000']);

/**
 * Returns a timezone value that is safe to persist in a weather request.
 * Some Android WebViews report UTC as a fixed offset (`+00:00`), while
 * Open-Meteo accepts the canonical `UTC` identifier instead.
 */
export function normalizeWeatherTimezone(value, fallback = 'Asia/Shanghai') {
  const candidate = String(value ?? '').trim();
  if (!candidate) return fallback;
  return ZERO_OFFSET_ALIASES.has(candidate.toUpperCase()) ? 'UTC' : candidate;
}

export function browserWeatherTimezone(resolve = () => Intl.DateTimeFormat().resolvedOptions().timeZone) {
  try {
    return normalizeWeatherTimezone(resolve());
  } catch {
    return 'Asia/Shanghai';
  }
}
