import { TestBed } from '@angular/core/testing';

import { AporteCreateService } from './aporte-create.service';

describe('AporteCreateService', () => {
  let service: AporteCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AporteCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
