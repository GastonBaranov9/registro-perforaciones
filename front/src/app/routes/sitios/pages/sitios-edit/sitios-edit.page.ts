import { Component, inject, input, resource, signal } from '@angular/core';
import { SitiosFormComponent } from '../../components/sitios-form/sitios-form.component';
import { SitiosEditService } from '../../../../shared/services/sitios-edit.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SitioBody } from '../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, IonButton } from '@ionic/angular/standalone';
import { SitioReturnService } from '../../../../shared/services/sitio-navegar/sitio-navegar';

@Component({
  selector: 'app-sitios-edit',
  imports: [IonContent, IonCard, IonCardContent, SitiosFormComponent, IonButton],
  templateUrl: './sitios-edit.page.html',
  styleUrl: './sitios-edit.page.css',
})
export class SitiosEditPage {
  public editSitioService = inject(SitiosEditService);
  public activateRoute = inject(ActivatedRoute);
  public sitioReturn: SitioReturnService = inject(SitioReturnService);
  private router: Router = inject(Router);

  public id_sitio = input.required<number>();

  public sitio = signal<SitioBody>({
    departamento: '',
  });

  public sitioResource = resource({
    params: () => ({ id: this.id_sitio() }),
    loader: ({ params }) => this.editSitioService.getSitioById(params.id),
  });

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);

  returnTo = signal('/sitios-list');

  ngOnInit() {
    const nav = this.router.currentNavigation();
    this.returnTo.set(nav?.extras.state?.['returnTo'] ?? '/sitios-list');
  }

  async handleEdit(sitio: SitioBody) {
    try {
      this.disabled.set(true);
      const editado = await this.editSitioService.editSitio(this.id_sitio(), sitio);
      console.log('Sitio editado', editado);
      this.sitioReturn.sitioCreado.set(editado);
      this.router.navigateByUrl(this.returnTo());
    } catch (err: any) {
      this.errorMessage.set(err.message);
    }
    this.disabled.set(false);
  }
}
