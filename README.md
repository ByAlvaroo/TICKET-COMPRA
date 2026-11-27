# ByTicket

Listas de la compra con forma de ticket de súper. El ticket crece cada vez que añades un producto, los tachas en rojo con un toque, cada uno lleva un QR que abre esa misma lista y lo puedes descargar como imagen. Todos tus dispositivos ven los mismos tickets y se puede **instalar como app** en el móvil (Chrome o Safari).

**HECHO POR @BYALVARO__**

## Subirlo a GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `byticket` (puede ser público o privado*).
2. Sube **todo** el contenido del zip a la rama `main` (incluida la carpeta `icons/`, `manifest.webmanifest`, `sw.js` y `.nojekyll`).
3. En el repo ve a **Settings → Pages → Build and deployment**: *Source* = `Deploy from a branch`, *Branch* = `main` / `(root)` y pulsa **Save**.
4. En un minuto la tienes en `https://byalvaroo.github.io/byticket/`.

\* GitHub Pages en repos privados requiere un plan de pago. Si el repo es público, cualquiera con el enlace puede **ver** tus listas, pero solo tú puedes **editarlas** (hace falta tu token).

## Activar la sincronización (una vez por dispositivo)

Los tickets se guardan en un archivo `tickets.json` en la rama **`datos`** de tu propio repo (la app crea la rama sola la primera vez). Para que un dispositivo pueda editar necesita un token:

1. Entra en <https://github.com/settings/personal-access-tokens/new>.
2. *Repository access* → **Only select repositories** → elige `byticket`.
3. *Permissions* → *Repository permissions* → **Contents: Read and write**.
4. Genera el token, cópialo y en la app pulsa el engranaje ⚙ → pégalo en **Token** → *Guardar y conectar*.

Repite el paso 4 en el móvil, el iPad, etc. El token solo se guarda en ese navegador. Sin token la app abre en **modo solo lectura**.

## Instalarla en el móvil

- **Android (Chrome):** abre la web → menú ⋯ de la app → *Instalar app en el móvil* (o menú ⋮ de Chrome → *Instalar aplicación*).
- **iPhone / iPad (Safari):** botón *Compartir* → *Añadir a pantalla de inicio* → *Añadir*.
- En el PC (Chrome/Edge) aparece un botón de instalar junto al engranaje.

Instalada se abre a pantalla completa con su icono, carga al instante y **funciona sin conexión**: si tachas o añades cosas sin cobertura en el súper, se guardan en el móvil y se suben solas cuando vuelve la conexión.

## Cómo se usa

- **Nuevo ticket**: nombre, tienda (opcional) y nota al pie (opcional).
- **Añadir productos**: escribe en la impresora. Puedes meter varios a la vez separados por comas, y la cantidad delante o detrás: `2 leche, pan, huevos x12`.
- **Tachar**: toca un producto y se tacha en rojo; tócalo otra vez para quitarlo.
- **Borrar un producto**: en el móvil desliza a la izquierda; en el PC, la ✕.
- **En el móvil** todas las opciones están en el menú ⋯ de arriba a la derecha, para que el ticket se vea limpio.
- **Descargar imagen**: PNG del ticket con su QR (en móvil/iPad abre el menú de compartir para guardarlo en Fotos).
- **Copiar enlace / QR**: abre directamente ese ticket (`…/byticket/#id-del-ticket`).
- **Quitar tachados**, **Editar ticket** y **Eliminar**.

Si dos dispositivos guardan a la vez, la app vuelve a leer el archivo y reaplica tus cambios, así que no se pierde nada. Los demás dispositivos se actualizan cada ~12 segundos y al volver a la pestaña.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (impresora + ticket térmico) |
| `app.js` | Lógica, sincronización con GitHub, imagen del ticket |
| `manifest.webmanifest`, `sw.js` | Lo que la hace instalable y usable sin conexión |
| `icons/` | Iconos de la app |
| `qr.js` | Generador de códigos QR (Kazuhiko Arase, licencia MIT) |
| `.nojekyll` | Evita que GitHub Pages procese el sitio con Jekyll |
