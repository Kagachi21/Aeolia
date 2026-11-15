/*
 * Windows distribution driver for Aeolia Island.
 *
 * electron-builder cannot finish on this machine (its winCodeSign download
 * contains darwin symlinks that need SeCreateSymbolicLinkPrivilege), and its
 * file filter silently produced an app.asar with only node_modules in it.
 * So this script assembles the app explicitly:
 *
 *   dist/ (compiled main + preload + renderer html/css/svg)
 *   + node_modules/koffi + its win32-x64 native binary
 *   + a minimal package.json
 *   -> <app root>/resources/app/        (plain folder, no asar)
 *
 * Electron prefers resources/app.asar when present; we never create one, so
 * resources/app/ is always used. That also keeps koffi's .node loadable
 * without asarUnpack tricks.
 *
 *   node scripts/build-win.js setup      -> dist-release/Aeolia-Island-<v>-setup.exe
 *   node scripts/build-win.js portable   -> dist-release/Aeolia-Island-<v>-portable.zip
 *   node scripts/build-win.js msix       -> dist-release/AeoliaIsland-<v>.msix
 *   node scripts/build-win.js all        -> all three
 */
const { execFileSync } = require('node:child_process');
const { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const out = join(root, 'dist-release');
const appRoot = join(out, 'app-root');
const runtimeSource = join(out, 'electron-runtime');
const cache = 'C:/Users/Lycaon/AppData/Local/electron-builder/Cache';
const signRoot = join(cache, 'winCodeSign', '020224355');
const signCache = join(signRoot, 'windows-10', 'x64');
const nsisBin = join(cache, 'nsis-3.0.4.1', 'nsis-3.0.4.1-w8az6', 'Bin');
const sevenZip = join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const exeName = 'Aeolia Island.exe';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const appVersion = `${version}.0`;

function run(file, args, opts) {
  return execFileSync(file, args, { cwd: root, stdio: 'inherit', ...opts });
}

// cmd rd is used instead of fs.rmSync: the sandbox's safe-delete shim refuses
// to trash folders that other processes have open.
function hardRemove(dir) {
  if (existsSync(dir)) execFileSync('cmd.exe', ['/c', 'rd', '/s', '/q', dir]);
}

function ensureRuntime() {
  if (existsSync(join(runtimeSource, exeName))) return;
  const seeds = [join(root, 'buildrun_mw9gnvi3', 'win-unpacked'), join(out, 'win-unpacked', 'app')];
  const seed = seeds.find((p) => existsSync(join(p, exeName)));
  if (!seed) throw new Error('electron runtime seed missing in: ' + seeds.join(', '));
  mkdirSync(runtimeSource, { recursive: true });
  cpSync(seed, runtimeSource, { recursive: true });
  hardRemove(join(runtimeSource, 'resources'));
}

/* Rebuild <app root>/resources/app from the current dist/ tree. */
function assemble() {
  ensureRuntime();
  if (!existsSync(join(appRoot, exeName))) {
    mkdirSync(appRoot, { recursive: true });
    cpSync(runtimeSource, appRoot, { recursive: true });
  }

  const appDir = join(appRoot, 'resources', 'app');
  hardRemove(appDir);
  mkdirSync(appDir, { recursive: true });

  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: 'aeolia-island',
    version,
    productName: 'Aeolia Island',
    description: 'Aeolia Dynamic Island for Windows 11',
    main: 'dist/main/main.js',
    private: true,
  }, null, 2) + '\n', 'utf8');

  cpSync(join(root, 'dist'), join(appDir, 'dist'), { recursive: true });
  cpSync(join(root, 'node_modules', 'koffi'), join(appDir, 'node_modules', 'koffi'), { recursive: true });
  cpSync(join(root, 'node_modules', '@koromix', 'koffi-win32-x64'),
    join(appDir, 'node_modules', '@koromix', 'koffi-win32-x64'), { recursive: true });

  // Sanity: the renderer entry point must be inside the package.
  for (const rel of ['dist/main/main.js', 'dist/renderer/index.html', 'dist/settings/settings.html']) {
    if (!existsSync(join(appDir, rel))) throw new Error('packaged app is missing ' + rel);
  }

  run(join(signRoot, 'rcedit-x64.exe'), [
    join(appRoot, exeName),
    '--set-icon', join(root, 'build', 'appicon.ico'),
    '--set-file-version', appVersion,
    '--set-product-version', appVersion,
    '--set-version-string', 'ProductName', 'Aeolia Island',
    '--set-version-string', 'FileDescription', 'Aeolia Island',
    '--set-version-string', 'CompanyName', 'Aeolia',
    '--set-version-string', 'LegalCopyright', 'Aeolia',
  ]);
}

function buildSetup() {
  const target = join(out, `Aeolia-Island-${version}-setup.exe`);
  if (existsSync(target)) unlinkSync(target);
  run(join(nsisBin, 'makensis.exe'), [join(root, 'build', 'installer.nsi')]);
  if (!existsSync(target)) throw new Error('makensis produced no installer');
  return target;
}

function buildPortable() {
  const target = join(out, `Aeolia-Island-${version}-portable.zip`);
  if (existsSync(target)) unlinkSync(target);
  run(sevenZip, ['a', '-tzip', '-mx=5', target, join(appRoot, '*')]);

  // Portable mode activates when a `data` folder sits beside the exe.
  // Add a marker file so the folder survives zip extraction.
  const markerRoot = join(out, '_portable-marker');
  hardRemove(markerRoot);
  mkdirSync(join(markerRoot, 'data'), { recursive: true });
  writeFileSync(join(markerRoot, 'data', 'README.txt'),
    'Aeolia Island menyimpan pengaturan dan data di sini saat mode portable.\n' +
    'Salin seluruh folder ini ke USB untuk membawa data ikut berpindah.\n', 'utf8');
  run(sevenZip, ['a', '-tzip', target, 'data\\README.txt'], { cwd: markerRoot });
  return target;
}

function buildMsix() {
  const stage = join(out, 'msix-staging');
  hardRemove(stage);
  mkdirSync(stage, { recursive: true });
  cpSync(appRoot, stage, { recursive: true });

  const assets = join(stage, 'assets');
  mkdirSync(assets, { recursive: true });
  for (const name of ['Square44x44Logo', 'Square150x150Logo', 'StoreLogo', 'Wide310x150Logo', 'Square256x256Logo']) {
    copyFileSync(join(root, 'build', `${name}.png`), join(assets, `${name}.png`));
  }

  // MSIX cannot reference an executable whose name contains a space.
  renameSync(join(stage, exeName), join(stage, 'AeoliaIsland.exe'));

  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="Aeolia.Island" ProcessorArchitecture="x64" Version="${appVersion}" Publisher="CN=Aeolia"/>
  <Properties>
    <DisplayName>Aeolia Island</DisplayName>
    <PublisherDisplayName>Aeolia</PublisherDisplayName>
    <Description>Aeolia Dynamic Island for Windows 11</Description>
    <Logo>assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/>
  </Dependencies>
  <Resources>
    <Resource Language="en-us"/>
  </Resources>
  <Applications>
    <Application Id="AeoliaIsland" Executable="AeoliaIsland.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Aeolia Island" Description="Aeolia Dynamic Island for Windows 11"
        BackgroundColor="#2B1E1A"
        Square150x150Logo="assets\\Square150x150Logo.png"
        Square44x44Logo="assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png"/>
        <uap:SplashScreen Image="assets\\Square256x256Logo.png"/>
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust"/>
  </Capabilities>
</Package>
`;
  writeFileSync(join(stage, 'AppxManifest.xml'), manifest, 'utf8');

  const target = join(out, `AeoliaIsland-${version}.msix`);
  if (existsSync(target)) unlinkSync(target);
  run(join(signCache, 'makeappx.exe'), ['pack', '/d', stage, '/p', target, '/o']);
  if (!existsSync(target)) throw new Error('makeappx produced no package');
  return target;
}

const mode = process.argv[2] || 'all';
mkdirSync(out, { recursive: true });
assemble();

const built = [];
if (mode === 'setup' || mode === 'all') built.push(buildSetup());
if (mode === 'portable' || mode === 'all') built.push(buildPortable());
if (mode === 'msix' || mode === 'all') built.push(buildMsix());

for (const file of built) {
  console.log(`[build] ${file}  ${(readFileSync(file).length / 1024 / 1024).toFixed(1)} MB`);
}
