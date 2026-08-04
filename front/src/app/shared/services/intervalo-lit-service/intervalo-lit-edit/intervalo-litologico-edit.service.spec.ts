import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { IntervaloLitologicoEditService } from '../intervalo-lit-edit/intervalo-litologico-edit.service';

describe('IntervaloLitologicoEditService', () => {
  let service: IntervaloLitologicoEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(IntervaloLitologicoEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
