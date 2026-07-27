const COMMAND_TARGETS = {
  set_power: (parameters) => ({ power: parameters?.on }),
  set_level: (parameters) => ({ level: parameters?.level }),
  set_mode: (parameters) => ({ mode: parameters?.mode })
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyValue(value) {
  if (Array.isArray(value)) {
    return value.map(copyValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  }
  return value;
}

function copyState(value) {
  return isRecord(value) ? copyValue(value) : {};
}

function commandTarget(command) {
  const mapper = COMMAND_TARGETS[command?.type];
  return mapper ? mapper(command.parameters) : {};
}

/**
 * Applies a command lifecycle update without ever mutating the device view.
 * Only an acknowledgement represents confirmed device state.
 */
export function transitionCommand(device = {}, command = {}) {
  const previousDesired = copyState(device.desiredState);
  const previousReported = copyState(device.reportedState);
  const status = command.status ?? device.commandStatus ?? null;
  const hasDesiredState = Object.prototype.hasOwnProperty.call(command, 'desiredState')
    && isRecord(command.desiredState);
  const hasReportedState = Object.prototype.hasOwnProperty.call(command, 'reportedState')
    && isRecord(command.reportedState);

  let desiredState = previousDesired;
  let reportedState = previousReported;

  if (status === 'ACKNOWLEDGED') {
    const confirmedState = hasReportedState ? copyState(command.reportedState) : previousReported;
    reportedState = confirmedState;
    desiredState = copyState(confirmedState);
  } else if (status === 'PENDING' || status === 'SENT') {
    desiredState = hasDesiredState
      ? copyState(command.desiredState)
      : { ...previousDesired, ...commandTarget(command) };
  }

  return {
    ...device,
    desiredState,
    reportedState,
    commandStatus: status,
    lastCommandId: command.commandId ?? device.lastCommandId ?? null,
    commandError: command.error ?? null
  };
}

export function isTerminalCommandStatus(status) {
  return status === 'ACKNOWLEDGED' || status === 'FAILED';
}
