import test from 'node:test';
import assert from 'node:assert/strict';
import { DATOS_TECNICOS_ESTANDAR as backend } from '../src/constants/datos-tecnicos-estandar.ts';
import { DATOS_TECNICOS_ESTANDAR as frontend } from '../../front/src/app/shared/constants/datos-tecnicos-estandar.ts';

// Importa ambas definiciones reales: detecta cambios de claves y de textos,
// sin acoplar las compilaciones de los dos proyectos ni mantener otra copia.
test('frontend y backend comparten exactamente los cuatro estándares técnicos', () => {
  assert.deepEqual(Object.keys(backend).sort(), ['cementacion', 'desarrollo', 'metodo_rocoso', 'metodo_sedimentario']);
  assert.deepEqual(frontend, backend);
});
