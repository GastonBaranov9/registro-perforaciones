const fs = require('fs');

const args = process.argv.slice(2);
if (args.includes('-n')) {
  const emailIndex = args.indexOf('--arg');
  const passwordIndex = args.indexOf('--rawfile');
  if (emailIndex < 0 || passwordIndex < 0 || args[emailIndex + 1] !== 'email' || args[passwordIndex + 1] !== 'password') process.exit(2);
  try {
    process.stdout.write(JSON.stringify({ email: args[emailIndex + 2], password: fs.readFileSync(args[passwordIndex + 2], 'utf8') }));
    process.exit(0);
  } catch (error) {
    process.stderr.write(`fixture jq no pudo construir login: ${error.message}\n`);
    process.exit(4);
  }
}
if (args.length < 2) process.exit(2);
const file = args[args.length - 1];
const expression = args[args.length - 2];
let value;
try {
  value = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  process.stderr.write(`fixture jq no pudo leer JSON (${file}): ${error.message}\n`);
  process.exit(4);
}

if (args.includes('-f') || expression.includes('type=="array"')) {
  const valid = Array.isArray(value) && value.every((well) =>
    well && Number.isSafeInteger(well.id_pozo) && well.id_pozo>0 && Object.hasOwn(well,'id_propietario') &&
    (well.id_propietario!=null ? Number.isSafeInteger(well.id_propietario)&&well.id_propietario>0&&well.propietario_provisional==null :
      well.propietario_provisional!=null ? typeof well.propietario_provisional==='string'&&well.propietario_provisional.length<=160&&well.propietario_provisional.replace(/^ +| +$/g,'').length>0 : well.origen==='historico') &&
    (well.foto_url == null || typeof well.foto_url === 'string'));
  process.exit(valid ? 0 : 1);
}
if (!Array.isArray(value)) process.exit(5);
if (expression === 'length') {
  process.stdout.write(String(value.length));
  process.exit(0);
}
if (expression.includes('[.[]|select')) {
  const candidate = value.find((well) => typeof well.foto_url === 'string' && well.foto_url !== '');
  if (candidate) process.stdout.write(String(expression.includes('id_propietario') ? (candidate.id_propietario ?? 0) : candidate.id_pozo));
  process.exit(0);
}
if (expression.includes('.[0].id_pozo')) {
  if (!value[0] || value[0].id_pozo == null) process.exit(1);
  process.stdout.write(String(value[0].id_pozo));
  process.exit(0);
}
if (expression.includes('.[0].id_propietario')) {
  if (!value[0]) process.exit(1);
  process.stdout.write(String(value[0].id_propietario ?? 0));
  process.exit(0);
}
process.exit(6);
