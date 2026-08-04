import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosDiametrosEditPage } from './intervalos-diametros-edit.page';

describe('IntervalosDiametrosEditPage', () => {
  let component: IntervalosDiametrosEditPage;
  let fixture: ComponentFixture<IntervalosDiametrosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervalosDiametrosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosDiametrosEditPage);
    fixture.componentRef.setInput('id_pozo', 1);
    fixture.componentRef.setInput('id_intervalo_diametro', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
