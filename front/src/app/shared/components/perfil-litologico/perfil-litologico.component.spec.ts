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
  aportes: [{ profundidad_m: 7, tipo: 'puntual', desde_m: 7, hasta_m: 7, geometria: { x_inicio: 0.03, x_fin: 0.97, espesor_min_px: 12, patron: 'ondas' } }],
  tuberias: [{tipo:'tuberia',desde_m:0,hasta_m:20,diametro_pulg:6,material_tuberia:'PVC',material_texto:'PVC',carril_etiqueta:0,geometria:{x_inicio:.3,x_fin:.7,patron:'liso'}}],
  filtros: [{tipo:'filtro',desde_m:10,hasta_m:15,diametro_pulg:6,material_tuberia:'Acero',material_texto:'Acero',carril_etiqueta:0,geometria:{x_inicio:.3,x_fin:.7,patron:'ranuras'}}],
  etiquetas: [
    {clave:'lit-0-.5',tipo:'litologia',texto:'0–0.5 m · Arena',profundidad_anclaje_m:.25,rango_desde_m:0,posicion_y_normalizada:.1,carril:0,x_anclaje_normalizado:1,x_texto_normalizado:310/760,conector:{puntos:[{x_normalizada:270/760,y_normalizada:140/820},{x_normalizada:302/760,y_normalizada:140/820}]},caja_texto:{x_normalizada:310/760,y_normalizada:132/820,ancho_normalizado:.2,alto_normalizado:16/820}},
    {clave:'tub-0-20',tipo:'tuberia',texto:'Tubería PVC · Ø 6 pulg · 0-20 m',profundidad_anclaje_m:10,rango_desde_m:0,posicion_y_normalizada:.45,carril:1,x_anclaje_normalizado:.7,x_texto_normalizado:390/760,conector:{puntos:[{x_normalizada:216/760,y_normalizada:385/820},{x_normalizada:382/760,y_normalizada:385/820}]},caja_texto:{x_normalizada:390/760,y_normalizada:377/820,ancho_normalizado:.3,alto_normalizado:16/820}},
    {clave:'fil-10-15',tipo:'filtro',texto:'Filtro ranurado Acero · Ø 6 pulg · 10-15 m',profundidad_anclaje_m:12.5,rango_desde_m:0,posicion_y_normalizada:.65,carril:2,x_anclaje_normalizado:.7,x_texto_normalizado:470/760,conector:{puntos:[{x_normalizada:216/760,y_normalizada:525/820},{x_normalizada:462/760,y_normalizada:525/820}]},caja_texto:{x_normalizada:470/760,y_normalizada:517/820,ancho_normalizado:.3,alto_normalizado:16/820}},
    {clave:'apo-7',tipo:'aporte',texto:'Aporte de agua 7 m',profundidad_anclaje_m:7,rango_desde_m:0,posicion_y_normalizada:.35,carril:3,x_anclaje_normalizado:.97,x_texto_normalizado:550/760,conector:{puntos:[{x_normalizada:265/760,y_normalizada:315/820},{x_normalizada:542/760,y_normalizada:315/820}]},caja_texto:{x_normalizada:550/760,y_normalizada:307/820,ancho_normalizado:.2,alto_normalizado:16/820}},
  ],
  seccion_pozo: { tuberia_exterior_inicio: 0.36, tuberia_exterior_fin: 0.64, tuberia_interior_inicio: 0.43, tuberia_interior_fin: 0.57 },
  geometria:{ancho_logico:760,alto_logico:820,columna:{x:90,y:70,ancho:180,alto:700},x_texto_escala:12,carriles_etiqueta_x:[310,390,470,550],separacion_vertical_normalizada:.055,conector:{salida:12,llegada:8},alto_texto:16},
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
    expect(elemento.querySelector('.constructivo.material-pvc')).not.toBeNull();
    expect(elemento.querySelector('.ranurado-filtro')).not.toBeNull();
    expect(elemento.querySelector('.etiqueta-filtro')?.textContent).toContain('Filtro ranurado Acero');
    expect(elemento.querySelector('.etiqueta-tuberia')?.textContent).toContain('Tubería PVC · Ø 6 pulg');
    expect(elemento.querySelector('.aporte')).not.toBeNull();
    expect(elemento.querySelector('.banda-aporte')).not.toBeNull();
    const filtro = elemento.querySelector('.ranurado-filtro');
    const aporte = elemento.querySelector('.banda-aporte');
    expect(filtro && aporte && Boolean(filtro.compareDocumentPosition(aporte) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTrue();
    expect(elemento.querySelector('.tuberia-interior')).not.toBeNull();
    expect(elemento.querySelector('pattern#perfil-puntos')).not.toBeNull();
    expect(elemento.querySelector('.marca-escala')).not.toBeNull();
    expect(elemento.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 760 820');
    expect(elemento.querySelectorAll('polyline.conector-etiqueta').length).toBe(perfil.etiquetas.length);
    expect((elemento.querySelector('polyline.conector-etiqueta')?.getAttribute('points') ?? '').split(' ').length).toBeGreaterThanOrEqual(2);
    expect(elemento.querySelector('.guia')).toBeNull();
    const tablaLitologica = elemento.querySelector('table');
    expect(Array.from(tablaLitologica?.querySelectorAll('th') ?? []).map((th) => th.textContent?.trim())).toEqual(['Intervalo', 'Material']);
    expect(tablaLitologica?.textContent).not.toContain('Sin descripción registrada');
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

  it('vuelve a consultar al cambiar la versión y muestra el modelo confirmado por API', async () => {
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const actualizado: PerfilLitologico = { ...perfil,
      tuberias: [{ ...perfil.tuberias[0], material_tuberia:'Acero', material_texto:'Acero', diametro_pulg:8, geometria:{...perfil.tuberias[0].geometria,patron:'metal'} }],
      etiquetas: perfil.etiquetas.map((item) => item.tipo === 'tuberia' ? {...item,texto:'Tubería Acero · Ø 8 pulg · 0-20 m'} : item),
    };
    obtener.and.resolveTo(actualizado);
    fixture.componentRef.setInput('versionPerfil', 1);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(obtener).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('.etiqueta-tuberia')?.textContent).toContain('Acero · Ø 8 pulg');
    expect(fixture.nativeElement.querySelector('.constructivo.material-acero')).not.toBeNull();
  });

  it('permite reintentar una recarga fallida sin mostrar el perfil anterior', async () => {
    obtener.and.rejectWith(new Error('fallo'));
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.perfil()).toBeNull();
    obtener.and.resolveTo(perfil);
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(obtener).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.perfil()).toBe(perfil);
  });

  it('reutiliza el renderer con un modelo de vista previa sin consultar datos persistidos', () => {
    fixture.componentRef.setInput('modelo', perfil);
    fixture.detectChanges();
    expect(obtener).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.etiqueta-tuberia')?.textContent).toContain('PVC');
  });

  it('ignora una respuesta anterior cuando ya existe una recarga más reciente', async () => {
    let resolverAnterior!: (dato: PerfilLitologico) => void;
    let resolverVigente!: (dato: PerfilLitologico) => void;
    obtener.and.returnValues(new Promise<PerfilLitologico>((resolve) => resolverAnterior = resolve), new Promise<PerfilLitologico>((resolve) => resolverVigente = resolve));
    fixture.detectChanges();
    fixture.componentRef.setInput('versionPerfil', 1); fixture.detectChanges();
    const vigente = {...perfil, titulo:'Perfil litológico del pozo' as const, tuberias:[]};
    resolverVigente(vigente); await fixture.whenStable(); fixture.detectChanges();
    resolverAnterior(perfil); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.perfil()).toBe(vigente);
  });
});
