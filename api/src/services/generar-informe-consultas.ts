import { myPool } from "../db/pool.ts";
import type { IntervaloPerfilLitologico } from "../pdf/perfil-litologico.ts";

export interface ReportePozo {
  sello_sanitario_constructivo?: import('../models/schemas.ts').SelloSanitarioConstructivo | null;
  id_pozo: number;
  numero_perforacion?: number | null;
  origen?: "normal" | "historico";
  propietario: string | null;
  propietario_documento_rut?: string | null;
  propietario_telefono?: string | null;
  propietario_email?: string | null;
  empresa: string | null;
  perforador: string | null;
  sitio: string | null;
  departamento?: string | null;
  localidad?: string | null;
  latitud?: string | null;
  longitud?: string | null;
  padron?: string | null;
  fecha_inicio: string | Date | null;
  fecha_fin: string | Date | null;
  profundidad_final_m: number | null;
  sello_sanitario?: boolean | null;
  pre_filtro?: string | null;
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
    sin_tuberia?: boolean;
  }[];
  filtros?: { desde_m:number; hasta_m:number; diametro_pulg:number; material_tuberia:"PVC"|"Acero"; ranura_mm?:number|null }[];
  niveles_aporte: { profundidad_m: number }[];
}

type CampoNumericoReporte = "id_pozo" | "numero_perforacion" | "profundidad_final_m"
  | "nivel_estatico_m" | "nivel_dinamico_m" | "caudal_estimado_lh";
type FilaReportePozo = Omit<ReportePozo, CampoNumericoReporte | "litologia" | "diametros" | "filtros" | "niveles_aporte">
  & { id_pozo: number | string }
  & { [K in Exclude<CampoNumericoReporte, "id_pozo">]: number | string | null };

export async function getReportePozo(
  id_pozo: number,
  db: Pick<typeof myPool, "query"> = myPool,
): Promise<ReportePozo | null> {
  const sql = `
    SELECT
      p.id_pozo, p.numero_perforacion, p.origen,
      (SELECT json_build_object('desde_m',ss.desde_m,'hasta_m',ss.hasta_m)
       FROM public.sello_sanitario_pozo ss WHERE ss.id_pozo=p.id_pozo) AS sello_sanitario_constructivo,
      COALESCE(prop.nombre, p.propietario_provisional) AS propietario,
      prop.documento_rut AS propietario_documento_rut,
      prop.telefono AS propietario_telefono,
      prop.propietario_email AS propietario_email,
      p.empresa AS empresa,
      COALESCE(perf.nombre,p.perforador_provisional) AS perforador,
      s.departamento || COALESCE(' - ' || s.localidad, '') AS sitio,
      s.departamento,
      s.localidad,
      s.latitud,
      s.longitud,
      s.padron,
      p.fecha_inicio,
      p.fecha_fin,
      p.profundidad_final_m,
      p.sello_sanitario,
      p.pre_filtro,
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
      LEFT JOIN public.usuario prop ON prop.id_usuario = p.id_propietario
      LEFT JOIN public.usuario perf ON perf.id_usuario = p.id_perforador
      LEFT JOIN public.sitio s ON s.id_sitio = p.id_sitio
      LEFT JOIN public.documento doc ON doc.id_pozo = p.id_pozo
    WHERE p.id_pozo = $1;
  `;

  const { rows } = await db.query<FilaReportePozo>(sql, [id_pozo]);
  if (rows.length === 0) return null;

  const pozo = rows[0];

  const litologiaSql = `
    SELECT i.desde_m,i.hasta_m,COALESCE(c.nombre,i.litologia_provisional,i.material) AS material,i.id_litologia,c.codigo AS litologia_codigo,c.nombre AS litologia_nombre,c.color AS litologia_color,c.patron AS litologia_patron,c.activo AS litologia_activa
    FROM public.intervalo_litologico i LEFT JOIN public.catalogo_litologia c ON c.id_litologia=i.id_litologia
    WHERE i.id_pozo = $1 ORDER BY i.desde_m;
  `;

  const { rows: litRows } = await db.query(litologiaSql, [id_pozo]);

  const diamSql = `
    SELECT desde_m, hasta_m, diametro_pulg, material_tuberia, sin_tuberia
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
    numero_perforacion: numeroNullable(pozo.numero_perforacion),
    profundidad_final_m: numeroNullable(pozo.profundidad_final_m),
    nivel_estatico_m: numeroNullable(pozo.nivel_estatico_m),
    nivel_dinamico_m: numeroNullable(pozo.nivel_dinamico_m),
    caudal_estimado_lh: numeroNullable(pozo.caudal_estimado_lh),
    litologia: (litRows as Record<string, unknown>[]).map((l) => ({
      desde_m: Number(l.desde_m),
      hasta_m: Number(l.hasta_m),
      material: String(l.material),
      litologia_codigo: l.litologia_codigo == null ? null : String(l.litologia_codigo),
      id_litologia:l.id_litologia==null?null:Number(l.id_litologia),litologia_nombre:l.litologia_nombre==null?null:String(l.litologia_nombre),litologia_color:l.litologia_color==null?null:String(l.litologia_color),litologia_patron:l.litologia_patron==null?null:String(l.litologia_patron) as import("../pdf/perfil-litologico.ts").PatronCatalogoLitologia|null,litologia_activa:l.litologia_activa==null?null:Boolean(l.litologia_activa),
    })),
    diametros: (diamRows as Record<string, unknown>[]).map((d) => ({
      desde_m: Number(d.desde_m),
      hasta_m: Number(d.hasta_m),
      diametro_pulg: Number(d.diametro_pulg),
      material_tuberia: d.material_tuberia == null ? null : String(d.material_tuberia) as "PVC" | "Acero",
      sin_tuberia: d.sin_tuberia === true,
    })),
    filtros: (filtroRows as Record<string, unknown>[]).map((f) => ({ desde_m:Number(f.desde_m),hasta_m:Number(f.hasta_m),diametro_pulg:Number(f.diametro_pulg),material_tuberia:String(f.material_tuberia) as "PVC"|"Acero",ranura_mm:f.ranura_mm==null?null:Number(f.ranura_mm) })),

    niveles_aporte: (aporteRows as Record<string, unknown>[]).map((a) => ({
      profundidad_m: Number(a.profundidad_m),
    })),
  };
}

function numeroNullable(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : Number(valor);
}
