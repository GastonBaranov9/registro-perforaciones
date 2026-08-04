import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AporteListService } from './aporte-list.service';

describe('AporteListService', () => {
  let service: AporteListService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AporteListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
