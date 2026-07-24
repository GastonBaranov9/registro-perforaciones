import { TestBed } from '@angular/core/testing';

import { SitiosListService } from './sitios-list.service';

describe('SitiosListService', () => {
  let service: SitiosListService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SitiosListService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
