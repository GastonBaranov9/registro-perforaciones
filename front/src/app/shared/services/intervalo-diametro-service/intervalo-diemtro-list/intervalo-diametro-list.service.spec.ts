import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { IntervaloDiametroListService } from './intervalo-diametro-list.service';

describe('IntervaloDiametroListService', () => {
  let service: IntervaloDiametroListService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(IntervaloDiametroListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
