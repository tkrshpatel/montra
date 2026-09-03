// Dynamic config on top of app.json so EXPO_PUBLIC_BACKEND_URL is
// captured into `extra` at build time. This gives the app a reliable
// fallback via expo-constants if EXPO_PUBLIC_* inlining ever fails
// on a native/EAS build.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra || {}),
    EXPO_PUBLIC_BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL || '',
  },
});
