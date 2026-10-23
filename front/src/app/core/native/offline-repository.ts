import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, type FilesystemPlugin } from '@capacitor/filesystem';
import type { DatosTecnicosBorrador, NuevoPozo, PozoCompletoResultado, SitioBody } from '../../shared/types/schemas';

export interface BorradorLocal {
  epoca?: string;
  epocaRetirada?: boolean;
  id: string; usuario: number; estado: 'pendiente' | 'sincronizando' | 'sincronizado' | 'error' | 'conflicto';
  pozo: NuevoPozo; sitio: SitioBody; tecnicos: DatosTecnicosBorrador;
  foto?: { ruta: string; tipo: 'image/jpeg' | 'image/png' };
  fotoPendiente?: boolean;
  enviado?: boolean; error?: string; resultado?: PozoCompletoResultado;
  // Local identity never changes. A replacement operation is only authorized by
  // the server's durable closed-without-creation receipt for the previous key.
  claveOperacion?: string;
  requiereCorreccion?: boolean;
}
export type OfflineFiles = Pick<FilesystemPlugin, 'mkdir' | 'readFile' | 'writeFile' | 'rename' | 'readdir' | 'deleteFile' | 'stat' | 'getUri' | 'rmdir'>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const revision = /^revision-\d{12}\.json$/;

/** A display state alone never authorizes forgetting an uncertain operation. */
export function eliminacionLocal(draft: BorradorLocal): 'borrador' | 'copia' | null {
  if (draft.epocaRetirada) return 'borrador';
  if (draft.estado === 'sincronizado' && draft.resultado?.pozo?.id_pozo && draft.resultado.pozo.numero_perforacion) return 'copia';
  if (draft.enviado || draft.estado === 'sincronizando' || draft.estado === 'sincronizado' || draft.resultado) return null;
  return 'borrador';
}

/** Immutable revisions: never overwrite the last committed metadata or image. */
export class OfflineRepository {
  constructor(private fs: OfflineFiles, private root: string, private usuario: number) {}
  private path(id: string) {
    if (!uuid.test(id)) throw new Error('Identificador local inválido.');
    return `${this.root}/${id}`;
  }
  async init() {
    try { await this.fs.mkdir({ directory: Directory.Data, path: this.root, recursive: true }); }
    catch { await this.fs.readdir({ directory: Directory.Data, path: this.root }); }
  }
  async epoca(): Promise<string | undefined> {
    try {
      const file = await this.fs.readFile({ directory: Directory.Data, path: `${this.root}/epoca.json`, encoding: Encoding.UTF8 });
      const value = JSON.parse(String(file.data)).epoca;
      return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
    } catch { return undefined; }
  }
  async guardarEpoca(epoca: string): Promise<void> {
    await this.init();
    const temp = `${this.root}/epoca.tmp`;
    await this.fs.writeFile({ directory: Directory.Data, path: temp, data: JSON.stringify({ epoca }), encoding: Encoding.UTF8 });
    await this.fs.rename({ directory: Directory.Data, from: temp, to: `${this.root}/epoca.json` });
  }
  async list(): Promise<BorradorLocal[]> {
    await this.init();
    const entries = await this.fs.readdir({ directory: Directory.Data, path: this.root });
    for (const entry of entries.files.filter(e => e.name.startsWith('deleted-') && uuid.test(e.name.slice(8)))) {
      try { await this.fs.rmdir({ directory: Directory.Data, path: `${this.root}/${entry.name}`, recursive: true }); } catch { /* retry next load */ }
    }
    const drafts: BorradorLocal[] = [];
    for (const entry of entries.files.filter(e => uuid.test(e.name))) {
      const files = await this.fs.readdir({ directory: Directory.Data, path: this.path(entry.name) });
      // A process killed before its first atomic commit has no saved draft.
      if (files.files.some(f => revision.test(f.name))) drafts.push(await this.read(entry.name));
    }
    return drafts;
  }
  async read(id: string): Promise<BorradorLocal> {
    const versions = await this.revisions(id);
    if (!versions.length) throw new Error('No hay una revisión guardada del borrador.');
    const file = await this.fs.readFile({ directory: Directory.Data, path: `${this.path(id)}/${versions.at(-1)}`, encoding: Encoding.UTF8 });
    const draft = JSON.parse(String(file.data)) as BorradorLocal;
    if (draft.id !== id || draft.usuario !== this.usuario) throw new Error('El borrador no pertenece a este usuario.');
    if (draft.foto) this.photoPath(draft);
    return draft;
  }
  async write(draft: BorradorLocal): Promise<void> {
    if (draft.usuario !== this.usuario || draft.pozo.numero_perforacion != null) throw new Error('Borrador local inválido.');
    if (draft.foto) this.photoPath(draft);
    const dir = this.path(draft.id);
    try { await this.fs.mkdir({ directory: Directory.Data, path: dir, recursive: true }); }
    catch { await this.fs.readdir({ directory: Directory.Data, path: dir }); }
    const temp = `${dir}/${crypto.randomUUID()}.tmp`;
    const versions = await this.revisions(draft.id);
    if (versions.length && (await this.read(draft.id)).epoca !== draft.epoca)
      throw new Error('La etapa del borrador es inmutable. No se puede convertir un borrador antiguo.');
    const next = versions.length ? Number(versions.at(-1)!.slice(9, 21)) + 1 : 1;
    const committed = `${dir}/revision-${String(next).padStart(12, '0')}.json`;
    await this.fs.writeFile({ directory: Directory.Data, path: temp, data: JSON.stringify(draft), encoding: Encoding.UTF8 });
    await this.fs.rename({ directory: Directory.Data, from: temp, to: committed });
    // Keep the current and previous revisions. Cleanup failure cannot invalidate a saved draft.
    const obsoletePhotos = new Set<string>();
    for (const old of versions.slice(0, -1)) {
      try {
        const metadata = await this.fs.readFile({ directory: Directory.Data, path: `${dir}/${old}`, encoding: Encoding.UTF8 });
        const previous = JSON.parse(String(metadata.data)) as BorradorLocal;
        if (previous.id !== draft.id) throw new Error('Revisión inválida');
        if (previous.foto) obsoletePhotos.add(this.photoPath(previous));
        await this.fs.deleteFile({ directory: Directory.Data, path: `${dir}/${old}` });
      } catch { /* cleanup cannot invalidate a saved draft */ }
    }
    await this.cleanSupersededPhotos(draft.id, obsoletePhotos);
  }
  private async cleanSupersededPhotos(id: string, candidates: Set<string>) {
    try {
      for (const name of await this.revisions(id)) {
        const metadata = await this.fs.readFile({ directory: Directory.Data, path: `${this.path(id)}/${name}`, encoding: Encoding.UTF8 });
        const retained = JSON.parse(String(metadata.data)) as BorradorLocal;
        if (retained.id !== id) throw new Error('Revisión inválida');
        if (retained.foto) candidates.delete(this.photoPath(retained));
      }
      // Only photos from superseded committed revisions, never pending/orphan files.
      for (const ruta of candidates) await this.fs.deleteFile({ directory: Directory.Data, path: ruta });
    } catch { /* retain on any uncertainty */ }
  }
  private photoPath(draft: BorradorLocal): string {
    const prefix = `${this.path(draft.id)}/photo-`;
    const ruta = draft.foto?.ruta;
    if (draft.usuario !== this.usuario || !ruta?.startsWith(prefix) || !uuid.test(ruta.slice(prefix.length).replace(/\.(jpg|png)$/, ''))) throw new Error('Ruta de foto inválida.');
    return ruta;
  }
  async photoUri(draft: BorradorLocal): Promise<string | null> {
    if (!draft.foto) return null;
    const path = this.photoPath(draft);
    const info = await this.fs.stat({ directory: Directory.Data, path });
    if (info.type !== 'file' || info.size <= 0) throw new Error('No se encontró la fotografía guardada. Puede volver a tomarla; los demás datos se conservan.');
    const { uri } = await this.fs.getUri({ directory: Directory.Data, path });
    return Capacitor.convertFileSrc(uri);
  }
  async remove(id: string): Promise<void> {
    const draft = await this.read(id);
    if (!eliminacionLocal(draft)) throw new Error('El resultado del envío es incierto. Reintente la sincronización para confirmarlo antes de eliminar.');
    // Atomic retirement prevents older revisions becoming syncable after interrupted cleanup.
    const retired = `${this.root}/deleted-${id}`;
    await this.fs.rename({ directory: Directory.Data, from: this.path(id), to: retired });
    try { await this.fs.rmdir({ directory: Directory.Data, path: retired, recursive: true }); }
    catch { throw new Error('El borrador fue retirado de la cola. Quedaron archivos locales por limpiar; vuelva a abrir la lista para reintentar.'); }
  }
  private async revisions(id: string): Promise<string[]> {
    return (await this.fs.readdir({ directory: Directory.Data, path: this.path(id) })).files.map(f => f.name).filter(n => revision.test(n)).sort();
  }
  async photo(id: string, file: File): Promise<NonNullable<BorradorLocal['foto']>> {
    if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('La foto debe pesar entre 1 byte y 5 MB.');
    if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('La foto debe ser JPEG o PNG.');
    const ruta = `${this.path(id)}/photo-${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    await this.fs.writeFile({ directory: Directory.Data, path: ruta, data: btoa(binary), recursive: true });
    const stored = await this.fs.readFile({ directory: Directory.Data, path: ruta });
    if (stored.data !== btoa(binary)) throw new Error('No se pudo verificar la copia permanente de la fotografía.');
    return { ruta, tipo: file.type as 'image/jpeg' | 'image/png' };
  }
  async photoBase64(draft: BorradorLocal): Promise<string | undefined> {
    if (!draft.foto) return undefined;
    this.photoPath(draft);
    const result = await this.fs.readFile({ directory: Directory.Data, path: draft.foto.ruta });
    if (typeof result.data !== 'string' || !result.data) throw new Error('No se pudo leer la fotografía local.');
    return result.data;
  }
}
