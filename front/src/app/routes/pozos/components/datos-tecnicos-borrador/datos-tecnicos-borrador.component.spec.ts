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

  it('muestra las etiquetas técnicas con codificación UTF-8 correcta', () => {
    component.agregarDiametro();
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Datos técnicos');
    expect(texto).toContain('Intervalos litológicos');
    expect(texto).toContain('Intervalos de diámetro');
    expect(texto).toContain('Diámetro');
    expect(texto).toContain('Material de tubería');
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
    expect(component.datos()).toEqual({ intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
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

  it('sugiere continuidad editable para litología y diámetro', () => {
    component.datos.set({
      intervalosLitologicos: [{ idLocal: 'a', dato: { desde_m: 0, hasta_m: 10, material: 'Arena' } }],
      intervalosDiametro: [{ idLocal: 'b', dato: { desde_m: 0, hasta_m: 12, diametro_pulg: 8, material_tuberia: 'PVC' } }], intervalosFiltro: [], nivelesAporte: [],
    });
    component.agregarLitologia(); component.agregarDiametro();
    expect(component.datos().intervalosLitologicos[1].dato.desde_m).toBe(10);
    expect(component.datos().intervalosDiametro[1].dato.desde_m).toBe(12);
    component.datos().intervalosLitologicos[1].dato.desde_m = 11;
    expect(component.datos().intervalosLitologicos[1].dato.desde_m).toBe(11);
  });

  it('sincroniza una nueva versión inicial sin marcar dirty', () => {
    const primero = { intervalosLitologicos: [{ idLocal:'a',dato:{desde_m:0,hasta_m:5,material:'Arena'} }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
    const segundo = { intervalosLitologicos: [{ idLocal:'b',dato:{desde_m:0,hasta_m:8,material:'Basalto'} }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [{idLocal:'c',dato:{profundidad_m:4}}] };
    const cambios=spyOn(component.cambiado,'emit');
    fixture.componentRef.setInput('inicial',primero);fixture.detectChanges();TestBed.flushEffects();
    fixture.componentRef.setInput('inicial',segundo);fixture.detectChanges();TestBed.flushEffects();
    expect(component.datos()).toEqual(segundo);expect(component.dirty()).toBeFalse();expect(cambios).toHaveBeenCalledWith(segundo);
  });

  it('preserva cambios locales hasta recibir descarte confirmado', () => {
    const inicial = { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
    fixture.componentRef.setInput('inicial',inicial);fixture.detectChanges();TestBed.flushEffects();component.agregarAporte();
    const remoto = { ...inicial, nivelesAporte:[{idLocal:'remoto',dato:{profundidad_m:9}}] };
    fixture.componentRef.setInput('inicial',remoto);fixture.detectChanges();TestBed.flushEffects();expect(component.datos().nivelesAporte[0].dato.profundidad_m).toBe(0);
    fixture.componentRef.setInput('versionDescartar',1);fixture.detectChanges();TestBed.flushEffects();expect(component.datos()).toEqual(remoto);expect(component.dirty()).toBeFalse();
  });
});
