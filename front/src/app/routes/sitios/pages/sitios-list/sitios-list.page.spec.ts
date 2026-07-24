import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitiosListPage } from './sitios-list.page';

describe('SitiosListPage', () => {
  let component: SitiosListPage;
  let fixture: ComponentFixture<SitiosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SitiosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitiosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
