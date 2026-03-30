// API endpoint para cargar el último reporte procesado desde .MD
// Devuelve datos integrados con fecha de actualización

const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
  try {
    // Directorio donde se guardan los reportes procesados
    const dataDir = path.join(process.cwd(), 'data');

    // Crear directorio si no existe
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Buscar archivos reporte_procesado_*.json
    const files = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('reporte_procesado_') && f.endsWith('.json'))
      .sort()
      .reverse(); // Ordenar por fecha descendente para obtener el más reciente

    if (files.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No hay reportes procesados disponibles',
        data: null,
        lastUpdated: null,
      });
    }

    // Leer el archivo más reciente
    const latestFile = files[0];
    const filePath = path.join(dataDir, latestFile);
    const content = fs.readFileSync(filePath, 'utf-8');
    const reportData = JSON.parse(content);

    return res.status(200).json({
      success: true,
      message: 'Reporte cargado correctamente',
      data: reportData,
      lastUpdated: reportData.processedAt,
      sourceFile: latestFile,
    });
  } catch (error) {
    console.error('Error al cargar reporte:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al cargar el reporte',
      error: error.message,
    });
  }
}
