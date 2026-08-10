import { Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonInput, IonItem, IonLabel, IonList, IonText } from '@ionic/angular/standalone';
import { CandidatoPozo } from '../../../../shared/types/schemas';

@Component({
  selector: 'app-selector-persona-pozo', standalone: true,
  imports: [FormsModule, IonButton, IonInput, IonItem, IonLabel, IonList, IonText],
  templateUrl: './selector-persona-pozo.component.html',
  styleUrl: './selector-persona-pozo.component.css',
})
export class SelectorPersonaPozoComponent {
  etiqueta = input.required<string>();
  candidatos = input.required<CandidatoPozo[]>();
  seleccionado = model.required<number>();
  deshabilitado = input(false);
  rol = input<'propietario' | 'perforador'>('propietario');
  buscarRemoto = input<((q: string) => Promise<CandidatoPozo[]>) | null>(null);
  personaSeleccionada = output<CandidatoPozo>();
  busqueda = signal('');
  resultados = signal<CandidatoPozo[] | null>(null);
  private secuenciaBusqueda = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  activo = signal(0);
  private seleccionRemota = signal<CandidatoPozo | null>(null);
  filtrados = computed(() => {
    const q = this.busqueda().trim().toLocaleLowerCase();
    if (q.length < 2) return [];
    const origen = this.resultados() ?? [];
    return origen.filter((c) => c.nombre.toLocaleLowerCase().includes(q) || c.email.toLocaleLowerCase().includes(q)).slice(0, 20);
  });
  actual = computed(() => [...this.candidatos(), ...(this.resultados() ?? []), ...(this.seleccionRemota() ? [this.seleccionRemota()!] : [])]
    .find((c) => c.id_usuario === Number(this.seleccionado())) ?? null);
  elegir(id: number) {
    const persona = [...this.candidatos(), ...(this.resultados() ?? [])].find((c) => c.id_usuario === id);
    if (!persona) return;
    this.seleccionRemota.set(persona);
    this.seleccionado.set(id);
    this.personaSeleccionada.emit(persona);
    this.busqueda.set('');
    this.resultados.set(null);
  }
  async buscar(valor: string | number | null | undefined) {
    const texto = String(valor ?? ''); this.busqueda.set(texto);
    if (this.temporizador) clearTimeout(this.temporizador);
    const q = texto.trim(); const secuencia = ++this.secuenciaBusqueda;
    this.activo.set(0);
    if (q.length < 2) { this.resultados.set(null); this.activo.set(0); return; }
    if (!this.buscarRemoto()) { this.resultados.set(this.candidatos().filter((c) => c.nombre.toLocaleLowerCase().includes(q.toLocaleLowerCase()) || c.email.toLocaleLowerCase().includes(q.toLocaleLowerCase()))); return; }
    this.temporizador = setTimeout(async () => { try { const lista = await this.buscarRemoto()!(q); if (secuencia === this.secuenciaBusqueda) this.resultados.set(lista); }
    catch { if (secuencia === this.secuenciaBusqueda) this.resultados.set([]); }
    }, 300);
  }
  tecla(evento: KeyboardEvent) {
    const resultados = this.filtrados();
    if (!resultados.length) return;
    if (evento.key === 'ArrowDown') { evento.preventDefault(); this.activo.update((i) => Math.min(i + 1, resultados.length - 1)); }
    else if (evento.key === 'ArrowUp') { evento.preventDefault(); this.activo.update((i) => Math.max(i - 1, 0)); }
    else if (evento.key === 'Enter') { evento.preventDefault(); this.elegir(resultados[this.activo()].id_usuario); }
    else if (evento.key === 'Escape') { this.resultados.set(null); }
  }
}
