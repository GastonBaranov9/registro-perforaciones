import { TestBed } from '@angular/core/testing';

import { IntervaloDiametroCreateService } from './intervalo-diametro-create.service';

describe('IntervaloDiametroCreateService', () => {
  let service: IntervaloDiametroCreateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IntervaloDiametroCreateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
