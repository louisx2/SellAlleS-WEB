import { execSync } from 'node:child_process';

// Versión que se hornea en el bundle y se muestra en el menú lateral. Sirve
// para saber, mirando la pantalla de alguien, qué build está usando de verdad
// — que no siempre es el último, porque el navegador y el Service Worker
// pueden estar sirviendo uno viejo.
//
// El mismo valor le pone nombre a la caché del Service Worker (ver
// scripts/version-sw.mjs), y eso es lo que hace que el navegador se entere de
// que hay una versión nueva.
function versionDelBuild() {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    // Si hay cambios sin commitear, lo desplegado no es exactamente ese commit.
    const sucio = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().length > 0;
    return `${fecha}.${sha}${sucio ? '+' : ''}`;
  } catch {
    // Sin git (o desplegando desde otro sitio) la fecha y la hora bastan para
    // distinguir un build de otro.
    return `${fecha}.${Date.now().toString(36).slice(-4)}`;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  env: {
    NEXT_PUBLIC_VERSION: versionDelBuild(),
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
      {
        protocol: 'https',
        hostname: 'alephksa.com',
      },
      {
        protocol: 'https',
        hostname: 'cdn.hooli.com.do',
      },
      {
        protocol: 'https',
        hostname: 'm.media-amazon.com',
      },
      {
        protocol: 'https',
        hostname: 'portatilshoprd.com',
      },
      {
        protocol: 'https',
        hostname: 'shop.samsung.com',
      },
      {
        protocol: 'https',
        hostname: 'http2.mlstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'lacasadelascarcasas.com.mx',
      },
      {
        protocol: 'https',
        hostname: 'losgyks.com',
      },
      {
        protocol: 'https',
        hostname: 'encrypted-tbn0.gstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'cdnx.jumpseller.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
