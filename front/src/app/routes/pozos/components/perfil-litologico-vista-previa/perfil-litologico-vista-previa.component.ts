import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { Subject, catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton, IonSpinner } from '@ionic/angular/standalone';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { PerfilLitologicoService } from '../../../../shared/services/perfil-litologico.service';
import { DatosTecnicosBorrador, PerfilLitologico, PerfilLitologicoVistaPreviaBody } from '../../../../shared/types/schemas';
import { validarDatosTecnicos } from '../../../../shared/utils/datos-tecnicos-borrador';
import { PerfilLitologicoComponent } from '../../../../shared/components/perfil-litologico/perfil-litologico.component';

@Component({
  selector: 'app-perfil-litologico-vista-previa',
  imports: [IonButton, IonSpinner, PerfilLitologicoComponent],
  templateUrl: './perfil-litologico-vista-previa.component.html',
  styleUrl: './perfil-litologico-vista-previa.component.css',
})
export class PerfilLitologicoVistaPreviaComponent {
  readonly idPozo = input.required<number>();
  readonly profundidad = input<number | undefined>();
  readonly datos = input.required<DatosTecnicosBorrador>();
  readonly perfil = signal<PerfilLitologico | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');
  private readonly solicitudes = new Subject<PerfilLitologicoVistaPreviaBody>();
  private readonly service = inject(PerfilLitologicoService);
  private readonly auth = inject(AuthService);
  private ultimoBorrador: PerfilLitologicoVistaPreviaBody | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.solicitudes.pipe(
      debounceTime(300),
      tap(() => { this.cargando.set(true); this.error.set(''); this.perfil.set(null); }),
      switchMap((borrador) => {
        const idUsuario = this.auth.userId();
        if (!idUsuario) return of({ error: 'No hay una sesión válida para actualizar la vista previa.' } as const);
        return this.service.vistaPrevia(idUsuario, this.idPozo(), borrador).pipe(
          catchError((fallo: unknown) => {
            const respuesta = fallo as { error?: { message?: string }; message?: string };
            return of({ error: respuesta.error?.message ?? respuesta.message ?? 'No se pudo actualizar la vista previa.' } as const);
          }),
        );
      }),
      takeUntilDestroyed(destroyRef),
    ).subscribe((resultado) => {
      this.cargando.set(false);
      if ('error' in resultado) { this.error.set(resultado.error); this.perfil.set(null); }
      else this.perfil.set(resultado);
    });

    effect(() => this.preparar(this.profundidad(), this.datos()));
  }

  reintentar() { if (this.ultimoBorrador) this.solicitudes.next(this.ultimoBorrador); }

  private preparar(profundidad: number | undefined, datos: DatosTecnicosBorrador) {
    const errores = validarDatosTecnicos(datos, profundidad);
    if (!Number.isFinite(profundidad) || (profundidad ?? 0) <= 0) errores.unshift('Indique una profundidad final mayor que 0 para generar la vista previa.');
    if (errores.length) {
      this.ultimoBorrador = null; this.perfil.set(null); this.cargando.set(false); this.error.set(errores.join(' ')); return;
    }
    const borrador: PerfilLitologicoVistaPreviaBody = {
      profundidad_final_m: profundidad!,
      intervalos_litologicos: datos.intervalosLitologicos.map((x) => ({ ...x.dato })),
      intervalos_diametro: datos.intervalosDiametro.map((x) => ({ ...x.dato })),
      intervalos_filtro: datos.intervalosFiltro.map((x) => ({ ...x.dato })),
      niveles_aporte: datos.nivelesAporte.map((x) => ({ ...x.dato })),
    };
    this.ultimoBorrador = borrador;
    this.solicitudes.next(borrador);
  }
}
