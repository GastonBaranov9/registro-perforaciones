import { TestBed } from '@angular/core/testing';

import { PozosCreateService } from './pozos-create.service';

describe('PozosCreateService', () => {
  let service: PozosCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PozosCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
