import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { SitiosEditService } from './sitios-edit.service';

describe('SitiosEditService', () => {
  let service: SitiosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(SitiosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
