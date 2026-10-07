import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { SelectorLitologiaComponent } from './selector-litologia.component';
import { LitologiasService } from '../../services/litologias.service';
import { LitologiaPublica } from '../../types/schemas';

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '<app-selector-litologia />' })
class HostComponent {}

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '@for (item of items; track item) { <app-selector-litologia /> }' })
class ManyHostComponent { items = Array.from({ length: 10 }, (_, index) => index); }

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '<app-selector-litologia [seleccionado]="7" /><app-selector-litologia [seleccionado]="7" />' })
class HistoricalHostComponent {}

describe('SelectorLitologiaComponent', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [LitologiasService, provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('filtra la búsqueda Are y solo ofrece activas', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 1, codigo: 'arenisca_rosada', nombre: 'Arenisca rosada', familia: 'arenisca', color: '#C98C82', patron: 'sandstone_fine', activo: true, orden: 1 },
      { id_litologia: 2, codigo: 'basalto', nombre: 'Basalto', familia: 'basalto', color: '#555555', patron: 'basalt', activo: true, orden: 2 },
    ]);
    await fixture.whenStable();
    const selector = fixture.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
    selector.busqueda.set('Are');
    expect(selector.opcionesFiltradas().map((x) => x.id_litologia)).toEqual([1]);
    expect(selector.opcionesFiltradas().every((x) => x.activo)).toBeTrue();
  });
  it('permite seleccionar Sello sanitario como litología activa del catálogo', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 30, codigo: 'sello_sanitario', nombre: 'Sello sanitario', familia: 'otro', color: '#999999', patron: 'concrete', activo: true, orden: 30 },
    ]);
    await fixture.whenStable();
    const selector = fixture.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
    const cambio = spyOn(selector.seleccionadoChange, 'emit');
    selector.seleccionar('30');
    expect(cambio).toHaveBeenCalledWith(30);
  });
  it('comparte una sola carga activa entre diez selectores y no recarga al cambiar', async () => {
    const many = TestBed.createComponent(ManyHostComponent);
    many.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 1, codigo: 'a', nombre: 'A', familia: 'arenisca', color: '#C98C82', patron: 'sandstone_fine', activo: true, orden: 1 },
    ]);
    await many.whenStable();
    many.debugElement.queryAll(By.directive(SelectorLitologiaComponent))[0].componentInstance.seleccionar('1');
    expect(many.debugElement.queryAll(By.directive(SelectorLitologiaComponent)).length).toBe(10);
  });

  it('comparte la carga excepcional de una historica inactiva', async () => {
    const historical = TestBed.createComponent(HistoricalHostComponent);
    historical.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([]);
    await historical.whenStable();
    http.expectOne((r) => r.url.endsWith('/litologias/7')).flush({ id_litologia: 7, codigo: 'historica', nombre: 'Historica', familia: 'otro', color: '#666666', patron: 'granite', activo: false, orden: 7 });
    await historical.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    historical.detectChanges();
    const selectors = historical.debugElement.queryAll(By.directive(SelectorLitologiaComponent));
    expect(selectors.length).toBe(2);
    expect((selectors[0].componentInstance as SelectorLitologiaComponent).opciones().map((item) => item.id_litologia)).toEqual([7]);
  });
});

describe('Autocompletado litológico', () => {
  const catalogo: LitologiaPublica[] = [
    { id_litologia: 1, codigo: 'basalto_marron', nombre: 'Basalto marrón', familia: 'basalto', color: '#795548', patron: 'basalt', activo: true, orden: 1 },
    { id_litologia: 4, codigo: 'basalto_negro', nombre: 'Basalto negro', familia: 'basalto', color: '#202124', patron: 'basalt', activo: true, orden: 4 },
    { id_litologia: 6, codigo: 'suelo_organico', nombre: 'Suelo orgánico', familia: 'suelo', color: '#4E342E', patron: 'organic', activo: true, orden: 6 },
  ];
  beforeEach(() => {
    spyOn(window, 'matchMedia').and.returnValue(Object.assign(new EventTarget(), { matches: false }) as MediaQueryList);
    TestBed.configureTestingModule({
      imports: [SelectorLitologiaComponent],
      providers: [{ provide: LitologiasService, useValue: { listar: async () => catalogo } }],
    });
  });
  async function fixture() {
    const f = TestBed.createComponent(SelectorLitologiaComponent);
    f.detectChanges(); await f.whenStable(); f.detectChanges(); return f;
  }
  it('sugiere desde ba y normaliza mayúsculas y tildes tanto en nombre como familia', async () => {
    const f = await fixture(), c = f.componentInstance;
    c.buscar('ba'); expect(c.opcionesFiltradas().map(x => x.id_litologia)).toEqual([1, 4]);
    c.buscar('MARRON'); expect(c.opcionesFiltradas().map(x => x.id_litologia)).toEqual([1]);
    c.buscar('BÁSALTO'); expect(c.opcionesFiltradas().map(x => x.id_litologia)).toEqual([1, 4]);
    c.buscar('organico'); expect(c.opcionesFiltradas().map(x => x.id_litologia)).toEqual([6]);
    c.buscar('inexistente'); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('No hay coincidencias');
  });
  it('permite elegir con flechas y Enter sin enviar el formulario ni alterar el catálogo', async () => {
    const f = await fixture(), c = f.componentInstance, original = structuredClone(catalogo);
    const selected = spyOn(c.seleccionadoChange, 'emit'), name = spyOn(c.nombreChange, 'emit');
    c.buscar('ba');
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    c.teclado(down); f.detectChanges();
    expect(down.defaultPrevented).toBeTrue();
    expect(f.nativeElement.querySelector('[role="combobox"]').getAttribute('aria-activedescendant')).toBe(c.listaId + '-0');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    c.teclado(enter);
    expect(enter.defaultPrevented).toBeTrue();
    expect(selected).toHaveBeenCalledOnceWith(1); expect(name).toHaveBeenCalledOnceWith('Basalto marrón');
    expect(c.abierto()).toBeFalse(); expect(catalogo).toEqual(original);
  });
  it('ofrece objetivos táctiles de 48px y selecciona el ID real a 320px de ancho', async () => {
    const f = await fixture(), c = f.componentInstance;
    f.nativeElement.style.width = '320px';
    c.buscar('ba'); f.detectChanges();
    const options = f.nativeElement.querySelectorAll('[role="option"]') as NodeListOf<HTMLButtonElement>;
    expect(options.length).toBe(2);
    for (const option of Array.from(options)) {
      expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
      expect(option.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    }
    const selected = spyOn(c.seleccionadoChange, 'emit');
    options[1].click(); expect(selected).toHaveBeenCalledOnceWith(4);
  });
  it('Escape cierra las sugerencias conservando la selección', async () => {
    const f = await fixture(), c = f.componentInstance;
    f.componentRef.setInput('seleccionado', 1);
    const selected = spyOn(c.seleccionadoChange, 'emit');
    c.buscar('suelo'); c.teclado(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(c.abierto()).toBeFalse(); expect(selected).not.toHaveBeenCalled();
  });

  it('en desktop mantiene la lista al ocultar el teclado y cierra al enfocar o pulsar fuera', async () => {
    const f = await fixture(), c = f.componentInstance;
    c.buscar('ba'); f.detectChanges();
    const input = f.nativeElement.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(c.abierto()).toBeTrue();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    expect(c.abierto()).toBeFalse();
    c.buscar('ba');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(c.abierto()).toBeFalse();
  });

  function simularMovil() {
    (window.matchMedia as jasmine.Spy).and.returnValue(Object.assign(new EventTarget(), { matches: true }) as MediaQueryList);
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 600, offsetTop: 0, offsetLeft: 0 });
    spyOnProperty(window, 'visualViewport', 'get').and.returnValue(viewport as VisualViewport);
    return viewport;
  }

  it('en móvil ajusta búsqueda y opciones al viewport con teclado abierto, permite scroll y no cierra al ocultarlo', async () => {
    const viewport = simularMovil();
    const f = await fixture(), c = f.componentInstance;
    c.opciones.set(Array.from({ length: 30 }, (_, i) => ({ ...catalogo[0], id_litologia: i + 10 })));
    (f.nativeElement.querySelector('.abrir-selector') as HTMLButtonElement).click();
    f.detectChanges();
    const dialogo = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const input = dialogo.querySelector('input')!;
    expect(dialogo.open).toBeTrue();
    expect(document.activeElement).toBe(input);
    Object.assign(viewport, { height: 320, offsetTop: 24 });
    viewport.dispatchEvent(new Event('resize'));
    f.detectChanges();
    const lista = dialogo.querySelector('[role="listbox"]') as HTMLElement;
    const limites = lista.getBoundingClientRect();
    expect(dialogo.getBoundingClientRect().width).toBe(304);
    expect(input.getBoundingClientRect().top).toBeGreaterThanOrEqual(viewport.offsetTop);
    expect(limites.height).toBeGreaterThanOrEqual(48);
    expect(limites.bottom).toBeLessThanOrEqual(viewport.offsetTop + viewport.height);
    expect(lista.scrollHeight).toBeGreaterThan(lista.clientHeight);
    lista.scrollTop = 100;
    expect(lista.scrollTop).toBe(100);
    input.blur();
    Object.assign(viewport, { height: 600, offsetTop: 0 });
    viewport.dispatchEvent(new Event('resize'));
    f.detectChanges();
    expect(c.abierto()).toBeTrue();
    expect(dialogo.open).toBeTrue();
    expect(lista.getBoundingClientRect().height).toBeGreaterThan(limites.height);
    const selected = spyOn(c.seleccionadoChange, 'emit');
    (lista.querySelectorAll('button')[5] as HTMLButtonElement).click();
    expect(selected).toHaveBeenCalledOnceWith(15);
    expect(dialogo.open).toBeFalse();
  });

  it('en móvil busca por texto, conserva resultados tras focusout y selecciona con el teclado abierto', async () => {
    const viewport = simularMovil();
    const f = await fixture(), c = f.componentInstance;
    c.abrirMovil();
    const dialogo = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const input = dialogo.querySelector('input')!;
    input.value = 'MARRON';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Object.assign(viewport, { height: 320 });
    viewport.dispatchEvent(new Event('resize'));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    f.detectChanges();
    const opciones = dialogo.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(opciones.length).toBe(1);
    expect(opciones[0].textContent).toContain('Basalto marrón');
    const selected = spyOn(c.seleccionadoChange, 'emit');
    opciones[0].click();
    expect(selected).toHaveBeenCalledOnceWith(1);
    expect(dialogo.open).toBeFalse();
  });

  it('en móvil Escape oculta el teclado; Cerrar cancela sin modificar la selección y permite reabrir', async () => {
    simularMovil();
    const f = await fixture(), c = f.componentInstance;
    const selected = spyOn(c.seleccionadoChange, 'emit');
    c.abrirMovil();
    const dialogo = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const input = dialogo.querySelector('input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(input);
    expect(dialogo.open).toBeTrue();
    (dialogo.querySelector('header button') as HTMLButtonElement).click();
    expect(dialogo.open).toBeFalse();
    expect(c.abierto()).toBeFalse();
    expect(selected).not.toHaveBeenCalled();
    await f.whenStable();
    c.abrirMovil();
    expect(dialogo.open).toBeTrue();
    dialogo.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(c.abierto()).toBeFalse();
    expect(selected).not.toHaveBeenCalled();
  });

  it('en móvil no abre deshabilitado y libera los listeners del viewport al destruirse', async () => {
    const viewport = simularMovil();
    const eliminarListener = spyOn(viewport, 'removeEventListener').and.callThrough();
    const f = await fixture(), c = f.componentInstance;
    f.componentRef.setInput('deshabilitado', true); f.detectChanges();
    c.abrirMovil();
    expect(c.abierto()).toBeFalse();
    expect(f.nativeElement.querySelector('dialog').open).toBeFalse();
    f.destroy();
    expect(eliminarListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    expect(eliminarListener).toHaveBeenCalledWith('scroll', jasmine.any(Function));
  });
});
