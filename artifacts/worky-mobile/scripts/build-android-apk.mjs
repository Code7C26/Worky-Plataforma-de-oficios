import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone release APKs use the workspace debug signature for sideloading,
// not a Google Play signing key. Keep test and production package IDs/version
// counters separate.
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.resolve(mobileRoot, '../../generated-artifacts/worky-android');
const target = process.env.WORKY_APK_TARGET || 'test';
if (!['test', 'production'].includes(target)) {
  throw new Error('WORKY_APK_TARGET must be either test or production.');
}
const versionFile = path.join(mobileRoot, target === 'production'
  ? 'production-apk-version.json'
  : 'test-apk-version.json');
const storedVersion = existsSync(versionFile)
  ? JSON.parse(readFileSync(versionFile, 'utf8')).versionCode
  : 1;
if (!Number.isSafeInteger(storedVersion) || storedVersion < 1) {
  throw new Error(`${path.basename(versionFile)} must contain a positive integer versionCode.`);
}
const nextVersionCode = storedVersion + 1;
const sdk = process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.resolve(mobileRoot, '../../generated-artifacts/android-sdk');
if (!process.env.WORKY_API_ORIGIN) {
  throw new Error('Set WORKY_API_ORIGIN to the HTTPS API origin before building.');
}
const origin = new URL(process.env.WORKY_API_ORIGIN);
if (origin.protocol !== 'https:' || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error('WORKY_API_ORIGIN must be an HTTPS origin without credentials or a path.');
}
if (target === 'test' && /\.replit\.app$/i.test(origin.hostname) &&
    process.env.WORKY_ALLOW_PRODUCTION_DATA !== 'true') {
  throw new Error('A test APK cannot use a .replit.app host by default; that can access production data. Select WORKY_APK_TARGET=production explicitly.');
}
if (!sdk || !existsSync(path.join(sdk, 'build-tools'))) {
  throw new Error('Install Android SDK in generated-artifacts/android-sdk or set ANDROID_HOME before building.');
}
const androidRoot = path.join(mobileRoot, 'android');
const gradleBuildFile = path.join(androidRoot, 'app/build.gradle');
if (!existsSync(path.join(androidRoot, 'gradlew')) || !existsSync(gradleBuildFile)) {
  throw new Error('The native Android project is missing. Restore it before building; this script does not run Expo prebuild.');
}

mkdirSync(outputRoot, { recursive: true });
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  CI: '1',
  NODE_ENV: 'production',
  EXPO_PUBLIC_DOMAIN: origin.host,
  GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || path.join(outputRoot, 'gradle-home'),
  NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=768',
  CMAKE_BUILD_PARALLEL_LEVEL: process.env.CMAKE_BUILD_PARALLEL_LEVEL || '1',
};
function run(command, args, cwd = mobileRoot, capture = false) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: capture ? 16 * 1024 * 1024 : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || ''}`);
  }
  return result.stdout;
}

function prepareGeneratedGradleConfig() {
  // android/ is generated and ignored by Git. Reapply the package/version
  // separation here so a later Expo prebuild cannot silently undo it.
  let source = readFileSync(gradleBuildFile, 'utf8');
  const minifyDeclaration =
    "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()";
  const targetDeclarations = [
    "def workyBuildTarget = (findProperty('workyBuildTarget') ?: 'test').toString()",
    "if (!(workyBuildTarget in ['test', 'production'])) {",
    '    throw new GradleException("workyBuildTarget must be test or production.")',
    '}',
    "def workyBuildVersionCode = findProperty('workyBuildVersionCode')?.toString()",
  ].join('\n');

  if (!source.includes('def workyBuildTarget =')) {
    if (!source.includes(minifyDeclaration)) {
      throw new Error('Could not locate the Android release configuration anchor.');
    }
    source = source.replace(minifyDeclaration, `${minifyDeclaration}\n${targetDeclarations}`);
  } else if (!source.includes('def workyBuildVersionCode =')) {
    source = source.replace(
      /^def workyBuildTarget = .*$/m,
      (targetLine) => `${targetLine}\ndef workyBuildVersionCode = findProperty('workyBuildVersionCode')?.toString()`,
    );
  }

  const defaultConfigStart = source.indexOf('defaultConfig {');
  const defaultConfigEnd = source.indexOf('\n    }', defaultConfigStart);
  const versionCodeIndex = source.indexOf('versionCode ', defaultConfigStart);
  if (defaultConfigStart < 0 || defaultConfigEnd < 0 ||
      versionCodeIndex < 0 || versionCodeIndex > defaultConfigEnd) {
    throw new Error('Could not locate Android defaultConfig.versionCode.');
  }
  const versionLineStart = source.lastIndexOf('\n', versionCodeIndex) + 1;
  const versionLineEnd = source.indexOf('\n', versionCodeIndex);
  const versionIndent = source.slice(versionLineStart, versionCodeIndex);
  const versionLine = source.slice(versionCodeIndex, versionLineEnd);
  if (!versionLine.includes('workyBuildVersionCode')) {
    source = `${source.slice(0, versionLineStart)}${versionIndent}versionCode workyBuildVersionCode ? workyBuildVersionCode.toInteger() : 1${source.slice(versionLineEnd)}`;
  }

  if (!source.includes("if (workyBuildTarget == 'test')")) {
    source = source
      .replace(/^[ \t]*applicationIdSuffix "\.test"\s*$/m, '')
      .replace(/^[ \t]*resValue "string", "app_name", "Worky Prueba"\s*$/m, '');
    const releaseHeader = source.match(/^([ \t]*)release\s*\{\s*$/m);
    if (!releaseHeader) throw new Error('Could not locate the Android release build type.');
    const indent = releaseHeader[1];
    const testVariantConfig = [
      `${indent}    if (workyBuildTarget == 'test') {`,
      `${indent}        applicationIdSuffix ".test"`,
      `${indent}        resValue "string", "app_name", "Worky Prueba"`,
      `${indent}    }`,
    ].join('\n');
    source = source.replace(releaseHeader[0], `${releaseHeader[0]}\n${testVariantConfig}`);
  }

  writeFileSync(gradleBuildFile, source);
}

prepareGeneratedGradleConfig();
run('java', ['-version']);

// Gradle does not treat EXPO_PUBLIC_* values as task inputs. Remove the JS bundle
// outputs so each APK embeds the API origin selected for this build.
for (const generatedAssets of [
  path.join(mobileRoot, 'android/app/build/generated/assets/react/release'),
  path.join(mobileRoot, 'android/app/build/intermediates/assets/release/mergeReleaseAssets'),
]) {
  rmSync(generatedAssets, { recursive: true, force: true });
}

const apk = path.join(mobileRoot, 'android/app/build/outputs/apk/release/app-release.apk');
const buildTools = readdirSync(path.join(sdk, 'build-tools'))
  .filter((name) => existsSync(path.join(sdk, 'build-tools', name, 'apksigner')))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
if (!buildTools) throw new Error('Android build-tools with apksigner are required.');
const aapt = path.join(sdk, 'build-tools', buildTools, 'aapt');
if (!existsSync(aapt)) throw new Error('Android build-tools with aapt are required.');
const universalFileName = process.env.WORKY_APK_FILENAME || (target === 'production'
  ? 'worky-produccion-android-actualizada.apk'
  : 'worky-prueba-android.apk');
if (path.basename(universalFileName) !== universalFileName || !universalFileName.endsWith('.apk')) {
  throw new Error('WORKY_APK_FILENAME must be a simple .apk filename.');
}
const variants = target === 'production'
  ? [
      { fileName: 'worky-produccion-android-arm64-actualizada.apk', architectures: ['arm64-v8a'] },
      { fileName: universalFileName, architectures: ['armeabi-v7a', 'arm64-v8a'] },
    ]
  : [
      { fileName: 'worky-prueba-android-arm64.apk', architectures: ['arm64-v8a'] },
      { fileName: universalFileName, architectures: ['armeabi-v7a', 'arm64-v8a'] },
    ];
const expectedPackage = target === 'production' ? 'com.workyoficios.app' : 'com.workyoficios.app.test';
const expectedLabel = target === 'production' ? 'Worky Oficios' : 'Worky Prueba';

for (const variant of variants) {
  run('./gradlew', [
    ':app:assembleRelease', '--no-daemon', '--max-workers=1', '--console=plain',
    '--no-parallel',
    `-PreactNativeArchitectures=${variant.architectures.join(',')}`,
    '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=768m -XX:ReservedCodeCacheSize=128m',
    '-Pkotlin.compiler.execution.strategy=in-process',
    // Keep readable stack traces in this diagnostic APK.
    '-Pandroid.enableMinifyInReleaseBuilds=false',
    `-PworkyBuildTarget=${target}`,
    `-PworkyBuildVersionCode=${nextVersionCode}`,
  ], androidRoot);

  run(path.join(sdk, 'build-tools', buildTools, 'apksigner'), ['verify', '--verbose', apk]);
  const packageMetadata = run(aapt, ['dump', 'badging', apk], mobileRoot, true);
  if (!packageMetadata.includes(`name='${expectedPackage}'`) ||
      !packageMetadata.includes(`application-label:'${expectedLabel}'`) ||
      !packageMetadata.includes(`versionCode='${nextVersionCode}'`)) {
    throw new Error(`APK ${variant.fileName} does not match the selected ${target} package, label, and version.`);
  }
  const entries = run('unzip', ['-Z1', apk], mobileRoot, true).split('\n');
  const requiredEntries = [
    'assets/index.android.bundle',
    ...variant.architectures.map((architecture) => `lib/${architecture}/libreactnative.so`),
  ];
  for (const required of requiredEntries) {
    if (!entries.includes(required)) throw new Error(`APK ${variant.fileName} is missing ${required}.`);
  }
  const packagedArchitectures = new Set(
    entries.filter((entry) => entry.startsWith('lib/')).map((entry) => entry.split('/')[1]),
  );
  if (packagedArchitectures.size !== variant.architectures.length ||
      variant.architectures.some((architecture) => !packagedArchitectures.has(architecture))) {
    throw new Error(`APK ${variant.fileName} contains unexpected Android architectures.`);
  }
  const bundle = run('unzip', ['-p', apk, 'assets/index.android.bundle'], mobileRoot, true);
  if (!bundle.includes(origin.host)) {
    throw new Error(`APK bundle does not contain the requested API host: ${origin.host}`);
  }

  const destination = path.join(outputRoot, variant.fileName);
  copyFileSync(apk, destination);
  console.log(`Standalone ${target.toUpperCase()} APK (${variant.architectures.join(', ')}), API ${origin.host}: ${destination}`);
}

writeFileSync(versionFile, `${JSON.stringify({ versionCode: nextVersionCode }, null, 2)}\n`);
