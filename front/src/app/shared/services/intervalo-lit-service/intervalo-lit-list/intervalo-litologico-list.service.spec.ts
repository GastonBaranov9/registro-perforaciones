import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { IntervaloLitologicoListService } from '../intervalo-lit-list/intervalo-litologico-list.service';

describe('IntervaloLitologicoListService', () => {
  let service: IntervaloLitologicoListService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(IntervaloLitologicoListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
