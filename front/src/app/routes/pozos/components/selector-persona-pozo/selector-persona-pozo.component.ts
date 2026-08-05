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
  busqueda = signal('');
  filtrados = computed(() => {
    const q = this.busqueda().trim().toLocaleLowerCase();
    return this.candidatos().filter((c) => !q || c.nombre.toLocaleLowerCase().includes(q) || c.email.toLocaleLowerCase().includes(q));
  });
  actual = computed(() => this.candidatos().find((c) => c.id_usuario === Number(this.seleccionado())) ?? null);
  elegir(id: number) { this.seleccionado.set(id); }
}
