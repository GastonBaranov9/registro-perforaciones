import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { UsuariosListService } from './usuarios-list.service';

describe('UsuariosListService', () => {
  let service: UsuariosListService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(UsuariosListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
