// Windows build fixes for the generated Android project (re-applied by every `expo prebuild`):
//  1. React Native 0.88 asks for NDK 27.1, whose SDK folder is empty here, and NDK 26 is too old for the C++20
//     these libraries need. Pin the installed NDK instead. It must come before the root plugins are applied,
//     because they read ext.ndkVersion while configuring :app.
//  2. Native libraries have very long object paths. The default CMake 3.22 ships Ninja 1.10, which cannot create
//     paths over 260 characters even with Windows long paths on; CMake 4.1.2 ships Ninja 1.12, which can.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// beacon: windows build fixes';

module.exports = (config, { ndkVersion, cmakeVersion }) =>
  withProjectBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    // drop earlier forms of this patch
    src = src.replace(/\n?\/\/ beacon: pinned NDK\nrootProject\.ext\.ndkVersion = "[^"]*"\n?/g, '\n');
    src = src.replace(new RegExp(`${MARK}[\\s\\S]*?// beacon: end\\n\\n?`, 'g'), '');
    const block = [
      MARK,
      `rootProject.ext.ndkVersion = "${ndkVersion}"`,
      cmakeVersion
        ? `subprojects { sp ->
  ['com.android.library', 'com.android.application'].each { id ->
    sp.plugins.withId(id) {
      sp.android.externalNativeBuild.cmake.version = "${cmakeVersion}"
    }
  }
}`
        : '',
      '// beacon: end',
      '',
      '',
    ].join('\n');
    const first = src.indexOf('apply plugin:');
    cfg.modResults.contents = first >= 0 ? src.slice(0, first) + block + src.slice(first) : block + src;
    return cfg;
  });
