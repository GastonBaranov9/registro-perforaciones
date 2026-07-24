import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosEditPage } from './intervalos-litologicos-edit.page';

describe('IntervalosLitologicosEditPage', () => {
  let component: IntervalosLitologicosEditPage;
  let fixture: ComponentFixture<IntervalosLitologicosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalosLitologicosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosEditPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
