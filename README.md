# TDL Dashboard — Taller del Ladrillo

Dashboard comercial para análisis de agentes. Carga archivos CSV y genera métricas, ranking y análisis por agente en tiempo real.

---

## 🚀 Cómo subir a Vercel (paso a paso)

### Opción A — Desde GitHub (recomendado)

**Paso 1: Instalar dependencias y verificar que funciona**
```bash
npm install
npm run dev
```
Abre http://localhost:5173 — deberías ver el dashboard.

**Paso 2: Crear repositorio en GitHub**
1. Ve a https://github.com/new
2. Ponle nombre: `tdl-dashboard`
3. Déjalo en **Private** si quieres
4. Haz clic en **Create repository**

**Paso 3: Subir el código**
```bash
git init
git add .
git commit -m "TDL Dashboard v1"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/tdl-dashboard.git
git push -u origin main
```
*(Cambia `TU_USUARIO` por tu usuario de GitHub)*

**Paso 4: Conectar con Vercel**
1. Ve a https://vercel.com → **Log in with GitHub**
2. Haz clic en **Add New Project**
3. Busca `tdl-dashboard` y haz clic en **Import**
4. Vercel detecta automáticamente que es Vite/React
5. Deja todo por defecto y haz clic en **Deploy**
6. En ~1 minuto tendrás tu URL: `https://tdl-dashboard.vercel.app`

---

### Opción B — Subir directamente con Vercel CLI (sin GitHub)

**Paso 1: Instalar Vercel CLI**
```bash
npm install -g vercel
```

**Paso 2: Hacer build**
```bash
npm install
npm run build
```

**Paso 3: Deploy**
```bash
vercel
```
Sigue las instrucciones en pantalla (te pide hacer login la primera vez).

---

## 📂 Estructura del proyecto

```
tdl-dashboard/
├── index.html          ← Entrada de la app
├── vite.config.js      ← Configuración de Vite
├── package.json        ← Dependencias
├── public/
│   └── favicon.svg     ← Ícono TDL
└── src/
    ├── main.jsx        ← Punto de entrada React
    └── App.jsx         ← Dashboard completo
```

## 📊 Archivos CSV que acepta

| Archivo | Tipo detectado |
|---|---|
| `Total_Presupuestos_*.csv` | Presupuestos |
| `LEADS_abandonados_*.csv` | LEADS |
| `Total_de_llamadas_*.csv` | Llamadas |
| `Distribución_del_último_mensaje_*.csv` | Mensajes |
| `Contactos_por_usuario_asignado_*.csv` | Contactos |

Simplemente arrastra los archivos al área de carga — el sistema detecta el tipo automáticamente.
"# TDL-Dashboard-v1" 
"# TDL-Dashboard-v1" 
"# TDL-Dashboard-v1" 
