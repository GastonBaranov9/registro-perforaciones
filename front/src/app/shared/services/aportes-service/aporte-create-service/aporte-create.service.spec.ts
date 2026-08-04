import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AporteCreateService } from './aporte-create.service';

describe('AporteCreateService', () => {
  let service: AporteCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AporteCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
