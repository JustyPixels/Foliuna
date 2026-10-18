# Foliuna Android testing preview

Android 8.0 (API 26) or newer; target API 36. The separate application ID is `io.github.justypixels.foliuna.preview`, version `0.1.0-preview.1`. This is a **debug-signed testing build**, not a production or Google Play release. Windows remains available separately.

## Install and protect your archive

Use only an APK attached to a published [Foliuna GitHub Release](https://github.com/JustyPixels/Foliuna/releases). Verify its SHA-256 against the release's SHA256SUMS.txt. Enable installation permission for the app opening the APK when Android requests it. Device, region and developer-verification rules can impose additional steps; follow [Android's current developer verification guidance](https://developer.android.com/developer-verification/guides). A debug signature does not exempt a build from platform rules.

For development/testing with Android Studio's platform tools and an authorized USB-debugging device:

```powershell
adb install -r Foliuna-Android-0.1.0-preview.1-debug.apk
```

See [Android's ADB documentation](https://developer.android.com/tools/adb). Export first if an existing installation cannot update because the certificate differs. Do not uninstall to resolve an update error until you have a verified backup.

**Uninstalling the preview deletes its private archive, metadata and saved credentials. A different debug certificate may require uninstalling. Export before uninstalling, clearing storage, or switching signing identities.** No production signing identity or signing secret is created. GitHub CI builds can have different disposable debug certificates; use the published APK for a particular preview consistently.

## Use

Discover, Gallery and Collections are the three bottom tabs. Settings and account controls are in the header. All eight built-in providers and compatible custom Danbooru/Gelbooru connections use the shared definitions, rating defaults and interface. Site account details and favorite queries use e621 only.

Tag suggestions are debounced and paced. Numbered pages/infinite scrolling and natural/cropped layouts share the Windows preferences. Details navigate through loaded posts and the next page. Sample/full-size images retain their proportions. GIFs and videos use the in-app viewer; Fullscreen returns to the same details on Back. Codec support depends on the device.

Downloads are explicit and foreground-only. Leaving the app cancels active transfers. Completed originals are preserved; restart recovers prepared journal entries without changing earlier source history. Incomplete/conflicting originals are never silently replaced. Keep backups: recovery cannot guarantee physical power-loss or storage-device behavior.

## Export to Windows

1. Stop downloads and open **Settings → Export library…**.
2. Select a writable destination through Android's folder picker. Foliuna creates a new uniquely named folder inside it.
3. Wait for completion. An interrupted export retains an **EXPORT-INCOMPLETE.txt** marker: retry into a new folder and do not treat the incomplete folder as a backup.
4. Copy the complete completed folder to Windows, including hidden **.foliuna/collections.json**, **media/** and every adjacent **.foliuna.json**.
5. In Windows Foliuna, choose this folder as the archive, then **Gallery → Import sidecars**. Source histories and categorized tags rebuild the index; Collections reattach by SHA-256.

Export takes one locked snapshot; it excludes API credentials, private preferences, caches and the database. Originals and metadata are ordinary unencrypted exported files. Choose a destination appropriate for your library. Android preview import, Windows-to-Android transfer and synchronization are deferred.

## Architecture and build

Capacitor 8 hosts bundled React/TypeScript UI. Native Kotlin owns checked network requests, Keystore AES-GCM credentials, AndroidX bundled SQLite, app-private originals/sidecars, recovery and SAF exports. The WebView cannot load remote pages/frames, arbitrary local files, generic native HTTP or raw SQL. Named operations preserve the typed `FoliunaApi` boundary. No API key is returned to JavaScript.

Install dependencies with `npm ci`. Install Android SDK platform/build-tools 36 and a Java 21 runtime. Windows uses the installed Android Studio `jbr` without changing global Java settings; override only this build with `FOLIUNA_JAVA_HOME` if needed. Set `ANDROID_HOME` to your SDK (the local development fallback is ignored `work/android-sdk`).

```powershell
npm run android:build
npm run android:test
npm run android:lint
```

Build writes a debug APK and checksum into ignored **release/android/**. Tests require an owned API 26 or API 36 emulator; set **ANDROID_SERIAL** to its serial. Generated provider definitions and compatibility fixtures come from the same TypeScript sources used by Windows. Test fixtures are packaged only in the instrumentation APK.

Android tests cover provider normalization, custom identities, encrypted credentials and API separation, public-address/hostname checks, rate limiting/cache/cooldowns, media validation/cancellation, SHA-256 deduplication, recovery, offline searches, membership/restart, actual WebView bridge restrictions, navigation/layout and real SAF destination creation. Exact exported names and MIME types are checked; both private-snapshot and picker-produced fixtures are checked with the unchanged Windows importer:

```powershell
node scripts/verify-android-export.mjs
node scripts/verify-android-export.mjs --saf
```

Instrumentation exports the fixture ZIP through AndroidX test output storage before test apps are removed; the importer verification finds that artifact under the Android build outputs. Instrumentation uses a native-only temporary service override; no demo/testing control or transport override is exposed to JavaScript, intents or external apps. Tests never use real keys or provider requests. API 26 testing includes its older bundled WebView; keep Android System WebView/Chrome updated on actual devices.

Local verification includes API 26 phone and API 36 tablet emulators plus an authorized Moto g14 (API 34, ARM64, WebView 155) using temporary fixture archives and no real keys. Automatic destination selection runs only on owned emulators. Physical-phone tests open/cancel the picker without selecting a personal destination.

Deferred: Flash playback, floating desktop windows, background downloads, incoming portable libraries, sync and Google Play submission. Live authenticated providers, additional physical devices/OS versions and hardware power-loss behavior require separate verification.
