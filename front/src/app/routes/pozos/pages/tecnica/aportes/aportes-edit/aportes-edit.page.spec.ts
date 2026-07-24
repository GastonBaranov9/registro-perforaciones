import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AportesEditPage } from './aportes-edit.page';

describe('AportesEditPage', () => {
  let component: AportesEditPage;
  let fixture: ComponentFixture<AportesEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AportesEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AportesEditPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
