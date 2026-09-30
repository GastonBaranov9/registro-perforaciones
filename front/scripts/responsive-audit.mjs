// Run against `ng serve --host 127.0.0.1 --port 4206`. All API data is synthetic.
// Uses installed Chrome + CDP; no browser dependency or pilot connection.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { crearPerfilLitologico } from '../../api/src/pdf/perfil-litologico.ts';

const phase = process.argv[2] ?? 'after';
const viewportHeight = Number(process.env.AUDIT_HEIGHT ?? 900);
assert.ok(Number.isInteger(viewportHeight) && viewportHeight >= 320 && viewportHeight <= 1600);
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after');
const evidenceName = process.env.AUDIT_NAME ?? phase;
assert.match(evidenceName, /^[a-z0-9-]+$/);
const out = new URL(`../../docs/evidence/rsp10/${evidenceName}/`, import.meta.url);
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'rsp10-chrome-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let ws;
const pending = new Map(); let serial = 0;
function send(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve: v => { clearTimeout(timeout); resolve(v); }, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const roles = ['administracion', 'perforador', 'propietario'].map((nombre, i) => ({ id_rol: i + 1, nombre, descr: nombre }));
const user = { id_usuario: 1, nombre: 'Gaston Baranov Apellido Extenso', email: 'administracion.campo.correo.muy.largo@ejemplo.test', activo: true, fecha_registro: '2026-09-01', roles };
const sitio = { id_sitio: 1, departamento: 'Río Negro', localidad: 'Paso de los Mellizos', padron: '001-A', latitud: '-32.7345678', longitud: '-57.1234567' };
const pozo = { id_pozo: 1, id_propietario: 1, id_perforador: 1, id_sitio: 1, empresa: 'Raúl Silva Perforaciones', fecha_creado: '2026-09-01', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-02', profundidad_final_m: 30, caudal_estimado_lh: 1200, sitio, propietario_nombre: user.nombre, propietario_email: user.email, perforador_nombre: user.nombre, metodo_sedimentario: 'Rotación con circulación de lodo', metodo_rocoso: 'Rotopercusión', cementacion: 'Sellado de espacio anular', desarrollo: 'Limpieza y ensayo de bombeo' };
const persona = { ...user, roles: ['propietario', 'perforador'] };
const catalogo = [{ id_litologia: 30, codigo: 'sello_sanitario', nombre: 'Sello sanitario', familia: 'otro', color: '#999999', patron: 'concrete', activo: true, orden: 30 }];
const intervalo = { id_intervalo_litologico: 1, id_pozo: 1, desde_m: 0, hasta_m: 2, material: 'Sello sanitario', id_litologia: 30, litologia_nombre: 'Sello sanitario', litologia_color: '#999999', litologia_patron: 'concrete', litologia_activa: true };
const perfil = crearPerfilLitologico([intervalo], 30);
function fixture(path) {
  if (path === '/login') return user;
  if (path.includes('candidatos-personas')) return { propietarios: [persona], perforadores: [persona] };
  if (path === '/roles') return roles;
  if (path === '/litologias') return catalogo;
  if (path.includes('/perfil-litologico')) return perfil;
  if (path.endsWith('/intervalo_litologico')) return [intervalo];
  if (path.endsWith('/mapa-config')) return { configurado: false };
  if (/\/usuarios\/\d+\/pozos\/\d+$/.test(path)) return pozo;
  if (path.endsWith('/pozos')) return [pozo];
  if (/\/sitios\/\d+$/.test(path)) return sitio;
  if (path.endsWith('/sitios')) return [sitio];
  if (/\/usuarios\/\d+$/.test(path)) return user;
  if (path === '/usuarios') return [user, { ...user, id_usuario: 2, activo: false }];
  if (/intervalo|aporte/.test(path)) return /\/\d+$/.test(path) ? { desde_m: 0, hasta_m: 2, profundidad_m: 2, diametro_pulg: 6, material: 'Sello sanitario', id_litologia: 30 } : [];
  return null;
}
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
try {
  let target;
  for (let i = 0; i < 60; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9335/json/list')).json()).find(t => t.type === 'page'); if (target) break; } catch {}
    await delay(250);
  }
  if (!target) throw new Error('Chrome CDP unavailable');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', async ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(m.error) : p?.resolve(m.result); }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params; const url = new URL(request.url);
      if (url.origin === 'http://127.0.0.1:4206') { await send('Fetch.continueRequest', { requestId }); return; }
      const body = fixture(url.pathname);
      await send('Fetch.fulfillRequest', { requestId, responseCode: body === null ? 404 : 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: 'http://127.0.0.1:4206' }, { name: 'Access-Control-Allow-Credentials', value: 'true' }, { name: 'Access-Control-Allow-Headers', value: 'content-type,authorization,x-requested-with' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' }],
        body: Buffer.from(JSON.stringify(body ?? { message: 'Synthetic audit fixture unavailable' })).toString('base64') });
    }
  });
  await send('Page.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const routes = (process.env.AUDIT_ROUTES ?? 'home,login,pozo,sitio,usuario,usuario-detail,usuarios-list,usuarios-create,usuarios-edit/1,sitios-list,sitios-create/1,sitios-edit/1,sitio-detail/1,pozos-list,pozos-create,pozo-edit/1,pozos-detail/1,litologias-admin,pozos/1/intervalos-litologicos-list,pozos/1/intervalos-litologicos-create,pozos/1/intervalos-litologicos-edit/1,pozos/1/intervalos-diametros-list,pozos/1/intervalos-diametros-create,pozos/1/intervalos-diametros-edit/1,pozos/1/aportes-list,pozos/1/aportes-create,pozos/1/aportes-edit/1').split(',');
  const results = [];
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: viewportHeight, deviceScaleFactor: 1, mobile: false });
    for (const route of routes) {
      await send('Page.navigate', { url: `http://127.0.0.1:4206/${route}` });
      await delay(1500);
      if (phase === 'after' && ['pozo-edit/1', 'pozos-detail/1'].includes(route)) {
        assert.ok(await evaluate(`!!document.querySelector('app-perfil-litologico svg')`), 'Profile fixture must render, not an error placeholder');
      }
      if (phase === 'after' && route === 'pozo-edit/1') {
        await evaluate(`document.querySelectorAll('app-selector-persona-pozo ion-input').forEach(el => { el.value='Gaston'; el.dispatchEvent(new CustomEvent('ionInput',{detail:{value:'Gaston'},bubbles:true})); })`);
        await delay(600);
        assert.equal(await evaluate(`document.querySelectorAll('.persona-option').length`), 2, 'Both person selectors must display search results');
      }
      const geometry = await evaluate(`(() => {
        const nodes = []; const walk = root => { for (const el of root.querySelectorAll('*')) { nodes.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document);
        const visible = el => { const r = el.getBoundingClientRect(); return r.width && r.height && getComputedStyle(el).visibility !== 'hidden' && !el.closest('ion-menu'); };
        const outside = nodes.filter(el => visible(el) && !el.closest('svg') && (el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1)).map(el => ({ tag: el.tagName, cls: String(el.className), text: el.textContent.trim().slice(0,65), width: Math.round(el.getBoundingClientRect().width) }));
        const clipped = nodes.filter(el => visible(el) && el.matches('ion-label,.hero-title,button,ion-button,select') && el.scrollWidth > el.clientWidth + 2).map(el => ({ tag: el.tagName, text: el.textContent.trim().slice(0,65), width: el.clientWidth, scroll: el.scrollWidth }));
        const smallTargets = nodes.filter(el => visible(el) && el.matches('ion-button,button,ion-menu-button,ion-back-button') && !el.disabled && (el.getBoundingClientRect().height < 47 || el.getBoundingClientRect().width < 47)).map(el => ({ tag: el.tagName, text: el.textContent.trim().slice(0,45), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
        const overlappingRows = [...document.querySelectorAll('.data-row')].filter(el => { const labels = el.querySelectorAll('dt,dd'); if(labels.length !== 2) return false; const a=labels[0].getBoundingClientRect(), b=labels[1].getBoundingClientRect(); return a.bottom > b.top + 1 && a.right > b.left + 1; }).length;
        return { route: location.pathname, buildError: !!document.querySelector('vite-error-overlay'), outside: outside.slice(0,20), clipped, smallTargets, overlappingRows, title: document.querySelector('h1')?.textContent.trim(), text: document.querySelector('ion-router-outlet')?.textContent.trim().slice(0,120) };
      })()`);
      results.push({ width, height: viewportHeight, route, ...geometry });
      assert.equal(geometry.buildError, false, 'Dev server build error: audit invalid');
      assert.equal(geometry.route, '/' + route, 'Unexpected redirect: fixture/guard failure');
      if ([320, 390, 1280].includes(width) && ['home', 'login', 'usuarios-list', 'pozo-edit/1', 'pozos-list'].includes(route)) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        await writeFile(new URL(`${route.replaceAll('/', '-')}-${width}.png`, out), Buffer.from(shot.data, 'base64'));
      }
      console.log(`${phase} ${width} ${route}: ${geometry.outside.length} outside`);
      if (phase === 'after' && route === 'login') {
        const initial = await evaluate(`(async () => {
          const host=document.querySelector('ion-input[name=password]'); const input=await host.getInputElement();
          input.focus(); input.value='Clave de prueba'; input.dispatchEvent(new Event('input',{bubbles:true}));
          const r=document.querySelector('.password-toggle').getBoundingClientRect();
          return {type:input.type,x:r.x+r.width/2,y:r.y+r.height/2};
        })()`);
        assert.equal(initial.type, 'password');
        await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,x:initial.x,y:initial.y});
        await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,x:initial.x,y:initial.y});
        await delay(100);
        const visible = await evaluate(`(async () => {
          const input=await document.querySelector('ion-input[name=password]').getInputElement();
          return {type:input.type,value:input.value,focus:document.activeElement===input,label:document.querySelector('.password-toggle').shadowRoot.querySelector('button').getAttribute('aria-label'),busy:document.querySelector('.login-button').disabled};
        })()`);
        assert.deepEqual(visible, {type:'text',value:'Clave de prueba',focus:true,label:'Ocultar contraseña',busy:false});
        await evaluate(`document.querySelector('.password-toggle').shadowRoot.querySelector('button').focus()`);
        await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
        await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await delay(100);
        assert.equal(await evaluate(`document.querySelector('ion-input[name=password]').type`), 'password');
        assert.equal(await evaluate(`location.pathname`), '/login');
        await evaluate(`document.querySelector('ion-input[name=password]').setFocus()`);
        await send('Emulation.setTouchEmulationEnabled', {enabled:true,maxTouchPoints:1});
        await send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:initial.x,y:initial.y}]});
        await send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
        await delay(100);
        const touch = await evaluate(`(async () => { const input=await document.querySelector('ion-input[name=password]').getInputElement(); return {type:input.type,value:input.value,focus:document.activeElement===input}; })()`);
        assert.deepEqual(touch, {type:'text',value:'Clave de prueba',focus:true});
        await send('Emulation.setTouchEmulationEnabled', {enabled:false});
        results[results.length - 1].passwordToggle = {hiddenByDefault:true,pointerPreservesInputFocus:true,keyboardToggle:true,touchPreservesInputFocus:true,valuePreserved:true};
      }
      if (phase === 'after' && route === 'pozo-edit/1') {
        const { root } = await send('DOM.getDocument');
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'app-foto input[type=file]' });
        assert.ok(nodeId, 'Photo selector must render');
        await send('DOM.setFileInputFiles', { nodeId, files: [fileURLToPath(new URL('../public/assets/branding/logo.png', import.meta.url))] });
        await delay(350);
        const preview = await evaluate(`(() => { const img=document.querySelector('.foto-preview'); document.querySelector('.foto-editor')?.scrollIntoView({block:'center'}); return {loaded: !!img?.complete && img.naturalWidth > 0, pending: document.querySelector('.foto-pendiente')?.textContent, count: document.querySelectorAll('.foto-preview').length}; })()`);
        assert.equal(preview.loaded, true, 'Selected file must display immediately');
        assert.equal(preview.count, 1);
        assert.match(preview.pending, /pendiente de guardar/);
        await delay(200);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        await writeFile(new URL(`photo-pending-${width}.png`, out), Buffer.from(shot.data, 'base64'));
        results[results.length - 1].photo = preview;
      }
      if (phase === 'after' && route === 'pozos-list') {
        await evaluate(`document.querySelector('#open-filters').click()`);
        await delay(400);
        const modal = await evaluate(`(() => { const el=document.querySelector('ion-modal'); const r=el?.shadowRoot?.querySelector('[part=content]')?.getBoundingClientRect(); return r ? {left:r.left,right:r.right,top:r.top,bottom:r.bottom,inputs:el.querySelectorAll('ion-input').length} : null; })()`);
        assert.ok(modal && modal.inputs === 4, 'Filters modal must open');
        assert.ok(modal.left >= 0 && modal.right <= width + 1 && modal.top >= 0 && modal.bottom <= viewportHeight + 1);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        await writeFile(new URL(`filters-${width}.png`, out), Buffer.from(shot.data, 'base64'));
        results[results.length - 1].modal = modal;
      }
      if (phase === 'after' && route === 'home') {
        const home = await evaluate(`(async () => {
          const img=new Image(); img.src='/assets/branding/background.jpeg'; await img.decode();
          const content=document.querySelector('ion-router-outlet ion-content');
          return {imageLoaded:img.naturalWidth>0,background:getComputedStyle(content).getPropertyValue('--background'),homeAdmin:!!content.querySelector('ion-button'),menuAdmin:!!document.querySelector('ion-menu [routerlink="/litologias-admin"]')};
        })()`);
        assert.ok(home.imageLoaded && home.background.includes('background.jpeg') && !home.homeAdmin && home.menuAdmin);
        results[results.length - 1].home = home;
        // Exercise the fallback variables emitted by Capacitor on older WebViews.
        const insets = await evaluate(`(() => {
          const root=document.documentElement;
          root.style.setProperty('--safe-area-inset-top','24px');
          root.style.setProperty('--safe-area-inset-bottom','32px');
          const toolbar=document.querySelector('ion-toolbar');
          const content=document.querySelector('app-home ion-content') ?? document.querySelector('ion-router-outlet ion-content');
          const result={top:parseFloat(getComputedStyle(toolbar).paddingTop),bottom:parseFloat(getComputedStyle(content.shadowRoot.querySelector('[part=scroll]')).paddingBottom),token:getComputedStyle(root).getPropertyValue('--ion-safe-area-bottom').trim()};
          root.style.removeProperty('--safe-area-inset-top');
          root.style.removeProperty('--safe-area-inset-bottom');
          return result;
        })()`);
        assert.ok(insets.top >= 24 && insets.bottom >= 32 && insets.token === '32px', 'Capacitor safe-area fallback must reach Ionic');
        results[results.length - 1].insets = insets;
        await evaluate(`document.querySelector('ion-menu').open()`);
        await delay(350);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        await writeFile(new URL(`menu-${width}.png`, out), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  await writeFile(new URL('geometry.json', out), JSON.stringify(results, null, 2));
  const failures = results.filter(r => r.outside.length || r.clipped.length || r.smallTargets.length || r.overlappingRows);
  console.log(`RESULT: ${results.length} route/viewport measurements; ${failures.length} require review.`);
  assert.equal(failures.length, 0, 'Responsive geometry regression; see geometry.json');
} finally { ws?.close(); chrome.kill(); }
