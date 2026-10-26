// Release signing + versioning for the generated android/app/build.gradle (re-applied by every `expo prebuild`).
// android/ is git-ignored, so CI regenerates it; this plugin is what makes the release APK signed.
//  - BEACON_KEYSTORE_PATH / _PASSWORD / BEACON_KEY_ALIAS / BEACON_KEY_PASSWORD (env or gradle properties)
//    sign the release build; without them it falls back to the debug key with a warning.
//  - -PbeaconVersionName / -PbeaconVersionCode override app.json (defaults come from app.json).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = 'beaconHasReleaseKey';

function rep(src, from, to) {
  if (!src.includes(from)) throw new Error(`withReleaseSigning: build.gradle template changed, cannot find: ${from.slice(0, 60)}`);
  return src.replace(from, () => to);
}

module.exports = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let s = cfg.modResults.contents;
    if (s.includes(MARK)) return cfg;
    s = rep(
      s,
      'def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()\n',
      `def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()

// beacon: version comes from app.json (kept in sync by scripts/set-version.mjs); -P overrides.
def beaconAppJson = new groovy.json.JsonSlurper().parse(new File(projectRoot, "app.json")).expo
def beaconVersionName = (findProperty('beaconVersionName') ?: beaconAppJson.version).toString()
def beaconVersionCode = Integer.parseInt((findProperty('beaconVersionCode') ?: beaconAppJson.android.versionCode ?: 1).toString())

// beacon: release signing config from env or gradle properties.
def beaconSigning = { String name -> System.getenv(name) ?: findProperty(name) }
def beaconKeystorePath = beaconSigning('BEACON_KEYSTORE_PATH')
def beaconHasReleaseKey = beaconKeystorePath && new File(beaconKeystorePath.toString()).isFile() &&
    beaconSigning('BEACON_KEYSTORE_PASSWORD') && beaconSigning('BEACON_KEY_ALIAS') && beaconSigning('BEACON_KEY_PASSWORD')
`
    );
    s = s.replace(/versionCode \d+/, 'versionCode beaconVersionCode').replace(/versionName "[^"]*"/, 'versionName beaconVersionName');
    if (!s.includes('versionCode beaconVersionCode')) throw new Error('withReleaseSigning: versionCode not found');
    s = rep(
      s,
      '    signingConfigs {\n        debug {',
      `    signingConfigs {
        if (beaconHasReleaseKey) {
            release {
                storeFile file(beaconKeystorePath.toString())
                storePassword beaconSigning('BEACON_KEYSTORE_PASSWORD').toString()
                keyAlias beaconSigning('BEACON_KEY_ALIAS').toString()
                keyPassword beaconSigning('BEACON_KEY_PASSWORD').toString()
            }
        }
        debug {`
    );
    s = s.replace(
      /(release \{\n)((?:\s*\/\/[^\n]*\n)*)\s*signingConfig signingConfigs\.debug\n/,
      (m, head) => `${head}            if (beaconHasReleaseKey) {
                signingConfig signingConfigs.release
            } else {
                logger.warn("WARNING: BEACON_KEYSTORE_* not set; signing the release build with the DEBUG key. Do not publish this APK.")
                signingConfig signingConfigs.debug
            }
`
    );
    if (!s.includes('signingConfig signingConfigs.release')) throw new Error('withReleaseSigning: release buildType not found');
    cfg.modResults.contents = s;
    return cfg;
  });
