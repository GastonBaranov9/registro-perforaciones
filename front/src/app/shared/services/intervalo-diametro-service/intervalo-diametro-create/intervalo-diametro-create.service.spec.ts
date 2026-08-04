import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { IntervaloDiametroCreateService } from './intervalo-diametro-create.service';

describe('IntervaloDiametroCreateService', () => {
  let service: IntervaloDiametroCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(IntervaloDiametroCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
