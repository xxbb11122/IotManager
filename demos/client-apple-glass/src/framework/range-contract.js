function rangeNumber(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && !value.trim()) return NaN;
  return Number(value);
}

export function rangeSpec(capability = {}) {
  if (capability.rangeDefinitionInvalid === true) return null;
  const min = rangeNumber(capability.min, 0);
  const max = rangeNumber(capability.max, 100);
  const step = rangeNumber(capability.step, 1);
  return [min, max, step].every(Number.isFinite) && max > min && step > 0
    ? { min, max, step } : null;
}

export function normalizeRangeDefinition(source, schema = {}) {
  const first = (...values) => values.find(value => value != null);
  const spec = rangeSpec({
    min: first(source.min, source.minimum, schema.min, schema.minimum),
    max: first(source.max, source.maximum, schema.max, schema.maximum),
    step: first(source.step, schema.step),
    rangeDefinitionInvalid: source.rangeDefinitionInvalid
  });
  return spec
    ? { ...spec, rangeDefinitionInvalid: false }
    : { min: 0, max: 100, step: 1, rangeDefinitionInvalid: true };
}
