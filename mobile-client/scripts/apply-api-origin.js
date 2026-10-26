// Cordova after_prepare hook: bakes the sync API URL into the built app.
// Source: API_ORIGIN environment variable, else api.config.json. Empty = offline-only build (no sign-in).
// It writes www/js/api-origin.js and adds the origin to the CSP connect-src and the <access> allow-list
// of the *platform copy* only, so the source files never contain an environment-specific URL.
const fs = require('node:fs');
const path = require('node:path');

function resolveOrigin(root) {
  const fromEnv = process.env.API_ORIGIN;
  const fromFile = JSON.parse(fs.readFileSync(path.join(root, 'api.config.json'), 'utf8')).apiOrigin;
  const origin = (fromEnv ?? fromFile ?? '').trim().replace(/\/+$/, '');
  if (origin && !/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    throw new Error(`API origin must be https://host (or http://localhost:port for development), got "${origin}"`);
  }
  return origin;
}

// Android blocks plain HTTP. Development builds that talk to http://localhost (via `adb reverse`) get a
// network-security rule allowing cleartext to localhost only; HTTPS builds have the rule removed again.
function allowLocalhostCleartext(root, p, enable) {
  const manifestPath = path.join(root, p.manifest);
  const attr = ' android:networkSecurityConfig="@xml/network_security_config"';
  let manifest = fs.readFileSync(manifestPath, 'utf8').replace(attr, '');
  const nscPath = path.join(root, p.netSecurity);
  if (enable) {
    fs.writeFileSync(nscPath, '<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n'
      + '  <domain-config cleartextTrafficPermitted="true">\n'
      + '    <domain includeSubdomains="false">localhost</domain>\n'
      + '    <domain includeSubdomains="false">127.0.0.1</domain>\n'
      + '  </domain-config>\n</network-security-config>\n');
    manifest = manifest.replace('<application', `<application${attr}`);
  } else if (fs.existsSync(nscPath)) {
    fs.unlinkSync(nscPath);
  }
  fs.writeFileSync(manifestPath, manifest);
}

module.exports = function applyApiOrigin(context) {
  const root = context.opts.projectRoot;
  const origin = resolveOrigin(root);
  const platformWww = {
    android: {
      www: 'platforms/android/app/src/main/assets/www',
      config: 'platforms/android/app/src/main/res/xml/config.xml',
      manifest: 'platforms/android/app/src/main/AndroidManifest.xml',
      netSecurity: 'platforms/android/app/src/main/res/xml/network_security_config.xml',
    },
  };

  for (const platform of context.opts.platforms || []) {
    const p = platformWww[platform];
    if (!p) continue;
    const www = path.join(root, p.www);

    fs.writeFileSync(path.join(www, 'js', 'api-origin.js'),
      `// Generated at build time by scripts/apply-api-origin.js\nwindow.__API_ORIGIN__ = window.__API_ORIGIN__ || ${JSON.stringify(origin)};\n`);

    if (origin) {
      const indexPath = path.join(www, 'index.html');
      fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace("connect-src 'self'", `connect-src 'self' ${origin}`));

      const configPath = path.join(root, p.config);
      const xml = fs.readFileSync(configPath, 'utf8');
      if (!xml.includes(`<access origin="${origin}"`)) {
        fs.writeFileSync(configPath, xml.replace('</widget>', `    <access origin="${origin}" />\n</widget>`));
      }
    }
    allowLocalhostCleartext(root, p, origin.startsWith('http://'));
    console.log(`[api-origin] ${platform}: ${origin || '(none – offline-only build)'}`);
  }
};
