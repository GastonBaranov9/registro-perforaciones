import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { SitiosListService } from './sitios-list.service';

describe('SitiosListService', () => {
  let service: SitiosListService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(SitiosListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
