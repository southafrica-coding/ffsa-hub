module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      // NativeWind v4: also adds the Reanimated 4 / Worklets plugin.
      "nativewind/babel",
    ],
  };
};
