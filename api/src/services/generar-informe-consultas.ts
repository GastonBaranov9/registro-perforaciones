import { myPool } from "../db/pool.ts";
import type { IntervaloPerfilLitologico } from "../pdf/perfil-litologico.ts";

export interface ReportePozo {
  id_pozo: number;
  propietario: string;
  propietario_documento_rut?: string | null;
  propietario_telefono?: string | null;
  propietario_email?: string | null;
  empresa: string;
  perforador: string;
  sitio: string;
  departamento?: string;
  localidad?: string | null;
  latitud?: string | null;
  longitud?: string | null;
  padron?: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  profundidad_final_m: number | null;
  nivel_estatico_m: number | null;
  nivel_dinamico_m: number | null;
  caudal_estimado_lh: number | null;
  metodo_sedimentario: string | null;
  metodo_rocoso: string | null;
  cementacion: string | null;
  desarrollo: string | null;
  revestimiento?: string | null;
  introduccion: string | null;
  nombre_archivo: string | null;
  litologia: Array<IntervaloPerfilLitologico & Record<string, unknown>>;
  foto_url: string | null;
  diametros: {
    desde_m: number;
    hasta_m: number;
    diametro_pulg: number;
    material_tuberia: "PVC" | "Acero" | null;
  }[];
  filtros?: { desde_m:number; hasta_m:number; diametro_pulg:number; material_tuberia:"PVC"|"Acero"; ranura_mm?:number|null }[];
  niveles_aporte: { profundidad_m: number }[];
}

export async function getReportePozo(
  id_pozo: number,
  db: Pick<typeof myPool, "query"> = myPool,
): Promise<ReportePozo | null> {
  const sql = `
    SELECT
      p.id_pozo,
      prop.nombre AS propietario,
      prop.documento_rut AS propietario_documento_rut,
      prop.telefono AS propietario_telefono,
      prop.propietario_email AS propietario_email,
      p.empresa AS empresa,
      perf.nombre AS perforador,
      s.departamento || COALESCE(' - ' || s.localidad, '') AS sitio,
      s.departamento,
      s.localidad,
      s.latitud,
      s.longitud,
      s.padron,
      p.fecha_inicio,
      p.fecha_fin,
      p.profundidad_final_m,
      p.nivel_estatico_m,
      p.nivel_dinamico_m,
      p.caudal_estimado_lh,
      p.metodo_sedimentario,
      p.metodo_rocoso,
      p.cementacion AS cementacion,
      p.desarrollo AS desarrollo,
      p.revestimiento,
      NULL::text AS introduccion,  
      doc.nombre_archivo,
      p.foto_url 
    FROM public.pozo p
      JOIN public.usuario prop ON prop.id_usuario = p.id_propietario
      JOIN public.usuario perf ON perf.id_usuario = p.id_perforador
      JOIN public.sitio s ON s.id_sitio = p.id_sitio
      LEFT JOIN public.documento doc ON doc.id_pozo = p.id_pozo
    WHERE p.id_pozo = $1;
  `;

  const { rows } = await db.query(sql, [id_pozo]);
  if (rows.length === 0) return null;

  const pozo = rows[0] as Record<string, unknown>;

  const litologiaSql = `
    SELECT i.desde_m,i.hasta_m,i.material,i.id_litologia,c.nombre AS litologia_nombre,c.color AS litologia_color,c.patron AS litologia_patron,c.activo AS litologia_activa
    FROM public.intervalo_litologico i LEFT JOIN public.catalogo_litologia c ON c.id_litologia=i.id_litologia
    WHERE i.id_pozo = $1 ORDER BY i.desde_m;
  `;

  const { rows: litRows } = await db.query(litologiaSql, [id_pozo]);

  const diamSql = `
    SELECT desde_m, hasta_m, diametro_pulg, material_tuberia
    FROM public.intervalo_diametro_perforacion
    WHERE id_pozo = $1
    ORDER BY desde_m;
  `;
  const { rows: diamRows } = await db.query(diamSql, [id_pozo]);
  const { rows: filtroRows } = await db.query(`SELECT desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm FROM public.intervalo_filtro WHERE id_pozo=$1 ORDER BY desde_m`, [id_pozo]);

  const aporteSql = `
    SELECT profundidad_m
    FROM public.nivel_aporte
    WHERE id_pozo = $1
    ORDER BY profundidad_m;
  `;
  const { rows: aporteRows } = await db.query(aporteSql, [id_pozo]);

  return {
    ...pozo,
    id_pozo: Number(pozo.id_pozo),
    profundidad_final_m: numeroNullable(pozo.profundidad_final_m),
    nivel_estatico_m: numeroNullable(pozo.nivel_estatico_m),
    nivel_dinamico_m: numeroNullable(pozo.nivel_dinamico_m),
    caudal_estimado_lh: numeroNullable(pozo.caudal_estimado_lh),
    litologia: (litRows as Record<string, unknown>[]).map((l) => ({
      desde_m: Number(l.desde_m),
      hasta_m: Number(l.hasta_m),
      material: l.material,
      id_litologia:l.id_litologia==null?null:Number(l.id_litologia),litologia_nombre:l.litologia_nombre==null?null:String(l.litologia_nombre),litologia_color:l.litologia_color==null?null:String(l.litologia_color),litologia_patron:l.litologia_patron==null?null:String(l.litologia_patron) as import("../pdf/perfil-litologico.ts").PatronCatalogoLitologia|null,litologia_activa:l.litologia_activa==null?null:Boolean(l.litologia_activa),
    })),
    diametros: (diamRows as Record<string, unknown>[]).map((d) => ({
      desde_m: Number(d.desde_m),
      hasta_m: Number(d.hasta_m),
      diametro_pulg: Number(d.diametro_pulg),
      material_tuberia: d.material_tuberia == null ? null : String(d.material_tuberia) as "PVC" | "Acero",
    })),
    filtros: (filtroRows as Record<string, unknown>[]).map((f) => ({ desde_m:Number(f.desde_m),hasta_m:Number(f.hasta_m),diametro_pulg:Number(f.diametro_pulg),material_tuberia:String(f.material_tuberia) as "PVC"|"Acero",ranura_mm:f.ranura_mm==null?null:Number(f.ranura_mm) })),

    niveles_aporte: (aporteRows as Record<string, unknown>[]).map((a) => ({
      profundidad_m: Number(a.profundidad_m),
    })),
  } as ReportePozo;
}

function numeroNullable(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : Number(valor);
}
