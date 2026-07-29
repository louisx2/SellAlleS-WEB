// Escribe la versión del build dentro del Service Worker ya construido.
//
// Por qué hace falta: el navegador solo instala un Service Worker nuevo si el
// archivo cambió byte a byte. `public/sw.js` era idéntico en todos los
// despliegues — el nombre de la caché estaba fijo a mano ('...-v3') — así que
// nunca se instalaba uno nuevo y la app se quedaba corriendo código viejo hasta
// que alguien hacía Ctrl+F5. Con la versión dentro, cada despliegue produce un
// archivo distinto y el navegador se entera.
//
// Se toca la copia de `out/`, no la de `public/`: así el archivo versionado no
// ensucia el repo en cada build (out/ está en .gitignore).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DESTINO = 'out/sw.js';
const MARCA = '__VERSION__';

// Mismo cálculo que next.config.mjs, para que el número que ve el usuario en el
// menú lateral y el de la caché sean el mismo.
function versionDelBuild() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const sucio = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().length > 0;
    return `${fecha}.${sha}${sucio ? '+' : ''}`;
  } catch {
    return `${fecha}.${Date.now().toString(36).slice(-4)}`;
  }
}

if (!existsSync(DESTINO)) {
  console.error(`[version-sw] No existe ${DESTINO}. ¿Se corrió "next build" antes?`);
  process.exit(1);
}

const original = readFileSync(DESTINO, 'utf8');
if (!original.includes(MARCA)) {
  // Fallar aquí y no seguir: un despliegue sin versionar es justo el problema
  // que esto viene a resolver, y en silencio no se nota hasta que alguien se
  // queda con la app vieja.
  console.error(`[version-sw] ${DESTINO} no contiene ${MARCA}. ¿Se editó public/sw.js?`);
  process.exit(1);
}

const version = versionDelBuild();
writeFileSync(DESTINO, original.split(MARCA).join(version), 'utf8');
console.log(`[version-sw] Service Worker marcado como ${version}`);
