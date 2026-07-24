import { TestBed } from '@angular/core/testing';

import { AporteListService } from './aporte-list.service';

describe('AporteListService', () => {
  let service: AporteListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AporteListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
