'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_LINUX_PACKAGES = ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64'];
const PLATFORM_PACKAGE_PATTERN = /^(?:sharp|sharp-libvips)-(win32|darwin|freebsd|linux|linuxmusl)(?:-(x64|arm64|arm|ia32|ppc64|riscv64|s390x))?$/i;

function collectPaths(root) {
  if (!fs.existsSync(root)) return [];
  const paths = [];
  const visited = new Set();
  function walk(current) {
    let stat;
    try { stat = fs.lstatSync(current); } catch { return; }
    if (stat.isSymbolicLink()) return;
    const real = path.resolve(current);
    if (visited.has(real)) return;
    visited.add(real);
    paths.push(current);
    if (!stat.isDirectory()) return;
    let entries;
    try { entries = fs.readdirSync(current); } catch { return; }
    for (const entry of entries) walk(path.join(current, entry));
  }
  walk(root);
  return paths;
}

function packageNames(paths) {
  const names = new Set();
  for (const entry of paths) {
    const normalized = entry.replaceAll('\\', '/');
    const match = normalized.match(/node_modules\/@img\/([^/]+)/);
    if (match) names.add(`@img/${match[1]}`);
  }
  return names;
}

function hasPackage(paths, packageName) {
  const marker = `/node_modules/${packageName}/package.json`;
  return paths.some((entry) => entry.replaceAll('\\', '/').endsWith(marker));
}

function verifyLinuxArtifact({
  root = '.vercel/output',
  platform = process.platform,
  arch = process.arch,
  requireBuildPlatform = true,
  requireSharp = true,
  requireSharpLoad = false,
  cwd = process.cwd(),
} = {}) {
  const resolvedRoot = path.resolve(cwd, root);
  if (!fs.existsSync(resolvedRoot)) throw new Error('Linux artifact guard: artifact root is missing');
  if (requireBuildPlatform && (platform !== 'linux' || arch !== 'x64')) {
    throw new Error('Linux artifact guard: prebuilt Linux runtime must be built on linux-x64');
  }
  const paths = collectPaths(resolvedRoot);
  const packages = packageNames(paths);
  const hasSharp = hasPackage(paths, 'sharp') || [...packages].some((name) => name.startsWith('@img/sharp-'));
  if (requireSharp && !hasSharp) throw new Error('Linux artifact guard: sharp package is missing from the artifact');
  const nativePackages = [...packages].filter((name) => name.startsWith('@img/sharp-'));
  const unsupported = nativePackages.filter((name) => {
    const packageName = name.slice('@img/'.length);
    const match = packageName.match(PLATFORM_PACKAGE_PATTERN);
    if (!match) return false;
    const family = match[1].toLowerCase();
    const packageArch = (match[2] || '').toLowerCase();
    return family !== 'linux' || packageArch !== 'x64';
  });
  if (unsupported.length) throw new Error(`Linux artifact guard: unsupported native packages present (${unsupported.join(', ')})`);
  if (hasSharp) {
    for (const required of EXPECTED_LINUX_PACKAGES) {
      if (!packages.has(required)) throw new Error(`Linux artifact guard: ${required} is missing from the artifact`);
    }
  }
  const windowsNativeFiles = paths.filter((entry) => /(?:^|[\\/])(?:win32|windows)[^\\/]*\.(?:node|dll|lib|exe)$/i.test(entry));
  if (windowsNativeFiles.length) throw new Error('Linux artifact guard: Windows native files are present in the Linux artifact');
  if (requireSharpLoad) {
    let sharp;
    try { sharp = require(require.resolve('sharp', { paths: [cwd] })); } catch { throw new Error('Linux artifact guard: sharp failed to load on the build runner'); }
    if (sharp?.versions?.sharp !== '0.35.4') throw new Error('Linux artifact guard: unexpected sharp version');
  }
  return {
    root: resolvedRoot,
    packageCount: packages.size,
    packages: [...packages].sort(),
    hasSharp,
    unsupported,
    linuxPackages: EXPECTED_LINUX_PACKAGES.filter((name) => packages.has(name)),
    windowsNativeFiles: windowsNativeFiles.length,
  };
}

function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  try {
    const roots = argv.filter((value) => !value.startsWith('--'));
    const result = verifyLinuxArtifact({
      root: roots[0] || '.vercel/output',
      requireSharpLoad: argv.includes('--require-sharp-load'),
    });
    log('LINUX_ARTIFACT_GUARD=PASS');
    log(`LINUX_SHARP_PACKAGE_IN_ARTIFACT=${result.linuxPackages.includes('@img/sharp-linux-x64') ? 'PASS' : 'NOT_REQUIRED'}`);
    log(`LINUX_LIBVIPS_PACKAGE_IN_ARTIFACT=${result.linuxPackages.includes('@img/sharp-libvips-linux-x64') ? 'PASS' : 'NOT_REQUIRED'}`);
    log('WIN32_NATIVE_ARTIFACT=ABSENT');
    if (argv.includes('--require-sharp-load')) log('LINUX_SHARP_LOAD=PASS');
    return 0;
  } catch (reason) {
    error(`Linux artifact preflight failed: ${reason.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { EXPECTED_LINUX_PACKAGES, collectPaths, hasPackage, main, packageNames, verifyLinuxArtifact };
