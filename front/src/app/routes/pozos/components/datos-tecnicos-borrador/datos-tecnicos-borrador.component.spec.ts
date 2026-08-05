import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DatosTecnicosBorradorComponent } from './datos-tecnicos-borrador.component';

describe('DatosTecnicosBorradorComponent', () => {
  let fixture: ComponentFixture<DatosTecnicosBorradorComponent>;
  let component: DatosTecnicosBorradorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DatosTecnicosBorradorComponent] }).compileComponents();
    fixture = TestBed.createComponent(DatosTecnicosBorradorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('profundidad', 30);
    fixture.detectChanges();
  });

  it('agrega, edita y quita las tres categorías en memoria', () => {
    component.agregarLitologia();
    component.agregarDiametro();
    component.agregarAporte();
    const inicial = component.datos();
    inicial.intervalosLitologicos[0].dato.material = 'Arena';
    component.notificarEdicion();
    expect(component.datos().intervalosLitologicos[0].dato.material).toBe('Arena');
    component.quitarLitologia(component.datos().intervalosLitologicos[0].idLocal);
    component.quitarDiametro(component.datos().intervalosDiametro[0].idLocal);
    component.quitarAporte(component.datos().nivelesAporte[0].idLocal);
    expect(component.datos()).toEqual({ intervalosLitologicos: [], intervalosDiametro: [], nivelesAporte: [] });
  });

  it('mantiene una fila fuera de rango y muestra el error', () => {
    component.agregarAporte();
    component.datos().nivelesAporte[0].dato.profundidad_m = 35;
    component.notificarEdicion();
    fixture.detectChanges();
    expect(component.errores()[0]).toContain('excede');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(component.datos().nivelesAporte.length).toBe(1);
  });
});
