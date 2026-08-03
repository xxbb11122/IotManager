const config = {
  appId: 'com.iot.manager.client',
  appName: 'IoT Manager',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: { enabled: true }
  }
};

// Capacitor 8 loads JavaScript config with require(), even in an ESM package.
export const { appId, appName, webDir, plugins } = config;
export default config;
