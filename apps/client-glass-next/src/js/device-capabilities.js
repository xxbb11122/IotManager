function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

const ID_ALIASES = Object.freeze({
  switch: 'power',
  on_off: 'power',
  set_power: 'power',
  brightness: 'level',
  dimmer: 'level',
  set_level: 'level',
  set_mode: 'mode'
});

const LEGACY_COMMANDS = Object.freeze({
  power: 'set_power',
  level: 'set_level',
  mode: 'set_mode'
});

const LEGACY_PARAMETER_KEYS = Object.freeze({
  power: 'on',
  level: 'level',
  mode: 'mode'
});

const LEGACY_CONTROL_TYPES = Object.freeze({
  power: 'toggle',
  level: 'range',
  mode: 'select'
});

function hasDeclaredCapabilities(value) {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  return ['controls', 'capabilities', 'items', 'definitions'].some((key) => Array.isArray(value[key]));
}

function capabilitySourceList(value) {
  if (Array.isArray(value)) return value;
  const source = plainObject(value);
  return arrayOf(source.controls ?? source.capabilities ?? source.items ?? source.definitions);
}

function firstDefined(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function commandTypeOf(source) {
  const command = source.command;
  const action = plainObject(source.action);
  return stringValue(firstDefined(
    source.commandType,
    typeof command === 'string' ? command : null,
    plainObject(command).type,
    plainObject(command).commandType,
    action.type,
    action.commandType
  ));
}

function normalizeOptions(value) {
  return arrayOf(value).map((option) => {
    if (option !== null && typeof option === 'object') {
      const source = plainObject(option);
      const optionValue = firstDefined(source.value, source.id, source.key, source.name);
      if (optionValue === undefined) return null;
      return {
        ...source,
        value: optionValue,
        label: String(firstDefined(source.label, source.displayName, source.name, optionValue))
      };
    }
    return { value: option, label: String(option) };
  }).filter(Boolean);
}

function numberValue(...values) {
  const value = firstDefined(...values);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeControlType(value, fallback) {
  const normalized = stringValue(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['toggle', 'switch', 'boolean', 'bool', 'on_off'].includes(normalized)) return 'toggle';
  if (['range', 'slider', 'number', 'integer', 'float', 'percentage'].includes(normalized)) return 'range';
  if (['select', 'enum', 'choice', 'mode', 'options'].includes(normalized)) return 'select';
  if (['action', 'button', 'command', 'trigger'].includes(normalized)) return 'action';
  return fallback;
}

/**
 * The platform may expose a profile envelope at the device or connection
 * level. Device-level declarations take precedence because they are the
 * deployed Profile snapshot for that particular device.
 */
export function resolveCapabilityEnvelope(device = {}, connection = {}) {
  const deviceSource = plainObject(device);
  const connectionSource = plainObject(connection);
  const candidates = [
    deviceSource.capabilities,
    deviceSource.profileCapabilities,
    plainObject(deviceSource.profile).capabilities,
    plainObject(deviceSource.profile).controls,
    plainObject(deviceSource.profileDefinition).capabilities,
    plainObject(deviceSource.profileDefinition).controls,
    connectionSource.capabilities,
    connectionSource.profileCapabilities,
    plainObject(connectionSource.metadata).capabilities,
    plainObject(deviceSource.metadata).capabilities
  ];
  return candidates.find(hasDeclaredCapabilities) ?? null;
}

export function capabilityControls(value) {
  return capabilitySourceList(value).map((control) => (
    typeof control === 'string' ? control : { ...plainObject(control) }
  ));
}

export function normalizeCapability(raw, commandDefinition = null) {
  const source = typeof raw === 'string' ? { id: raw } : plainObject(raw);
  const command = plainObject(source.command);
  const commandSpec = plainObject(commandDefinition);
  const rawId = stringValue(firstDefined(source.id, source.key, source.capabilityId, source.name));
  const id = ID_ALIASES[rawId.toLowerCase()] ?? rawId;
  const commandType = commandTypeOf(source) || stringValue(commandSpec.type) || LEGACY_COMMANDS[id] || null;
  const stateKey = stringValue(firstDefined(
    source.stateKey,
    source.reportedStateKey,
    source.property,
    source.field,
    plainObject(source.state).key,
    command.stateKey,
    command.stateField,
    commandSpec.stateField,
    id
  ));
  const parameterKey = stringValue(firstDefined(
    source.parameterKey,
    source.parameter,
    source.valueKey,
    plainObject(source.parameter).key,
    command.parameterKey,
    command.valueKey,
    command.stateParameter,
    commandSpec.stateParameter,
    LEGACY_PARAMETER_KEYS[id],
    stateKey
  ));
  const commandParameter = plainObject(commandSpec.parameters)[parameterKey];
  const schema = plainObject(firstDefined(source.schema, source.valueSchema, source.constraints, commandParameter));
  const options = normalizeOptions(firstDefined(
    source.options,
    source.values,
    source.enum,
    schema.options,
    schema.enum
  ));
  const inferredType = options.length
    ? 'select'
    : numberValue(source.min, source.minimum, schema.min, schema.minimum) !== undefined
      || numberValue(source.max, source.maximum, schema.max, schema.maximum) !== undefined
      ? 'range'
      : null;
  const controlType = normalizeControlType(
    firstDefined(source.controlType, source.kind, source.inputType, source.widget, source.valueType, source.type, schema.type),
    LEGACY_CONTROL_TYPES[id] ?? inferredType ?? 'action'
  );

  return {
    ...source,
    id,
    label: firstDefined(source.label, source.displayName, source.title, id),
    commandType,
    stateKey,
    parameterKey,
    controlType,
    options,
    fixedParameters: {
      ...plainObject(firstDefined(source.defaultParameters, source.parameters)),
      ...plainObject(command.parameters),
      ...plainObject(commandSpec.defaultParameters)
    },
    min: numberValue(source.min, source.minimum, schema.min, schema.minimum),
    max: numberValue(source.max, source.maximum, schema.max, schema.maximum),
    step: numberValue(source.step, schema.step),
    writable: source.writable !== false && source.enabled !== false,
    enabled: source.enabled !== false
  };
}

export function resolveDeviceCapabilities(device = {}, connection = {}) {
  const envelope = resolveCapabilityEnvelope(device, connection);
  const envelopeObject = plainObject(envelope);
  const profile = plainObject(plainObject(device).profile);
  const commandsByType = new Map(capabilitySourceList(envelopeObject.commands)
    .map((command) => plainObject(command))
    .filter((command) => stringValue(command.type))
    .map((command) => [stringValue(command.type), command]));
  const controls = capabilityControls(envelope).map((control) => {
    const source = typeof control === 'string' ? { id: control } : plainObject(control);
    const commandType = commandTypeOf(source) || (LEGACY_COMMANDS[String(source.id ?? '').toLowerCase()] ?? null);
    return normalizeCapability(control, commandsByType.get(commandType) ?? null);
  })
    .filter((capability) => capability.id);
  const profileId = firstDefined(
    envelopeObject.profileId,
    envelopeObject.id,
    plainObject(device).profileId,
    profile.id,
    plainObject(connection).profileId,
    typeof plainObject(connection).profile === 'string' ? plainObject(connection).profile : null
  ) ?? null;
  const known = envelopeObject.known === false
    ? false
    : envelope !== null && (envelopeObject.known === true || controls.length > 0 || Boolean(profileId));

  return {
    profileId: profileId == null ? null : String(profileId),
    version: firstDefined(
      envelopeObject.version,
      envelopeObject.profileVersion,
      plainObject(device).profileVersion,
      profile.version,
      plainObject(connection).profileVersion
    ) ?? null,
    known,
    controls,
    readOnly: arrayOf(envelopeObject.readOnly)
  };
}

export function isControllableCapability(capability) {
  return Boolean(capability?.id && capability.writable !== false && capability.enabled !== false && capability.commandType);
}

export function capabilityValue(capability, desiredState = {}, reportedState = {}) {
  const key = capability?.stateKey;
  if (!key) return undefined;
  const desired = plainObject(desiredState);
  const reported = plainObject(reportedState);
  return firstDefined(desired[key], reported[key]);
}

export function capabilityCommandInput(capability, value) {
  if (!capability?.parameterKey) return {};
  return { [capability.parameterKey]: value };
}

export function capabilityDesiredState(capability, value) {
  if (!capability?.stateKey) return {};
  return { [capability.stateKey]: value };
}
