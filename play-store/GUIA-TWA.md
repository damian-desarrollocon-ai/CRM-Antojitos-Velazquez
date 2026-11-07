# Guía: de tu página a un APK / Google Play (TWA)

Un TWA es una app de Android que abre tu tienda de Vercel a pantalla completa, sin barra del navegador.
Todo lo que cambies en tu página se actualiza solo; el APK casi no se vuelve a tocar.

## 0) Antes de empezar
1. **Decide tu dominio FINAL.** El TWA queda amarrado al dominio. Si luego cambias de `crm-antojitos-velazquez.vercel.app`
   a un dominio propio, hay que generar y publicar otra app. Si vas a comprar un dominio, hazlo antes del paso 2.
2. Sube a Vercel los archivos de esta actualización y abre tu sitio en Chrome → F12 → pestaña **Application → Manifest**:
   debe verse el nombre, los íconos y sin errores en rojo.
3. Revisa que `https://TU-DOMINIO/privacidad` abra bien.

## 1) Cuenta de desarrollador de Google
- play.google.com/console → pago único de **$25 USD** y verificación de identidad.
- Cuenta **personal**: para producción necesitas una prueba cerrada con **12 testers durante 14 días seguidos**.
- Cuenta de **organización** (con D-U-N-S): no pide esa prueba.

## 2) Generar el APK y el AAB con PWABuilder
1. Entra a **pwabuilder.com**, pega `https://TU-DOMINIO` y toca **Start**.
2. Cuando termine el análisis, **Package for stores → Android**.
3. Datos sugeridos (los nombres de los campos pueden variar un poco):
   - **Package ID:** `mx.antojitosvelazquez.app` (no se puede cambiar después de publicar)
   - **App name:** Antojitos Velázquez · **Short name:** Antojitos
   - **Version:** 1.0.0 · **Version code:** 1 (sube +1 en cada actualización del APK)
   - **Display mode:** Standalone · **Status bar / Nav bar:** #111111
   - **Signing key:** *Create new* y llena tus datos. Deja las demás opciones como vienen.
4. Descarga el zip. Trae: `.aab` (para Play), `.apk` (para probar), `signing.keystore` y `signing-key-info.txt`.
5. **Guarda `signing.keystore` y su contraseña en dos lugares** (Drive y una USB). No la subas a GitHub.

## 3) Enlace de verificación con tu página (assetlinks)
Sin este paso la app mostraría una barra del navegador arriba.
1. Abre `signing-key-info.txt` y copia la huella **SHA-256** (formato `AA:BB:CC:...`).
2. Edita `public/.well-known/assetlinks.json`:
   - `package_name`: tu Package ID
   - `sha256_cert_fingerprints`: pon la huella.
3. Haz `git add . && git commit -m "assetlinks" && git push`.
4. Comprueba (debe salir tu paquete, sin `{}` vacío):
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://TU-DOMINIO&relation=delegate_permission/common.handle_all_urls`

## 4) Prueba en tu celular
Pásate el `.apk` (WhatsApp o Drive), instálalo y ábrelo con internet.
Si se ve **sin barra de URL**, quedó verificado. Si aparece una barra, la huella o el package no coinciden.

## 5) Subir a Google Play
1. Play Console → **Crear app** (Español México, App, Gratuita).
2. Llena la ficha con `ficha-play-store.md` y sube `icono-512.png` y `feature-graphic-1024x500.png`.
3. Completa: Clasificación de contenido, Seguridad de los datos, Público objetivo y Política de privacidad.
4. **Prueba cerrada** → crea la versión → sube el `.aab` → agrega los correos de tus testers → comparte el enlace de aceptación.
5. **Importante, huella de Play:** al subir el `.aab`, Google re-firma tu app. Ve a
   **Configuración → Integridad de la app → Firma de apps** y copia la **huella SHA-256 del certificado de firma de la app**.
   Agrégala como **segunda huella** en `assetlinks.json` (déjala junto a la primera) y haz push.
   Sin esto, la app instalada desde Play mostrará la barra del navegador.
6. Cuando se cumpla la prueba cerrada, solicita **producción**.

## 6) Activar el banner "Descargar en Google Play" en la tienda
En Vercel → Settings → Environment Variables agrega:
`VITE_PLAY_URL = https://play.google.com/store/apps/details?id=mx.antojitosvelazquez.app` y redeploy.
(Antes de Play, puedes usar `VITE_APK_URL` con el enlace a tu APK en GitHub Releases.)
Dentro de la app instalada el banner no aparece.

## 7) Actualizaciones
- Cambios en la tienda, menú, precios, diseño: solo `git push`, la app los toma sola.
- Nuevo AAB solo si cambias el ícono, el nombre, el package o la versión de Android objetivo
  (Google pide subir el nivel de API cada año; PWABuilder lo trae actualizado).
