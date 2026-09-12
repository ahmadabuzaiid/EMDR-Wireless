module.exports = {
  preset: '@react-native/jest-preset',
  // Several native modules (gesture-handler, navigation, svg, etc.) ship ESM
  // syntax in their published output, which Jest can't parse without being told
  // to transform them too - the default "ignore all of node_modules" rule breaks
  // as soon as a dependency isn't pre-compiled to plain CommonJS.
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-navigation|react-native-.*)/',
  ],
};
