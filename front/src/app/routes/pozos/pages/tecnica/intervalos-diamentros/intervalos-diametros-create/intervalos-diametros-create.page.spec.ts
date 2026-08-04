import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosDiametrosCreatePage } from './intervalos-diametros-create.page';

describe('IntervalosDiametrosCreatePage', () => {
  let component: IntervalosDiametrosCreatePage;
  let fixture: ComponentFixture<IntervalosDiametrosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervalosDiametrosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosDiametrosCreatePage);
    fixture.componentRef.setInput('id_pozo', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
