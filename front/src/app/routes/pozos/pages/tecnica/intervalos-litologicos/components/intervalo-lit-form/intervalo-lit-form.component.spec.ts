import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { IntervaloLitFormComponent } from './intervalo-lit-form.component';

describe('IntervaloLitFormComponent', () => {
  let component: IntervaloLitFormComponent;
  let fixture: ComponentFixture<IntervaloLitFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervaloLitFormComponent, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(IntervaloLitFormComponent);
    fixture.componentRef.setInput('intervaloLitologico', { desde_m: 0, hasta_m: 10, material: 'arena' });
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
});
