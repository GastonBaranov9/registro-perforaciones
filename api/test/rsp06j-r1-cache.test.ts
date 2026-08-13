import assert from 'node:assert/strict';
import test from 'node:test';

test('el contrato del endpoint de mapa protegido exige no-store', async () => {
  const fuente = await (await import('../src/routes/sitios.ts')).default;
  assert.equal(typeof fuente, 'function');
  const texto = (await import('node:fs/promises')).readFile(new URL('../src/routes/sitios.ts', import.meta.url), 'utf8');
  assert.match(await texto, /Cache-Control.*private, no-store/);
  assert.doesNotMatch(await texto, /Cache-Control.*max-age/);
});
