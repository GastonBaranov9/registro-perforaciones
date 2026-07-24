import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosDiametrosCreatePage } from './intervalos-diametros-create.page';

describe('IntervalosDiametrosCreatePage', () => {
  let component: IntervalosDiametrosCreatePage;
  let fixture: ComponentFixture<IntervalosDiametrosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalosDiametrosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosDiametrosCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
