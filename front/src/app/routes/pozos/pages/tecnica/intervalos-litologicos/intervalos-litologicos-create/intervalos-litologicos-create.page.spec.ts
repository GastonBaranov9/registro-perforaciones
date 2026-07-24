import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosCreatePage } from './intervalos-litologicos-create.page';

describe('IntervalosLitologicosCreatePage', () => {
  let component: IntervalosLitologicosCreatePage;
  let fixture: ComponentFixture<IntervalosLitologicosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IntervalosLitologicosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
