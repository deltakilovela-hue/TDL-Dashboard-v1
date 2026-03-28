// Vercel Serverless Function: GET /api/status
export default function handler(req, res) {
  const hasKeys = !!(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
  res.json({
    ok: true,
    server: "Vercel Serverless",
    version: "2.0.0",
    lastSync: null,        // Serverless no guarda estado entre requests
    totalContacts: 0,
    totalMensajes: 0,
    ready: hasKeys,
    dataFile: hasKeys ? "exists" : "not_found",
  });
}
