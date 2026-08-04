import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { AporteEditService } from './aporte-edit.service';

describe('AporteEditService', () => {
  let service: AporteEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AporteEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
