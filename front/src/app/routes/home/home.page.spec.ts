import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [HomePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  for (const width of [320, 360, 768, 1280]) {
    it(`título y tarjeta no desbordan a ${width}px de viewport`, () => {
      // Un iframe aplica media queries y cqi al viewport real, no sólo al ancho del host.
      const frame = document.createElement('iframe');
      frame.style.cssText = `position:absolute;left:-10000px;width:${width}px;height:800px;border:0`;
      document.body.appendChild(frame);
      try {
        const doc = frame.contentDocument!;
        doc.body.style.margin = '0';
        doc.body.style.fontFamily = 'Arial, sans-serif';
        for (const style of document.querySelectorAll('style')) {
          doc.head.appendChild(style.cloneNode(true));
        }
        const hero = (fixture.nativeElement.querySelector('.hero-welcome') as HTMLElement).cloneNode(true) as HTMLElement;
        doc.body.appendChild(hero);
        const card = doc.querySelector('.hero-card') as HTMLElement;
        card.style.animation = 'none';
        expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(hero.scrollWidth).toBeLessThanOrEqual(width);
        const title = doc.querySelector('.hero-title') as HTMLElement;
        expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1);
        for (const span of title.querySelectorAll('span')) {
          const range = doc.createRange();
          range.selectNodeContents(span);
          for (const rect of Array.from(range.getClientRects())) {
            expect(rect.left).toBeGreaterThanOrEqual(card.getBoundingClientRect().left);
            expect(rect.right).toBeLessThanOrEqual(card.getBoundingClientRect().right);
          }
        }
      } finally { frame.remove(); }
    });
  }
});
