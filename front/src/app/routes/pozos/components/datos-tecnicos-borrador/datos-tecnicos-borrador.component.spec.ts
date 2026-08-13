import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DatosTecnicosBorradorComponent } from './datos-tecnicos-borrador.component';

describe('DatosTecnicosBorradorComponent', () => {
  let fixture: ComponentFixture<DatosTecnicosBorradorComponent>;
  let component: DatosTecnicosBorradorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DatosTecnicosBorradorComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
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

  it('exige selector de ranura solo para filtros nuevos y acepta histórico sin especificar', () => {
    component.agregarFiltro();
    expect(component.datos().intervalosFiltro[0].dato.ranura_mm).toBeNull();
    expect(component.errores().some((error) => error.includes('ranura obligatoria'))).toBeTrue();
    component.datos().intervalosFiltro[0].dato.ranura_mm = 0.75;
    expect(component.errores().some((error) => error.includes('ranura'))).toBeFalse();
    component.datos().intervalosFiltro[0].dato.id_intervalo_filtro = 9;
    component.datos().intervalosFiltro[0].dato.ranura_mm = null;
    expect(component.errores().some((error) => error.includes('ranura'))).toBeFalse();
  });

  it('solo ofrece No especificada para un histórico originalmente NULL', () => {
    component.datos.set({
      intervalosLitologicos: [], intervalosDiametro: [], nivelesAporte: [],
      intervalosFiltro: [
        { idLocal: 'historico', ranuraOriginal: null, dato: { id_intervalo_filtro: 10, desde_m: 0, hasta_m: 5, diametro_pulg: 6, material_tuberia: 'PVC', ranura_mm: null } },
        { idLocal: 'moderno', ranuraOriginal: 0.75, dato: { id_intervalo_filtro: 11, desde_m: 5, hasta_m: 10, diametro_pulg: 6, material_tuberia: 'PVC', ranura_mm: 0.75 } },
      ],
    });
    fixture.detectChanges();
    const selects = fixture.nativeElement.querySelectorAll('select[aria-label="Ranura del filtro"]') as NodeListOf<HTMLSelectElement>;
    expect(Array.from(selects[0].options).map((option) => option.textContent?.trim())).toContain('No especificada');
    expect(Array.from(selects[1].options).map((option) => option.textContent?.trim())).not.toContain('No especificada');
    component.datos().intervalosFiltro[1].dato.ranura_mm = null;
    expect(component.errores().some((error) => error.includes('no se puede eliminar'))).toBeTrue();
  });

  it('completa un hueco interno aunque el último intervalo alcance la profundidad final', () => {
    fixture.componentRef.setInput('profundidad', 100);
    component.datos.set({
      intervalosLitologicos: [
        { idLocal: 'persistido-30', dato: { id_intervalo_litologico: 30, desde_m: 0, hasta_m: 10, material: 'Sello', id_litologia: 4 } },
        { idLocal: 'persistido-31', dato: { id_intervalo_litologico: 31, desde_m: 10, hasta_m: 40, material: 'Tosca', id_litologia: 5 } },
        { idLocal: 'persistido-32', dato: { id_intervalo_litologico: 32, desde_m: 40, hasta_m: 100, material: 'Arena', id_litologia: 6 } },
      ], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [],
    });

    component.datos().intervalosLitologicos[0].dato.hasta_m = 5;
    component.notificarEdicion();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.seccion button') as HTMLButtonElement).disabled).toBeFalse();

    component.agregarLitologia();

    const intervalos = component.datos().intervalosLitologicos;
    expect(intervalos.map((item) => [item.dato.desde_m, item.dato.hasta_m])).toEqual([[0, 5], [5, 10], [10, 40], [40, 100]]);
    expect(intervalos[0].dato.id_intervalo_litologico).toBe(30);
    expect(intervalos[1].dato.id_intervalo_litologico).toBeUndefined();
    expect(new Set(intervalos.map((item) => item.dato.id_intervalo_litologico).filter((id) => id != null)).size).toBe(3);
    expect(component.errorAgregar()).toBe('');
  });

  it('informa cobertura real solo cuando no existen huecos', () => {
    component.datos.set({
      intervalosLitologicos: [
        { idLocal: 'a', dato: { desde_m: 0, hasta_m: 10, material: 'Arena' } },
        { idLocal: 'b', dato: { desde_m: 10, hasta_m: 30, material: 'Roca' } },
      ], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [],
    });
    component.agregarLitologia();
    expect(component.datos().intervalosLitologicos.length).toBe(2);
    expect(component.errorAgregar()).toBe('El perfil litológico cubre toda la profundidad.');
  });
});
