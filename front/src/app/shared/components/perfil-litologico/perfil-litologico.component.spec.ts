import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PerfilLitologicoComponent } from './perfil-litologico.component';
import { PerfilLitologicoService } from '../../services/perfil-litologico.service';
import { PerfilLitologico } from '../../types/schemas';

const perfil: PerfilLitologico = {
  titulo: 'Perfil litológico del pozo',
  profundidad_m: 20,
  paso_escala_m: 2,
  tramos: [
    { clase: 'litologia', desde_m: 0, hasta_m: 0.5, material: 'Arena', descripcion: null, estilo: { color: '#D8AB52', gris: 0.72, patron: 'puntos' }, carril_etiqueta: 0 },
    { clase: 'hueco', desde_m: 0.5, hasta_m: 20, material: 'Sin datos', descripcion: null, estilo: { color: '#F5F5F5', gris: 0.95, patron: 'cruz' }, carril_etiqueta: 1 },
  ],
  aportes: [{ profundidad_m: 7, tipo: 'puntual', desde_m: 7, hasta_m: 7, geometria: { x_inicio: 0.05, x_fin: 0.95, espesor_min_px: 8, patron: 'ondas' } }],
  tuberias: [{tipo:'tuberia',desde_m:0,hasta_m:20,diametro_pulg:6,material_tuberia:'PVC',material_texto:'PVC',geometria:{x_inicio:.3,x_fin:.7,patron:'liso'}}],
  filtros: [{tipo:'filtro',desde_m:10,hasta_m:15,diametro_pulg:6,material_tuberia:'Acero',material_texto:'Acero',geometria:{x_inicio:.3,x_fin:.7,patron:'ranuras'}}],
  seccion_pozo: { tuberia_exterior_inicio: 0.36, tuberia_exterior_fin: 0.64, tuberia_interior_inicio: 0.43, tuberia_interior_fin: 0.57 },
  rangos: [{ desde_m: 0, hasta_m: 20 }],
  advertencias: [],
  tiene_litologia: true,
};

describe('PerfilLitologicoComponent', () => {
  let fixture: ComponentFixture<PerfilLitologicoComponent>;
  let obtener: jasmine.Spy;

  beforeEach(async () => {
    obtener = jasmine.createSpy().and.resolveTo(perfil);
    await TestBed.configureTestingModule({
      imports: [PerfilLitologicoComponent],
      providers: [{ provide: PerfilLitologicoService, useValue: { getPerfil: obtener } }],
    }).compileComponents();
    fixture = TestBed.createComponent(PerfilLitologicoComponent);
    fixture.componentRef.setInput('idUsuario', 10);
    fixture.componentRef.setInput('idPozo', 22);
  });

  it('renderiza el SVG, tabla accesible, patrón y aporte desde el modelo de API', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const elemento: HTMLElement = fixture.nativeElement;
    expect(obtener).toHaveBeenCalledOnceWith(10, 22);
    expect(elemento.querySelector('svg title')?.textContent).toContain('Perfil litológico');
    expect(elemento.querySelectorAll('tbody tr').length).toBe(5);
    expect(elemento.querySelector('.constructivo.ranuras')).not.toBeNull();
    expect(elemento.querySelector('.aporte')).not.toBeNull();
    expect(elemento.querySelector('.banda-aporte')).not.toBeNull();
    expect(elemento.querySelector('.tuberia-interior')).not.toBeNull();
    expect(elemento.querySelector('pattern#perfil-puntos')).not.toBeNull();
    expect(elemento.innerHTML).not.toContain('[object Object]');
  });

  it('muestra ausencia de datos', async () => {
    obtener.and.resolveTo(null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No hay profundidad ni litología');
  });

  it('muestra error sin conservar un perfil anterior', async () => {
    obtener.and.rejectWith(new Error('fallo'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
    expect(fixture.componentInstance.perfil()).toBeNull();
  });
});
