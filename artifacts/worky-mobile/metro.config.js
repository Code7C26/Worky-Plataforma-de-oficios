const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const singletonPackages = ['react', 'react-dom', 'react-native', '@tanstack/react-query'];

// Workspace libraries can have different peer installations. Always resolve
// these runtime/context providers from the mobile app, including JSX subpaths.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = singletonPackages.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  return context.resolveRequest(
    singleton
      ? { ...context, originModulePath: path.join(__dirname, 'package.json') }
      : context,
    moduleName,
    platform,
  );
};

module.exports = config;
