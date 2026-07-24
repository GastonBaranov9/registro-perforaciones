import { TestBed } from '@angular/core/testing';

import { UsuariosEditService } from './usuarios-edit.service';

describe('UsuariosEditService', () => {
  let service: UsuariosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UsuariosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
