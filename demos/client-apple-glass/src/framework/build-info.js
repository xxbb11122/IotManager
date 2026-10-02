// Public, build-time identity only; never serialize the environment or file paths.
export const BUILD_INFO = Object.freeze(typeof __IOT_BUILD_INFO__ === 'undefined'
  ? { commit: 'unknown', builtAt: 'unknown', dirty: true, version: 'unbundled' }
  : __IOT_BUILD_INFO__);
