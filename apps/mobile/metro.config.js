const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo's defaults on purpose. apps/mobile is NOT an npm workspace, so Metro
// only watches this folder: a package that isn't in apps/mobile/node_modules
// fails the bundle instead of being picked up from the web app's
// node_modules at the repo root. (Proved by bundling with the root
// node_modules removed; see README.)
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
