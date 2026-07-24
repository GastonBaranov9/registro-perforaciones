import { TestBed } from '@angular/core/testing';

import { IntervaloDiametroListService } from './intervalo-diametro-list.service';

describe('IntervaloDiametroListService', () => {
  let service: IntervaloDiametroListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IntervaloDiametroListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
