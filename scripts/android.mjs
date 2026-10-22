import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const windows = process.platform === 'win32';
const java = process.env.FOLIUNA_JAVA_HOME || (windows ? 'C:/Program Files/Android/Android Studio/jbr' : process.env.JAVA_HOME);
if (!java || !existsSync(path.join(java, 'bin', windows ? 'java.exe' : 'java'))) throw Error('Install Java 21 or set FOLIUNA_JAVA_HOME to its directory.');
const sdk = process.env.ANDROID_HOME || path.resolve('work/android-sdk');
const env = { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdk, GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.resolve('work/gradle') };
function run(command, args) {
  if (windows && /\.(cmd|bat)$/.test(command)) command = command.replaceAll('/', '\\');
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: windows && /\.(cmd|bat)$/.test(command) });
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}
const task = process.argv[2] || 'build';
if (!['build', 'test', 'lint'].includes(task)) throw Error('Use build, test or lint.');
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.android.config.ts']);
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
run(process.execPath, ['scripts/android-assets.mjs']);
mkdirSync('work', { recursive: true });
writeFileSync('android/local.properties', 'sdk.dir=' + sdk.replaceAll('\\', '/').replaceAll(':', '\\:') + '\n');
run(windows ? 'android/gradlew.bat' : './android/gradlew', ['-p', 'android', task === 'test' ? ':app:connectedDebugAndroidTest' : task === 'lint' ? ':app:lintDebug' : ':app:assembleDebug', '--console=plain']);
if (task === 'build') {
  mkdirSync('release/android', { recursive: true });
  const name = 'Foliuna-Android-0.1.0-preview.2-debug.apk';
  copyFileSync('android/app/build/outputs/apk/debug/app-debug.apk', 'release/android/' + name);
  const digest = createHash('sha256').update(readFileSync('release/android/' + name)).digest('hex');
  writeFileSync('release/android/SHA256SUMS.txt', digest + '  ' + name + '\n');
  console.log('Debug testing APK and SHA-256 saved in release/android. Publication requires passing verification.');
}
