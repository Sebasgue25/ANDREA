# Subir Andrea a GitHub

Estos archivos están listos para guardarse en un repositorio privado de GitHub y publicarse como una aplicación web.

## 1. Crear el repositorio

1. Entra a [github.com/new](https://github.com/new).
2. Escribe el nombre `andrea-pedidos`.
3. Selecciona **Private** para que el código no sea público.
4. No marques la opción de crear README, `.gitignore` o licencia: esta carpeta ya los contiene.
5. Pulsa **Create repository**.

## 2. Cargar los archivos

1. En el nuevo repositorio, pulsa **Add file** y luego **Upload files**.
2. Sube todo el contenido de esta carpeta, incluyendo la carpeta oculta `.github`.
3. Escribe como mensaje: `Primera versión de Andrea Pedidos`.
4. Pulsa **Commit changes**.

## 3. Publicar la aplicación

1. En el repositorio entra a **Settings** → **Pages**.
2. En **Build and deployment**, elige **GitHub Actions** como fuente.
3. GitHub ejecutará el archivo `.github/workflows/deploy-pages.yml` y mostrará el enlace de la aplicación al terminar.

Después de cada cambio enviado a la rama `main`, GitHub actualizará la aplicación automáticamente.

## Seguridad

- Nunca subas contraseñas, pedidos reales de clientes, firmas electrónicas, certificados ni claves de Supabase.
- El archivo `.gitignore` evita subir archivos `.env`, pero revisa siempre los archivos antes de confirmar un cambio.
- GitHub Pages publica una web estática. En esta primera versión los pedidos continúan guardándose en el navegador de cada dispositivo. Para compartir pedidos entre celulares se debe conectar Supabase.
