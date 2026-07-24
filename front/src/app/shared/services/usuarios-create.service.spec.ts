import { TestBed } from '@angular/core/testing';

import { UsuariosCreateService } from './usuarios-create.service';

describe('UsuariosCreateService', () => {
  let service: UsuariosCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UsuariosCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
