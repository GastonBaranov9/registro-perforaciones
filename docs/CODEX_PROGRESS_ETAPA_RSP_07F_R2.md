# ETAPA RSP-07F-R2 — Rollback desde audit fallido y password exacta

Fecha de cierre: 2026-08-14. Rama: `feature/rsp-07-produccion`. HEAD inicial verificado: `d7f88bb8f759c6d31b94e0bb22efb70a473d9e60`, con árbol limpio.

## 1. Resultado

Los dos hallazgos del review quedaron cerrados:

- **P1 rollback desde audit fallido:** resuelto. Un audit `failed` ya no se rechaza por su estado; se valida su formato, fase, refs, deployment state, hashes y backup antes de elegir no-op, rollback de aplicación o restore completo.
- **P2 password del smoke:** resuelto. PowerShell y POSIX conservan todos los caracteres significativos y eliminan únicamente un terminador final LF o CRLF.

La corrección no cambia reglas de negocio ni el contrato de autenticación.

## 2. Causa del P1

El deploy ya emitía `ROLLBACK_REQUIRED=<audit>` al fallar tras una fase con mutación, pero `rollback.ps1` y `rollback.sh` exigían `status=success`. El propio artefacto señalado para recuperar era, por definición, rechazado. Además, el audit anterior no distinguía con precisión la fase iniciada, la última fase completada y la clasificación de recuperación de DB.

## 3. Formato y escritura progresiva del audit

PowerShell usa JSON formato 3 y POSIX un env estricto formato 2. Los formatos difieren por representación, pero contienen la misma semántica:

- proyecto, estado y timestamps UTC;
- `phase_started` y `phase_completed`;
- `database_recovery`;
- path exacto del deployment state y si N+1 llegó a persistirse;
- refs, image IDs, versión, Git SHA y config hash de N;
- refs, versión, Git SHA y config hash de N+1;
- bundle de backup cuando la fase correspondiente completó.

El deploy escribe el audit antes de cada mutación y al completar cada fase mediante archivo temporal y replace/rename atómico. Así, un corte conserva la intención de la fase iniciada y la última fase confirmada. Las fases ordenadas son:

```text
none → preflight → maintenance → backup → images → migrate
     → services → health → smoke → persist_state → complete
```

El estado puede ser `started`, `failed` o `success`; ya no decide por sí solo si el archivo es recuperable.

## 4. Audits fallidos aceptables y validación de seguridad

`deployment-audit.ps1` y `deployment-audit.sh` centralizan la validación previa al rollback. Rechazan:

- formato, status o fase desconocidos;
- fase completada posterior a la iniciada;
- audit malformado, truncado o con campos críticos duplicados/vacíos;
- proyecto o path de deployment state distintos de los solicitados;
- refs `latest`, identificadores inseguros o image IDs ausentes;
- config hashes que no se recomputan exactamente desde las refs/versiones registradas;
- timestamps inválidos;
- backup ausente cuando la fase `backup` figura completada.

El rollback vuelve a resolver las refs N y exige que apunten a los image IDs auditados. También comprueba que el deployment state actual sea N o N+1 según el tipo de audit; no supone que el archivo persistido describa el runtime parcial de un deploy fallido.

## 5. Clasificación por fase

- **Antes de mutaciones:** un fallo limitado a preflight, con deployment state aún en N, devuelve `ROLLBACK_NOT_REQUIRED`. No toca runtime ni DB.
- **Después del switch con DB evaluada compatible:** `database_recovery=operator_assessment_required` permite rollback nivel `Application` únicamente con confirmación explícita `DATABASE_BACKWARD_COMPATIBLE`.
- **Migración potencialmente incompatible:** `database_recovery=restore_required` rechaza nivel `Application` y exige nivel `Full`, backup completado y confirmación `RESTORE_EXISTING_TARGET_FROM_BACKUP`.

No se infiere automáticamente compatibilidad de migraciones forward-only. La decisión segura continúa siendo explícita.

## 6. Rollback de aplicación

El nivel `Application` acepta un audit `success` válido y también un audit fallido apto, siempre que el operador confirme compatibilidad DB. Restaura las imágenes/config N registradas, levanta servicios, ejecuta health y smoke, y recién después persiste atómicamente N en `deployment.env` y emite `ROLLBACK_OK`.

Si health, smoke, imágenes o estado fallan, mantiene/activa mantenimiento, registra `rollback_status=failed` y no emite `ROLLBACK_OK`.

## 7. Restore completo

El nivel `Full` exige que backup haya completado y que el bundle auditado exista. El procedimiento RSP-07C verifica antes de mutar:

- nombre y ubicación segura del bundle;
- manifest y checksums SHA-256;
- dump PostgreSQL y archivo de fotos;
- metadata de migraciones.

Después detiene escrituras, restaura DB y fotos, vuelve a las imágenes N auditadas, ejecuta health y smoke y persiste N. Un audit `failed` sin el backup requerido se rechaza antes de recuperar parcialmente.

## 8. Deployment state durante y después del rollback

El audit registra `deployment_state_persisted`, pero el rollback valida además el archivo real. Esto cubre ambos casos:

- el deploy falló antes de persistir N+1: el state aún describe N aunque el runtime pueda estar parcialmente en N+1;
- el deploy falló después de persistir N+1: el state describe N+1.

Tras rollback exitoso, ambos casos terminan con runtime N y deployment state N. La escritura del estado sigue ocurriendo solo después de health y smoke correctos.

## 9. Causa y corrección del P2

`smoke.ps1` usaba `.Trim()` y `smoke.sh` eliminaba todos los CR/LF con `tr -d`. Ambos modificaban credenciales válidas: espacios iniciales/finales, tabs y cualquier salto contenido dejaban de ser opacos.

Los nuevos helpers `secret-file.ps1` y `secret-file.sh` leen un archivo regular, no symlink, con tamaño limitado. Solo eliminan un terminador final permitido:

```text
" Password123! \n"   → " Password123! "
" Password123! \r\n" → " Password123! "
" Password123! "      → " Password123! "
```

No normalizan whitespace, Unicode, mayúsculas ni minúsculas. POSIX construye el JSON con `jq --rawfile` dentro de un subshell y nunca coloca la password en argumentos, variables exportadas o salida. PowerShell escribe el body temporal sin mostrar su contenido.

## 10. LF, CRLF y paridad

La prueba contractual cubre password simple, espacio inicial, espacio final, ambos espacios, LF, CRLF, ausencia de newline, dos espacios antes del newline, Unicode/tab y una password solo de espacios. PowerShell y POSIX produjeron exactamente los mismos bytes efectivos en los nueve casos, y ninguna credencial apareció en stdout.

El simulacro real usó una password válida con espacios a ambos lados y archivo CRLF. Bootstrap y todos los smoke —deploy, rollback de aplicación y rollback completo— autenticaron con el valor exacto.

## 11. Pruebas de contratos e inválidos

`scripts/test-rsp07f-r2-contracts.ps1` verifica:

- audit `success` válido;
- audit `failed` de preflight como no-op;
- audit `failed` tras services apto para rollback de aplicación;
- audit incompatible que exige Full;
- fallo posterior a persistir N+1;
- rechazo de backup ausente, audit truncado, checksum corrupto, fase desconocida y refs N ausentes;
- matriz de passwords y ausencia de fuga;
- paridad PowerShell/POSIX.

Resultado:

```json
{"success_audit":true,"failed_preflight_noop":true,"failed_switch_application":true,"failed_incompatible_full":true,"failed_persisted_state":true,"invalid_audits_rejected":5,"password_cases":9,"password_output_leak":false,"powershell_posix_exact":true}
```

## 12. Simulacro real del P1

`scripts/test-production-upgrade.ps1` creó un project, network, volúmenes, certificados, env, backups e imágenes aislados. El flujo ejecutado fue:

1. levantar N y cargar usuarios, sitio, pozo, hijos y foto;
2. desplegar N+1 y comprobar el rollback desde audit `success`;
3. iniciar otro deploy N+1;
4. inyectar un fallo controlado después de completar `services`, clasificado `restore_required`;
5. comprobar exit no cero, `DEPLOY_FAILED` y `ROLLBACK_REQUIRED` apuntando al audit exacto;
6. entregar ese mismo audit `status=failed` al rollback nivel Full;
7. verificar restore, runtime N, health, smoke, login, DB, PDF/foto y deployment state N.

Evidencia final:

```json
{"version_n":"rsp07f-n","version_n1":"rsp07f-n1","success_audit_rollback":true,"failed_audit_status":"failed","failed_phase":"services","rollback_required_exact":true,"restore_full":true,"password_whitespace_crlf":true,"deployment_state_final":"rsp07f-n","counts":"3,1,1,1,1","migrations_ok":true,"photo_sha256":"32461d5bd1773012acef0ba15636752949bd7c2ce50f9172159d9f56cf0dd9af","reconcile_clean":true}
```

El cleanup eliminó todos los recursos del project aislado.

## 13. Validación final y regresiones

- PowerShell: parse de todos los scripts modificados OK.
- POSIX: `sh -n` de audit, deploy, rollback, secret helper y smoke OK.
- API build: OK.
- API suite completa: 219/219.
- frontend production build: OK; solo los warnings preexistentes de baseline/Stencil.
- contratos R2: OK.
- contrato R1 de estado N → N+1 → proceso limpio → N: OK.
- simulacro Docker N/N+1/fallo/audit failed/restore/N: OK, 193 s.
- restore: conteos y siete migraciones intactos; foto con el mismo SHA-256.
- reconciliación final: cero referencias faltantes, archivos huérfanos o trash inconsistente.
- `git diff --check`: OK.

Se preservan deployment state, migraciones con checksum/lock, backup/restore, fotos, HTTPS, CSRF, CORS, WebSocket, rate limiting, logs redactados, timeouts DB, PDF concurrency, Swagger off, revocación de logout y migraciones development frescas.

## 14. Hallazgos cerrados y riesgos residuales

El P1 y el P2 del review quedan cerrados. Los riesgos operativos ya documentados no cambian:

- el operador debe confirmar compatibilidad DB para nivel 1;
- restore nivel 2 pierde datos posteriores al backup conforme al RPO;
- una imagen N eliminada del registry/host no se reconstruye: las refs deben permanecer retenidas;
- la variante Docker integral se ejecutó con PowerShell en el host Windows; POSIX tiene pruebas de contrato/paridad y validación sintáctica.

## 15. Pendiente fuera de etapa

No quedan P1/P2 web de RSP-07F-R2. **P2-10 autenticación Android** permanece fuera de esta etapa.
