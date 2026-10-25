// onnxruntime-react-native's own Expo plugin adds the Gradle dependency but never registers its ReactPackage, and the
// package has no autolinking metadata, so NativeModules.Onnxruntime stays undefined and the photo model cannot start.
// This registers the package in MainApplication, the way the library's README does for a bare project.
const { withMainApplication } = require('@expo/config-plugins');

module.exports = (config) =>
  withMainApplication(config, (c) => {
    if (c.modResults.language !== 'kt') return c;
    const src = c.modResults.contents;
    if (src.includes('OnnxruntimePackage')) return c;
    c.modResults.contents = src.replace(/(PackageList\(this\)\.packages\.apply \{\r?\n)/, '$1          add(ai.onnxruntime.reactnative.OnnxruntimePackage())\n');
    return c;
  });
