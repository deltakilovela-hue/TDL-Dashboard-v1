# TDL Dashboard — Taller del Ladrillo

Dashboard comercial para análisis de actividad por asesor, alimentado en vivo desde GoHighLevel (GHL).

---

## 🔌 Cómo funciona la conexión de datos

Este dashboard **no usa carga manual de CSV** como fuente principal — se conecta directo a la API de GHL:

| Fuente | Qué trae | Cuándo corre |
|---|---|---|
| `/api/sync` (Vercel serverless) | Contactos, pipelines, oportunidades, conversaciones — en vivo | Cada vez que se abre el dashboard o se pulsa "Sincronizar" (cache de 30 min en Upstash Redis) |
| `scripts/sync-deep.mjs` (GitHub Actions) | Estadísticas diarias por asesor: mensajes enviados, llamadas | Cron cada 2 horas, guarda en Redis (`tdl:ghl:deep:v1`) |

Variables de entorno requeridas (Vercel + GitHub Secrets):
```
GHL_API_KEY
GHL_LOCATION_ID
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Solo en Vercel (feature de Resumen IA en la ficha de contacto, no la usa el job nocturno):
```
OPENAI_API_KEY
OPENAI_MODEL   # opcional, default "gpt-4o-mini"
```

### ⚠️ Importante: el job nocturno se puede auto-desactivar

GitHub **desactiva automáticamente** cualquier workflow con `schedule:` si el repositorio pasa **60 días sin un `push`**. Si eso pasa, `/api/deep-stats` sigue respondiendo pero con datos congelados (sin aviso visible salvo el banner de "desactualizado" en el dashboard).

Para evitarlo, `.github/workflows/keepalive.yml` hace un commit trivial cada 3 semanas — no debería volver a pasar, pero si el dashboard muestra el banner ámbar de "Estadísticas de actividad desactualizadas":

1. Ve a **GitHub → Actions → Sync GHL Deep Stats**
2. Si dice "This scheduled workflow is disabled", haz clic en **Enable workflow**
3. Lánzalo manualmente una vez con **Run workflow** para refrescar los datos de inmediato

También se puede verificar el estado de la conexión con GHL en cualquier momento visitando `/api/debug` (requiere las env vars configuradas en Vercel).

---

## 🚀 Desarrollo local

```bash
npm install
npm run dev
```
Abre http://localhost:5173

## 📦 Deploy

El repo está conectado a Vercel vía GitHub — cualquier push a `main` dispara un deploy automático. No requiere pasos manuales adicionales.

---

## 📂 Estructura del proyecto

```
TDL-Dashboard-v1/
├── api/                    ← Funciones serverless de Vercel (sync, deep-stats, audit, etc.)
├── scripts/sync-deep.mjs   ← Job nocturno de GitHub Actions (stats históricas)
├── .github/workflows/      ← sync-deep.yml (cron 2h) + keepalive.yml (evita auto-disable)
├── src/
│   ├── App.jsx             ← Dashboard principal
│   ├── contexts/DataContext.jsx
│   ├── components/         ← Navbar, ContactModal, etc.
│   └── views/               ← AdvisorWeeklyView, AuditView, etc.
└── vercel.json
```
