import { createIdempotencyKey } from '../api.js';

export class PlatformAdapter {
  constructor({ api, realtime, accessRoute, idempotencyKeyFactory = () => createIdempotencyKey('platform') }) {
    if (!api || !realtime) throw new TypeError('PlatformAdapter requires API and realtime clients');
    this.api = api;
    this.realtime = realtime;
    this.accessRoute = accessRoute;
    this.idempotencyKeyFactory = idempotencyKeyFactory;
  }

  listDevices(context = {}, options = {}) { return this.api.listDevices(context, options); }
  discoverLan({ siteCode }, options = {}) { return this.api.listLanCandidates(siteCode, options); }
  claimLan(candidate, claim, options = {}) {
    const candidateId = typeof candidate === 'string' ? candidate : candidate?.candidateId;
    if (!candidateId) throw new TypeError('LAN claim requires a candidate');
    return this.api.claimLanCandidate(candidateId, claim, options);
  }
  sendCommand(command, options = {}) {
    if (command?.deviceId === undefined || !command?.type) throw new TypeError('Platform command requires deviceId and type');
    return this.api.submitCommand(command.deviceId, {
      type: command.type,
      parameters: command.parameters ?? {},
      idempotencyKey: command.idempotencyKey ?? this.idempotencyKeyFactory()
    }, options);
  }
  getCommand(commandId, options = {}) { return this.api.getCommand(commandId, options); }
  listActivity(deviceId, options = {}) { return this.api.listActivity(deviceId, options); }
  getSiteWeather(siteCode, options = {}) { return this.api.getSiteWeather(siteCode, options); }
  getSiteWeatherForecast(siteCode, query = {}, options = {}) {
    return this.api.getSiteWeatherForecast(siteCode, query, options);
  }
  getSiteWeatherSettings(siteCode, options = {}) { return this.api.getSiteWeatherSettings(siteCode, options); }
  updateSiteWeatherLocation(siteCode, location, options = {}) {
    return this.api.updateSiteWeatherLocation(siteCode, location, options);
  }
  refreshSiteWeather(siteCode, options = {}) { return this.api.refreshSiteWeather(siteCode, options); }
  subscribe(listener) { return this.realtime.subscribe(listener); }
  subscribeStatus(listener, options) { return this.realtime.subscribeStatus(listener, options); }
  connect() { return this.realtime.connect(); }
  disconnect() { this.realtime.disconnect(); }
}
