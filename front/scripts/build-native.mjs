import { spawnSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProductionAppId,
  deriveNativeWebsocketOrigin,
  validateNativeBackendOrigin,
} from './native-backend-config.mjs';
import { validateNativeStyleDelivery } from './native-style-contract.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
const origin = validateNativeBackendOrigin(process.env.NATIVE_BACKEND_ORIGIN, mode);
const websocketOrigin = deriveNativeWebsocketOrigin(origin);
const environmentPath = join(frontRoot, 'src', 'environments', 'environment.native.generated.ts');
const indexPath = join(frontRoot, 'src', 'index.native.generated.html');
const angularCli = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));

if (mode === 'production') {
  assertProductionAppId(await readFile(join(frontRoot, 'capacitor.config.ts'), 'utf8'));
}

const environmentSource = `export const environment = {
  serverURL: ${JSON.stringify(`${origin}/api`)},
  apiURL: ${JSON.stringify(`${origin}/api/`)},
  wsUrl: '',
  nativeBackendOrigin: ${JSON.stringify(origin)},
  nativeBuildMode: ${JSON.stringify(mode)} as const,
};
`;

const csp = [
  "default-src 'self' data: blob:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${origin}`,
  "font-src 'self' data:",
  `connect-src 'self' ${origin} ${websocketOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

const indexSource = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Registro de perforaciones</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content=${JSON.stringify(csp)}>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
  <noscript>Debes habilitar JavaScript para usar esta aplicación.</noscript>
</body>
</html>
`;

try {
  await writeFile(environmentPath, environmentSource, { encoding: 'utf8', flag: 'wx' });
  await writeFile(indexPath, indexSource, { encoding: 'utf8', flag: 'wx' });
  const result = spawnSync(
    process.execPath,
    [angularCli, 'build', `--configuration=native-${mode}`],
    { cwd: frontRoot, env: process.env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    const outputPath = join(frontRoot, 'dist', 'front', 'browser');
    const outputIndex = await readFile(join(outputPath, 'index.html'), 'utf8');
    const stylesheetNames = (await readdir(outputPath)).filter((name) =>
      /^styles(?:-[^.]+)?\.css$/i.test(name),
    );
    const stylesheetCss = (
      await Promise.all(
        stylesheetNames.map((name) => readFile(join(outputPath, name), 'utf8')),
      )
    ).join('\n');
    const contract = validateNativeStyleDelivery(outputIndex, stylesheetCss);
    console.log(`Contrato CSS nativo validado: ${contract.stylesheetHref}`);
  }
} finally {
  await Promise.all([
    rm(environmentPath, { force: true }),
    rm(indexPath, { force: true }),
  ]);
}
