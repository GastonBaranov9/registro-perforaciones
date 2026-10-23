const names = [
  'ANDROID_STORE_FILE',
  'ANDROID_STORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

const missing = names.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Faltan variables de firma: ${missing.join(', ')}`);
  process.exitCode = 2;
} else {
  console.log('Las cuatro variables de firma están definidas. No se verificaron sus valores ni el keystore.');
}
