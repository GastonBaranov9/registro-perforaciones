import type { CapacitorConfig } from '@capacitor/cli';
const { mobileSelection } = require('./scripts/mobile-build-config.cjs');
const mobile = mobileSelection();

const config: CapacitorConfig = {
  appId: 'uy.com.raulsilva.perforaciones',
  appName: 'Raul Silva Perforaciones',
  webDir: 'dist/front/browser'
};

// Shared selection also supplies the future universal iOS identity.
if (mobile.variant === 'lab') {
  config.appId = mobile.appId;
  config.appName = mobile.appName;
  config.webDir = mobile.webDir;
}

export default config;
