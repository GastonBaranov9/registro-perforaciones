import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNativeStyleDelivery } from './native-style-contract.mjs';

const ionicPageCss =
  '.ion-page{left:0;right:0;top:0;bottom:0;display:flex;position:absolute;flex-direction:column}' +
  'ion-route,.ion-page-hidden{display:none!important}';

test('acepta el CSS Ionic estructural cargado sin JavaScript inline', () => {
  assert.deepEqual(
    validateNativeStyleDelivery(
      '<link rel="stylesheet" href="styles-ABC123.css">',
      ionicPageCss,
    ),
    { stylesheetHref: 'styles-ABC123.css' },
  );
});

test('rechaza el patrón async de critical CSS que bloquea la CSP nativa', () => {
  assert.throws(
    () =>
      validateNativeStyleDelivery(
        '<link rel="stylesheet" href="styles-ABC123.css" media="print" onload="this.media=\'all\'">',
        ionicPageCss,
      ),
    /media="print"/,
  );
});

test('rechaza bundles sin las reglas estructurales de páginas Ionic', () => {
  assert.throws(
    () =>
      validateNativeStyleDelivery(
        '<link rel="stylesheet" href="styles-ABC123.css">',
        '.ion-page{display:block;position:static}.ion-page-hidden{visibility:hidden}',
      ),
    /display: flex/,
  );
});
