// API endpoint para procesar un archivo .MD descargado
// Usa parseReportMD para extraer datos y guardar en formato JSON

const fs = require('fs');
const path = require('path');
const { parseReportMD } = require('./parseReportMD');

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath es requerido' });
    }

    // Parsear el archivo .MD
    const reportData = parseReportMD(filePath);

    // Crear directorio de datos si no existe
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generar nombre del archivo procesado con timestamp
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
    const outputFileName = `reporte_procesado_${dateStr}_${timeStr}.json`;
    const outputPath = path.join(dataDir, outputFileName);

    // Guardar datos procesados
    fs.writeFileSync(outputPath, JSON.stringify(reportData, null, 2), 'utf-8');

    return res.status(200).json({
      success: true,
      message: 'Reporte procesado correctamente',
      outputFile: outputFileName,
      outputPath: outputPath,
      processedAt: reportData.processedAt,
      data: {
        contactos: reportData.contactos?.length || 0,
        llamadas: reportData.llamadas?.length || 0,
        mensajes: reportData.mensajes?.length || 0,
        leads: reportData.leads?.length || 0,
        presupuestos: reportData.presupuestos?.length || 0,
      },
    });
  } catch (error) {
    console.error('Error al procesar reporte:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al procesar el reporte',
      error: error.message,
    });
  }
}
