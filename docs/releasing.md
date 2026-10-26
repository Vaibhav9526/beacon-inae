# Releasing the phone app

A GitHub Actions workflow (`.github/workflows/release-android.yml`) builds a signed, arm64-v8a release APK and publishes it as a GitHub Release. The app (and people) download it from there.

## Cut a release

1. Commit and push your changes to `main`.
2. Tag and push. The tag is the version: `v1.0.1` becomes version `1.0.1`, versionCode `10001`.
   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```
   A tag containing a hyphen (`v1.1.0-beta.1`) is published as a pre-release. You can also run the workflow by hand from the Actions tab (input `version`).
3. Watch the run under Actions, "Release Android APK" (roughly 20-40 minutes).
4. Open the new Release, download `beacon-1.0.1.apk` on the phone and install it.

versionCode = major*10000 + minor*100 + patch (minor and patch must be at most 99). Each release must have a higher version than the last, or Android refuses the update. The workflow runs `beacon/scripts/set-version.mjs` on the runner only; to keep the bump in git run `node scripts/set-version.mjs 1.0.1` in `beacon/` and commit.

The `android/` folder is git-ignored and regenerated on CI by `expo prebuild`. Signing and version wiring are applied to it by `beacon/plugins/withReleaseSigning.js`.

## Signing key

Releases are signed with one release keystore. Android only installs an update over an installed app if both are signed with the same key.

- If the keystore or its passwords are lost, phones cannot update in place. Users must uninstall (losing local data) and install a build signed with a new key. Keep an offline backup of the keystore and passwords.
- The debug / dev-client build on a developer phone is signed with the debug key, so this APK cannot update it. Uninstall the dev build once, then install the release APK.
- Never commit keystores (`*.jks` and `*.keystore` are in `.gitignore`).

## First install

1. Uninstall any existing Beacon (dev client) from the phone.
2. Download `beacon-<version>.apk` from the latest Release.
3. Open it, allow "Install unknown apps" for the browser or file manager when asked, and install.
4. Optional: compare `sha256sum beacon-<version>.apk` with the `.sha256` asset.

Requires Android 8 or newer (`min-android: 8` is in the release body).

## How the app finds updates

The app calls the GitHub API `GET /repos/Vaibhav9526/beacon-inae/releases/latest` (drafts and pre-releases are not returned), reads `tag_name` for the version, and picks the asset whose name matches `beacon-*.apk`. The `.sha256` asset can be used to verify the download.

## Roll back

Delete the Release and its tag so `releases/latest` points at the previous one:
```
gh release delete v1.0.1 --cleanup-tag
```
or delete the release and tag in the GitHub web UI. Android cannot downgrade an installed app, so phones that already took the bad build need a fixed higher version (`v1.0.2`).

## Repository secrets

Set under Settings, Secrets and variables, Actions. They are created by the project owner; values are never stored in the repo.

| Secret | Contents |
| --- | --- |
| `BEACON_KEYSTORE_B64` | Release keystore file, base64-encoded |
| `BEACON_KEYSTORE_PASSWORD` | Keystore password |
| `BEACON_KEY_ALIAS` | Key alias inside the keystore |
| `BEACON_KEY_PASSWORD` | Key password |

The keystore was generated once with `keytool -genkeypair` and uploaded with `gh secret set`. The workflow stops with a clear error if any secret is empty.

## Local release build

`cd beacon/android && ./gradlew.bat app:assembleRelease -PreactNativeArchitectures=arm64-v8a`. Without `BEACON_KEYSTORE_PATH`, `BEACON_KEYSTORE_PASSWORD`, `BEACON_KEY_ALIAS` and `BEACON_KEY_PASSWORD` (env vars or gradle properties) it signs with the debug key and prints a warning. Do not publish that APK.

## Desktop Hub (Windows installer, self-updating)

Workflow: `.github/workflows/release-desktop.yml`. Push a tag `hub-v<version>` (for example `hub-v1.0.1`) or run it manually with a version. It sets the version from the tag, runs `npm ci` and `npm run release` in `hub/` on `windows-latest`, and uploads `Beacon-Hub-Setup-<version>.exe`, its `.blockmap` and `latest.yml` to two releases:

- `hub-v<version>`: the versioned release people download.
- `hub-latest`: a rolling update feed the installed app reads (`https://github.com/Vaibhav9526/beacon-inae/releases/download/hub-latest/latest.yml`). Do not delete it.

Both are marked prerelease on purpose. Why not the stock GitHub provider: electron-updater's GitHub provider asks for the repository's single "latest release" (`/releases/latest`) and then downloads `latest.yml` from that tag. It has no tag-prefix filter, so as soon as a phone release `v1.x` is the latest, desktop clients would look for `latest.yml` there and fail (checked in `electron-updater/out/providers/GitHubProvider.js`). A fixed-URL feed avoids the clash with no extra repository or token. Keeping the Hub releases as prereleases also stops them from becoming the repository's "latest", which the phone app's update check uses. (Alternative if ever preferred: a separate repo for Hub releases using the GitHub provider.)

Local build: `cd hub && npm run dist` (installer in `hub/release/`). `npm run bundle` only builds `hub/dist/engine.mjs` and `hub/dist/ui`.

### Update flow
The installed app checks 15 seconds after start and every 6 hours, downloads in the background (differential via the blockmap), and installs when the app quits. A notification says "Beacon Hub x.y.z will be installed when you quit", and the tray menu gets "Restart now to install x.y.z". Tray menu also has "Check for updates" and "Version x.y.z". Events are logged to `%APPDATA%\beacon-hub\updater.log`. A failed check (offline) is logged and ignored. Data lives in `%APPDATA%\beacon-hub\hub-data` and survives updates.

### Unsigned installer
The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC" on first run: choose More info, then Run anyway. Updates still work, because electron-updater verifies the downloaded file against the SHA-512 in `latest.yml` served from your own release; SmartScreen reputation may warn again on some updates. To sign later: buy an OV/EV certificate or use Azure Trusted Signing, store it as repository secrets, and set `CSC_LINK`/`CSC_KEY_PASSWORD` (or electron-builder's `win.azureSignOptions`) in the workflow's build step. No other change is needed.
