// Parser para procesar reportes .MD descargados de GHL
// Extrae datos estructurados del archivo markdown

const fs = require('fs');
const path = require('path');

// Leer archivo .MD y parsear datos
function parseReportMD(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const report = {
      fileName: path.basename(filePath),
      processedAt: new Date().toISOString(),
      periodo: extractPeriodo(lines),
      resumen: extractResumen(lines),
      contactos: extractContactos(lines),
      llamadas: extractLlamadas(lines),
      mensajes: extractMensajes(lines),
      leads: extractLeads(lines),
      presupuestos: extractPresupuestos(lines),
    };

    return report;
  } catch (error) {
    console.error('Error al parsear .MD:', error.message);
    throw error;
  }
}

// Extrae período del reporte
function extractPeriodo(lines) {
  const match = lines.join('\n').match(/(\w+\s+\d{1,2}.*?→\s*\w+\s+\d{1,2}.*?202\d)/);
  return match ? match[1] : "N/A";
}

// Extrae sección Resumen General (tabla)
function extractResumen(lines) {
  const start = lines.findIndex(l => l.includes('## Resumen General'));
  if (start === -1) return {};

  const resumen = {};
  let inTable = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('|') && !line.includes('---')) {
      inTable = true;
      continue;
    }

    if (inTable && line.includes('|')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p && p !== '---|-------|' && !p.includes('---'));
      if (parts.length >= 2) {
        const key = parts[0];
        const value = parseInt(parts[1].replace('+', '').replace('%', '')) || parts[1];
        if (key && key !== 'Métrica') resumen[key] = value;
      }
    }

    if (inTable && line.trim() === '') break;
  }

  return resumen;
}

// Extrae tabla de Contactos
function extractContactos(lines) {
  const start = lines.findIndex(l => l.includes('## Tabla de Contactos'));
  if (start === -1) return [];

  const contactos = [];
  let inTable = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('Nombre del Contacto') && line.includes('|')) {
      inTable = true;
      continue;
    }

    if (inTable && line.includes('|') && !line.includes('---')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 3 && !parts[0].includes('Nombre')) {
        contactos.push({
          nombre: parts[0] || "(No hay datos)",
          telefono: parts[1] || "(No hay datos)",
          asesor: parts[2] || "(No hay datos)",
        });
      }
    }

    if (inTable && line.trim() === '') break;
  }

  return contactos;
}

// Extrae tabla de Llamadas
function extractLlamadas(lines) {
  const start = lines.findIndex(l => l.includes('## Detalle de Llamadas Realizadas'));
  if (start === -1) return [];

  const llamadas = [];
  let inTable = false;

  for (let i = start; i < Math.min(start + 300, lines.length); i++) {
    const line = lines[i];

    if (line.includes('Nombre del Contacto') && line.includes('|')) {
      inTable = true;
      continue;
    }

    if (inTable && line.includes('|') && !line.includes('---')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 5 && !parts[0].includes('Nombre')) {
        llamadas.push({
          contacto: parts[0] || "(No hay datos)",
          asignado: parts[1] || "(No hay datos)",
          viaAsesor: parts[2] || "(No hay datos)",
          duracion: parts[3] ? parseInt(parts[3]) : 0,
          estado: parts[4] || "(No hay datos)",
        });
      }
    }

    if (inTable && line.trim() === '' && i > start + 50) break;
  }

  return llamadas;
}

// Extrae tabla de Mensajes
function extractMensajes(lines) {
  const start = lines.findIndex(l => l.includes('## Distribución del Último Mensaje por Canal'));
  if (start === -1) return [];

  const mensajes = [];
  let inTable = false;

  for (let i = start; i < Math.min(start + 200, lines.length); i++) {
    const line = lines[i];

    if (line.includes('Nombre del Contacto') && line.includes('|')) {
      inTable = true;
      continue;
    }

    if (inTable && line.includes('|') && !line.includes('---')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 6 && !parts[0].includes('Nombre')) {
        mensajes.push({
          contacto: parts[0] || "(No hay datos)",
          noLeidos: parseInt(parts[1]) || 0,
          asesor: parts[2] || "(No hay datos)",
          tipo: parts[3] || "(No hay datos)",
          direccion: parts[4] || "(No hay datos)",
          canal: parts[5] || "(No hay datos)",
        });
      }
    }

    if (inTable && line.trim() === '' && i > start + 50) break;
  }

  return mensajes;
}

// Extrae LEADS Abandonados
function extractLeads(lines) {
  const start = lines.findIndex(l => l.includes('## LEADS Abandonados'));
  if (start === -1) return [];

  const leads = [];
  let inTable = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('Nombre') && line.includes('|')) {
      inTable = true;
      continue;
    }

    if (inTable && line.includes('|') && !line.includes('---')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 4 && !parts[0].includes('Nombre')) {
        leads.push({
          nombre: parts[0] || "(No hay datos)",
          fuente: parts[1] || "(No hay datos)",
          asesor: parts[2] || "(No hay datos)",
          pipeline: parts[3] || "(No hay datos)",
        });
      }
    }

    if (inTable && line.trim() === '') break;
  }

  return leads;
}

// Extrae Presupuestos
function extractPresupuestos(lines) {
  const start = lines.findIndex(l => l.includes('## Presupuestos'));
  if (start === -1) return [];

  const presupuestos = [];
  let inTable = false;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('Identificador') && line.includes('|')) {
      inTable = true;
      continue;
    }

    if (inTable && line.includes('|') && !line.includes('---')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      if (parts.length >= 3 && !parts[0].includes('Identificador')) {
        presupuestos.push({
          identificador: parts[0] || "(No hay datos)",
          presupuesto: parts[1] || "(No hay datos)",
          nivelInteres: parts[2] || "(No hay datos)",
        });
      }
    }

    if (inTable && line.trim() === '') break;
  }

  return presupuestos;
}

// Exportar función
module.exports = { parseReportMD };
