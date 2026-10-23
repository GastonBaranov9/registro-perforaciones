import { T05DatosIncorrectos, T05SinPermiso } from '../models/errors.ts';
import type { PoolClient } from 'pg';

export function exigirTextoLitologico(texto: string): void {
  if (['sello sanitario', 'sello_sanitario'].includes(texto.trim().toLowerCase()))
    throw new T05DatosIncorrectos('Sello sanitario es un elemento constructivo; no puede cargarse como litología ni provisional.');
}

export async function exigirLitologiaNoConstructiva(db: Pick<PoolClient, 'query'>, id: number | null | undefined): Promise<void> {
  if (id == null) return;
  const { rows } = await db.query('SELECT codigo FROM catalogo_litologia WHERE id_litologia=$1 FOR SHARE', [id]);
  if (rows[0]?.codigo === 'sello_sanitario')
    throw new T05DatosIncorrectos('Sello sanitario es un elemento constructivo; su id_litologia no puede utilizarse como litología.');
}

// Las ediciones ordinarias no cuentan con el snapshot de la pantalla de pendientes.
// Incluso administración resuelve lo ya observado por ese flujo transaccional.
export function exigirVinculacionDesdePendientes(provisional: string | null | undefined, destino: number | null | undefined): void {
  if (provisional != null && destino != null)
    throw new T05SinPermiso('Un provisional guardado se vincula desde Pendientes por Administración.');
}

export function provisionalParaIntervaloNuevo(data: { material: string; id_litologia?: number | null; litologia_provisional?: string | null }): string | null {
  const provisional = normalizarLitologiaProvisional(data);
  if (provisional != null || data.id_litologia != null) return provisional;
  // Compatibilidad de clientes anteriores: el texto observado es provisional,
  // nunca una identidad de catálogo inferida a partir del nombre.
  return normalizarLitologiaProvisional({ litologia_provisional: data.material });
}

export function normalizarLitologiaProvisional(data: { id_litologia?: number | null; litologia_provisional?: string | null }): string | null {
  if (data.litologia_provisional == null) return null;
  const texto = data.litologia_provisional.trim();
  exigirTextoLitologico(texto);
  if (!texto || texto.length > 160 || data.id_litologia != null)
    throw new T05DatosIncorrectos('Indique una litología de catálogo o un nombre provisional de 1 a 160 caracteres, no ambos.');
  return texto;
}
