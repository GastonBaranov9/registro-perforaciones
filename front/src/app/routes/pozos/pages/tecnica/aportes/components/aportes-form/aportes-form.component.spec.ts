import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { AportesFormComponent } from './aportes-form.component';

describe('AportesFormComponent', () => {
  let component: AportesFormComponent;
  let fixture: ComponentFixture<AportesFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [AportesFormComponent, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(AportesFormComponent);
    fixture.componentRef.setInput('nivelAporte', { profundidad_m: 10 });
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
