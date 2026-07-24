import { TestBed } from '@angular/core/testing';

import { AporteEditService } from './aporte-edit.service';

describe('AporteEditService', () => {
  let service: AporteEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AporteEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
