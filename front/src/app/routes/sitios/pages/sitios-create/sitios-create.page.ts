import { Component, inject, input, output, signal } from '@angular/core';
import { SitiosCreateService } from '../../../../shared/services/sitios-create.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SitioBody } from '../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent } from '@ionic/angular/standalone';
import { SitiosFormComponent } from '../../components/sitios-form/sitios-form.component';
import { SitioReturnService } from '../../../../shared/services/sitio-navegar/sitio-navegar';


@Component({
  selector: 'app-sitios-create',
  imports: [IonContent, IonCard, IonCardContent, SitiosFormComponent],
  templateUrl: './sitios-create.page.html',
  styleUrl: './sitios-create.page.css',
})
export class SitiosCreatePage {
  public sitiosCreateService = inject(SitiosCreateService);
  public router = inject(Router);
  public activateRoute = inject(ActivatedRoute);
  public sitioReturn: SitioReturnService = inject(SitioReturnService);


  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);

  public sitio = signal<SitioBody>({
    departamento: '',
  });

  public idUsuario = Number(this.activateRoute.snapshot.paramMap.get('id_usuario'));

  returnTo = signal('/sitios-list');

  ngOnInit() {
    const nav = this.router.currentNavigation();
    this.returnTo.set(nav?.extras.state?.['returnTo'] ?? '/sitios-list');
  }

  async guardarSitio(sitio: SitioBody) {
    try {
      this.disabled.set(true);
      const nuevositio = await this.sitiosCreateService.createSitio(this.idUsuario, sitio);
      console.log('sitio creado: ', nuevositio);
      this.sitioReturn.sitioCreado.set(nuevositio);
      this.router.navigateByUrl(this.returnTo());
    } catch (err: any) {
      this.errorMessage.set(err.message);
    }
    this.disabled.set(false);
  }


}
