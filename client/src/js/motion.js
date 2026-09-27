const PRIMARY_SCREENS = new Set(['devices', 'activity', 'add']);
const PARENT_SCREEN = {
  detail: 'devices',
  ble: 'add',
  lan: 'add',
  connections: 'devices',
  sites: 'devices',
  weather: 'devices'
};

export function navigationMotionKind(from, to, hint = null) {
  if (!from) return null;
  if (hint === 'context') return 'context';
  if (from === to) return null;
  if (hint === 'peer' || hint === 'back' || hint === 'forward') return hint;
  if (from === 'sites' && to === 'devices') return 'peer';
  if (PRIMARY_SCREENS.has(from) && PRIMARY_SCREENS.has(to)) return 'peer';
  if (PARENT_SCREEN[from] === to || (PARENT_SCREEN[from] && PRIMARY_SCREENS.has(to))) return 'back';
  return 'forward';
}

export function commandMotionKind(previous, current) {
  if (!previous || previous.id !== current?.id || previous.status === current.status) return null;
  if (current.status === 'ACKNOWLEDGED' && ['PENDING', 'SENT'].includes(previous.status)) return 'confirmed';
  if (['FAILED', 'UNCONFIRMED'].includes(current.status)) return 'outcome';
  return null;
}
