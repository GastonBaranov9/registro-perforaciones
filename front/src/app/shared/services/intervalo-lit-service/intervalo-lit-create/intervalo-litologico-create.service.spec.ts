import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { IntervaloLitologicoCreateService } from './intervalo-litologico-create.service';

describe('IntervaloLitologicoCreateService', () => {
  let service: IntervaloLitologicoCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(IntervaloLitologicoCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
