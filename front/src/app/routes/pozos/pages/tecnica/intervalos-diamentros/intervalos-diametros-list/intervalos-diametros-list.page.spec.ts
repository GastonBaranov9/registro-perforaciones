import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosDiametrosListPage } from './intervalos-diametros-list.page';

describe('IntervalosDiametrosListPage', () => {
  let component: IntervalosDiametrosListPage;
  let fixture: ComponentFixture<IntervalosDiametrosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalosDiametrosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosDiametrosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
