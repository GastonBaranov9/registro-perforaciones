import {
  Directive,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  Output,
  Renderer2,
} from '@angular/core';
import { catchError, distinctUntilChanged, of, Subject, Subscription, switchMap } from 'rxjs';
import {
  ProtectedResourceService,
  type ProtectedResourceHandle,
} from './protected-resource.service';

@Directive({
  selector: 'img[protectedSrc],ion-img[protectedSrc]',
  standalone: true,
})
export class ProtectedResourceDirective implements OnDestroy {
  private readonly loader = inject(ProtectedResourceService);
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);
  private readonly sources = new Subject<string | null>();
  private current: ProtectedResourceHandle | null = null;

  @Output() readonly protectedResourceError = new EventEmitter<void>();

  private readonly subscription: Subscription = this.sources
    .pipe(
      distinctUntilChanged(),
      switchMap((source) => {
        this.releaseCurrent();
        if (!source) return of(null);
        return this.loader.load(source).pipe(
          catchError(() => {
            this.protectedResourceError.emit();
            return of(null);
          }),
        );
      }),
    )
    .subscribe((handle) => {
      this.current = handle;
      this.renderer.setProperty(this.element.nativeElement, 'src', handle?.url ?? null);
    });

  @Input()
  set protectedSrc(source: string | null | undefined) {
    this.sources.next(source ?? null);
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.sources.complete();
    this.releaseCurrent();
  }

  private releaseCurrent(): void {
    this.current?.revoke();
    this.current = null;
    this.renderer.setProperty(this.element.nativeElement, 'src', null);
  }
}
