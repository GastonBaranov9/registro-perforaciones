import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozoEditPage } from './pozo-edit.page';

describe('PozoEditPage', () => {
  let component: PozoEditPage;
  let fixture: ComponentFixture<PozoEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PozoEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozoEditPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
