import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosListPage } from './intervalos-litologicos-list.page';

describe('IntervalosLitologicosListPage', () => {
  let component: IntervalosLitologicosListPage;
  let fixture: ComponentFixture<IntervalosLitologicosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalosLitologicosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
