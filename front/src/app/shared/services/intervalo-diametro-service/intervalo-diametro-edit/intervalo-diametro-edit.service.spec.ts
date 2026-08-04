import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { IntervaloDiametroEditService } from './intervalo-diametro-edit.service';

describe('IntervaloDiametroEditService', () => {
  let service: IntervaloDiametroEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(IntervaloDiametroEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
