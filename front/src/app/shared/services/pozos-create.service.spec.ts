import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { PozosCreateService } from './pozos-create.service';

describe('PozosCreateService', () => {
  let service: PozosCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(PozosCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
