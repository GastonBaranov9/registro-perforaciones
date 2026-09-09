import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideZonelessChangeDetection(),
      ],
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the application shell and router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ion-app')).not.toBeNull();
    expect(compiled.querySelector('#main-content > ion-header')).not.toBeNull();
    expect(compiled.querySelector('#main-content > .app-router > ion-router-outlet')).not.toBeNull();
  });

  it('should not nest the router outlet inside ion-content', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const outlet = compiled.querySelector('#main-content ion-router-outlet');

    expect(compiled.querySelector('#main-content > ion-content')).toBeNull();
    expect(outlet?.closest('ion-content')).toBeNull();
  });

  it('should give the routed content the space below the header', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const mainContent = compiled.querySelector<HTMLElement>('#main-content');
    const routerRegion = compiled.querySelector<HTMLElement>('#main-content > .app-router');
    const outlet = compiled.querySelector<HTMLElement>('.app-router > ion-router-outlet');

    const styleRules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const ruleFor = (selector: string) =>
      styleRules.find((rule) => rule.selectorText.includes(selector));
    const outletRule = styleRules.find(
      (rule) => rule.selectorText.includes('.app-router') && rule.selectorText.includes('ion-router-outlet'),
    );

    expect(mainContent).not.toBeNull();
    expect(routerRegion).not.toBeNull();
    expect(outlet).not.toBeNull();
    expect(getComputedStyle(mainContent!).display).toBe('flex');
    expect(getComputedStyle(mainContent!).flexDirection).toBe('column');
    expect(getComputedStyle(routerRegion!).flex).toBe('1 1 auto');

    expect(ruleFor('#main-content')?.style.height).toBe('100%');
    expect(ruleFor('#main-content')?.style.minHeight).toBe('0px');
    expect(ruleFor('.app-router')?.style.flex).toBe('1 1 auto');
    expect(ruleFor('.app-router')?.style.minHeight).toBe('0px');
    expect(outletRule?.style.width).toBe('100%');
    expect(outletRule?.style.height).toBe('100%');
  });
});
