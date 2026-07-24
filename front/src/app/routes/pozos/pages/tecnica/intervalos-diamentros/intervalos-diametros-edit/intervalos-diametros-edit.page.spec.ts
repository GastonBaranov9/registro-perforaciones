import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosDiametrosEditPage } from './intervalos-diametros-edit.page';

describe('IntervalosDiametrosEditPage', () => {
  let component: IntervalosDiametrosEditPage;
  let fixture: ComponentFixture<IntervalosDiametrosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalosDiametrosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosDiametrosEditPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
