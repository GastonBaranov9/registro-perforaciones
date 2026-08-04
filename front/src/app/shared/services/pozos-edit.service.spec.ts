import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { PozosEditService } from './pozos-edit.service';

describe('PozosEditService', () => {
  let service: PozosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(PozosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
