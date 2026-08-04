import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IntervaloLitFormComponent } from './intervalo-lit-form.component';

describe('IntervaloLitFormComponent', () => {
  let component: IntervaloLitFormComponent;
  let fixture: ComponentFixture<IntervaloLitFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [IntervaloLitFormComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(IntervaloLitFormComponent);
    fixture.componentRef.setInput('intervaloLitologico', {
      desde_m: 0,
      hasta_m: 1,
      material: 'arena',
    });
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
