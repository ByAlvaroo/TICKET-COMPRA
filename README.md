# ByTicket

Listas de la compra con forma de ticket, **por comercio** (de momento Mercadona). Eliges productos del catálogo completo por categorías o con el buscador, ajustas la cantidad y aparecen en tu ticket. Todos tus dispositivos ven lo mismo y se puede **instalar como app** en el móvil.

**HECHO POR @BYALVARO__**

## Qué hace

- **Inicio:** eliges comercio (Mercadona; más comercios próximamente).
- **Categorías y buscador:** todas las categorías y productos de Mercadona, con foto. Pulsa **+** para añadirlo y ajusta la cantidad con las flechas ‹ ›.
- **Ticket con estilo Mercadona:** verde, agrupado por categorías en el orden de la tienda.
- **Fijos ⭐:** toca la **foto** de un producto en el ticket. Queda con marco dorado, siempre arriba y **nunca se borra** (los de todas las semanas).
- **Tachar:** toca el producto. Los tachados se **borran solos** a las 24 h (se cambia en ⚙ Ajustes: al momento, 1 h, 6 h, 12 h, 24 h, 3 días, 1 semana o nunca). Los fijos no se borran: se destachan solos para la próxima compra.
- **+ Añadir producto que no está en Mercadona:** debajo de la lista, para cosas a mano (`2 velas, papel regalo`).
- **Cantidad en el ticket:** toca «x 2» para cambiarla.
- **Borrar:** desliza a la izquierda (móvil) o la ✕ (PC).
- **Descargar imagen**, **compartir enlace** y QR que abre ese ticket.
- **Sin conexión:** los cambios se guardan en el móvil y se suben al volver la cobertura.

## 1. Subirlo a GitHub Pages

1. Crea un repositorio, por ejemplo `byticket`.
2. Sube **todo** el contenido del zip a la rama `main`, incluidas las carpetas `.github/`, `scripts/` e `icons/`. En Windows las carpetas que empiezan por punto pueden estar ocultas; si subes arrastrando en la web de GitHub, comprueba que `.github/workflows/catalogo.yml` aparece.
3. **Settings → Pages:** *Deploy from a branch* → `main` / `(root)` → Save.
4. En un minuto está en `https://byalvaroo.github.io/byticket/`.

## 2. Descargar el catálogo de Mercadona (una vez)

El catálogo lo descarga tu propio repo con una GitHub Action:

1. En el repo ve a **Actions**. Si pide activar los workflows, acéptalo.
2. Elige **«Actualizar catálogo de Mercadona»** → **Run workflow**.
3. En unos 3-5 minutos se crea `catalog/mercadona.json` con todas las categorías y productos.

Después se actualiza **solo cada lunes**. También puedes lanzarlo desde la app (⚙ Ajustes → *Actualizar catálogo ahora*) si el token tiene permiso de Actions.

El almacén por defecto es `vlc1` (Valencia). Para otra zona cambia `MERCADONA_WH` en `.github/workflows/catalogo.yml` (por ejemplo `mad1` o `bcn1`).

## 3. Sincronización (una vez por dispositivo)

1. Entra en <https://github.com/settings/personal-access-tokens/new>.
2. *Repository access* → **Only select repositories** → `byticket`.
3. *Permissions* → **Contents: Read and write** y, si quieres actualizar el catálogo desde la app, **Actions: Read and write**.
4. En la app: ⚙ (o ⋯ → Ajustes en el móvil) → pega el token → *Guardar*.

Los tickets se guardan en `tickets.json`, en la rama `datos` de tu repo. Sin token la app abre en modo solo lectura. Si el repo es público, cualquiera con el enlace puede ver las listas, pero solo quien tenga el token puede editarlas.

## Instalarla en el móvil

- **Android (Chrome):** menú ⋯ de la app → *Instalar app en el móvil*.
- **iPhone / iPad (Safari):** *Compartir* → *Añadir a pantalla de inicio*.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `manifest.webmanifest`, `sw.js`, `icons/` | App instalable y sin conexión |
| `qr.js` | Generador de QR (Kazuhiko Arase, MIT) |
| `scripts/actualizar-catalogo.mjs` | Descarga el catálogo de Mercadona |
| `.github/workflows/catalogo.yml` | Lo ejecuta en GitHub cada semana |
| `catalog/mercadona.json` | El catálogo (lo crea la Action) |

ByTicket es un proyecto personal sin relación con Mercadona. Los nombres y fotos de productos se leen de su tienda online pública.
