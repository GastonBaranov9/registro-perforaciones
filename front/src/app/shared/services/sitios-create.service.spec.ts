import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { SitiosCreateService } from './sitios-create.service';

describe('SitiosCreateService', () => {
  let service: SitiosCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(SitiosCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
