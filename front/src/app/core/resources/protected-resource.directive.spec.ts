import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ProtectedResourceDirective } from './protected-resource.directive';
import { ProtectedResourceService, type ProtectedResourceHandle } from './protected-resource.service';

@Component({
  standalone: true,
  imports: [ProtectedResourceDirective],
  template: '<img [protectedSrc]="source" (protectedResourceError)="recordError()" />',
})
class HostComponent {
  source: string | null = 'first';
  errors = 0;
  recordError() { this.errors += 1; }
}

describe('ProtectedResourceDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let load: jasmine.Spy;
  let revokes: Record<string, jasmine.Spy>;

  const handle = (url: string, revoke: jasmine.Spy): ProtectedResourceHandle => ({ url, revoke });

  beforeEach(() => {
    revokes = {};
    load = jasmine.createSpy('load').and.callFake((url: string) => {
      revokes[url] = jasmine.createSpy(`revoke-${url}`);
      return of(handle(`blob:${url}`, revokes[url]));
    });
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: ProtectedResourceService, useValue: { load } }],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renderiza el Blob como object URL y revoca al reemplazar y destruir', () => {
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(image.src).toContain('blob:first');
    host.source = 'second';
    fixture.detectChanges();
    expect(image.src).toContain('blob:second');
    expect(load).toHaveBeenCalledWith('second');
    expect(revokes['first']).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(revokes['second']).toHaveBeenCalledTimes(1);
  });

  it('una respuesta stale no sustituye la imagen más nueva', () => {
    const first = new Subject<ProtectedResourceHandle>();
    const second = new Subject<ProtectedResourceHandle>();
    load.and.callFake((url: string) => (url === 'first' ? first.asObservable() : second.asObservable()));
    fixture.destroy();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    host.source = 'second';
    fixture.detectChanges();
    second.next(handle('blob:second', jasmine.createSpy('revoke-second')));
    first.next(handle('blob:first', jasmine.createSpy('revoke-first')));
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('img') as HTMLImageElement).src).toContain('blob:second');
  });
});
