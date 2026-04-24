# Explorer of War — PWA

Explora el mundo real como un videojuego. Cada lugar que visites desvela la niebla de guerra en el mapa.

## Archivos incluidos

```
explorer-of-war/
├── index.html       ← App principal
├── app.js           ← Lógica GPS, mapa, fog of war
├── sw.js            ← Service Worker (offline + segundo plano)
├── manifest.json    ← Config PWA (nombre, iconos, colores)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## Cómo publicarlo (gratis, 5 minutos)

### Opción A — Netlify Drop (la más fácil, sin cuenta)

1. Ve a **https://app.netlify.com/drop**
2. Arrastra la carpeta `explorer-of-war` completa a la página
3. Netlify te da una URL tipo `https://algo-random.netlify.app`
4. ¡Listo! Ya tienes la app en internet

### Opción B — GitHub Pages

1. Crea una cuenta en **https://github.com** si no tienes
2. Crea un repositorio nuevo (puede ser privado)
3. Sube todos los archivos de esta carpeta
4. Ve a Settings → Pages → Source: "main branch / root"
5. Tu app estará en `https://TU_USUARIO.github.io/NOMBRE_REPO`

---

## Instalar en Android como app

Una vez que tengas la URL publicada:

1. Abre **Chrome en tu Android**
2. Navega a tu URL
3. Toca el menú (⋮) → **"Añadir a pantalla de inicio"**
4. Dale un nombre y confirma
5. La app aparece como icono en tu escritorio

> También puede aparecer automáticamente un banner de instalación en la parte inferior de Chrome.

---

## GPS en segundo plano

El GPS de Android puede pausar apps en segundo plano para ahorrar batería. Para que Explorer of War funcione siempre:

1. Ajustes de Android → Aplicaciones → Chrome
2. Batería → **"Sin restricciones"** o **"Sin optimización de batería"**
3. (Opcional) Activa "Ubicación" en modo **"Alta precisión"**

Con esto, el GPS seguirá registrando tu ruta aunque bloquees la pantalla.

---

## Características

- Mapa real de OpenStreetMap
- Fog of war: niebla negra que se desvela al explorar
- Rastro verde de tu ruta
- Guardado automático en el navegador (localStorage)
- Funciona sin internet una vez cacheado (Service Worker)
- Zoom con pinch y scroll
- Arrastrar mapa con dedo o ratón
- Hitos: notificaciones al alcanzar 10, 50, 100, 500 puntos
- Anillo de precisión GPS visible

---

## Próximas versiones (roadmap)

- [ ] Panel de logros y medallas
- [ ] Contador de ciudades y países visitados
- [ ] Exportar mapa explorado como imagen
- [ ] Modo multijugador (ver amigos en el mapa)
- [ ] Estadísticas semanales / mensuales
- [ ] Notificaciones push con hitos
