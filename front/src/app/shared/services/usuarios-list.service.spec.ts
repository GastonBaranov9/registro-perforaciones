import { TestBed } from '@angular/core/testing';

import { UsuariosListService } from './usuarios-list.service';

describe('UsuariosListService', () => {
  let service: UsuariosListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UsuariosListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
