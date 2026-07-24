import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AportesListPage } from './aportes-list.page';

describe('AportesListPage', () => {
  let component: AportesListPage;
  let fixture: ComponentFixture<AportesListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AportesListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AportesListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
