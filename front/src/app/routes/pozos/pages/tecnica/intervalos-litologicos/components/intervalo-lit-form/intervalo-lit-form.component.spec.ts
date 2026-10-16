import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { IntervaloLitFormComponent } from './intervalo-lit-form.component';

describe('IntervaloLitFormComponent', () => {
  let component: IntervaloLitFormComponent;
  let fixture: ComponentFixture<IntervaloLitFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervaloLitFormComponent, IonicModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(IntervaloLitFormComponent);
    fixture.componentRef.setInput('intervaloLitologico', {
      desde_m: 0,
      hasta_m: 10,
      material: 'arena',
    });
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('emite el intervalo litologico recibido', () => {
    const emit = spyOn(component.saved, 'emit');

    component.handleIntervaloLit();

    expect(emit).toHaveBeenCalledOnceWith({ desde_m: 0, hasta_m: 10, material: 'arena' });
  });

  it('edita provisional con id nulo y rechaza texto vacío o contradictorio', () => {
    const emit = spyOn(component.saved, 'emit');
    const dato = { desde_m: 0, hasta_m: 10, material: 'Tosca', id_litologia: null as number | null, litologia_provisional: 'Tosca' };
    fixture.componentRef.setInput('intervaloLitologico', dato);
    component.handleIntervaloLit();
    expect(emit).toHaveBeenCalledOnceWith(dato);
    emit.calls.reset();
    dato.litologia_provisional = ' ';
    component.handleIntervaloLit();
    expect(emit).not.toHaveBeenCalled();
    dato.litologia_provisional = 'Tosca'; dato.id_litologia = 1;
    component.handleIntervaloLit();
    expect(emit).not.toHaveBeenCalled();
  });
});
