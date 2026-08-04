import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { SitiosFormComponent } from './sitios-form.component';

describe('SitiosFormComponent', () => {
  let component: SitiosFormComponent;
  let fixture: ComponentFixture<SitiosFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [SitiosFormComponent, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(SitiosFormComponent);
    fixture.componentRef.setInput('sitio', { departamento: 'Montevideo' });
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
