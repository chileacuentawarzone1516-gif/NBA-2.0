import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native packaging (Android/iOS) around the web build in `dist/`.
 * appId is PROVISIONAL: it becomes permanent once published to a store, so confirm the
 * final reverse-domain identifier before the first upload.
 */
const config: CapacitorConfig = {
  appId: 'com.hoopline.game',
  appName: 'Hoopline',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b0f17',
  },
};

export default config;
