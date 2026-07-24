import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosDetailPage } from './pozos-detail.page';

describe('PozosDetailPage', () => {
  let component: PozosDetailPage;
  let fixture: ComponentFixture<PozosDetailPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PozosDetailPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozosDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
