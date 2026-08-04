import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosDiametrosListPage } from './intervalos-diametros-list.page';

describe('IntervalosDiametrosListPage', () => {
  let component: IntervalosDiametrosListPage;
  let fixture: ComponentFixture<IntervalosDiametrosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervalosDiametrosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosDiametrosListPage);
    fixture.componentRef.setInput('id_pozo', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
