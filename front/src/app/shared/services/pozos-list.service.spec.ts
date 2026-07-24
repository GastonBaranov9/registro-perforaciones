import { TestBed } from '@angular/core/testing';

import { PozosListService } from './pozos-list.service';

describe('PozosListService', () => {
  let service: PozosListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PozosListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
