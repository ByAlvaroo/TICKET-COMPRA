# Ticket Supremo

Listas de la compra con forma de ticket de súper. El ticket crece cada vez que añades un producto, los tachas en rojo con un toque, cada uno lleva un QR que abre esa misma lista y lo puedes descargar como imagen. Todos tus dispositivos ven los mismos tickets.

**HECHO POR @BYALVARO__**

## Subirlo a GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `ticket-supremo` (puede ser público o privado*).
2. Sube estos archivos a la rama `main`: `index.html`, `styles.css`, `app.js`, `qr.js`, `.nojekyll` y este `README.md`.
3. En el repo ve a **Settings → Pages → Build and deployment**: *Source* = `Deploy from a branch`, *Branch* = `main` / `(root)` y pulsa **Save**.
4. En un minuto la tienes en `https://byalvaroo.github.io/ticket-supremo/`.

\* GitHub Pages en repos privados requiere un plan de pago. Si el repo es público, cualquiera con el enlace puede **ver** tus listas, pero solo tú puedes **editarlas** (hace falta tu token).

## Activar la sincronización (una vez por dispositivo)

Los tickets se guardan en un archivo `tickets.json` en la rama **`datos`** de tu propio repo (la app crea la rama sola la primera vez). Para que un dispositivo pueda editar necesita un token:

1. Entra en <https://github.com/settings/personal-access-tokens/new>.
2. *Repository access* → **Only select repositories** → elige `ticket-supremo`.
3. *Permissions* → *Repository permissions* → **Contents: Read and write**.
4. Genera el token, cópialo y en la app pulsa el engranaje ⚙ → pégalo en **Token** → *Guardar y conectar*.

Repite el paso 4 en el móvil, el iPad, etc. El token solo se guarda en ese navegador. Sin token la app abre en **modo solo lectura**.

## Cómo se usa

- **Nuevo ticket**: nombre, tienda (opcional) y nota al pie (opcional).
- **Añadir productos**: escribe en la impresora. Puedes meter varios a la vez separados por comas, y la cantidad delante o detrás: `2 leche, pan, huevos x12`.
- **Tachar**: toca un producto y se tacha en rojo; tócalo otra vez para quitarlo. La ✕ lo borra.
- **Descargar imagen**: PNG del ticket con su QR (en móvil/iPad abre el menú de compartir para guardarlo en Fotos).
- **Copiar enlace / QR**: abre directamente ese ticket (`…/ticket-supremo/#id-del-ticket`).
- **Quitar tachados**, **Editar ticket** y **Eliminar**.

Si dos dispositivos guardan a la vez, la app vuelve a leer el archivo y reaplica tus cambios, así que no se pierde nada. Los demás dispositivos se actualizan cada ~12 segundos y al volver a la pestaña.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (impresora + ticket térmico) |
| `app.js` | Lógica, sincronización con GitHub, imagen del ticket |
| `qr.js` | Generador de códigos QR (Kazuhiko Arase, licencia MIT) |
| `.nojekyll` | Evita que GitHub Pages procese el sitio con Jekyll |
