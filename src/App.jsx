import { useState, useCallback, useMemo, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, LineChart, Line } from "recharts";
import { Upload, TrendingUp, Phone, MessageSquare, Users, AlertTriangle, DollarSign, X, Award, ArrowLeft, BarChart2, Plus, Trash2, CalendarDays } from "lucide-react";

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = "tdl_reports_v1";
function loadReports() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
function saveReports(r) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} }

// ── CSV Parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => { const vals = parseCSVLine(line); const obj = {}; headers.forEach((h, i) => (obj[h] = vals[i] ?? "")); return obj; });
}
function parseCSVLine(line) {
  const result = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  result.push(cur.trim()); return result;
}
function detectFileType(headers) {
  const h = headers.join(",").toLowerCase();
  if (h.includes("identificador_presupuesto")) return "presupuestos";
  if (h.includes("primary contact name") || h.includes("lost reason")) return "leads";
  if (h.includes("estado de la llamada")) return "llamadas";
  if (h.includes("canal del")) return "mensajes";
  if (h.includes("usuario asignado") && h.includes("tel")) return "contactos";
  return "unknown";
}

// ── Date helpers ──────────────────────────────────────────────────────────────
// Parse any date string found in CSVs: "Mar 08 2026 03:01 AM", "Mar 09 2026", "07 Mar 26"
function parseDate(str) {
  if (!str || str === "N/A" || str === "") return null;
  // GHL API puede devolver timestamps numéricos — convertir a Date directamente
  if (typeof str !== "string") {
    if (typeof str === "number") return new Date(str > 1e10 ? str : str * 1000);
    str = String(str);
  }
  const s = str.trim();
  // "Mar 08 2026 03:01 AM" or "Mar 09 2026"
  let m = s.match(/([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2,4})/);
  if (m) {
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const yr = m[3].length===2 ? 2000+parseInt(m[3]) : parseInt(m[3]);
    const d = new Date(yr, months[m[1]] ?? 0, parseInt(m[2]));
    return isNaN(d) ? null : d;
  }
  // "07 Mar 26"
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/);
  if (m) {
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const yr = m[3].length===2 ? 2000+parseInt(m[3]) : parseInt(m[3]);
    const d = new Date(yr, months[m[2]] ?? 0, parseInt(m[1]));
    return isNaN(d) ? null : d;
  }
  // ISO
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// Get Monday of the week for a given date
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function weekKey(date) {
  const ws = getWeekStart(date);
  return ws.toISOString().split("T")[0];
}

function weekLabel(isoKey) {
  const start = new Date(isoKey + "T12:00:00");
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const fmt = d => d.toLocaleDateString("es-MX", { day:"numeric", month:"short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

// ── Week splitter ─────────────────────────────────────────────────────────────
// Given datasets, split each row by the date field and return weeks map
function splitDatasetsByWeek(datasets) {
  const { llamadas=[], mensajes=[], contactos=[], leads=[], presupuestos=[] } = datasets;
  const weeks = {}; // { "2026-03-02": { llamadas:[], mensajes:[], ... } }

  const addRow = (type, row, dateStr) => {
    const d = parseDate(dateStr);
    if (!d) return;
    const k = weekKey(d);
    if (!weeks[k]) weeks[k] = { llamadas:[], mensajes:[], contactos:[], leads:[], presupuestos:[] };
    weeks[k][type].push(row);
  };

  llamadas.forEach(r => addRow("llamadas", r, r["Creada Activado"] || r["Created On"] || ""));
  mensajes.forEach(r => addRow("mensajes", r, r["Creada Activado"] || ""));
  contactos.forEach(r => addRow("contactos", r, r["Creada Activado"] || r["Created On"] || ""));
  leads.forEach(r => addRow("leads", r, r["Created On"] || ""));
  presupuestos.forEach(r => addRow("presupuestos", r, r["Created On"] || r["Updated On"] || ""));

  return weeks;
}

function summaryFromRows(rows) {
  const { llamadas=[], mensajes=[], contactos=[], leads=[], presupuestos=[] } = rows;
  const contestadas = llamadas.filter(r=>r["Estado de la llamada"]==="Answered").length;
  const durTotal = llamadas.reduce((s,r)=>s+(parseInt(r["Duración (in segundos)"])||0),0);
  const presTotal = presupuestos.filter(r=>r["Presupuesto"]).reduce((s,r)=>s+(parseFloat(r["Presupuesto"].replace(/,/g,""))||0),0);
  return {
    totalLlamadas: llamadas.length, contestadas,
    perdidas: llamadas.filter(r=>(r["Estado de la llamada"]||"").includes("Missed")).length,
    durProm: contestadas ? Math.round(durTotal/contestadas) : 0,
    tasaContestacion: llamadas.length ? Math.round(contestadas/llamadas.length*100) : 0,
    totalMensajes: mensajes.length,
    unread: mensajes.filter(r=>r["Tipo"]==="Unread").length,
    inbound: mensajes.filter(r=>r["Dirección del último mensaje"]==="inbound").length,
    outbound: mensajes.filter(r=>r["Dirección del último mensaje"]==="outbound").length,
    totalContactos: contactos.length, totalLeads: leads.length,
    presTotal, presCon: presupuestos.filter(r=>r["Presupuesto"]).length,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const GOLD="#C8974E", NAVY="#1A2B4A";
const MONO="'DM Mono', monospace", SERIF="'Playfair Display', serif";
const COLORS=["#C8974E","#4A7FA5","#7DB8D4","#E8C38A","#8B5A2B","#2D5A8C","#A8D8EA","#E8824A","#6DB87A","#B87CC8"];
const RANK_COLORS=["#FFD700","#C0C0C0","#CD7F32","#4A7FA5","#5A7090","#3A5070","#2A4060","#1E3050","#162840","#0E2030"];

// ── Pipeline Config ───────────────────────────────────────────────────────────
const PIPELINE_MAP = {
  "Interesado en proyecto":"Desarrollos","Contacto 1a1 Lead activo":"Desarrollos",
  "Contacto 1a1 Lead detenido":"Desarrollos","Cita por confirmar":"Desarrollos",
  "No respondio / Lead Frio":"Desarrollos","No respondió / Lead Frío":"Desarrollos",
  "Cita agendada presencial":"Desarrollos","Mensaje programado":"Desarrollos","Descalificado":"Desarrollos",
  "Asistio a cita":"Cierre","Asistió a cita":"Cierre","Nutricion de cierre":"Cierre",
  "Nutrición de cierre":"Cierre","Apartado":"Cierre","Enganche":"Cierre",
  "Proceso notarial":"Cierre","Venta cerrada":"Cierre",
  "LEAD Entrante":"Rentas","Reservado":"Rentas","Cancelado":"Rentas","Clientes habituales":"Rentas",
};
const PIPELINE_CONFIG = {
  "Desarrollos":{color:"#C8974E",icon:"🏗️",stages:["Interesado en proyecto","Contacto 1a1 Lead activo","Contacto 1a1 Lead detenido","Cita por confirmar","No respondió / Lead Frío","Cita agendada presencial","Mensaje programado","Descalificado"]},
  "Cierre":{color:"#6DB87A",icon:"✅",stages:["Asistió a cita","Nutrición de cierre","Apartado","Enganche","Proceso notarial","Venta cerrada"]},
  "Rentas":{color:"#4A7FA5",icon:"🏖️",stages:["LEAD Entrante","Reservado","Cancelado","Clientes habituales"]},
};
function getLeadNotes(row) {
  return row["{{contact.suma_de_notas_de_agente}}"]||row["suma_de_notas_de_agente"]||row["contact.suma_de_notas_de_agente"]||row["Notas del agente"]||"0";
}
function getLeadPipeline(lead) {
  const p = lead["Pipeline"]||lead["Pipeline Name"]||lead["pipeline"]||"";
  if (p) { if (/cierre|02/i.test(p)) return "Cierre"; if (/renta|vacacional/i.test(p)) return "Rentas"; if (/desarroll|01/i.test(p)) return "Desarrollos"; }
  return PIPELINE_MAP[lead["Stage"]||lead["stage"]||""]||"Desarrollos";
}
function inDateRange(dateStr, start, end) { const d=parseDate(dateStr); return d&&d>=start&&d<=end; }

// ── Seed report (PDF data) ────────────────────────────────────────────────────
const SEED_REPORT = {
  id:"report_seed_feb7_mar9", label:"Feb 7 – Mar 9, 2026", period:"2026-02-07", createdAt:"2026-03-09",
  summary:{ totalLlamadas:232, contestadas:98, perdidas:121, durProm:28, tasaContestacion:42, totalMensajes:99, unread:14, inbound:45, outbound:54, totalContactos:31, totalLeads:7, presTotal:21000000, presCon:3, clientesAbiertos:88, clientesGanados:24, clientesPerdidos:17 },
  charts:{
    contactosPorMedio:[{name:"Facebook",value:53},{name:"Instagram",value:9},{name:"Form",value:5}],
    contactosAsignados:[{name:"Fernanda Valdez",value:16},{name:"Daniela Gonzalez",value:4},{name:"Pamela Martinez",value:3},{name:"Karina Torres",value:2},{name:"Humberto Ortega",value:1},{name:"Lilia Dones",value:1},{name:"Diana Reyes",value:1},{name:"Jorge Benitez",value:1},{name:"Laura Lizet",value:1},{name:"Zulema Mendoza",value:1}],
    llamadasPorAgente:[{name:"Fernanda Valdez",value:183},{name:"Jorge Benitez",value:16},{name:"Pamela Martinez",value:15},{name:"Diana Reyes",value:8},{name:"Lilia Dones",value:4},{name:"Laura Lizet",value:2},{name:"Otros",value:4}],
    estadoLlamadas:[{name:"Missed/No answer",value:121},{name:"Answered",value:98},{name:"Busy",value:7},{name:"N/A",value:4},{name:"Failed",value:2}],
    conversacionesPorResponsable:[{name:"Nanncy Meza",value:37},{name:"Fernanda Valdez",value:26},{name:"Pamela Martinez",value:5},{name:"Daniela Gonzalez",value:4},{name:"Diana Reyes",value:3},{name:"Celeste Lizárraga",value:3},{name:"Jorge Benitez",value:3},{name:"Laura Lizet",value:3},{name:"Humberto Ortega",value:2},{name:"Marco Franco",value:2}],
    interesDist:[{name:"Medio",value:3},{name:"Bajo",value:1},{name:"Sin nivel",value:1}],
    // Seed week data (manual from PDF - 4 weeks Feb7-Mar9)
    weeklyData: [
      { weekKey:"2026-02-09", weekLabel:"Feb 9 – 15", totalLlamadas:48, contestadas:18, perdidas:28, tasaContestacion:38, totalMensajes:20, unread:4, totalContactos:7, totalLeads:2 },
      { weekKey:"2026-02-16", weekLabel:"Feb 16 – 22", totalLlamadas:55, contestadas:24, perdidas:29, tasaContestacion:44, totalMensajes:24, unread:3, totalContactos:8, totalLeads:2 },
      { weekKey:"2026-02-23", weekLabel:"Feb 23 – Mar 1", totalLlamadas:72, contestadas:31, perdidas:38, tasaContestacion:43, totalMensajes:29, unread:4, totalContactos:9, totalLeads:2 },
      { weekKey:"2026-03-02", weekLabel:"Mar 2 – 8", totalLlamadas:57, contestadas:25, perdidas:26, tasaContestacion:44, totalMensajes:26, unread:3, totalContactos:7, totalLeads:1 },
    ]
  },
  agentScores:[
    {name:"Fernanda Valdez",score:88,llamadasTotal:183,llamadasContestadas:85,tasaContestacion:46,durProm:32,mensajesTotal:26,mensajesUnread:4,mensajesInbound:12,contactosTotal:16,leadsAbandonados:4,actividadesTotal:209,leadsContactados:16,actividadesPorLead:13.1,tasaContactos:100,radar:[{subject:"Llamadas",value:100},{subject:"Contactación",value:46},{subject:"Mensajes",value:100},{subject:"Gestión",value:85},{subject:"Contactos",value:100}]},
    {name:"Jorge Benitez",score:54,llamadasTotal:16,llamadasContestadas:8,tasaContestacion:50,durProm:28,mensajesTotal:3,mensajesUnread:0,mensajesInbound:1,contactosTotal:1,leadsAbandonados:0,actividadesTotal:19,leadsContactados:1,actividadesPorLead:19.0,tasaContactos:100,radar:[{subject:"Llamadas",value:9},{subject:"Contactación",value:50},{subject:"Mensajes",value:12},{subject:"Gestión",value:100},{subject:"Contactos",value:6}]},
    {name:"Pamela Martinez",score:48,llamadasTotal:15,llamadasContestadas:7,tasaContestacion:47,durProm:25,mensajesTotal:5,mensajesUnread:0,mensajesInbound:2,contactosTotal:3,leadsAbandonados:0,actividadesTotal:20,leadsContactados:3,actividadesPorLead:6.7,tasaContactos:100,radar:[{subject:"Llamadas",value:8},{subject:"Contactación",value:47},{subject:"Mensajes",value:19},{subject:"Gestión",value:100},{subject:"Contactos",value:19}]},
    {name:"Diana Reyes",score:38,llamadasTotal:8,llamadasContestadas:4,tasaContestacion:50,durProm:40,mensajesTotal:3,mensajesUnread:0,mensajesInbound:2,contactosTotal:1,leadsAbandonados:1,actividadesTotal:11,leadsContactados:1,actividadesPorLead:11.0,tasaContactos:100,radar:[{subject:"Llamadas",value:4},{subject:"Contactación",value:50},{subject:"Mensajes",value:12},{subject:"Gestión",value:100},{subject:"Contactos",value:6}]},
    {name:"Daniela Gonzalez",score:35,llamadasTotal:0,llamadasContestadas:0,tasaContestacion:0,durProm:0,mensajesTotal:4,mensajesUnread:2,mensajesInbound:3,contactosTotal:4,leadsAbandonados:0,actividadesTotal:4,leadsContactados:1,actividadesPorLead:1.0,tasaContactos:25,radar:[{subject:"Llamadas",value:0},{subject:"Contactación",value:0},{subject:"Mensajes",value:15},{subject:"Gestión",value:50},{subject:"Contactos",value:25}]},
    {name:"Karina Torres",score:28,llamadasTotal:0,llamadasContestadas:0,tasaContestacion:0,durProm:0,mensajesTotal:2,mensajesUnread:2,mensajesInbound:2,contactosTotal:2,leadsAbandonados:0,actividadesTotal:2,leadsContactados:0,actividadesPorLead:1.0,tasaContactos:0,radar:[{subject:"Llamadas",value:0},{subject:"Contactación",value:0},{subject:"Mensajes",value:8},{subject:"Gestión",value:0},{subject:"Contactos",value:13}]},
  ],
  datasets:{ llamadas:[], mensajes:[], contactos:[], leads:[], presupuestos:[] }
};

// ── Score Engine ──────────────────────────────────────────────────────────────
function buildAgentScores(datasets) {
  const { llamadas=[], mensajes=[], contactos=[], leads=[] } = datasets;
  const agents = {};
  const get = name => {
    if (!name||name==="N/A"||name==="") return null;
    const k=typeof name==="string"?name.trim():String(name);
    if (!agents[k]) agents[k]={name:k,llamadasTotal:0,llamadasContestadas:0,llamadasPerdidas:0,duracionTotal:0,mensajesTotal:0,mensajesUnread:0,mensajesInbound:0,contactosTotal:0,leadsAbandonados:0};
    return agents[k];
  };
  llamadas.forEach(r=>{const a=get(r["Llamar realizada Vía"]);if(!a)return;a.llamadasTotal++;if(r["Estado de la llamada"]==="Answered"){a.llamadasContestadas++;a.duracionTotal+=parseInt(r["Duración (in segundos)"])||0;}if((r["Estado de la llamada"]||"").includes("Missed"))a.llamadasPerdidas++;});
  mensajes.forEach(r=>{const a=get(r["Asignado a"]);if(!a)return;a.mensajesTotal++;if(r["Tipo"]==="Unread")a.mensajesUnread++;if(r["Dirección del último mensaje"]==="inbound")a.mensajesInbound++;});
  contactos.forEach(r=>{const a=get(r["Usuario asignado"]);if(!a)return;a.contactosTotal++;});
  leads.forEach(r=>{const a=get(r["Assigned User"]);if(!a)return;a.leadsAbandonados++;});
  const all=Object.values(agents);
  const max=k=>Math.max(...all.map(a=>a[k]),1);
  all.forEach(a=>{
    const tasaC=a.llamadasTotal>0?a.llamadasContestadas/a.llamadasTotal:0;
    const dp=a.llamadasContestadas>0?a.duracionTotal/a.llamadasContestadas:0;
    const g=a.mensajesTotal>0?1-(a.mensajesUnread/a.mensajesTotal):0;
    a.score=Math.round(Math.max(0,Math.min(100,(a.llamadasTotal/max("llamadasTotal"))*20+tasaC*25+(Math.min(dp,120)/120)*15+(a.mensajesTotal/max("mensajesTotal"))*20+g*10+(a.contactosTotal/max("contactosTotal"))*10+(a.leadsAbandonados/Math.max(max("leadsAbandonados"),1))*-10)));
    a.tasaContestacion=Math.round(tasaC*100);a.durProm=Math.round(dp);a.gestionMensajes=Math.round(g*100);
    a.radar=[{subject:"Llamadas",value:Math.round((a.llamadasTotal/max("llamadasTotal"))*100)},{subject:"Contactación",value:a.tasaContestacion},{subject:"Mensajes",value:Math.round((a.mensajesTotal/max("mensajesTotal"))*100)},{subject:"Gestión",value:a.gestionMensajes},{subject:"Contactos",value:Math.round((a.contactosTotal/max("contactosTotal"))*100)}];
  });
  all.forEach(a=>{
    const outbound = a.mensajesTotal - a.mensajesInbound;
    a.actividadesTotal = a.llamadasTotal + a.mensajesTotal;
    const contactados = Math.min(a.llamadasContestadas + outbound, Math.max(a.contactosTotal, 1));
    a.leadsContactados = contactados;
    a.actividadesPorLead = a.contactosTotal > 0 ? +(a.actividadesTotal / a.contactosTotal).toFixed(1) : a.actividadesTotal;
    a.tasaContactos = a.contactosTotal > 0 ? Math.round((contactados / a.contactosTotal) * 100) : 0;
  });
  return all.sort((a,b)=>b.score-a.score);
}

// ── Weekly Agent Matrix ───────────────────────────────────────────────────────
function buildWeeklyAgentMatrix(datasets) {
  const { llamadas=[], mensajes=[] } = datasets;
  const matrix = {};
  const weeks = new Set();
  const addActivity = (agentName, dateStr, type) => {
    if (!agentName || agentName==="N/A" || agentName==="") return;
    const d = parseDate(dateStr);
    if (!d) return;
    const wk = weekKey(d);
    weeks.add(wk);
    if (!matrix[agentName]) matrix[agentName] = {};
    if (!matrix[agentName][wk]) matrix[agentName][wk] = { llamadas:0, mensajes:0 };
    matrix[agentName][wk][type]++;
  };
  llamadas.forEach(r => addActivity(r["Llamar realizada Vía"], r["Creada Activado"]||r["Created On"]||"", "llamadas"));
  mensajes.forEach(r => addActivity(r["Asignado a"], r["Creada Activado"]||"", "mensajes"));
  return { agents: Object.keys(matrix).sort(), weeks: [...weeks].sort(), matrix };
}

function buildSummaryFromDatasets(datasets) {
  const { llamadas=[], mensajes=[], contactos=[], leads=[], presupuestos=[] } = datasets;
  const contestadas=llamadas.filter(r=>r["Estado de la llamada"]==="Answered").length;
  const durTotal=llamadas.reduce((s,r)=>s+(parseInt(r["Duración (in segundos)"])||0),0);
  const presTotal=presupuestos.filter(r=>r["Presupuesto"]).reduce((s,r)=>s+(parseFloat(r["Presupuesto"].replace(/,/g,""))||0),0);
  return { totalLlamadas:llamadas.length,contestadas,perdidas:llamadas.filter(r=>(r["Estado de la llamada"]||"").includes("Missed")).length,durProm:contestadas?Math.round(durTotal/contestadas):0,tasaContestacion:llamadas.length?Math.round(contestadas/llamadas.length*100):0,totalMensajes:mensajes.length,unread:mensajes.filter(r=>r["Tipo"]==="Unread").length,inbound:mensajes.filter(r=>r["Dirección del último mensaje"]==="inbound").length,outbound:mensajes.filter(r=>r["Dirección del último mensaje"]==="outbound").length,totalContactos:contactos.length,totalLeads:leads.length,presTotal,presCon:presupuestos.filter(r=>r["Presupuesto"]).length,clientesAbiertos:0,clientesGanados:0,clientesPerdidos:0 };
}

// ── GHL API Integration ───────────────────────────────────────────────────────
// En Vercel (producción) usa las API routes del mismo dominio: /api/...
// En localhost (desarrollo) usa el servidor local: http://localhost:3001
const GHL_SERVER = (typeof window !== "undefined" && window.location.hostname !== "localhost")
  ? ""           // Vercel: /api/sync, /api/status (mismo dominio)
  : "http://localhost:3001"; // Local: servidor Node.js

// Parsea "Opportunities" del JSON de GHL: formatos:
//   antiguo: "open 01 - Desarrollos Interesado en proyecto 🤖"
//   nuevo:   "open: 01 - Desarrollos - Interesado en proyecto 🤖"
function parseMainOpportunityClient(oppsStr) {
  if (!oppsStr) return { status:"", pipeline:"", stage:"" };
  const KNOWN = ["01 - Desarrollos","02 - Cierre","Rentas Vacacionales","Seguimiento IA","Recepción Proveedores"];
  const entries = String(oppsStr).split(/;|, (?=open |won |lost )/i).map(s=>s.trim()).filter(Boolean);
  const parsed = entries.map(entry => {
    // Soporta "open: pipeline - stage" (nuevo) y "open pipeline stage" (antiguo)
    const sm = entry.match(/^(open|won|lost)[:\s]+/i);
    const status = sm ? sm[1].toLowerCase() : "open";
    const rest = entry.replace(/^(open|won|lost)[:\s]+/i,"").trim();
    let pipeline="", stage=rest;
    for(const p of KNOWN){
      if(rest===p||rest.startsWith(p+" ")||rest.startsWith(p+" -")){
        pipeline=p;
        stage=rest.slice(p.length).replace(/^\s*-\s*/,"").trim();
        break;
      }
    }
    return {status,pipeline,stage};
  });
  for(const p of ["01 - Desarrollos","02 - Cierre","Rentas Vacacionales"]){
    const f=parsed.find(o=>o.pipeline===p); if(f) return f;
  }
  // Nunca devolver "Seguimiento IA" como resultado principal
  return parsed.find(o=>o.status==="open"&&o.pipeline!=="Seguimiento IA")||
         parsed.find(o=>o.pipeline!=="Seguimiento IA")||
         parsed[0]||{status:"",pipeline:"",stage:""};
}

function buildReportFromGHLContacts(contacts, syncDate, mensajesRaw=[], llamadasRaw=[]) {
  // Los contactos ya vienen con los mismos nombres de columna que el CSV de GHL
  // ("Assigned To", "Stage", "Pipeline", "Nombre del Contacto", etc.)

  const contactos = contacts;

  // Para leads: contactos con Stage o Opportunities
  const leads = contacts
    .filter(c => c["Stage"] || c["Opportunities"])
    .map(c => {
      const opp = (!c["Stage"] && c["Opportunities"]) ? parseMainOpportunityClient(c["Opportunities"]) : null;
      const stage = c["Stage"] || opp?.stage || "";
      const pipeline = c["Pipeline"] || c["Pipeline Name"] || opp?.pipeline || "";
      return {
        "Primary Contact Name": c["Nombre del Contacto"] || `${c["First Name"]||""} ${c["Last Name"]||""}`.trim(),
        "Assigned User": c["Assigned To"] || c["Usuario asignado"] || "",
        "Stage": stage,
        "Pipeline Name": pipeline,
        "Pipeline": pipeline,
        "Source": c["Source"] || "",
        "Created On": c["Created On"] || c["Created"] || "",
        "Tags": c["Tags"] || "",
        "Contact Id":       c["Contact Id"] || "",
        "Días Asignado":    c["Días Asignado"] || "",
        "Last Activity":    c["Last Activity"] || c["Updated"] || "",
        "🌡️ Nivel de interés del prospecto":        c["🌡️ Nivel de interés del prospecto"] || "",
        "💸 Presupuesto estimado":                  c["💸 Presupuesto estimado"] || "",
        "🏦 ¿Cuenta con financiamiento o crédito?": c["🏦 ¿Cuenta con financiamiento o crédito?"] || "",
        "📅 ¿Desea agendar una cita?":              c["📅 ¿Desea agendar una cita?"] || "",
        "Comentario de NOTA primer contacto":       c["Comentario de NOTA primer contacto"] || "",
        "Comentario de seguimiento externo":        c["Comentario de seguimiento externo"] || "",
        "Medio de contacto de preferencia":         c["Medio de contacto de preferencia"] || "",
        "Funciones de LEAD":                        c["Funciones de LEAD"] || "",
        "Requiero más tiempo para responder":       c["Requiero más tiempo para responder"] || "",
        "¿Dónde te gustaria invertir?":             c["¿Dónde te gustaria invertir?"] || "",
        "Propiedad seleccionada":                   c["Propiedad seleccionada"] || "",
        "{{contact.suma_de_notas_de_agente}}": c["{{contact.suma_de_notas_de_agente}}"] || "0",
      };
    });

  const datasets = { llamadas:llamadasRaw, mensajes:mensajesRaw, contactos, leads, presupuestos:[] };

  // ── Resumen de llamadas ───────────────────────────────────────────────────
  const contestadas = llamadasRaw.filter(r => r["Estado de la llamada"] === "Answered").length;
  const perdidas    = llamadasRaw.filter(r => (r["Estado de la llamada"]||"").includes("No Answer") || (r["Estado de la llamada"]||"").includes("Missed")).length;
  const durTotal    = llamadasRaw.reduce((s,r) => s + (parseInt(r["Duración (in segundos)"])||0), 0);
  const durProm     = contestadas > 0 ? Math.round(durTotal / contestadas) : 0;
  const tasaContest = llamadasRaw.length > 0 ? Math.round(contestadas / llamadasRaw.length * 100) : 0;

  // ── Agent scores integrando llamadas + mensajes + contactos ──────────────
  const agentMap = {};
  const getAgent = (name) => {
    if (!name || name === "N/A" || name === "") return null;
    if (!agentMap[name]) agentMap[name] = {
      name, llamadasTotal:0, llamadasContestadas:0, llamadasPerdidas:0, duracionTotal:0,
      mensajesTotal:0, mensajesUnread:0, mensajesInbound:0, mensajesOutboundLeads:0,
      contactosTotal:0, leadsAbandonados:0,
    };
    return agentMap[name];
  };

  contactos.forEach(c => {
    const a = getAgent(c["Assigned To"]||c["Usuario asignado"]);
    if (a) a.contactosTotal++;
  });

  llamadasRaw.forEach(r => {
    const a = getAgent(r["Llamar realizada Vía"]);
    if (!a) return;
    a.llamadasTotal++;
    if (r["Estado de la llamada"] === "Answered") {
      a.llamadasContestadas++;
      a.duracionTotal += parseInt(r["Duración (in segundos)"])||0;
    }
    if ((r["Estado de la llamada"]||"").includes("No Answer") || (r["Estado de la llamada"]||"").includes("Missed")) {
      a.llamadasPerdidas++;
    }
  });

  // Mapa contactId → agente asignado (para cruzar mensajes outbound con leads)
  const contactAgentMap = {};
  contactos.forEach(c => {
    const id = c["Contact Id"] || c["contact_id"] || "";
    if (id) contactAgentMap[id] = c["Assigned To"] || c["Usuario asignado"] || "";
  });

  mensajesRaw.forEach(r => {
    const a = getAgent(r["Asignado a"]);
    if (!a) return;
    a.mensajesTotal++;
    if (r["Tipo"] === "Unread") a.mensajesUnread++;
    const dir = (r["Dirección del último mensaje"]||"").toLowerCase();
    if (dir === "inbound") a.mensajesInbound++;
    // Mensajes outbound enviados a leads/contactos asignados a este asesor
    if (dir === "outbound") {
      const leadAgent = String(contactAgentMap[r["Contact Id"]] || "").trim();
      if (leadAgent && leadAgent === String(a.name).trim()) a.mensajesOutboundLeads++;
    }
  });

  const agentList = Object.values(agentMap);
  const maxL = Math.max(...agentList.map(a=>a.llamadasTotal), 1);
  const maxM = Math.max(...agentList.map(a=>a.mensajesTotal), 1);
  const maxC2 = Math.max(...agentList.map(a=>a.contactosTotal), 1);

  const agentScores = agentList.map(a => {
    const tasaC = a.llamadasTotal > 0 ? a.llamadasContestadas / a.llamadasTotal : 0;
    const dp    = a.llamadasContestadas > 0 ? a.duracionTotal / a.llamadasContestadas : 0;
    const outbound = a.mensajesTotal - a.mensajesInbound;
    const g = a.mensajesTotal > 0 ? outbound / a.mensajesTotal : 0;
    const score = Math.round(Math.max(0, Math.min(100,
      (a.llamadasTotal / maxL) * 20 + tasaC * 25 + (Math.min(dp,120)/120)*15 +
      (a.mensajesTotal / maxM) * 20 + g * 10 + (a.contactosTotal / maxC2) * 10
    )));
    const contactados = Math.min(a.llamadasContestadas + (a.mensajesTotal - a.mensajesInbound), Math.max(a.contactosTotal, 1));
    return {
      ...a,
      tasaContestacion: a.llamadasTotal > 0 ? Math.round(tasaC * 100) : 0,
      durProm: Math.round(dp),
      gestionMensajes: Math.round(g * 100),
      actividadesTotal: a.llamadasTotal + a.mensajesTotal,
      leadsContactados: contactados,
      actividadesPorLead: a.contactosTotal > 0 ? Math.round((a.llamadasTotal + a.mensajesTotal) / a.contactosTotal * 10) / 10 : 0,
      tasaContactos: a.contactosTotal > 0 ? Math.round(contactados / a.contactosTotal * 100) : 0,
      score,
      radar:[
        {subject:"Llamadas",   value:Math.round((a.llamadasTotal/maxL)*100)},
        {subject:"Contactación",value:a.llamadasTotal>0?Math.round(tasaC*100):0},
        {subject:"Mensajes",   value:Math.round((a.mensajesTotal/maxM)*100)},
        {subject:"Gestión",    value:Math.round(g*100)},
        {subject:"Contactos",  value:Math.round((a.contactosTotal/maxC2)*100)},
      ],
    };
  }).sort((a,b) => b.score - a.score);

  const byAgent = agentList.map(a=>({name:a.name,value:a.contactosTotal})).sort((a,b)=>b.value-a.value);
  const stageDistrib = Object.entries(leads.reduce((acc,l)=>{const s=l["Stage"]||"N/A";acc[s]=(acc[s]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const pipelineDist = Object.entries(leads.reduce((acc,l)=>{const p=l["Pipeline"]||"Sin pipeline";acc[p]=(acc[p]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));
  const nivelesInteres = Object.entries(contactos.reduce((acc,c)=>{const n=c["🌡️ Nivel de interés del prospecto"]||"";if(n)acc[n]=(acc[n]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const fuentes = Object.entries(contactos.reduce((acc,c)=>{const s=c["Source"]||"N/A";acc[s]=(acc[s]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const llamadasPorAgente = Object.entries(llamadasRaw.reduce((acc,r)=>{const a=r["Llamar realizada Vía"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,8);
  const estadoLlamadas = Object.entries(llamadasRaw.reduce((acc,r)=>{const s=r["Estado de la llamada"]||"N/A";acc[s]=(acc[s]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));

  return {
    id:`report_ghl_${Date.now()}`,
    label:`GHL Sync — ${syncDate}`,
    period:syncDate, createdAt:syncDate, isGHLSync:true,
    summary:{
      totalLlamadas:llamadasRaw.length, contestadas, perdidas, durProm, tasaContestacion:tasaContest,
      totalMensajes:mensajesRaw.length,
      unread:mensajesRaw.filter(m=>m["Tipo"]==="Unread").length,
      inbound:mensajesRaw.filter(m=>m["Dirección del último mensaje"]==="inbound").length,
      outbound:mensajesRaw.filter(m=>m["Dirección del último mensaje"]==="outbound").length,
      totalContactos:contactos.length, totalLeads:leads.length,
      presTotal:0, presCon:0, clientesAbiertos:0, clientesGanados:0, clientesPerdidos:0,
    },
    charts:{ contactosAsignados:byAgent, stageDistrib, pipelineDist, interesDist:nivelesInteres, contactosPorMedio:fuentes, llamadasPorAgente, estadoLlamadas },
    agentScores, datasets,
  };
}

// ── UI Atoms ──────────────────────────────────────────────────────────────────
function KPICard({ icon:Icon, label, value, sub, color=GOLD, delta }) {
  return (
    <div style={{background:"linear-gradient(135deg,#0f1923,#1a2b4a)",border:`1px solid ${color}33`,borderRadius:12,padding:"18px 20px",display:"flex",flexDirection:"column",gap:6}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{background:`${color}22`,borderRadius:7,padding:7}}><Icon size={16} color={color}/></div>
        <span style={{color:"#8A9BB8",fontSize:10,fontFamily:MONO,textTransform:"uppercase",letterSpacing:1}}>{label}</span>
      </div>
      <div style={{display:"flex",alignItems:"flex-end",gap:10}}>
        <div style={{color:"#F0EAD6",fontSize:32,fontFamily:SERIF,fontWeight:700,lineHeight:1}}>{value}</div>
        {delta!==undefined&&delta!==0&&<div style={{color:delta>0?"#6DB87A":"#E8824A",fontFamily:MONO,fontSize:11,marginBottom:4}}>{delta>0?"▲":"▼"}{Math.abs(delta)}</div>}
      </div>
      {sub&&<div style={{color:"#5A7090",fontSize:10,fontFamily:MONO}}>{sub}</div>}
    </div>
  );
}
function SectionTitle({children}) {
  return <div style={{display:"flex",alignItems:"center",gap:10,margin:"28px 0 14px"}}><div style={{width:3,height:18,background:GOLD,borderRadius:2}}/><h3 style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:17,fontWeight:600,margin:0}}>{children}</h3></div>;
}
function ChartPanel({title,data,dataKey,nameKey,color=GOLD}) {
  if(!data?.length) return null;
  return <div style={{background:"#0f1923",border:"1px solid #1E3050",borderRadius:12,padding:18}}>
    <div style={{color:"#8A9BB8",fontFamily:MONO,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>{title}</div>
    <ResponsiveContainer width="100%" height={200}><BarChart data={data} margin={{top:0,right:0,bottom:44,left:0}}><XAxis dataKey={nameKey} tick={{fill:"#5A7090",fontSize:9}} angle={-35} textAnchor="end" interval={0}/><YAxis tick={{fill:"#5A7090",fontSize:9}}/><Tooltip contentStyle={{background:"#0A1420",border:`1px solid ${color}44`,color:"#F0EAD6",fontFamily:MONO,fontSize:11}}/><Bar dataKey={dataKey} fill={color} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
  </div>;
}
function PiePanel({title,data}) {
  if(!data?.length) return null;
  return <div style={{background:"#0f1923",border:"1px solid #1E3050",borderRadius:12,padding:18}}>
    <div style={{color:"#8A9BB8",fontFamily:MONO,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>{title}</div>
    <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} paddingAngle={2}>{data.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip contentStyle={{background:"#0A1420",border:`1px solid ${GOLD}44`,color:"#F0EAD6",fontFamily:MONO,fontSize:11}}/><Legend wrapperStyle={{color:"#8A9BB8",fontFamily:MONO,fontSize:10}}/></PieChart></ResponsiveContainer>
  </div>;
}
function DataTable({title,rows,cols}) {
  const [page,setPage]=useState(0); const PER=8;
  if(!rows?.length) return null;
  const total=Math.ceil(rows.length/PER);
  return <div style={{background:"#0f1923",border:"1px solid #1E3050",borderRadius:12,padding:18}}>
    <div style={{color:"#8A9BB8",fontFamily:MONO,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>{title} <span style={{color:"#5A7090"}}>· {rows.length}</span></div>
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:MONO}}>
      <thead><tr>{cols.map(c=><th key={c} style={{padding:"7px 10px",textAlign:"left",color:GOLD,borderBottom:"1px solid #1E3050",whiteSpace:"nowrap",fontSize:10}}>{c}</th>)}</tr></thead>
      <tbody>{rows.slice(page*PER,(page+1)*PER).map((row,i)=><tr key={i} style={{borderBottom:"1px solid #0D1B2A"}}>{cols.map(c=><td key={c} style={{padding:"7px 10px",color:"#A8C0D8",whiteSpace:"nowrap",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis"}}>{row[c]||"—"}</td>)}</tr>)}</tbody>
    </table></div>
    {total>1&&<div style={{display:"flex",justifyContent:"flex-end",gap:5,marginTop:10}}>{Array.from({length:total},(_,i)=><button key={i} onClick={()=>setPage(i)} style={{background:i===page?GOLD:"#1A2B4A",color:i===page?NAVY:"#8A9BB8",border:"none",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontSize:10,fontFamily:MONO}}>{i+1}</button>)}</div>}
  </div>;
}
function ScoreBar({value,color}) {
  return <div style={{display:"flex",alignItems:"center",gap:7}}><div style={{flex:1,height:5,background:"#1E3050",borderRadius:3,overflow:"hidden"}}><div style={{width:`${value}%`,height:"100%",background:color,borderRadius:3}}/></div><span style={{color:"#A8C0D8",fontSize:10,fontFamily:MONO,minWidth:24,textAlign:"right"}}>{value}</span></div>;
}
function RankBadge({rank}) {
  const m=rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":null;
  return <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:30,height:30,borderRadius:"50%",background:RANK_COLORS[rank-1]||"#0E2030",fontFamily:MONO,fontSize:m?16:11,fontWeight:700,color:rank<=3?"#fff":"#5A7090",flexShrink:0}}>{m||`#${rank}`}</div>;
}

// ── Date Filter Bar ───────────────────────────────────────────────────────────
function DateFilterBar({ filter, setFilter, datasets }) {
  const months = useMemo(() => {
    const set = new Set();
    const allRows = [...(datasets?.llamadas||[]),...(datasets?.mensajes||[]),...(datasets?.leads||[])];
    allRows.forEach(r => { const d=parseDate(r["Creada Activado"]||r["Created On"]||""); if(d) set.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); });
    return [...set].sort().reverse();
  },[datasets]);
  const isActive = v => filter===v || (typeof filter==="object" && filter?.month===v);
  const Btn = ({label,val}) => (
    <button onClick={()=>setFilter(val)} style={{background:isActive(val)?GOLD:"#0f1923",color:isActive(val)?NAVY:"#8A9BB8",border:`1px solid ${isActive(val)?GOLD:"#1E3050"}`,borderRadius:8,padding:"6px 14px",cursor:"pointer",fontFamily:MONO,fontSize:10,fontWeight:isActive(val)?700:400,transition:"all 0.15s",whiteSpace:"nowrap"}}>{label}</button>
  );
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 22px",background:"#070D14",borderBottom:"1px solid #0D1B2A",flexWrap:"wrap"}}>
      <span style={{color:"#5A7090",fontFamily:MONO,fontSize:9,textTransform:"uppercase",letterSpacing:1}}>Filtrar:</span>
      <Btn label="Todo" val="all"/>
      <Btn label="Esta semana" val="week"/>
      <Btn label="Este mes" val="month"/>
      <Btn label="Mes anterior" val="prev_month"/>
      {months.length>0&&(
        <select value={typeof filter==="object"?filter.month:""} onChange={e=>e.target.value&&setFilter({type:"month_specific",month:e.target.value})}
          style={{background:"#0f1923",color:"#8A9BB8",border:"1px solid #1E3050",borderRadius:8,padding:"6px 10px",fontFamily:MONO,fontSize:10,cursor:"pointer",outline:"none"}}>
          <option value="">Mes específico…</option>
          {months.map(m=><option key={m} value={m}>{new Date(m+"-15").toLocaleDateString("es-MX",{month:"long",year:"numeric"})}</option>)}
        </select>
      )}
      {filter!=="all"&&<span style={{color:GOLD,fontFamily:MONO,fontSize:9,marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}><span style={{width:6,height:6,borderRadius:"50%",background:GOLD,display:"inline-block"}}/>Filtro activo</span>}
    </div>
  );
}

// ── Pipeline Kanban ───────────────────────────────────────────────────────────
function PipelineKanban({ leads, llamadas, mensajes }) {
  const [sel, setSel] = useState("Desarrollos");
  const [asrFilter, setAsrFilter] = useState("");
  const cfg = PIPELINE_CONFIG[sel];
  const enriched = useMemo(()=>leads.map(lead=>{
    const contactName=lead["Primary Contact Name"]||lead["Contact Name"]||"";
    const stage=lead["Stage"]||lead["stage"]||"";
    const pipeline=getLeadPipeline(lead);
    const notes=getLeadNotes(lead);
    const agentName=lead["Assigned User"]||lead["Owner"]||"Sin asignar";
    const firstWord=(contactName.split(" ")[0]||"").toLowerCase();
    const callCount=firstWord.length>2?llamadas.filter(r=>(r["Nombre del Contacto"]||"").toLowerCase().includes(firstWord)).length:0;
    const msgCount=firstWord.length>2?mensajes.filter(r=>(r["Nombre del Contacto"]||"").toLowerCase().includes(firstWord)).length:0;
    return {...lead,contactName,stage,pipeline,notes,agentName,callCount,msgCount};
  }),[leads,llamadas,mensajes]);
  const pipeLeads=enriched.filter(l=>l.pipeline===sel&&(asrFilter===""||l.agentName.toLowerCase().includes(asrFilter.toLowerCase())));
  const pipeCount=(name)=>enriched.filter(l=>l.pipeline===name).length;
  if(!leads.length) return <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:40,textAlign:"center",color:"#2A3D5A",fontFamily:MONO,fontSize:12}}>Sube el CSV de leads para ver el pipeline</div>;
  return (
    <div>
      <SectionTitle>🏗️ Pipeline — Etapas por Prospecto</SectionTitle>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {Object.entries(PIPELINE_CONFIG).map(([name,c])=>{
          const isA=sel===name;
          return <button key={name} onClick={()=>setSel(name)} style={{background:isA?`${c.color}22`:"#0f1923",border:`1px solid ${isA?c.color:"#1E3050"}`,color:isA?c.color:"#5A7090",borderRadius:10,padding:"8px 16px",cursor:"pointer",fontFamily:MONO,fontSize:11,fontWeight:isA?700:400,display:"flex",alignItems:"center",gap:6,transition:"all 0.15s"}}>
            <span>{c.icon}</span><span>{name}</span>
            <span style={{background:isA?`${c.color}33`:"#1A2B4A",color:isA?c.color:"#5A7090",borderRadius:12,padding:"2px 8px",fontSize:9,fontWeight:700}}>{pipeCount(name)}</span>
          </button>;
        })}
        <input placeholder="Filtrar asesor…" value={asrFilter} onChange={e=>setAsrFilter(e.target.value)}
          style={{marginLeft:"auto",background:"#0f1923",border:"1px solid #1E3050",color:"#F0EAD6",borderRadius:8,padding:"7px 12px",fontFamily:MONO,fontSize:10,outline:"none",minWidth:160}}/>
      </div>
      <div style={{display:"flex",gap:10,overflowX:"auto",paddingBottom:12,alignItems:"flex-start"}}>
        {cfg.stages.map(stage=>{
          const stLeads=pipeLeads.filter(l=>l.stage===stage);
          return (
            <div key={stage} style={{minWidth:196,flexShrink:0}}>
              <div style={{background:`${cfg.color}18`,border:`1px solid ${cfg.color}44`,borderRadius:"10px 10px 0 0",padding:"9px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{color:cfg.color,fontFamily:MONO,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,lineHeight:1.3}}>{stage}</span>
                <span style={{background:`${cfg.color}44`,color:cfg.color,borderRadius:10,padding:"2px 8px",fontSize:9,fontWeight:700,flexShrink:0,marginLeft:4}}>{stLeads.length}</span>
              </div>
              <div style={{background:"#0A1420",border:`1px solid ${cfg.color}22`,borderTop:"none",borderRadius:"0 0 10px 10px",padding:8,minHeight:100,display:"flex",flexDirection:"column",gap:6}}>
                {stLeads.length===0
                  ?<div style={{color:"#2A3D5A",fontFamily:MONO,fontSize:9,textAlign:"center",padding:"16px 0"}}>Sin leads</div>
                  :stLeads.map((lead,i)=>(
                    <div key={i} style={{background:"#0f1923",border:"1px solid #1E3050",borderRadius:8,padding:"9px 11px",transition:"border-color 0.15s"}} onMouseEnter={e=>e.currentTarget.style.borderColor=`${cfg.color}66`} onMouseLeave={e=>e.currentTarget.style.borderColor="#1E3050"}>
                      <div style={{color:"#F0EAD6",fontFamily:MONO,fontSize:10,fontWeight:600,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lead.contactName||"Sin nombre"}</div>
                      <div style={{color:"#5A7090",fontFamily:MONO,fontSize:9,marginBottom:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lead.agentName}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {lead.callCount>0&&<span style={{color:GOLD,fontSize:8,background:`${GOLD}18`,borderRadius:4,padding:"2px 5px"}}>📞{lead.callCount}</span>}
                        {lead.msgCount>0&&<span style={{color:"#4A7FA5",fontSize:8,background:"#4A7FA522",borderRadius:4,padding:"2px 5px"}}>💬{lead.msgCount}</span>}
                        {parseInt(lead.notes)>0&&<span style={{color:"#B87CC8",fontSize:8,background:"#B87CC822",borderRadius:4,padding:"2px 5px"}}>📝{lead.notes}</span>}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Asesor Search ─────────────────────────────────────────────────────────────
function AsesorSearch({ agents, leads, llamadas, mensajes }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [showDrop, setShowDrop] = useState(false);
  const [expandedLead, setExpandedLead] = useState(null);
  const filtered = query.length>=1 ? agents.filter(a=>a.name.toLowerCase().includes(query.toLowerCase())) : [];
  const selAgent = agents.find(a=>a.name===selected);
  const agentLeads = useMemo(()=>{
    if (!selected) return [];
    return leads.filter(l=>(l["Assigned User"]||"").toLowerCase()===selected.toLowerCase()).map(lead=>{
      const contactName=lead["Primary Contact Name"]||lead["Contact Name"]||"";
      const stage=lead["Stage"]||lead["stage"]||"";
      const pipeline=getLeadPipeline(lead);
      const notes=getLeadNotes(lead);
      const fw=(contactName.split(" ")[0]||"").toLowerCase();
      const callCount=fw.length>2?llamadas.filter(r=>(r["Nombre del Contacto"]||"").toLowerCase().includes(fw)).length:0;
      const msgCount=fw.length>2?mensajes.filter(r=>(r["Nombre del Contacto"]||"").toLowerCase().includes(fw)).length:0;
      return {
      contactName, stage, pipeline, notes, callCount, msgCount,
      actividades: callCount+msgCount+(parseInt(notes)||0),
      interes:     lead["🌡️ Nivel de interés del prospecto"] || "",
      presupuesto: lead["💸 Presupuesto estimado"] || "",
      financ:      lead["🏦 ¿Cuenta con financiamiento o crédito?"] || "",
      cita:        lead["📅 ¿Desea agendar una cita?"] || "",
      medio:       lead["Medio de contacto de preferencia"] || "",
      notaPrimerC: lead["Comentario de NOTA primer contacto"] || "",
      notaSeguim:  lead["Comentario de seguimiento externo"] || "",
      dias:        lead["Días Asignado"] !== "" && lead["Días Asignado"] !== undefined ? String(lead["Días Asignado"]) : "",
      contactId:   lead["Contact Id"] || "",
    };
    });
  },[selected,leads,llamadas,mensajes]);
  const pipeCounts = useMemo(()=>{ const c={}; agentLeads.forEach(l=>{c[l.pipeline]=(c[l.pipeline]||0)+1;}); return c; },[agentLeads]);
  return (
    <div>
      <SectionTitle>🔍 Búsqueda por Asesor</SectionTitle>
      <div style={{position:"relative",marginBottom:16}}>
        <input placeholder="Escribe el nombre del asesor…" value={query}
          onChange={e=>{setQuery(e.target.value);setShowDrop(true);if(!e.target.value){setSelected(null);}}}
          onFocus={()=>setShowDrop(true)}
          style={{width:"100%",background:"#0f1923",border:`2px solid ${GOLD}44`,color:"#F0EAD6",borderRadius:10,padding:"13px 16px",fontFamily:MONO,fontSize:13,outline:"none",boxSizing:"border-box",transition:"border-color 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.borderColor=`${GOLD}88`} onMouseLeave={e=>e.currentTarget.style.borderColor=`${GOLD}44`}/>
        {filtered.length>0&&showDrop&&!selected&&(
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#0A1420",border:`1px solid ${GOLD}33`,borderRadius:10,zIndex:200,overflow:"hidden"}}>
            {filtered.slice(0,8).map(a=>(
              <div key={a.name} onClick={()=>{setSelected(a.name);setQuery(a.name);setShowDrop(false);}}
                style={{padding:"11px 16px",cursor:"pointer",color:"#F0EAD6",fontFamily:MONO,fontSize:12,borderBottom:"1px solid #0D1B2A",display:"flex",alignItems:"center",justifyContent:"space-between"}}
                onMouseEnter={e=>e.currentTarget.style.background=`${GOLD}18`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <span>{a.name}</span>
                <span style={{color:"#5A7090",fontSize:10}}>Score {a.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {selected&&selAgent&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:16}}>
            <KPICard icon={Users} label="Leads Asignados" value={agentLeads.length} color={GOLD}/>
            <KPICard icon={Phone} label="Llamadas" value={selAgent.llamadasTotal}/>
            <KPICard icon={MessageSquare} label="Mensajes" value={selAgent.mensajesTotal} color="#4A7FA5"/>
            <KPICard icon={TrendingUp} label="% Contactación" value={`${selAgent.tasaContactos||0}%`} color="#6DB87A"/>
            <KPICard icon={BarChart2} label="Actividades" value={selAgent.actividadesTotal||0}/>
            <KPICard icon={Award} label="Score" value={selAgent.score} color={GOLD}/>
          </div>
          {Object.keys(pipeCounts).length>0&&(
            <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
              {Object.entries(PIPELINE_CONFIG).map(([name,c])=>(
                <div key={name} style={{background:`${c.color}14`,border:`1px solid ${c.color}33`,borderRadius:10,padding:"12px 18px",flex:1,minWidth:110}}>
                  <div style={{color:c.color,fontFamily:MONO,fontSize:9,textTransform:"uppercase",marginBottom:4}}>{c.icon} {name}</div>
                  <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:26,fontWeight:700,lineHeight:1}}>{pipeCounts[name]||0}</div>
                  <div style={{color:"#5A7090",fontFamily:MONO,fontSize:9,marginTop:2}}>leads</div>
                </div>
              ))}
            </div>
          )}
          {agentLeads.length>0?(
            <div style={{background:"#0A1420",border:`1px solid ${GOLD}33`,borderRadius:16,overflow:"hidden"}}>
              <div style={{padding:"14px 20px",borderBottom:`1px solid ${GOLD}22`,display:"flex",alignItems:"center",gap:8}}>
                <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:15,fontWeight:600}}>Leads de {selected}</div>
                <div style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>· {agentLeads.length} registros</div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:MONO,fontSize:11}}>
                  <thead><tr style={{background:"#0D1B2A"}}>{["Prospecto","Pipeline","Etapa","🌡️ Interés","💸 Presupuesto","🏦 Financ.","📞","💬","📝","Actos","Días"].map(h=><th key={h} style={{padding:"10px 14px",textAlign:"left",color:"#5A7090",fontSize:9,fontWeight:500,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>{agentLeads.map((lead,i)=>{
                    const pc=PIPELINE_CONFIG[lead.pipeline]||{color:GOLD};
                    const diasNum=parseInt(lead.dias)||0;
                    const diasColor=diasNum>14?"#E8824A":diasNum>7?"#C8A84A":"#6DB87A";
                    const isExp=expandedLead===i;
                    const hasNotes=lead.notaPrimerC||lead.notaSeguim||lead.cita||lead.medio;
                    return <>
                      <tr key={i} onClick={()=>setExpandedLead(isExp?null:i)} style={{borderBottom:isExp?"none":"1px solid #0D1B2A",cursor:hasNotes?"pointer":"default",background:isExp?`${GOLD}0D`:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background=`${GOLD}0A`} onMouseLeave={e=>e.currentTarget.style.background=isExp?`${GOLD}0D`:"transparent"}>
                        <td style={{padding:"10px 14px",color:"#F0EAD6",fontWeight:600,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{hasNotes?<span style={{marginRight:4,fontSize:9}}>{isExp?"▼":"▶"}</span>:null}{lead.contactName||"—"}</td>
                        <td style={{padding:"10px 14px"}}><span style={{color:pc.color,background:`${pc.color}18`,borderRadius:6,padding:"3px 8px",fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>{lead.pipeline||"—"}</span></td>
                        <td style={{padding:"10px 14px",color:"#A8C0D8",fontSize:10,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lead.stage||"—"}</td>
                        <td style={{padding:"10px 14px",color:"#F0EAD6",fontSize:9,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lead.interes||"—"}</td>
                        <td style={{padding:"10px 14px",color:"#6DB87A",fontSize:10,whiteSpace:"nowrap"}}>{lead.presupuesto||"—"}</td>
                        <td style={{padding:"10px 14px",color:lead.financ&&lead.financ.toLowerCase().includes("sí")?"#6DB87A":"#A8C0D8",fontSize:10,whiteSpace:"nowrap"}}>{lead.financ||"—"}</td>
                        <td style={{padding:"10px 14px",textAlign:"center",color:lead.callCount>0?GOLD:"#3A5070",fontWeight:lead.callCount>0?700:400}}>{lead.callCount||"—"}</td>
                        <td style={{padding:"10px 14px",textAlign:"center",color:lead.msgCount>0?"#4A7FA5":"#3A5070",fontWeight:lead.msgCount>0?700:400}}>{lead.msgCount||"—"}</td>
                        <td style={{padding:"10px 14px",textAlign:"center",color:parseInt(lead.notes)>0?"#B87CC8":"#3A5070",fontWeight:parseInt(lead.notes)>0?700:400}}>{lead.notes}</td>
                        <td style={{padding:"10px 14px",textAlign:"center",color:lead.actividades>0?"#6DB87A":"#3A5070",fontWeight:lead.actividades>0?700:400,fontSize:13}}>{lead.actividades||"—"}</td>
                        <td style={{padding:"10px 14px",textAlign:"center",color:lead.dias?diasColor:"#3A5070",fontWeight:700,fontSize:10}}>{lead.dias?`${lead.dias}d`:"—"}</td>
                      </tr>
                      {isExp&&<tr key={`exp-${i}`} style={{borderBottom:"1px solid #0D1B2A",background:"#070D14"}}>
                        <td colSpan={11} style={{padding:"12px 20px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                            {lead.notaPrimerC&&<div style={{background:"#0A1420",borderRadius:8,padding:"10px 14px",border:"1px solid #1E3050"}}>
                              <div style={{color:GOLD,fontFamily:MONO,fontSize:9,fontWeight:700,marginBottom:5,textTransform:"uppercase",letterSpacing:0.5}}>📝 Nota primer contacto</div>
                              <div style={{color:"#A8C0D8",fontFamily:MONO,fontSize:10,lineHeight:1.5}}>{lead.notaPrimerC}</div>
                            </div>}
                            {lead.notaSeguim&&<div style={{background:"#0A1420",borderRadius:8,padding:"10px 14px",border:"1px solid #1E3050"}}>
                              <div style={{color:"#4A7FA5",fontFamily:MONO,fontSize:9,fontWeight:700,marginBottom:5,textTransform:"uppercase",letterSpacing:0.5}}>💬 Seguimiento externo</div>
                              <div style={{color:"#A8C0D8",fontFamily:MONO,fontSize:10,lineHeight:1.5}}>{lead.notaSeguim}</div>
                            </div>}
                            {(lead.cita||lead.medio)&&<div style={{background:"#0A1420",borderRadius:8,padding:"10px 14px",border:"1px solid #1E3050"}}>
                              {lead.cita&&<div style={{marginBottom:6}}><span style={{color:"#5A7090",fontFamily:MONO,fontSize:9}}>¿Desea cita? </span><span style={{color:"#F0EAD6",fontFamily:MONO,fontSize:10,fontWeight:600}}>{lead.cita}</span></div>}
                              {lead.medio&&<div><span style={{color:"#5A7090",fontFamily:MONO,fontSize:9}}>Medio preferido: </span><span style={{color:"#F0EAD6",fontFamily:MONO,fontSize:10,fontWeight:600}}>{lead.medio}</span></div>}
                            </div>}
                          </div>
                        </td>
                      </tr>}
                    </>;
                  })}</tbody>
                </table>
              </div>
            </div>
          ):(
            <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:28,textAlign:"center",color:"#3A5070",fontFamily:MONO,fontSize:11}}>
              No hay leads CSV cargados — sube el archivo de leads para ver el detalle del asesor
            </div>
          )}
        </div>
      )}
      {!selected&&(
        <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:48,textAlign:"center"}}>
          <Users size={36} color="#2A3D5A" style={{marginBottom:12}}/>
          <div style={{color:"#5A7090",fontFamily:MONO,fontSize:12,marginTop:8}}>Busca un asesor para ver su resumen completo de leads y actividad</div>
        </div>
      )}
    </div>
  );
}

// ── Leads & Activity Panel ────────────────────────────────────────────────────
function LeadsPanel({ agents }) {
  const [sortBy, setSortBy] = useState("contactosTotal");
  const [sortDir, setSortDir] = useState("desc");
  if (!agents.length) return <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:40,textAlign:"center",color:"#2A3D5A",fontFamily:MONO,fontSize:12}}>Carga los CSVs para ver leads por asesor</div>;
  const toggle = k => { if (sortBy===k) setSortDir(d=>d==="desc"?"asc":"desc"); else { setSortBy(k); setSortDir("desc"); } };
  const sorted = [...agents].sort((a,b)=>(sortDir==="desc"?-1:1)*((a[sortBy]||0)-(b[sortBy]||0)));
  const COLS = [
    {key:"contactosTotal",label:"Contactos"},
    {key:"leadsContactados",label:"Contactados"},
    {key:"tasaContactos",label:"% Contactados"},
    {key:"actividadesTotal",label:"Actividades"},
    {key:"actividadesPorLead",label:"Act/Lead"},
    {key:"llamadasTotal",label:"Llamadas"},
    {key:"mensajesTotal",label:"Mensajes"},
  ];
  const maxAct = Math.max(...agents.map(a=>a.actividadesTotal),1);
  const chartContacts = sorted.slice(0,8).map(a=>({name:a.name.split(" ")[0],value:a.contactosTotal}));
  const chartActs = sorted.slice(0,8).map(a=>({name:a.name.split(" ")[0],value:a.actividadesTotal}));
  return (
    <div>
      <SectionTitle>👤 Leads & Actividad por Asesor</SectionTitle>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
        {chartContacts.length>0&&<ChartPanel title="Contactos/Leads asignados por asesor" data={chartContacts} dataKey="value" nameKey="name" color={GOLD}/>}
        {chartActs.length>0&&<ChartPanel title="Actividades totales (llamadas + mensajes)" data={chartActs} dataKey="value" nameKey="name" color="#4A7FA5"/>}
      </div>
      <div style={{background:"#0A1420",border:`1px solid ${GOLD}33`,borderRadius:16,overflow:"hidden"}}>
        <div style={{padding:"16px 22px",borderBottom:`1px solid ${GOLD}22`,display:"flex",alignItems:"center",gap:10}}>
          <Users size={18} color={GOLD}/>
          <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:16,fontWeight:600}}>Actividad por Asesor — Detalle</div>
          <div style={{color:"#5A7090",fontFamily:MONO,fontSize:10,marginLeft:"auto"}}>Haz clic en columna para ordenar</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:MONO,fontSize:11}}>
            <thead>
              <tr style={{background:"#0D1B2A"}}>
                <th style={{padding:"12px 16px",textAlign:"left",color:"#5A7090",fontSize:10,fontWeight:500,minWidth:160}}>ASESOR</th>
                {COLS.map(c=><th key={c.key} onClick={()=>toggle(c.key)} style={{padding:"12px 14px",textAlign:"center",color:sortBy===c.key?GOLD:"#5A7090",fontSize:10,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap",userSelect:"none"}}>{c.label}{sortBy===c.key?(sortDir==="desc"?" ↓":" ↑"):""}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((agent,i)=>{
                const pct = agent.actividadesTotal/maxAct*100;
                const tcColor = agent.tasaContactos>=60?"#6DB87A":agent.tasaContactos>=40?GOLD:"#E8824A";
                const aplColor = agent.actividadesPorLead>=3?GOLD:"#A8C0D8";
                return (
                  <tr key={agent.name} style={{borderBottom:"1px solid #0D1B2A"}} onMouseEnter={e=>e.currentTarget.style.background=`${GOLD}0A`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{padding:"12px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <RankBadge rank={i+1}/>
                        <div>
                          <div style={{color:"#F0EAD6",fontWeight:600}}>{agent.name}</div>
                          <div style={{height:3,background:"#1E3050",borderRadius:2,marginTop:5,width:100,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:GOLD,borderRadius:2}}/></div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:"12px 14px",textAlign:"center",color:"#F0EAD6",fontWeight:600}}>{agent.contactosTotal}</td>
                    <td style={{padding:"12px 14px",textAlign:"center"}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                        <span style={{color:"#6DB87A",fontWeight:600}}>{agent.leadsContactados}</span>
                        <div style={{width:48,height:3,background:"#1E3050",borderRadius:2,overflow:"hidden"}}><div style={{width:`${Math.min(agent.contactosTotal>0?agent.leadsContactados/agent.contactosTotal*100:0,100)}%`,height:"100%",background:"#6DB87A"}}/></div>
                      </div>
                    </td>
                    <td style={{padding:"12px 14px",textAlign:"center"}}><span style={{color:tcColor,fontWeight:700,fontSize:13}}>{agent.tasaContactos}%</span></td>
                    <td style={{padding:"12px 14px",textAlign:"center",color:"#A8C0D8"}}>{agent.actividadesTotal}</td>
                    <td style={{padding:"12px 14px",textAlign:"center"}}><span style={{color:aplColor,fontWeight:agent.actividadesPorLead>=3?700:400,fontSize:13}}>{agent.actividadesPorLead}</span></td>
                    <td style={{padding:"12px 14px",textAlign:"center",color:"#A8C0D8"}}>{agent.llamadasTotal}</td>
                    <td style={{padding:"12px 14px",textAlign:"center",color:"#A8C0D8"}}>{agent.mensajesTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{padding:"10px 16px",borderTop:"1px solid #0D1B2A",display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:"#6DB87A"}}/><span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>≥60% contactados = bueno</span></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:GOLD}}/><span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>≥3 Act/Lead = óptimo</span></div>
          <div style={{color:"#3A5070",fontFamily:MONO,fontSize:9,marginLeft:"auto"}}>* Contactados = llamadas contestadas + mensajes enviados (estimado)</div>
        </div>
      </div>
    </div>
  );
}

// ── Agent Weekly Matrix ───────────────────────────────────────────────────────
function AgentWeeklyMatrix({ datasets }) {
  const matrixData = useMemo(()=>{
    if (!datasets) return {agents:[],weeks:[],matrix:{}};
    return buildWeeklyAgentMatrix(datasets);
  },[datasets]);
  const {agents,weeks,matrix} = matrixData;
  if (!agents.length||!weeks.length) return (
    <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:40,textAlign:"center"}}>
      <CalendarDays size={36} color="#2A3D5A" style={{marginBottom:12}}/>
      <div style={{color:"#5A7090",fontFamily:MONO,fontSize:12}}>Carga CSVs con fechas para ver la matriz de actividad por semana</div>
    </div>
  );
  const allVals = agents.flatMap(ag=>weeks.map(wk=>(matrix[ag]?.[wk]?.llamadas||0)+(matrix[ag]?.[wk]?.mensajes||0)));
  const maxVal = Math.max(...allVals,1);
  const cellBg = v => { const p=v/maxVal; return p>=0.8?"#8B5A2B":p>=0.5?"#4A7FA5":p>=0.25?"#2D5A8C":"#1A3A5C"; };
  return (
    <div>
      <SectionTitle>📊 Actividad Semanal por Asesor</SectionTitle>
      <div style={{background:"#0A1420",border:`1px solid ${GOLD}33`,borderRadius:16,overflow:"hidden"}}>
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${GOLD}22`,display:"flex",alignItems:"center",gap:10}}>
          <CalendarDays size={16} color={GOLD}/>
          <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:15,fontWeight:600}}>Matriz Actividad — Asesor × Semana</div>
          <div style={{color:"#5A7090",fontFamily:MONO,fontSize:9,marginLeft:"auto"}}>Llamadas + Mensajes por semana</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:MONO,fontSize:11}}>
            <thead>
              <tr style={{background:"#070D14"}}>
                <th style={{padding:"10px 16px",textAlign:"left",color:"#5A7090",fontSize:9,fontWeight:500,minWidth:150}}>ASESOR</th>
                {weeks.map(wk=><th key={wk} style={{padding:"10px 12px",textAlign:"center",color:"#5A7090",fontSize:9,fontWeight:500,whiteSpace:"nowrap",minWidth:76}}>{weekLabel(wk).replace(/ –.*/, "")}</th>)}
                <th style={{padding:"10px 12px",textAlign:"center",color:GOLD,fontSize:9,fontWeight:500}}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(ag=>{
                const totalAg = weeks.reduce((s,wk)=>s+(matrix[ag]?.[wk]?.llamadas||0)+(matrix[ag]?.[wk]?.mensajes||0),0);
                return (
                  <tr key={ag} style={{borderBottom:"1px solid #0A1520"}} onMouseEnter={e=>e.currentTarget.style.background="#0D1B2A"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{padding:"10px 16px",color:"#C0D4E8",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:150}}>{ag}</td>
                    {weeks.map(wk=>{
                      const cell=matrix[ag]?.[wk]||{llamadas:0,mensajes:0};
                      const total=cell.llamadas+cell.mensajes;
                      return (
                        <td key={wk} style={{padding:"8px 12px",textAlign:"center"}}>
                          {total>0?(
                            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                              <div style={{width:42,height:26,borderRadius:6,background:cellBg(total),display:"flex",alignItems:"center",justifyContent:"center",color:"#F0EAD6",fontWeight:700,fontSize:12,boxShadow:total/maxVal>=0.8?`0 0 8px ${GOLD}55`:"none"}}>{total}</div>
                              <div style={{display:"flex",gap:2}}>
                                {cell.llamadas>0&&<span style={{color:GOLD,fontSize:8}}>📞{cell.llamadas}</span>}
                                {cell.mensajes>0&&<span style={{color:"#4A7FA5",fontSize:8}}>💬{cell.mensajes}</span>}
                              </div>
                            </div>
                          ):<div style={{width:42,height:26,borderRadius:6,background:"#0D1B2A",margin:"0 auto",opacity:0.3}}/>}
                        </td>
                      );
                    })}
                    <td style={{padding:"10px 12px",textAlign:"center",color:GOLD,fontWeight:700,fontSize:13}}>{totalAg}</td>
                  </tr>
                );
              })}
              <tr style={{borderTop:`1px solid ${GOLD}22`,background:"#070D14"}}>
                <td style={{padding:"10px 16px",color:GOLD,fontSize:10,fontWeight:600}}>TOTAL SEMANA</td>
                {weeks.map(wk=>{
                  const wkT=agents.reduce((s,ag)=>s+(matrix[ag]?.[wk]?.llamadas||0)+(matrix[ag]?.[wk]?.mensajes||0),0);
                  return <td key={wk} style={{padding:"10px 12px",textAlign:"center",color:GOLD,fontWeight:700}}>{wkT}</td>;
                })}
                <td style={{padding:"10px 12px",textAlign:"center",color:GOLD,fontWeight:700}}>{agents.reduce((s,ag)=>s+weeks.reduce((s2,wk)=>s2+(matrix[ag]?.[wk]?.llamadas||0)+(matrix[ag]?.[wk]?.mensajes||0),0),0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{padding:"10px 16px",borderTop:"1px solid #0D1B2A",display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
          {[{c:"#8B5A2B",l:"Alta (≥80%)"},{c:"#4A7FA5",l:"Media (50–79%)"},{c:"#2D5A8C",l:"Baja (25–49%)"},{c:"#1A3A5C",l:"Muy baja (<25%)"}].map(x=>(
            <div key={x.l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:12,height:12,borderRadius:3,background:x.c}}/><span style={{color:"#5A7090",fontFamily:MONO,fontSize:9}}>{x.l}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Weekly Comparison View ────────────────────────────────────────────────────
function WeeklyView({ report }) {
  const [selectedWeek, setSelectedWeek] = useState(null);

  // Build weekly data from raw datasets if available, else use pre-baked
  const weeklyData = useMemo(() => {
    const { datasets, charts } = report;
    const hasRaw = datasets && (datasets.llamadas?.length > 0 || datasets.mensajes?.length > 0 || datasets.leads?.length > 0);

    if (hasRaw) {
      const weekMap = splitDatasetsByWeek(datasets);
      return Object.entries(weekMap)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([key, rows]) => ({
          weekKey: key,
          weekLabel: weekLabel(key),
          ...summaryFromRows(rows),
          _rows: rows,
        }));
    }
    // Fallback to seed pre-baked data
    return (charts.weeklyData || []).map(w => ({ ...w, _rows: null }));
  }, [report]);

  const METRICS = [
    { key:"totalLlamadas", label:"Llamadas", icon:Phone, color:GOLD },
    { key:"contestadas", label:"Contestadas", icon:TrendingUp, color:"#6DB87A" },
    { key:"tasaContestacion", label:"% Contactación", icon:TrendingUp, color:"#7DB8D4", suffix:"%" },
    { key:"perdidas", label:"No Contestadas", icon:AlertTriangle, color:"#E8824A" },
    { key:"totalMensajes", label:"Mensajes", icon:MessageSquare, color:"#4A7FA5" },
    { key:"unread", label:"Sin Leer", icon:AlertTriangle, color:"#E8824A" },
    { key:"totalContactos", label:"Contactos Nuevos", icon:Users, color:"#B87CC8" },
    { key:"totalLeads", label:"Leads Abd.", icon:AlertTriangle, color:"#E8824A" },
  ];

  if (!weeklyData.length) return (
    <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:48,textAlign:"center"}}>
      <CalendarDays size={36} color="#2A3D5A" style={{marginBottom:12}}/>
      <div style={{color:"#5A7090",fontFamily:MONO,fontSize:12}}>No hay suficientes fechas en los CSV para dividir por semanas</div>
    </div>
  );

  const best = (key) => {
    const vals = weeklyData.map(w => w[key] || 0);
    return Math.max(...vals);
  };
  const worst = (key) => {
    const vals = weeklyData.map(w => w[key] || 0);
    return Math.min(...vals);
  };

  return (
    <div>
      <SectionTitle>📅 Comparativa Semanal</SectionTitle>

      {/* Summary cards per week */}
      <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(weeklyData.length,4)},1fr)`,gap:10,marginBottom:20}}>
        {weeklyData.map((w,i) => {
          const prev = weeklyData[i-1];
          const dLlamadas = prev ? w.totalLlamadas - prev.totalLlamadas : undefined;
          const isSelected = selectedWeek === w.weekKey;
          return (
            <div key={w.weekKey} onClick={() => setSelectedWeek(isSelected ? null : w.weekKey)}
              style={{background:isSelected?`${GOLD}1A`:"#0f1923",border:`1px solid ${isSelected?GOLD:"#1E3050"}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",transition:"all 0.15s"}}
              onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.borderColor=`${GOLD}66`;}}
              onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.borderColor="#1E3050";}}>
              <div style={{color:GOLD,fontFamily:MONO,fontSize:9,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Semana {i+1}</div>
              <div style={{color:"#F0EAD6",fontFamily:MONO,fontSize:11,fontWeight:600,marginBottom:10}}>{w.weekLabel}</div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>Llamadas</span>
                <span style={{color:"#F0EAD6",fontFamily:MONO,fontSize:10,fontWeight:600}}>{w.totalLlamadas}{dLlamadas!==undefined&&<span style={{color:dLlamadas>=0?"#6DB87A":"#E8824A",fontSize:9,marginLeft:4}}>{dLlamadas>=0?"▲":"▼"}{Math.abs(dLlamadas)}</span>}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>% Contacto</span>
                <span style={{color:w.tasaContestacion>=45?"#6DB87A":"#E8824A",fontFamily:MONO,fontSize:10,fontWeight:600}}>{w.tasaContestacion}%</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>Mensajes</span>
                <span style={{color:"#A8C0D8",fontFamily:MONO,fontSize:10}}>{w.totalMensajes}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>Leads Abd.</span>
                <span style={{color:w.totalLeads>2?"#E8824A":"#6DB87A",fontFamily:MONO,fontSize:10}}>{w.totalLeads}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Big comparison table */}
      <div style={{background:"#0A1420",border:`1px solid ${GOLD}33`,borderRadius:16,overflow:"hidden",marginBottom:20}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${GOLD}22`,display:"flex",alignItems:"center",gap:10}}>
          <CalendarDays size={18} color={GOLD}/>
          <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:16,fontWeight:600}}>Tabla Comparativa — Semana a Semana</div>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:MONO,fontSize:11}}>
            <thead>
              <tr style={{background:"#0D1B2A"}}>
                <th style={{padding:"12px 16px",textAlign:"left",color:"#5A7090",fontSize:10,fontWeight:500,minWidth:140}}>MÉTRICA</th>
                {weeklyData.map((w,i)=>(
                  <th key={w.weekKey} style={{padding:"12px 16px",textAlign:"center",color:selectedWeek===w.weekKey?GOLD:"#8A9BB8",fontSize:10,fontWeight:500,whiteSpace:"nowrap",background:selectedWeek===w.weekKey?`${GOLD}0D`:"transparent",borderBottom:selectedWeek===w.weekKey?`2px solid ${GOLD}`:"none",cursor:"pointer"}} onClick={()=>setSelectedWeek(selectedWeek===w.weekKey?null:w.weekKey)}>
                    <div style={{color:GOLD,fontSize:9,marginBottom:2}}>SEM {i+1}</div>
                    {w.weekLabel}
                  </th>
                ))}
                <th style={{padding:"12px 16px",textAlign:"center",color:"#5A7090",fontSize:10,fontWeight:500}}>MEJOR</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map(metric=>(
                <tr key={metric.key} style={{borderBottom:"1px solid #0D1B2A"}}>
                  <td style={{padding:"11px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:metric.color,flexShrink:0}}/>
                      <span style={{color:"#8A9BB8"}}>{metric.label}</span>
                    </div>
                  </td>
                  {weeklyData.map((w,i)=>{
                    const val = w[metric.key] || 0;
                    const prev = weeklyData[i-1];
                    const delta = prev ? val - (prev[metric.key]||0) : null;
                    const isBest = val === best(metric.key) && val > 0;
                    const isWorst = val === worst(metric.key) && weeklyData.length > 1;
                    // For "bad" metrics (unread, leads, perdidas) flip colors
                    const badMetric = ["unread","totalLeads","perdidas"].includes(metric.key);
                    const highlight = isBest ? (badMetric?"#E8824A":"#6DB87A") : isWorst ? (badMetric?"#6DB87A":"#E8824A") : null;
                    return (
                      <td key={w.weekKey} style={{padding:"11px 16px",textAlign:"center",background:selectedWeek===w.weekKey?`${GOLD}0A`:"transparent"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                          <span style={{color:highlight||"#F0EAD6",fontWeight:isBest?"700":"400",fontSize:12}}>
                            {val}{metric.suffix||""}
                          </span>
                          {delta!==null&&delta!==0&&(
                            <span style={{color:(!badMetric&&delta>0)||(badMetric&&delta<0)?"#6DB87A":"#E8824A",fontSize:9}}>
                              {delta>0?"▲":"▼"}{Math.abs(delta)}
                            </span>
                          )}
                          {isBest&&!badMetric&&<span style={{fontSize:10}}>⭐</span>}
                        </div>
                      </td>
                    );
                  })}
                  <td style={{padding:"11px 16px",textAlign:"center",color:GOLD,fontFamily:MONO,fontSize:11,fontWeight:700}}>
                    {["unread","totalLeads","perdidas"].includes(metric.key)
                      ? worst(metric.key) + (metric.suffix||"")
                      : best(metric.key) + (metric.suffix||"")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{padding:"10px 16px",borderTop:"1px solid #0D1B2A",display:"flex",gap:16,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{color:"#6DB87A",fontSize:12}}>⭐</span><span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>Mejor semana</span></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:"#6DB87A"}}/><span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>Mejor valor</span></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:"#E8824A"}}/><span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>Peor valor</span></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{color:"#6DB87A",fontFamily:MONO,fontSize:10}}>▲ / </span><span style={{color:"#E8824A",fontFamily:MONO,fontSize:10}}>▼</span><span style={{color:"#5A7090",fontFamily:MONO,fontSize:10,marginLeft:4}}>vs semana anterior</span></div>
        </div>
      </div>

      {/* Detail of selected week */}
      {selectedWeek && (() => {
        const w = weeklyData.find(x=>x.weekKey===selectedWeek);
        if (!w) return null;
        const agentLlamadas = w._rows?.llamadas ? Object.entries(w._rows.llamadas.reduce((acc,r)=>{const a=r["Llamar realizada Vía"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value) : [];
        const agentMensajes = w._rows?.mensajes ? Object.entries(w._rows.mensajes.reduce((acc,r)=>{const a=r["Asignado a"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value) : [];
        return (
          <div style={{background:"#0A1420",border:`1px solid ${GOLD}33`,borderRadius:16,padding:20}}>
            <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:16,fontWeight:600,marginBottom:16}}>
              Detalle — {w.weekLabel}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:16}}>
              <KPICard icon={Phone} label="Llamadas" value={w.totalLlamadas}/>
              <KPICard icon={TrendingUp} label="Contestadas" value={w.contestadas} color="#6DB87A" sub={`${w.tasaContestacion}% tasa`}/>
              <KPICard icon={MessageSquare} label="Mensajes" value={w.totalMensajes} color="#4A7FA5"/>
              <KPICard icon={AlertTriangle} label="Sin Leer" value={w.unread} color="#E8824A"/>
              <KPICard icon={Users} label="Contactos" value={w.totalContactos} color="#B87CC8"/>
              <KPICard icon={AlertTriangle} label="Leads Abd." value={w.totalLeads} color="#E8824A"/>
            </div>
            {(agentLlamadas.length>0||agentMensajes.length>0)&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {agentLlamadas.length>0&&<ChartPanel title="Llamadas por agente" data={agentLlamadas} dataKey="value" nameKey="name" color={GOLD}/>}
                {agentMensajes.length>0&&<ChartPanel title="Mensajes por agente" data={agentMensajes} dataKey="value" nameKey="name" color="#4A7FA5"/>}
              </div>
            )}
          </div>
        );
      })()}

      {/* Agent × Week Matrix */}
      <div style={{marginTop:20}}>
        <AgentWeeklyMatrix datasets={report.datasets}/>
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function AgentLeaderboard({agents,onSelect}) {
  const [sortBy,setSortBy]=useState("score"); const [sortDir,setSortDir]=useState("desc");
  const rankMap=useMemo(()=>Object.fromEntries(agents.map((a,i)=>[a.name,i+1])),[agents]);
  const cols=[{key:"score",label:"Score"},{key:"llamadasTotal",label:"Llamadas"},{key:"llamadasContestadas",label:"Contest."},{key:"tasaContestacion",label:"% Cont."},{key:"mensajesTotal",label:"Mensajes"},{key:"mensajesUnread",label:"Sin Leer"},{key:"contactosTotal",label:"Contactos"},{key:"actividadesTotal",label:"Actividades"},{key:"actividadesPorLead",label:"Act/Lead"},{key:"tasaContactos",label:"% Contactados"},{key:"leadsAbandonados",label:"Leads Abd."}];
  const sorted=[...agents].sort((a,b)=>(sortDir==="desc"?-1:1)*(a[sortBy]-b[sortBy]));
  const toggle=k=>{ if(sortBy===k)setSortDir(d=>d==="desc"?"asc":"desc"); else{setSortBy(k);setSortDir("desc");} };
  if(!agents.length) return <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:40,textAlign:"center",color:"#2A3D5A",fontFamily:MONO,fontSize:12}}>Carga los CSVs para generar el ranking</div>;
  const top3=agents.slice(0,3);
  return (
    <div style={{background:"#0A1420",border:`1px solid ${GOLD}44`,borderRadius:16,overflow:"hidden"}}>
      <div style={{background:`linear-gradient(90deg,${GOLD}1A,transparent)`,padding:"18px 22px",borderBottom:`1px solid ${GOLD}22`,display:"flex",alignItems:"center",gap:12}}>
        <Award size={20} color={GOLD}/>
        <div><div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:19,fontWeight:700}}>Ranking de Rendimiento</div><div style={{color:"#5A7090",fontFamily:MONO,fontSize:10,marginTop:2}}>Haz clic en un agente para ver su análisis completo</div></div>
      </div>
      {top3.length>=2&&(
        <div style={{background:"#070D14",padding:"24px 22px 0",display:"flex",justifyContent:"center",alignItems:"flex-end",gap:12}}>
          {[top3[1],top3[0],top3[2]].filter(Boolean).map((agent,i)=>{
            const rank=rankMap[agent.name]; const heights=[88,118,70];
            return <div key={agent.name} onClick={()=>onSelect(agent.name)} style={{display:"flex",flexDirection:"column",alignItems:"center",cursor:"pointer",flex:1,maxWidth:130}} onMouseEnter={e=>e.currentTarget.style.opacity="0.8"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <div style={{width:rank===1?52:42,height:rank===1?52:42,borderRadius:"50%",background:`linear-gradient(135deg,${RANK_COLORS[rank-1]},${RANK_COLORS[rank]||"#0E2030"})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:rank===1?22:18,marginBottom:5,boxShadow:rank===1?`0 0 20px ${GOLD}55`:"none"}}>{rank===1?"🥇":rank===2?"🥈":"🥉"}</div>
              <div style={{color:"#F0EAD6",fontFamily:MONO,fontSize:10,fontWeight:600,textAlign:"center",maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{agent.name.split(" ")[0]}</div>
              <div style={{color:GOLD,fontFamily:SERIF,fontSize:rank===1?24:18,fontWeight:700}}>{agent.score}</div>
              <div style={{color:"#5A7090",fontFamily:MONO,fontSize:9,marginBottom:6}}>{agent.llamadasTotal} llamadas</div>
              <div style={{width:"100%",height:heights[i],background:`linear-gradient(180deg,${RANK_COLORS[rank-1]}33,${RANK_COLORS[rank-1]}0A)`,borderRadius:"7px 7px 0 0",border:`1px solid ${RANK_COLORS[rank-1]}44`,borderBottom:"none"}}/>
            </div>;
          })}
        </div>
      )}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:MONO}}>
          <thead><tr style={{background:"#0D1B2A"}}><th style={{padding:"11px 14px",textAlign:"left",color:"#5A7090",fontSize:10,fontWeight:500}}>POS</th><th style={{padding:"11px 14px",textAlign:"left",color:"#5A7090",fontSize:10,fontWeight:500,minWidth:150}}>AGENTE</th>{cols.map(c=><th key={c.key} onClick={()=>toggle(c.key)} style={{padding:"11px 14px",textAlign:"right",color:sortBy===c.key?GOLD:"#5A7090",fontSize:10,cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}}>{c.label}{sortBy===c.key?(sortDir==="desc"?" ↓":" ↑"):""}</th>)}<th style={{width:36}}/></tr></thead>
          <tbody>{sorted.map(agent=>{
            const rank=rankMap[agent.name]; const isTop=rank<=3;
            return <tr key={agent.name} onClick={()=>onSelect(agent.name)} style={{borderBottom:"1px solid #0D1B2A",background:isTop?`${RANK_COLORS[rank-1]}0A`:"transparent",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background=`${GOLD}0D`} onMouseLeave={e=>e.currentTarget.style.background=isTop?`${RANK_COLORS[rank-1]}0A`:"transparent"}>
              <td style={{padding:"11px 14px"}}><RankBadge rank={rank}/></td>
              <td style={{padding:"11px 14px"}}><div style={{color:"#F0EAD6",fontWeight:600,fontSize:12,marginBottom:3}}>{agent.name}</div><ScoreBar value={agent.score} color={isTop?RANK_COLORS[rank-1]:"#2D5A8C"}/></td>
              <td style={{padding:"11px 14px",textAlign:"right",color:GOLD,fontWeight:700,fontSize:15}}>{agent.score}</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:"#A8C0D8"}}>{agent.llamadasTotal}</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:"#6DB87A"}}>{agent.llamadasContestadas}</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:agent.tasaContestacion>=50?"#6DB87A":"#E8824A"}}>{agent.tasaContestacion}%</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:"#A8C0D8"}}>{agent.mensajesTotal}</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:agent.mensajesUnread>0?"#E8824A":"#6DB87A"}}>{agent.mensajesUnread}</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:"#A8C0D8"}}>{agent.contactosTotal}</td>
              <td style={{padding:"11px 14px",textAlign:"right",color:agent.leadsAbandonados>0?"#E8824A":"#6DB87A"}}>{agent.leadsAbandonados}</td>
              <td style={{padding:"11px 14px",textAlign:"center",color:GOLD}}>→</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Agent Detail ──────────────────────────────────────────────────────────────
function AgentDetail({agent,rank,datasets,onBack}) {
  const {llamadas=[],mensajes=[],contactos=[],leads=[]}=datasets||{};
  const myL=llamadas.filter(r=>r["Llamar realizada Vía"]===agent.name);
  const myM=mensajes.filter(r=>r["Asignado a"]===agent.name);
  const myC=contactos.filter(r=>r["Usuario asignado"]===agent.name);
  const myLe=leads.filter(r=>r["Assigned User"]===agent.name);
  const estadoL=Object.entries(myL.reduce((acc,r)=>{const s=r["Estado de la llamada"]||"N/A";acc[s]=(acc[s]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));
  const canalM=Object.entries(myM.reduce((acc,r)=>{const c=r["Canal del último Mensaje"]||"N/A";acc[c]=(acc[c]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));
  return (
    <div>
      <div style={{background:"linear-gradient(135deg,#0A1420,#1A2B4A)",border:`1px solid ${GOLD}33`,borderRadius:16,padding:22,marginBottom:20}}>
        <button onClick={onBack} style={{background:`${GOLD}1A`,border:`1px solid ${GOLD}44`,color:GOLD,borderRadius:8,padding:"6px 14px",cursor:"pointer",fontFamily:MONO,fontSize:11,display:"flex",alignItems:"center",gap:5,marginBottom:18}}><ArrowLeft size={12}/> Volver al ranking</button>
        <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
          <div style={{width:58,height:58,borderRadius:"50%",background:`linear-gradient(135deg,${RANK_COLORS[rank-1]||NAVY},${GOLD}44)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,border:`2px solid ${GOLD}55`}}>{rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":"👤"}</div>
          <div style={{flex:1,minWidth:180}}>
            <div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:24,fontWeight:700}}>{agent.name}</div>
            <div style={{color:"#5A7090",fontFamily:MONO,fontSize:10,marginTop:3}}>Posición <span style={{color:GOLD}}>#{rank}</span> · Score <span style={{color:GOLD,fontSize:14,fontFamily:SERIF}}>{agent.score}/100</span></div>
            <div style={{marginTop:8,maxWidth:260}}><ScoreBar value={agent.score} color={RANK_COLORS[rank-1]||GOLD}/></div>
          </div>
          <div style={{width:190,height:155,flexShrink:0}}>
            <ResponsiveContainer width="100%" height="100%"><RadarChart data={agent.radar} margin={{top:8,right:18,bottom:8,left:18}}><PolarGrid stroke="#1E3050"/><PolarAngleAxis dataKey="subject" tick={{fill:"#5A7090",fontSize:8}}/><Radar dataKey="value" stroke={GOLD} fill={GOLD} fillOpacity={0.2} dot={{fill:GOLD,r:2}}/></RadarChart></ResponsiveContainer>
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:10,marginBottom:16}}>
        <KPICard icon={Phone} label="Llamadas" value={agent.llamadasTotal}/>
        <KPICard icon={TrendingUp} label="Contestadas" value={agent.llamadasContestadas} sub={`${agent.tasaContestacion}%`} color="#6DB87A"/>
        <KPICard icon={Phone} label="Dur. Prom." value={`${agent.durProm}s`} color="#7DB8D4"/>
        <KPICard icon={MessageSquare} label="Mensajes" value={agent.mensajesTotal} color="#4A7FA5"/>
        <KPICard icon={AlertTriangle} label="Sin Leer" value={agent.mensajesUnread} color="#E8824A"/>
        <KPICard icon={Users} label="Contactos" value={agent.contactosTotal} color="#B87CC8"/>
        {(agent.mensajesOutboundLeads||0)>0&&<KPICard icon={MessageSquare} label="Msg Outbound" value={agent.mensajesOutboundLeads} color="#6DB87A" sub="a sus leads"/>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:myL.length&&myM.length?"1fr 1fr":"1fr",gap:12,marginBottom:12}}>
        {myL.length>0&&<PiePanel title="Estado llamadas" data={estadoL}/>}
        {myM.length>0&&<PiePanel title="Canal mensajes" data={canalM}/>}
      </div>
      {myL.length>0&&<div style={{marginBottom:12}}><DataTable title="Sus llamadas" rows={myL} cols={["Nombre del Contacto","Duración (in segundos)","Estado de la llamada"]}/></div>}
      {myM.length>0&&<div style={{marginBottom:12}}><DataTable title="Sus conversaciones" rows={myM} cols={["Nombre del Contacto","Mensajes no leídos","Tipo","Canal del último Mensaje"]}/></div>}
      {myC.length>0&&<div style={{marginBottom:12}}><DataTable title="Sus contactos" rows={myC} cols={["Nombre del Contacto","Número de teléfono"]}/></div>}
      {myLe.length>0&&<div style={{marginBottom:12}}><DataTable title="Sus leads abd." rows={myLe} cols={["Primary Contact Name","Pipeline Name","Stage","Source","Created On"]}/></div>}
    </div>
  );
}

// ── Cross-report Comparativa ──────────────────────────────────────────────────
function ComparativaView({reports}) {
  if(reports.length<2) return <div style={{background:"#0A1420",border:`1px solid ${GOLD}22`,borderRadius:16,padding:48,textAlign:"center"}}><BarChart2 size={36} color="#2A3D5A" style={{marginBottom:12}}/><div style={{color:"#5A7090",fontFamily:MONO,fontSize:12}}>Necesitas al menos 2 reportes</div></div>;
  const metrics=["totalLlamadas","contestadas","tasaContestacion","totalMensajes","unread","totalContactos","totalLeads"];
  const labels={totalLlamadas:"Llamadas",contestadas:"Contestadas",tasaContestacion:"% Contactación",totalMensajes:"Mensajes",unread:"Sin Leer",totalContactos:"Contactos",totalLeads:"Leads Abd."};
  const suffix={tasaContestacion:"%"};
  return (
    <div>
      <SectionTitle>📈 Comparativa entre Reportes</SectionTitle>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:MONO,fontSize:11,background:"#0f1923",borderRadius:12,overflow:"hidden"}}>
          <thead><tr style={{background:"#0D1B2A"}}><th style={{padding:"11px 14px",textAlign:"left",color:GOLD,fontSize:10,fontWeight:500}}>MÉTRICA</th>{reports.map(r=><th key={r.id} style={{padding:"11px 14px",textAlign:"right",color:GOLD,fontSize:10,whiteSpace:"nowrap"}}>{r.label}</th>)}</tr></thead>
          <tbody>{metrics.map(m=>(
            <tr key={m} style={{borderBottom:"1px solid #0D1B2A"}}>
              <td style={{padding:"10px 14px",color:"#8A9BB8"}}>{labels[m]}</td>
              {reports.map((r,i)=>{
                const val=r.summary[m]||0;
                const prev=i>0?(reports[i-1].summary[m]||0):null;
                const delta=prev!==null?val-prev:null;
                const bad=["unread","totalLeads","perdidas"].includes(m);
                return <td key={r.id} style={{padding:"10px 14px",textAlign:"right"}}>
                  <span style={{color:"#F0EAD6",fontWeight:600}}>{val}{suffix[m]||""}</span>
                  {delta!==null&&delta!==0&&<span style={{color:(!bad&&delta>0)||(bad&&delta<0)?"#6DB87A":"#E8824A",fontSize:9,marginLeft:5}}>{delta>0?"▲":"▼"}{Math.abs(delta)}</span>}
                </td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── New Report Modal ──────────────────────────────────────────────────────────
function NewReportModal({onSave,onClose}) {
  const [label,setLabel]=useState(""); const [period,setPeriod]=useState(""); const [datasets,setDatasets]=useState({}); const [drag,setDrag]=useState(false);
  const handleFile=useCallback((name,text)=>{ const rows=parseCSV(text); if(!rows.length) return; const type=detectFileType(Object.keys(rows[0])); setDatasets(prev=>({...prev,[type]:rows})); },[]);
  const handle=useCallback(files=>{ Array.from(files).forEach(file=>{ const r=new FileReader(); r.onload=e=>handleFile(file.name,e.target.result); r.readAsText(file,"utf-8"); }); },[handleFile]);
  const loaded=Object.keys(datasets); const canSave=label&&loaded.length>0;
  const save=()=>{ const scores=buildAgentScores(datasets); const summary=buildSummaryFromDatasets(datasets); onSave({id:`report_${Date.now()}`,label,period,createdAt:new Date().toISOString().split("T")[0],summary,charts:{},agentScores:scores,datasets}); onClose(); };
  return (
    <div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#0A1420",border:`1px solid ${GOLD}44`,borderRadius:20,width:"100%",maxWidth:520,padding:26,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}><div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:19,fontWeight:700}}>Nuevo Reporte</div><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#5A7090"}}><X size={18}/></button></div>
        <div style={{marginBottom:12}}><div style={{color:"#8A9BB8",fontFamily:MONO,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Nombre del período *</div><input value={label} onChange={e=>setLabel(e.target.value)} placeholder="ej. Mar 10 – Abr 6, 2026" style={{width:"100%",background:"#0f1923",border:"1px solid #1E3050",borderRadius:8,padding:"9px 12px",color:"#F0EAD6",fontFamily:MONO,fontSize:12,outline:"none"}}/></div>
        <div style={{marginBottom:16}}><div style={{color:"#8A9BB8",fontFamily:MONO,fontSize:10,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Fecha de inicio</div><input type="date" value={period} onChange={e=>setPeriod(e.target.value)} style={{background:"#0f1923",border:"1px solid #1E3050",borderRadius:8,padding:"9px 12px",color:"#F0EAD6",fontFamily:MONO,fontSize:12,outline:"none"}}/></div>
        <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files);}} style={{border:`2px dashed ${drag?GOLD:"#2A3D5A"}`,borderRadius:12,padding:"26px 20px",textAlign:"center",background:drag?`${GOLD}08`:"#070D14",cursor:"pointer",marginBottom:14,transition:"all 0.2s"}} onClick={()=>document.getElementById("modal-csv").click()}>
          <input id="modal-csv" type="file" multiple accept=".csv" style={{display:"none"}} onChange={e=>handle(e.target.files)}/>
          <Upload size={22} color={GOLD} style={{marginBottom:7,opacity:0.8}}/>
          <div style={{color:"#F0EAD6",fontFamily:MONO,fontSize:12}}>Arrastra los CSV o haz clic</div>
          <div style={{color:"#5A7090",fontFamily:MONO,fontSize:10,marginTop:3}}>Llamadas · Mensajes · Contactos · LEADS · Presupuestos</div>
        </div>
        {loaded.length>0&&<div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:14}}>{loaded.map(t=><div key={t} style={{background:`${GOLD}22`,border:`1px solid ${GOLD}44`,borderRadius:20,padding:"3px 10px",color:GOLD,fontFamily:MONO,fontSize:10}}>✓ {t}</div>)}</div>}
        <button onClick={save} disabled={!canSave} style={{width:"100%",background:canSave?GOLD:"#1E3050",color:canSave?NAVY:"#5A7090",border:"none",borderRadius:10,padding:"12px",cursor:canSave?"pointer":"not-allowed",fontFamily:MONO,fontSize:13,fontWeight:600}}>Guardar Reporte</button>
      </div>
    </div>
  );
}

// ── GHL Sync Panel ────────────────────────────────────────────────────────────
function GHLSyncPanel({ onReportReady }) {
  const [status, setStatus] = useState("checking"); // checking|connected|no_server|syncing|error
  const [lastSync, setLastSync] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [totalContacts, setTotalContacts] = useState(0);
  const [totalMensajes, setTotalMensajes] = useState(0);
  const [totalLlamadas, setTotalLlamadas] = useState(0);

  useEffect(() => { checkServer(); }, []);

  async function checkServer() {
    setStatus("checking");
    try {
      const r = await fetch(`${GHL_SERVER}/api/status`, { signal: AbortSignal.timeout(3000) });
      const data = await r.json();
      if (data.ok) { setStatus("connected"); setLastSync(data.lastSync); setTotalContacts(data.totalContacts||0); setTotalMensajes(data.totalMensajes||0); }
      else setStatus("no_server");
    } catch { setStatus("no_server"); }
  }

  async function syncNow() {
    setStatus("syncing"); setSyncError(null);
    try {
      const r = await fetch(`${GHL_SERVER}/api/sync`);
      const data = await r.json();
      if (!r.ok || !data.contacts) throw new Error(data.error || "Respuesta inválida");
      const today = new Date().toISOString().split("T")[0];
      const mensajes  = data.mensajes  || [];
      const llamadas  = data.llamadas  || [];
      const report = buildReportFromGHLContacts(data.contacts, today, mensajes, llamadas);
      setLastSync(new Date().toISOString());
      setTotalContacts(data.total || data.contacts.length);
      setTotalMensajes(mensajes.length);
      setTotalLlamadas(llamadas.length);
      setStatus("connected");
      onReportReady(report);
    } catch(err) { setStatus("error"); setSyncError(err.message.slice(0,80)); }
  }

  const dotColor = status==="connected"?"#6DB87A":status==="syncing"||status==="checking"?GOLD:"#E8824A";
  const noServer = status==="no_server";

  return (
    <div style={{padding:"8px 10px",background:"#070D14",borderRadius:8,margin:"8px 6px 4px",border:`1px solid ${noServer?"#1E3050":"#6DB87A33"}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{color:"#5A7090",fontFamily:MONO,fontSize:9,textTransform:"uppercase",letterSpacing:1}}>GHL Auto-Sync</div>
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:dotColor,boxShadow:!noServer?`0 0 5px ${dotColor}88`:"none"}}/>
          {!noServer&&<button onClick={checkServer} style={{background:"none",border:"none",cursor:"pointer",color:"#3A5070",padding:0,fontFamily:MONO,fontSize:10}} title="Verificar conexión">↻</button>}
        </div>
      </div>
      {noServer ? (
        <div style={{color:"#3A5070",fontFamily:MONO,fontSize:9,lineHeight:1.5}}>
          Servidor no detectado.<br/>Ejecuta <span style={{color:GOLD}}>start-server.bat</span> para activar.
        </div>
      ) : (
        <>
          {totalContacts>0&&<div style={{color:"#8A9BB8",fontFamily:MONO,fontSize:10,marginBottom:1}}>{totalContacts.toLocaleString()} contactos{totalLlamadas>0&&<span style={{color:"#5A7090"}}> · {totalLlamadas.toLocaleString()} 📞</span>}{totalMensajes>0&&<span style={{color:"#5A7090"}}> · {totalMensajes.toLocaleString()} 💬</span>}</div>}
          {lastSync&&<div style={{color:"#3A5070",fontFamily:MONO,fontSize:9,marginBottom:5}}>
            {new Date(lastSync).toLocaleDateString("es-MX",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
          </div>}
          {syncError&&<div style={{color:"#E8824A",fontFamily:MONO,fontSize:9,marginBottom:5,lineHeight:1.3}}>{syncError}</div>}
          <button
            onClick={status==="syncing"?undefined:syncNow}
            disabled={status==="syncing"||status==="checking"}
            style={{width:"100%",background:status==="syncing"?"#1E3050":GOLD,color:status==="syncing"?"#5A7090":NAVY,border:"none",borderRadius:6,padding:"6px 8px",cursor:status==="syncing"||status==="checking"?"not-allowed":"pointer",fontFamily:MONO,fontSize:9,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4,transition:"all 0.15s"}}
          >
            {status==="syncing"?"⏳ Descargando…":"🔄 Sincronizar GHL"}
          </button>
        </>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function ReportSidebar({reports,activeId,onSelect,onDelete,onNew,onGHLSync}) {
  return (
    <div style={{width:210,flexShrink:0,background:"#0A1420",borderRight:"1px solid #1E3050",display:"flex",flexDirection:"column",height:"100vh",position:"sticky",top:0,overflowY:"auto"}}>
      <div style={{padding:"16px 14px",borderBottom:"1px solid #1E3050"}}><div style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:14,fontWeight:700}}>TDL</div><div style={{color:"#5A7090",fontFamily:MONO,fontSize:9}}>REPORTES GUARDADOS</div></div>
      <div style={{flex:1,overflowY:"auto",padding:"8px 6px"}}>
        {reports.map(r=>(
          <div key={r.id} onClick={()=>onSelect(r.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",borderRadius:8,cursor:"pointer",background:r.id===activeId?`${GOLD}1A`:"transparent",border:r.id===activeId?`1px solid ${GOLD}33`:"1px solid transparent",marginBottom:3,transition:"all 0.15s"}} onMouseEnter={e=>{if(r.id!==activeId)e.currentTarget.style.background="#0f1923";}} onMouseLeave={e=>{if(r.id!==activeId)e.currentTarget.style.background="transparent";}}>
            <div><div style={{color:r.id===activeId?GOLD:"#A8C0D8",fontFamily:MONO,fontSize:11,fontWeight:600,lineHeight:1.3}}>{r.label}</div><div style={{color:"#3A5070",fontFamily:MONO,fontSize:9,marginTop:1}}>{r.createdAt}</div></div>
            {r.id!=="report_seed_feb7_mar9"&&<button onClick={e=>{e.stopPropagation();onDelete(r.id);}} style={{background:"none",border:"none",cursor:"pointer",color:"#3A5070",padding:2}} onMouseEnter={e=>e.currentTarget.style.color="#E8824A"} onMouseLeave={e=>e.currentTarget.style.color="#3A5070"}><Trash2 size={11}/></button>}
          </div>
        ))}
      </div>
      <div style={{padding:"10px 6px",borderTop:"1px solid #1E3050"}}>
        {onGHLSync&&<GHLSyncPanel onReportReady={onGHLSync}/>}
        <button onClick={onNew} style={{width:"100%",background:`${GOLD}22`,border:`1px solid ${GOLD}44`,color:GOLD,borderRadius:10,padding:"9px",cursor:"pointer",fontFamily:MONO,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginTop:6}} onMouseEnter={e=>e.currentTarget.style.background=`${GOLD}33`} onMouseLeave={e=>e.currentTarget.style.background=`${GOLD}22`}>
          <Plus size={12}/> Nuevo Reporte
        </button>
      </div>
    </div>
  );
}

// ── Report Dashboard ──────────────────────────────────────────────────────────
function ReportDashboard({report,prevReport}) {
  const [activeTab,setActiveTab]=useState("ranking");
  const [selectedAgent,setSelectedAgent]=useState(null);
  const [dateFilter,setDateFilter]=useState("all");
  const {summary,charts,agentScores,datasets}=report;
  const prev=prevReport?.summary;

  // ── Filtered datasets ──────────────────────────────────────────────────────
  const filteredDatasets = useMemo(()=>{
    if (dateFilter==="all"||!datasets) return datasets||{llamadas:[],mensajes:[],contactos:[],leads:[],presupuestos:[]};
    const now=new Date(); let start,end;
    if (dateFilter==="week") { start=getWeekStart(now); end=new Date(start); end.setDate(end.getDate()+6); }
    else if (dateFilter==="month") { start=new Date(now.getFullYear(),now.getMonth(),1); end=new Date(now.getFullYear(),now.getMonth()+1,0); }
    else if (dateFilter==="prev_month") { start=new Date(now.getFullYear(),now.getMonth()-1,1); end=new Date(now.getFullYear(),now.getMonth(),0); }
    else if (dateFilter?.type==="month_specific") { const [yr,mo]=dateFilter.month.split("-").map(Number); start=new Date(yr,mo-1,1); end=new Date(yr,mo,0); }
    else return datasets;
    const ok=str=>inDateRange(str,start,end);
    return {
      llamadas:(datasets.llamadas||[]).filter(r=>ok(r["Creada Activado"]||r["Created On"]||"")),
      mensajes:(datasets.mensajes||[]).filter(r=>ok(r["Creada Activado"]||"")),
      contactos:(datasets.contactos||[]).filter(r=>ok(r["Creada Activado"]||r["Created On"]||"")),
      leads:(datasets.leads||[]).filter(r=>ok(r["Created On"]||"")),
      presupuestos:(datasets.presupuestos||[]).filter(r=>ok(r["Created On"]||r["Updated On"]||"")),
    };
  },[datasets,dateFilter]);

  const filteredAgentScores = useMemo(()=>{
    if (dateFilter==="all") return agentScores||[];
    const hasRaw=(filteredDatasets.llamadas?.length||0)+(filteredDatasets.mensajes?.length||0)>0;
    return hasRaw ? buildAgentScores(filteredDatasets) : agentScores||[];
  },[filteredDatasets,dateFilter,agentScores]);

  const filteredSummary = useMemo(()=>{
    if (dateFilter==="all") return summary;
    const hasRaw=(filteredDatasets.llamadas?.length||0)+(filteredDatasets.mensajes?.length||0)>0;
    return hasRaw ? buildSummaryFromDatasets(filteredDatasets) : summary;
  },[filteredDatasets,dateFilter,summary]);

  const delta=key=>prev?(filteredSummary[key]||0)-(prev[key]||0):undefined;

  const TABS=[
    {id:"ranking",label:"🏆 Ranking"},
    {id:"buscar",label:"🔍 Asesor"},
    {id:"pipeline",label:"🏗️ Pipeline"},
    {id:"asesores",label:"👤 Actividad"},
    {id:"semanas",label:"📅 Semanas"},
    {id:"llamadas",label:"📞 Llamadas"},
    {id:"mensajes",label:"💬 Mensajes"},
    {id:"contactos",label:"👤 Contactos"},
    {id:"leads",label:"🚨 LEADS"},
  ];

  const {llamadas=[],mensajes=[],contactos=[],leads=[],presupuestos=[]}=filteredDatasets||{};
  const hasRaw=llamadas.length>0||mensajes.length>0;
  const llamadasPorAgente=hasRaw?Object.entries(llamadas.reduce((acc,r)=>{const a=r["Llamar realizada Vía"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,8):charts.llamadasPorAgente||[];
  const estadoLlamadas=hasRaw?Object.entries(llamadas.reduce((acc,r)=>{const s=r["Estado de la llamada"]||"N/A";acc[s]=(acc[s]||0)+1;return acc;},{})).map(([name,value])=>({name,value})):charts.estadoLlamadas||[];
  const mensajesPorAgente=hasRaw?Object.entries(mensajes.reduce((acc,r)=>{const a=r["Asignado a"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,8):charts.conversacionesPorResponsable||[];
  const canalDist=hasRaw?Object.entries(mensajes.reduce((acc,r)=>{const c=r["Canal del último Mensaje"]||"N/A";acc[c]=(acc[c]||0)+1;return acc;},{})).map(([name,value])=>({name,value})):[];
  const contactosPorAgente=hasRaw?Object.entries(contactos.reduce((acc,r)=>{const a=r["Usuario asignado"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value):charts.contactosAsignados||[];
  const leadsPorStage=hasRaw?Object.entries(leads.reduce((acc,r)=>{const s=r["Stage"]||"N/A";acc[s]=(acc[s]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value):[];
  const leadsPorAgente=hasRaw?Object.entries(leads.reduce((acc,r)=>{const a=r["Assigned User"]||"N/A";acc[a]=(acc[a]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value):[];
  const interesDist=hasRaw?Object.entries(contactos.reduce((acc,r)=>{const n=r["🌡️ Nivel de interés del prospecto"]||"";if(n)acc[n]=(acc[n]||0)+1;return acc;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value):charts.interesDist||[];
  const selAgent=filteredAgentScores?.find(a=>a.name===selectedAgent);
  const selRank=(filteredAgentScores?.findIndex(a=>a.name===selectedAgent)||0)+1;

  const noKpiTabs = ["semanas","pipeline","buscar"];

  return (
    <div style={{flex:1,overflowY:"auto"}}>
      {/* Header */}
      <div style={{background:"linear-gradient(90deg,#0A1420,#0f1923)",borderBottom:`1px solid ${GOLD}33`,padding:"0 24px",height:54,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{color:"#F0EAD6",fontFamily:SERIF,fontSize:15,fontWeight:600}}>Taller del Ladrillo</span>
          <span style={{color:"#5A7090",fontFamily:MONO,fontSize:10}}>{report.label}</span>
          {dateFilter!=="all"&&<span style={{background:`${GOLD}22`,color:GOLD,borderRadius:6,padding:"2px 8px",fontFamily:MONO,fontSize:9,fontWeight:700}}>FILTRADO</span>}
        </div>
        {selectedAgent&&<button onClick={()=>setSelectedAgent(null)} style={{background:`${GOLD}1A`,border:`1px solid ${GOLD}44`,color:GOLD,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontFamily:MONO,fontSize:10,display:"flex",alignItems:"center",gap:5}}><ArrowLeft size={11}/> Ranking</button>}
      </div>

      {/* Tab bar */}
      {!selectedAgent&&<div style={{background:"#0A1420",borderBottom:"1px solid #1E3050",padding:"0 24px",display:"flex",gap:0,overflowX:"auto"}}>
        {TABS.map(tab=><button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{background:"none",border:"none",borderBottom:activeTab===tab.id?`2px solid ${GOLD}`:"2px solid transparent",color:activeTab===tab.id?GOLD:"#5A7090",padding:"12px 13px",cursor:"pointer",fontFamily:MONO,fontSize:10,whiteSpace:"nowrap",transition:"all 0.15s"}}>{tab.label}</button>)}
      </div>}

      {/* Global Date Filter */}
      {!selectedAgent&&<DateFilterBar filter={dateFilter} setFilter={f=>{setDateFilter(f);}} datasets={datasets||{}}/>}

      <div style={{padding:"20px 22px",maxWidth:1200,margin:"0 auto"}}>
        {selectedAgent&&selAgent&&<AgentDetail agent={selAgent} rank={selRank} datasets={filteredDatasets||{}} onBack={()=>setSelectedAgent(null)}/>}
        {!selectedAgent&&<>
          {/* Global KPI cards */}
          {!noKpiTabs.includes(activeTab)&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:18}}>
            <KPICard icon={Phone} label="Llamadas" value={filteredSummary.totalLlamadas} delta={delta("totalLlamadas")}/>
            <KPICard icon={TrendingUp} label="Contestadas" value={filteredSummary.contestadas} color="#6DB87A" delta={delta("contestadas")}/>
            <KPICard icon={MessageSquare} label="Mensajes" value={filteredSummary.totalMensajes} color="#4A7FA5" delta={delta("totalMensajes")}/>
            <KPICard icon={AlertTriangle} label="Sin Leer" value={filteredSummary.unread} color="#E8824A" delta={delta("unread")}/>
            <KPICard icon={Users} label="Contactos" value={filteredSummary.totalContactos} delta={delta("totalContactos")}/>
            <KPICard icon={AlertTriangle} label="Leads Abd." value={filteredSummary.totalLeads} color="#E8824A" delta={delta("totalLeads")}/>
            {filteredSummary.clientesGanados>0&&<KPICard icon={TrendingUp} label="Ganados" value={filteredSummary.clientesGanados} color="#6DB87A"/>}
            {filteredSummary.presTotal>0&&<KPICard icon={DollarSign} label="Presupuestado" value={`$${(filteredSummary.presTotal/1000000).toFixed(1)}M`}/>}
          </div>}
          {activeTab==="ranking"&&<AgentLeaderboard agents={filteredAgentScores} onSelect={setSelectedAgent}/>}
          {activeTab==="buscar"&&<AsesorSearch agents={filteredAgentScores} leads={leads} llamadas={llamadas} mensajes={mensajes}/>}
          {activeTab==="pipeline"&&<PipelineKanban leads={leads} llamadas={llamadas} mensajes={mensajes}/>}
          {activeTab==="asesores"&&<LeadsPanel agents={filteredAgentScores}/>}
          {activeTab==="semanas"&&<WeeklyView report={{...report,datasets:filteredDatasets}}/>}
          {activeTab==="llamadas"&&<><SectionTitle>📞 Llamadas Salientes</SectionTitle><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}><ChartPanel title="Por Agente" data={llamadasPorAgente} dataKey="value" nameKey="name" color={GOLD}/><PiePanel title="Estado" data={estadoLlamadas}/></div>{llamadas.length>0&&<DataTable title="Detalle" rows={llamadas} cols={["Nombre del Contacto","Llamar realizada Vía","Duración (in segundos)","Estado de la llamada"]}/>}</>}
          {activeTab==="mensajes"&&<><SectionTitle>💬 Mensajes</SectionTitle><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}><ChartPanel title="Por Agente" data={mensajesPorAgente} dataKey="value" nameKey="name" color="#4A7FA5"/>{canalDist.length>0&&<PiePanel title="Canal" data={canalDist}/>}</div>{mensajes.length>0&&<DataTable title="Detalle" rows={mensajes} cols={["Nombre del Contacto","Mensajes no leídos","Asignado a","Tipo","Canal del último Mensaje"]}/>}</>}
          {activeTab==="contactos"&&<><SectionTitle>👤 Contactos</SectionTitle><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}><ChartPanel title="Por Agente" data={contactosPorAgente} dataKey="value" nameKey="name" color={GOLD}/>{interesDist.length>0&&<PiePanel title="🌡️ Nivel de Interés" data={interesDist}/>}</div>{contactos.length>0&&<DataTable title="Detalle" rows={contactos} cols={["Nombre del Contacto","Usuario asignado","Opportunities","🌡️ Nivel de interés del prospecto","💸 Presupuesto estimado","🏦 ¿Cuenta con financiamiento o crédito?","Días Asignado"]}/>}</>}
          {activeTab==="leads"&&<><SectionTitle>🚨 LEADS</SectionTitle><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>{leadsPorStage.length>0&&<ChartPanel title="Por Etapa" data={leadsPorStage} dataKey="value" nameKey="name" color="#E8824A"/>}{leadsPorAgente.length>0&&<ChartPanel title="Por Agente" data={leadsPorAgente} dataKey="value" nameKey="name" color="#4A7FA5"/>}</div>{leads.length>0&&<DataTable title="Detalle" rows={leads} cols={["Primary Contact Name","Assigned User","Pipeline Name","Stage","🌡️ Nivel de interés del prospecto","💸 Presupuesto estimado","🏦 ¿Cuenta con financiamiento o crédito?","Días Asignado","Source"]}/>}</>}
          {activeTab==="presupuestos"&&<><SectionTitle>💰 Presupuestos</SectionTitle><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>{interesDist.length>0&&<PiePanel title="Nivel de Interés" data={interesDist}/>}{charts.contactosPorMedio&&<PiePanel title="Por Medio" data={charts.contactosPorMedio}/>}</div>{presupuestos.length>0&&<DataTable title="Detalle" rows={presupuestos} cols={["identificador_presupuesto","Presupuesto","Nivel_interes","Owner","Created On"]}/>}</>}
        </>}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function TDLApp() {
  const [reports,setReports]=useState(()=>{ const saved=loadReports(); return saved.some(r=>r.id===SEED_REPORT.id)?saved:[SEED_REPORT,...saved]; });
  const [activeReportId,setActiveReportId]=useState(SEED_REPORT.id);
  const [showModal,setShowModal]=useState(false);
  const [showComparativa,setShowComparativa]=useState(false);

  useEffect(()=>{ saveReports(reports.filter(r=>r.id!==SEED_REPORT.id)); },[reports]);

  const activeReport=reports.find(r=>r.id===activeReportId)||reports[0];
  const activeIndex=reports.findIndex(r=>r.id===activeReportId);
  const prevReport=activeIndex>0?reports[activeIndex-1]:null;

  const saveReport=r=>{ setReports(prev=>[...prev,r]); setActiveReportId(r.id); };
  const deleteReport=id=>{ setReports(prev=>prev.filter(r=>r.id!==id)); if(activeReportId===id)setActiveReportId(reports[0]?.id); };

  return (
    <div style={{display:"flex",minHeight:"100vh",background:"#070D14"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:5px;height:5px;background:#070D14;}
        ::-webkit-scrollbar-thumb{background:#1E3050;border-radius:3px;}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.4);}
      `}</style>
      <ReportSidebar reports={reports} activeId={activeReportId} onSelect={id=>{setActiveReportId(id);setShowComparativa(false);}} onDelete={deleteReport} onNew={()=>setShowModal(true)} onGHLSync={r=>{saveReport(r);setShowComparativa(false);}}/>
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
        {showComparativa
          ?<div style={{flex:1,overflowY:"auto",padding:24}}><button onClick={()=>setShowComparativa(false)} style={{background:`${GOLD}1A`,border:`1px solid ${GOLD}44`,color:GOLD,borderRadius:8,padding:"6px 14px",cursor:"pointer",fontFamily:MONO,fontSize:11,display:"flex",alignItems:"center",gap:5,marginBottom:20}}><ArrowLeft size={12}/> Volver</button><ComparativaView reports={reports}/></div>
          :activeReport&&<ReportDashboard report={activeReport} prevReport={prevReport}/>
        }
      </div>
      {reports.length>=2&&!showComparativa&&<button onClick={()=>setShowComparativa(true)} style={{position:"fixed",bottom:24,right:24,background:GOLD,color:NAVY,border:"none",borderRadius:50,padding:"12px 18px",cursor:"pointer",fontFamily:MONO,fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:7,boxShadow:`0 4px 20px ${GOLD}55`,zIndex:90}}><BarChart2 size={14}/> Comparar reportes</button>}
      {showModal&&<NewReportModal onSave={saveReport} onClose={()=>setShowModal(false)}/>}
    </div>
  );
}
