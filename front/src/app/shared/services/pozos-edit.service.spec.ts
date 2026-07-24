import { TestBed } from '@angular/core/testing';

import { PozosEditService } from './pozos-edit.service';

describe('PozosEditService', () => {
  let service: PozosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PozosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
