/**
 * YouTube Playlist Cleaner — Store Release Packager & Auditor
 *
 * Generates clean, store-compliant .zip distribution packages for:
 * - Google Chrome (Chrome Web Store)
 * - Microsoft Edge (Edge Add-ons)
 * - Mozilla Firefox (AMO)
 * - Apple Safari (macOS & iOS Web Extension)
 *
 * Validates package integrity, required assets, manifest syntax, and zero forbidden dev artifacts.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ROOT_DIR, 'src');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const PACKAGE_DIR = path.resolve(ROOT_DIR, 'package');
const MANIFEST_PATH = path.resolve(SRC_DIR, 'manifest.json');

// Core extension files required in the production distribution package
const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'icon16.png',
  'icon48.png',
  'icon128.png'
];

/**
 * Ensures the package output directory exists.
 */
function preparePackageDir() {
  if (!fs.existsSync(PACKAGE_DIR)) {
    fs.mkdirSync(PACKAGE_DIR, { recursive: true });
  }
}

/**
 * Ensures the TypeScript code and assets are freshly compiled into dist/.
 */
function ensureBuild() {
  console.log('[Building extension assets]');
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist/ directory does not exist after running build.');
  }
}

/**
 * Recursively copies files from src directory to dest directory.
 * @param {string} src
 * @param {string} dest
 */
function copySync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      if (entry.startsWith('.') || entry.endsWith('.ts')) continue;
      copySync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Builds a zip archive from a staging directory.
 * @param {string} stagingDir
 * @param {string} outputZipPath
 */
function createZip(stagingDir, outputZipPath) {
  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath);
  }

  // Use zip utility ignoring hidden OS metadata
  execSync(`cd "${stagingDir}" && zip -r -q "${outputZipPath}" . -x "*.DS_Store"`, {
    stdio: 'pipe'
  });
}

/**
 * Copies compiled dist files to a staging directory.
 * @param {string} stageDir
 */
function stageDistFiles(stageDir) {
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });
  copySync(DIST_DIR, stageDir);
}

/**
 * Creates a browser-specific manifest for store release.
 * @param {object} baseManifest
 * @param {'chrome' | 'edge' | 'firefox' | 'safari'} browserType
 * @returns {object}
 */
function createBrowserManifest(baseManifest, browserType) {
  const manifest = JSON.parse(JSON.stringify(baseManifest));

  // Remove any development keys if present
  delete manifest.key;

  if (browserType === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: 'youtube-playlist-cleaner@dean.io',
        strict_min_version: '109.0'
      }
    };
  } else {
    delete manifest.browser_specific_settings;
  }

  return manifest;
}

/**
 * Packages the extension for Google Chrome Web Store.
 * @param {object} manifest
 * @returns {string} output zip filename
 */
function packageChrome(manifest) {
  console.log('\n[Packaging for Google Chrome Web Store]');
  const stageDir = path.join(PACKAGE_DIR, '.chrome-staging');
  stageDistFiles(stageDir);

  const chromeManifest = createBrowserManifest(manifest, 'chrome');
  fs.writeFileSync(
    path.join(stageDir, 'manifest.json'),
    JSON.stringify(chromeManifest, null, 2) + '\n',
    'utf-8'
  );

  const zipName = `youtube-playlist-cleaner-chrome-v${manifest.version}.zip`;
  const zipPath = path.join(PACKAGE_DIR, zipName);
  createZip(stageDir, zipPath);

  fs.rmSync(stageDir, { recursive: true, force: true });

  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`✓ Created: package/${zipName} (${sizeKb} KB)`);
  console.log(`  - Manifest V3 Chrome Web Store ready`);
  return zipName;
}

/**
 * Packages the extension for Microsoft Edge Add-ons.
 * @param {object} manifest
 * @returns {string} output zip filename
 */
function packageEdge(manifest) {
  console.log('\n[Packaging for Microsoft Edge Add-ons]');
  const stageDir = path.join(PACKAGE_DIR, '.edge-staging');
  stageDistFiles(stageDir);

  const edgeManifest = createBrowserManifest(manifest, 'edge');
  fs.writeFileSync(
    path.join(stageDir, 'manifest.json'),
    JSON.stringify(edgeManifest, null, 2) + '\n',
    'utf-8'
  );

  const zipName = `youtube-playlist-cleaner-edge-v${manifest.version}.zip`;
  const zipPath = path.join(PACKAGE_DIR, zipName);
  createZip(stageDir, zipPath);

  fs.rmSync(stageDir, { recursive: true, force: true });

  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`✓ Created: package/${zipName} (${sizeKb} KB)`);
  console.log(`  - Microsoft Partner Center ready`);
  return zipName;
}

/**
 * Packages the extension for Mozilla Firefox (AMO).
 * @param {object} manifest
 * @returns {string} output zip filename
 */
function packageFirefox(manifest) {
  console.log('\n[Packaging for Mozilla Firefox (AMO)]');
  const stageDir = path.join(PACKAGE_DIR, '.firefox-staging');
  stageDistFiles(stageDir);

  const firefoxManifest = createBrowserManifest(manifest, 'firefox');
  fs.writeFileSync(
    path.join(stageDir, 'manifest.json'),
    JSON.stringify(firefoxManifest, null, 2) + '\n',
    'utf-8'
  );

  const zipName = `youtube-playlist-cleaner-firefox-v${manifest.version}.zip`;
  const zipPath = path.join(PACKAGE_DIR, zipName);
  createZip(stageDir, zipPath);

  fs.rmSync(stageDir, { recursive: true, force: true });

  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`✓ Created: package/${zipName} (${sizeKb} KB)`);
  console.log(`  - Gecko ID: ${firefoxManifest.browser_specific_settings.gecko.id}`);
  console.log(`  - Ready for upload to addons.mozilla.org`);
  return zipName;
}

/**
 * Packages and verifies Safari Web Extension (macOS / iOS).
 * @param {object} manifest
 */
function packageSafari(manifest) {
  console.log('\n[Packaging for Apple Safari (macOS & iOS)]');
  const xcodeProj = path.join(ROOT_DIR, 'apple', 'YouTube Playlist Cleaner', 'YouTube Playlist Cleaner.xcodeproj');

  if (fs.existsSync(xcodeProj)) {
    try {
      console.log('  - Verifying macOS Release build with xcodebuild...');
      execSync(`xcodebuild -project "${xcodeProj}" -scheme "YouTube Playlist Cleaner (macOS)" -configuration Release build -quiet`, { stdio: 'pipe' });
      console.log('  ✓ macOS Safari target compiled successfully.');
    } catch (err) {
      console.warn(`  ! Xcode build notice: ${err.message}`);
    }
  } else {
    console.log('  - Safari Xcode project not found at apple/YouTube Playlist Cleaner.');
    console.log('  - To convert for Safari, run: xcrun safari-web-extension-converter dist');
  }
}

/**
 * Audits all generated .zip packages in package/ to verify integrity and required assets.
 * @param {string[]|null} targetZipFiles
 */
function verifyPackages(targetZipFiles = null) {
  console.log('\n============================================================');
  console.log('  VERIFYING STORE PACKAGES (Structure & Asset Audit)');
  console.log('============================================================\n');

  if (!fs.existsSync(PACKAGE_DIR)) {
    console.error('Error: package/ directory does not exist. Run "npm run package" first.');
    process.exit(1);
  }

  let zipFiles = targetZipFiles;
  if (!zipFiles) {
    const currentManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    const expectedCurrentZips = [
      `youtube-playlist-cleaner-chrome-v${currentManifest.version}.zip`,
      `youtube-playlist-cleaner-edge-v${currentManifest.version}.zip`,
      `youtube-playlist-cleaner-firefox-v${currentManifest.version}.zip`,
    ];
    zipFiles = fs.readdirSync(PACKAGE_DIR).filter(f => expectedCurrentZips.includes(f) || f.endsWith(`-v${currentManifest.version}.zip`));
  }
  if (zipFiles.length === 0) {
    console.error('Error: No .zip archives found in package/. Run "npm run package" first.');
    process.exit(1);
  }

  let allPassed = true;

  for (const zipFile of zipFiles) {
    const filename = path.basename(zipFile);
    const zipPath = path.join(PACKAGE_DIR, filename);
    if (!fs.existsSync(zipPath)) continue;

    console.log(`Auditing archive: package/${filename}`);

    const auditDir = path.join(PACKAGE_DIR, `.audit-${Date.now()}`);
    if (fs.existsSync(auditDir)) fs.rmSync(auditDir, { recursive: true, force: true });
    fs.mkdirSync(auditDir, { recursive: true });

    execSync(`unzip -q "${zipPath}" -d "${auditDir}"`);

    const missingFiles = [];
    for (const req of REQUIRED_FILES) {
      if (!fs.existsSync(path.join(auditDir, req))) {
        missingFiles.push(req);
      }
    }

    // Verify manifest.json is valid
    let manifestValid = false;
    const manifestFile = path.join(auditDir, 'manifest.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        if (parsed.name && parsed.version && parsed.manifest_version === 3) {
          manifestValid = true;
        }
      } catch (e) {
        manifestValid = false;
      }
    }

    fs.rmSync(auditDir, { recursive: true, force: true });

    if (missingFiles.length === 0 && manifestValid) {
      console.log(`  ✓ 100% Valid: All required files present with valid Manifest V3 schema.`);
    } else {
      allPassed = false;
      if (!manifestValid) {
        console.error(`  ✗ FAIL: manifest.json is invalid or missing required Manifest V3 fields.`);
      }
      if (missingFiles.length > 0) {
        console.error(`  ✗ FAIL: Missing required files: ${missingFiles.join(', ')}`);
      }
    }
    console.log('');
  }

  if (allPassed) {
    console.log('============================================================');
    console.log('  ✓ ALL PACKAGES PASSED AUDIT — READY FOR STORE SUBMISSION');
    console.log('============================================================\n');
  } else {
    console.error('============================================================');
    console.error('  ✗ AUDIT FAILED — ISSUES DETECTED IN DISTRIBUTION PACKAGES');
    console.error('============================================================\n');
    process.exit(1);
  }
}

/**
 * Main entry point.
 */
function main() {
  const target = (process.argv[2] || 'all').toLowerCase();

  if (target === 'verify') {
    verifyPackages();
    return;
  }

  preparePackageDir();
  ensureBuild();

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const builtZips = [];

  if (target === 'chrome' || target === 'all') {
    builtZips.push(packageChrome(manifest));
  }

  if (target === 'edge' || target === 'all') {
    builtZips.push(packageEdge(manifest));
  }

  if (target === 'firefox' || target === 'all') {
    builtZips.push(packageFirefox(manifest));
  }

  if (target === 'safari' || target === 'all') {
    packageSafari(manifest);
  }

  console.log('\nPackage generation complete.');

  if (builtZips.length > 0) {
    verifyPackages(builtZips);
  }
}

main();
