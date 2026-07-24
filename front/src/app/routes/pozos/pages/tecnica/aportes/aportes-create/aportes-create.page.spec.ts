import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AportesCreatePage } from './aportes-create.page';

describe('AportesCreatePage', () => {
  let component: AportesCreatePage;
  let fixture: ComponentFixture<AportesCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AportesCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AportesCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
