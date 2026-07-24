import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosListPage } from './pozos-list.page';

describe('PozosListPage', () => {
  let component: PozosListPage;
  let fixture: ComponentFixture<PozosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PozosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
