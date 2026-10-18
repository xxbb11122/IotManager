export const expectedExecutions = Object.freeze({
  auth: 5, ai: 1, load: 1, 'rollback-write': 1, 'rollback-read': 1, 'rollback-resume': 1
});

export function requireRuntimePhase(phase) {
  if (!Object.hasOwn(expectedExecutions, phase)) throw new Error('Select an explicit runtime-eight phase');
  return phase;
}
