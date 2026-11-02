/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.css$": "<rootDir>/test/style-stub.js",
    // Jest only: lucide's "react-native" export is .mjs, which jest-expo
    // doesn't transform. The app bundle (Metro) still uses the ESM build.
    "^lucide-react-native$": "<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js",
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
