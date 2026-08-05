import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SelectorPersonaPozoComponent } from './selector-persona-pozo.component';

describe('SelectorPersonaPozoComponent', () => {
  let fixture: ComponentFixture<SelectorPersonaPozoComponent>;
  let component: SelectorPersonaPozoComponent;
  const personas = [
    { id_usuario: 1, nombre: 'Nombre repetido', email: 'ana@example.test', roles: ['propietario'] },
    { id_usuario: 2, nombre: 'Nombre repetido', email: 'bea@example.test', roles: ['propietario'] },
  ];
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectorPersonaPozoComponent] }).compileComponents();
    fixture = TestBed.createComponent(SelectorPersonaPozoComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput('etiqueta', 'Propietario'); fixture.componentRef.setInput('candidatos', personas);
    fixture.componentRef.setInput('seleccionado', 1); fixture.detectChanges();
  });
  it('busca por nombre y email', () => {
    component.busqueda.set('repetido'); expect(component.filtrados().length).toBe(2);
    component.busqueda.set('bea@'); expect(component.filtrados().map((x) => x.id_usuario)).toEqual([2]);
  });
  it('distingue nombres duplicados y conserva identidad por id_usuario', () => {
    component.elegir(2); expect(component.seleccionado()).toBe(2); expect(component.actual()?.email).toContain('bea@');
  });
  it('representa catálogo vacío sin seleccionar otra identidad', () => {
    fixture.componentRef.setInput('candidatos', []); fixture.detectChanges();
    expect(component.filtrados()).toEqual([]); expect(component.actual()).toBeNull();
  });
});
