import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { UsuariosEditService } from './usuarios-edit.service';

describe('UsuariosEditService', () => {
  let service: UsuariosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(UsuariosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
