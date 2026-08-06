import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const raiz = path.resolve('src/app');
const extensiones = new Set(['.html', '.ts']);
const patrones = [
  /Ã[\u0080-\u00bf]/u,
  /Â[\u0080-\u00bf]/u,
  /â(?:€|€™|€œ|€|€“|€”|€¦)/u,
  /ðŸ/u,
  /�/u,
];
const errores = [];

async function revisarDirectorio(directorio) {
  for (const entrada of await readdir(directorio, { withFileTypes: true })) {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      await revisarDirectorio(ruta);
    } else if (extensiones.has(path.extname(entrada.name)) && !entrada.name.endsWith('.spec.ts')) {
      const contenido = await readFile(ruta, 'utf8');
      contenido.split(/\r?\n/u).forEach((linea, indice) => {
        if (patrones.some((patron) => patron.test(linea))) {
          errores.push(`${path.relative(process.cwd(), ruta)}:${indice + 1}`);
        }
      });
    }
  }
}

await revisarDirectorio(raiz);
if (errores.length > 0) {
  console.error(`Se detectó posible mojibake en:\n${errores.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Comprobación UTF-8 de interfaz correcta.');
}
