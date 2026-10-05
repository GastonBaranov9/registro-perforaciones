import { Directory, Encoding, type FilesystemPlugin } from '@capacitor/filesystem';
import type { DatosTecnicosBorrador, NuevoPozo, PozoCompletoResultado, SitioBody } from '../../shared/types/schemas';

export interface BorradorLocal {
  id: string; usuario: number; estado: 'pendiente' | 'sincronizando' | 'sincronizado' | 'error' | 'conflicto';
  pozo: NuevoPozo; sitio: SitioBody; tecnicos: DatosTecnicosBorrador;
  foto?: { ruta: string; tipo: 'image/jpeg' | 'image/png' };
  enviado?: boolean; error?: string; resultado?: PozoCompletoResultado;
  // Local identity never changes. A replacement operation is only authorized by
  // the server's durable closed-without-creation receipt for the previous key.
  claveOperacion?: string;
  requiereCorreccion?: boolean;
}
export type OfflineFiles = Pick<FilesystemPlugin, 'mkdir' | 'readFile' | 'writeFile' | 'rename' | 'readdir' | 'deleteFile'>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const revision = /^revision-\d{12}\.json$/;

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
  async list(): Promise<BorradorLocal[]> {
    await this.init();
    const entries = await this.fs.readdir({ directory: Directory.Data, path: this.root });
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
    if (draft.foto && !draft.foto.ruta.startsWith(`${this.path(id)}/photo-`)) throw new Error('Ruta de foto inválida.');
    return draft;
  }
  async write(draft: BorradorLocal): Promise<void> {
    if (draft.usuario !== this.usuario || draft.pozo.numero_perforacion != null) throw new Error('Borrador local inválido.');
    const dir = this.path(draft.id);
    try { await this.fs.mkdir({ directory: Directory.Data, path: dir, recursive: true }); }
    catch { await this.fs.readdir({ directory: Directory.Data, path: dir }); }
    const temp = `${dir}/${crypto.randomUUID()}.tmp`;
    const versions = await this.revisions(draft.id);
    const next = versions.length ? Number(versions.at(-1)!.slice(9, 21)) + 1 : 1;
    const committed = `${dir}/revision-${String(next).padStart(12, '0')}.json`;
    await this.fs.writeFile({ directory: Directory.Data, path: temp, data: JSON.stringify(draft), encoding: Encoding.UTF8 });
    await this.fs.rename({ directory: Directory.Data, from: temp, to: committed });
    // Keep the current and previous revisions. Cleanup failure cannot invalidate a saved draft.
    for (const old of versions.slice(0, -1)) {
      try { await this.fs.deleteFile({ directory: Directory.Data, path: `${dir}/${old}` }); } catch { /* retry at next save */ }
    }
  }
  private async revisions(id: string): Promise<string[]> {
    return (await this.fs.readdir({ directory: Directory.Data, path: this.path(id) })).files.map(f => f.name).filter(n => revision.test(n)).sort();
  }
  async photo(id: string, file: File): Promise<NonNullable<BorradorLocal['foto']>> {
    if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('La foto debe pesar entre 1 byte y 5 MB.');
    if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('La foto debe ser JPEG o PNG.');
    const ruta = `${this.path(id)}/photo-${crypto.randomUUID()}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    await this.fs.writeFile({ directory: Directory.Data, path: ruta, data: btoa(binary), recursive: true });
    return { ruta, tipo: file.type as 'image/jpeg' | 'image/png' };
  }
  async photoBase64(draft: BorradorLocal): Promise<string | undefined> {
    if (!draft.foto) return undefined;
    if (!draft.foto.ruta.startsWith(`${this.path(draft.id)}/photo-`) || draft.foto.ruta.includes('..')) throw new Error('Ruta de foto inválida.');
    const result = await this.fs.readFile({ directory: Directory.Data, path: draft.foto.ruta });
    if (typeof result.data !== 'string') throw new Error('No se pudo leer la fotografía local.');
    return result.data;
  }
}
