import { Component, computed, input, model, signal } from '@angular/core';
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
  busqueda = signal('');
  resultados = signal<CandidatoPozo[] | null>(null);
  private secuenciaBusqueda = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  filtrados = computed(() => {
    const q = this.busqueda().trim().toLocaleLowerCase();
    const origen = this.resultados() ?? this.candidatos();
    return origen.filter((c) => !q || c.nombre.toLocaleLowerCase().includes(q) || c.email.toLocaleLowerCase().includes(q));
  });
  actual = computed(() => [...this.candidatos(), ...(this.resultados() ?? [])].find((c) => c.id_usuario === Number(this.seleccionado())) ?? null);
  elegir(id: number) { this.seleccionado.set(id); }
  async buscar(valor: string | number | null | undefined) {
    const texto = String(valor ?? ''); this.busqueda.set(texto);
    if (this.temporizador) clearTimeout(this.temporizador);
    const q = texto.trim(); const secuencia = ++this.secuenciaBusqueda;
    if (q.length < 2) { this.resultados.set(null); return; }
    if (!this.buscarRemoto()) { this.resultados.set(this.candidatos().filter((c) => c.nombre.toLocaleLowerCase().includes(q.toLocaleLowerCase()) || c.email.toLocaleLowerCase().includes(q.toLocaleLowerCase()))); return; }
    this.temporizador = setTimeout(async () => { try { const lista = await this.buscarRemoto()!(q); if (secuencia === this.secuenciaBusqueda) this.resultados.set(lista); }
    catch { if (secuencia === this.secuenciaBusqueda) this.resultados.set([]); }
    }, 300);
  }
}
