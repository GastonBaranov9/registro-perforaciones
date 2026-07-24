import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonCard,
  IonCol,
  IonGrid,
  IonIcon,
  IonRippleEffect,
  IonRow,
} from '@ionic/angular/standalone';

@Component({
  selector: 'app-estilo-paginas',
  imports: [IonIcon, IonCard, IonCol, RouterLink],
  templateUrl: './estilo-paginas.html',
  styleUrls: ['./estilo-pagina.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EstiloPaginas {
  titulo = input<string>();
  link = input<string | null>();

  clickPagina = output<void>();

  onClick() {
    if (!this.link()) {
      this.clickPagina.emit();
    }
  }
}
