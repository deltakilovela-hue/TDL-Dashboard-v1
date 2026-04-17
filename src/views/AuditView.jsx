import { useState, useEffect } from "react";

const TABS = [
  { id: "location",      label: "📍 Location",         icon: "📍" },
  { id: "users",         label: "👥 Usuarios",          icon: "👥" },
  { id: "customFields",  label: "🏷️ Custom Fields",     icon: "🏷️" },
  { id: "contacts",      label: "👤 Contactos",         icon: "👤" },
  { id: "opportunities", label: "💼 Oportunidades",     icon: "💼" },
  { id: "pipelines",     label: "🔁 Pipelines",         icon: "🔁" },
  { id: "conversations", label: "💬 Conversaciones",    icon: "💬" },
  { id: "messages",      label: "📨 Mensajes",          icon: "📨" },
  { id: "calendars",     label: "📅 Calendarios/Citas", icon: "📅" },
  { id: "tags",          label: "🔖 Tags",              icon: "🔖" },
];

/* ── JSON Viewer coloreado ─────────────────────────────────────────────────── */
function JsonValue({ val, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  if (val === null || val === undefined) return <span className="text-zinc-500">null</span>;
  if (typeof val === "boolean") return <span className="text-yellow-400">{String(val)}</span>;
  if (typeof val === "number")  return <span className="text-blue-400">{val}</span>;
  if (typeof val === "string")  return <span className="text-green-400">"{val}"</span>;

  if (Array.isArray(val)) {
    if (val.length === 0) return <span className="text-zinc-400">[]</span>;
    return (
      <span>
        <button onClick={() => setOpen(o => !o)} className="text-zinc-400 hover:text-white">
          {open ? "▾" : "▸"} [{val.length}]
        </button>
        {open && (
          <div className="ml-4 border-l border-zinc-700 pl-3 mt-1 space-y-1">
            {val.map((item, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-zinc-500 text-xs mt-0.5">{i}</span>
                <JsonValue val={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof val === "object") {
    const keys = Object.keys(val);
    if (keys.length === 0) return <span className="text-zinc-400">{"{}"}</span>;
    return (
      <span>
        <button onClick={() => setOpen(o => !o)} className="text-zinc-400 hover:text-white">
          {open ? "▾" : "▸"} {"{"}…{"}"} ({keys.length})
        </button>
        {open && (
          <div className="ml-4 border-l border-zinc-700 pl-3 mt-1 space-y-1">
            {keys.map(k => (
              <div key={k} className="flex gap-2 flex-wrap">
                <span className="text-purple-400 text-sm shrink-0">{k}:</span>
                <JsonValue val={val[k]} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span className="text-zinc-300">{String(val)}</span>;
}

/* ── Card genérica ─────────────────────────────────────────────────────────── */
function Card({ title, children, badge }) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold text-zinc-100">{title}</h3>
        {badge != null && (
          <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── Tabla de campos ────────────────────────────────────────────────────────── */
function FieldsTable({ fields = [] }) {
  if (!fields.length) return <p className="text-zinc-500 text-sm">Sin campos</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {fields.map(f => (
        <span key={f} className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded font-mono">{f}</span>
      ))}
    </div>
  );
}

/* ── Pill de valor ─────────────────────────────────────────────────────────── */
function Pill({ label, value, color = "zinc" }) {
  const colors = {
    zinc:   "bg-zinc-700 text-zinc-200",
    blue:   "bg-blue-900/50 text-blue-300",
    green:  "bg-green-900/50 text-green-300",
    purple: "bg-purple-900/50 text-purple-300",
    yellow: "bg-yellow-900/50 text-yellow-300",
    red:    "bg-red-900/50 text-red-300",
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${colors[color]}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="font-semibold">{value ?? "—"}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  SECCIONES POR TAB                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

function SectionLocation({ data }) {
  const s = data?.summary || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Pill label="Nombre" value={s.name} color="blue" />
        <Pill label="ID" value={s.id} color="zinc" />
        <Pill label="País" value={s.country} color="green" />
        <Pill label="Timezone" value={s.timezone} color="purple" />
        <Pill label="Email" value={s.email} color="zinc" />
        <Pill label="Teléfono" value={s.phone} color="zinc" />
        <Pill label="Dirección" value={s.address} color="zinc" />
      </div>
      <Card title="Objeto raw completo">
        <div className="text-sm font-mono">
          <JsonValue val={data?.raw} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionUsers({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Pill label="Total usuarios" value={data?.total} color="blue" />
      </div>
      <Card title="Campos disponibles en un usuario" badge={`${(data?.fields || []).length} campos`}>
        <FieldsTable fields={data?.fields || []} />
      </Card>
      <Card title={`Lista de usuarios (${data?.total})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-4">Nombre</th>
                <th className="text-left py-2 pr-4">Email</th>
                <th className="text-left py-2 pr-4">Teléfono</th>
                <th className="text-left py-2 pr-4">Role</th>
                <th className="text-left py-2 pr-4">Type</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sample || []).map(u => (
                <tr key={u.id} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                  <td className="py-2 pr-4 text-zinc-100 font-medium">{u.name || "—"}</td>
                  <td className="py-2 pr-4 text-zinc-300">{u.email || "—"}</td>
                  <td className="py-2 pr-4 text-zinc-300">{u.phone || "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{u.role || "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{u.type || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw del primer usuario">
        <div className="text-sm font-mono">
          <JsonValue val={data?.firstRaw} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionCustomFields({ data }) {
  return (
    <div className="space-y-4">
      <Pill label="Total campos personalizados" value={data?.total} color="purple" />
      <Card title={`Todos los custom fields (${data?.total})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-4">Nombre</th>
                <th className="text-left py-2 pr-4">fieldKey</th>
                <th className="text-left py-2 pr-4">dataType</th>
                <th className="text-left py-2 pr-4">model</th>
                <th className="text-left py-2 pr-4">ID</th>
              </tr>
            </thead>
            <tbody>
              {(data?.fields || []).map(f => (
                <tr key={f.id} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                  <td className="py-2 pr-4 text-zinc-100 font-medium">{f.name}</td>
                  <td className="py-2 pr-4 text-zinc-300 font-mono text-xs">{f.fieldKey || "—"}</td>
                  <td className="py-2 pr-4 text-blue-400">{f.dataType || "—"}</td>
                  <td className="py-2 pr-4 text-zinc-400">{f.model || "—"}</td>
                  <td className="py-2 pr-4 text-zinc-500 font-mono text-xs">{f.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw del primer custom field">
        <div className="text-sm font-mono">
          <JsonValue val={data?.firstRaw} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionContacts({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Pill label="Total en GHL" value={data?.totalInGHL} color="blue" />
        <Pill label="Muestra (página 1)" value={data?.page1Count} color="zinc" />
        <Pill label="Campos en objeto" value={(data?.fields || []).length} color="purple" />
        <Pill label="Custom fields / contacto" value={data?.fieldsSample?._customFieldCount} color="yellow" />
      </div>
      <Card title="Campos disponibles en un contacto" badge={`${(data?.fields || []).length} campos`}>
        <FieldsTable fields={data?.fields || []} />
      </Card>
      <Card title="Custom fields en el primer contacto" badge={`${(data?.customFieldsOnContact || []).length}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-4">fieldKey</th>
                <th className="text-left py-2 pr-4">value</th>
                <th className="text-left py-2 pr-4">id</th>
              </tr>
            </thead>
            <tbody>
              {(data?.customFieldsOnContact || []).map((f, i) => (
                <tr key={i} className="border-b border-zinc-800">
                  <td className="py-1.5 pr-4 font-mono text-xs text-purple-300">{f.fieldKey || "—"}</td>
                  <td className="py-1.5 pr-4 text-zinc-200">{String(f.value).substring(0, 80) || "—"}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs text-zinc-500">{f.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Muestra de 5 contactos">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-3">Nombre</th>
                <th className="text-left py-2 pr-3">Teléfono</th>
                <th className="text-left py-2 pr-3">Fuente</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Asignado a</th>
                <th className="text-left py-2 pr-3">Tags</th>
                <th className="text-left py-2 pr-3">Creado</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sample || []).map(c => (
                <tr key={c.id} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                  <td className="py-2 pr-3 text-zinc-100 font-medium">{c.name || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-300">{c.phone || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-400">{c.source || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-400">{c.status || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-400">{c.assignedTo || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs">{(c.tags || []).join(", ") || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs">{c.dateAdded ? new Date(c.dateAdded).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw del primer contacto">
        <div className="text-sm font-mono">
          <JsonValue val={data?.fieldsSample} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionOpps({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Pill label="Total en GHL" value={data?.totalInGHL} color="blue" />
        <Pill label="Campos en objeto" value={(data?.fields || []).length} color="purple" />
      </div>
      <Card title="Campos disponibles en una oportunidad">
        <FieldsTable fields={data?.fields || []} />
      </Card>
      <Card title="Pipelines detectados en la muestra" badge={(data?.pipelines || []).length}>
        {(data?.pipelines || []).map(p => (
          <div key={p.id} className="mb-3">
            <div className="font-medium text-zinc-200 mb-1">{p.name} <span className="text-xs text-zinc-500 font-mono">({p.id})</span></div>
            <div className="flex flex-wrap gap-1.5 ml-3">
              {(p.stages || []).map(s => (
                <span key={s.id} className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded">
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Card>
      <Card title="Muestra de 5 oportunidades">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-3">Nombre</th>
                <th className="text-left py-2 pr-3">Pipeline</th>
                <th className="text-left py-2 pr-3">Etapa</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Valor $</th>
                <th className="text-left py-2 pr-3">Asignado</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sample || []).map(o => (
                <tr key={o.id} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                  <td className="py-2 pr-3 text-zinc-100">{o.name || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-300">{o.pipeline || "—"}</td>
                  <td className="py-2 pr-3 text-blue-400">{o.stage || "—"}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      o.status === "open" ? "bg-green-900/50 text-green-300" :
                      o.status === "won"  ? "bg-blue-900/50 text-blue-300" :
                      "bg-zinc-700 text-zinc-300"
                    }`}>{o.status}</span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-300">{o.monetaryValue != null ? `$${o.monetaryValue.toLocaleString()}` : "—"}</td>
                  <td className="py-2 pr-3 text-zinc-400 text-xs">{o.assignedTo || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw de la primera oportunidad">
        <div className="text-sm font-mono">
          <JsonValue val={data?.fieldsSample} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionPipelines({ data }) {
  if (!data?.total) {
    return (
      <Card title="Pipelines">
        <p className="text-zinc-400 text-sm">El endpoint de pipelines no devolvió datos. Los pipelines se detectaron a través de las oportunidades — ve a la pestaña 💼 Oportunidades.</p>
        <div className="mt-3 text-sm font-mono">
          <JsonValue val={data?.raw} depth={1} />
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Pill label="Total pipelines" value={data?.total} color="blue" />
      {(data?.list || []).map(p => (
        <Card key={p.id} title={p.name} badge={`${p.stages?.length || 0} etapas`}>
          <p className="text-xs text-zinc-500 font-mono mb-3">{p.id}</p>
          <div className="space-y-1">
            {(p.stages || []).map((s, i) => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="text-xs text-zinc-500 w-4">{i + 1}</span>
                <span className="text-zinc-200">{s.name}</span>
                <span className="text-xs text-zinc-600 font-mono">{s.id}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <Card title="Raw del endpoint /opportunities/pipelines">
        <div className="text-sm font-mono">
          <JsonValue val={data?.raw} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionConversations({ data }) {
  const typeColors = {
    "TYPE_PHONE": "bg-green-900/50 text-green-300",
    "TYPE_SMS":   "bg-blue-900/50 text-blue-300",
    "TYPE_EMAIL": "bg-purple-900/50 text-purple-300",
    "TYPE_WHATSAPP": "bg-emerald-900/50 text-emerald-300",
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Pill label="Total en GHL" value={data?.totalInGHL} color="blue" />
        <Pill label="Muestra" value={data?.page1Count} color="zinc" />
        <Pill label="Campos en objeto" value={(data?.fields || []).length} color="purple" />
      </div>
      <Card title="Distribución de tipos (type)">
        <div className="flex flex-wrap gap-2">
          {Object.entries(data?.typeDistribution || {}).map(([t, count]) => (
            <div key={t} className={`rounded px-3 py-1 text-sm ${typeColors[t] || "bg-zinc-700 text-zinc-300"}`}>
              <span className="font-mono font-medium">{t}</span>
              <span className="ml-2 opacity-70">×{count}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Campos disponibles en una conversación">
        <FieldsTable fields={data?.fields || []} />
      </Card>
      <Card title="Muestra de 10 conversaciones">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-3">Contacto</th>
                <th className="text-left py-2 pr-3">type</th>
                <th className="text-left py-2 pr-3">lastMsgType</th>
                <th className="text-left py-2 pr-3">direction</th>
                <th className="text-left py-2 pr-3">Última act.</th>
                <th className="text-left py-2 pr-3">Unread</th>
                <th className="text-left py-2 pr-3">channel</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sample || []).map(c => (
                <tr key={c.id} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                  <td className="py-2 pr-3 text-zinc-100 text-xs">{c.contactName || c.contactId?.substring(0, 8) || "—"}</td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${typeColors[c.type] || "bg-zinc-700 text-zinc-400"}`}>
                      {c.type || "—"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-zinc-400 text-xs font-mono">{c.lastMessageType || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-400 text-xs">{c.lastMessageDirection || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs">{c.lastMessageDateISO ? new Date(c.lastMessageDateISO).toLocaleDateString() : "—"}</td>
                  <td className="py-2 pr-3 text-center">
                    {c.unreadCount > 0
                      ? <span className="text-xs bg-red-500/20 text-red-400 px-1.5 rounded">{c.unreadCount}</span>
                      : <span className="text-zinc-600">0</span>}
                  </td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs font-mono">{c.channel || c.lastMessageChannel || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw de la primera conversación">
        <div className="text-sm font-mono">
          <JsonValue val={data?.fieldsSample} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionMessages({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Pill label="Mensajes en muestra" value={data?.total} color="blue" />
        <Pill label="Campos en objeto" value={(data?.fields || []).length} color="purple" />
        <Pill label="conversationId" value={data?.fromConversationId?.substring(0, 12) + "…"} color="zinc" />
      </div>
      <Card title="Campos disponibles en un mensaje">
        <FieldsTable fields={data?.fields || []} />
      </Card>
      <Card title="Muestra de 10 mensajes de la primera conversación">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-700">
                <th className="text-left py-2 pr-3">type</th>
                <th className="text-left py-2 pr-3">messageType</th>
                <th className="text-left py-2 pr-3">direction</th>
                <th className="text-left py-2 pr-3">status</th>
                <th className="text-left py-2 pr-3">Fecha</th>
                <th className="text-left py-2 pr-3">body</th>
                <th className="text-left py-2 pr-3">meta</th>
              </tr>
            </thead>
            <tbody>
              {(data?.sample || []).map((m, i) => (
                <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/30">
                  <td className="py-2 pr-3 font-mono text-xs text-yellow-400">{m.type ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-blue-400">{m.messageType ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs">
                    <span className={m.direction === "outbound" || m.messageDirection === "outbound" || m.direction === "1" || m.messageDirection === "1"
                      ? "text-green-400" : "text-zinc-400"}>
                      {m.direction || m.messageDirection || "—"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-zinc-400">{m.status || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs">{m.dateAdded ? new Date(m.dateAdded).toLocaleDateString() : "—"}</td>
                  <td className="py-2 pr-3 text-zinc-300 text-xs max-w-[200px] truncate">{m.body || "—"}</td>
                  <td className="py-2 pr-3 text-zinc-500 text-xs">
                    {m.meta ? JSON.stringify(m.meta).substring(0, 40) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Raw del primer mensaje">
        <div className="text-sm font-mono">
          <JsonValue val={data?.fieldsSample} depth={1} />
        </div>
      </Card>
    </div>
  );
}

function SectionCalendars({ data }) {
  return (
    <div className="space-y-4">
      <Pill label="Calendarios encontrados" value={data?.total} color="blue" />
      {data?.total === 0 && (
        <Card title="Calendarios">
          <p className="text-zinc-400 text-sm">No se encontraron calendarios, o el endpoint no está disponible en tu plan GHL.</p>
          <div className="mt-3 text-sm font-mono">
            <JsonValue val={data?.raw} depth={1} />
          </div>
        </Card>
      )}
      {(data?.list || []).map(cal => (
        <Card key={cal.id} title={cal.name || "(Sin nombre)"}>
          <p className="text-sm text-zinc-400">{cal.description}</p>
          <p className="text-xs text-zinc-600 font-mono mt-1">{cal.id}</p>
        </Card>
      ))}
      <Card title="Citas (últimos 30 días)" badge={data?.appointments?.total}>
        {data?.appointments?.total === 0
          ? <p className="text-zinc-500 text-sm">Sin citas en los últimos 30 días</p>
          : <div className="text-sm font-mono"><JsonValue val={data?.appointments?.raw} depth={1} /></div>
        }
      </Card>
    </div>
  );
}

function SectionTags({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Pill label="Tags en endpoint" value={(data?.fromEndpoint || []).length || "N/A"} color="blue" />
        <Pill label="Tags en contactos (muestra)" value={data?.totalFromContacts} color="green" />
      </div>
      {(data?.fromEndpoint || []).length > 0 && (
        <Card title="Tags desde endpoint /locations/{id}/tags">
          <div className="flex flex-wrap gap-1.5">
            {(data?.fromEndpoint || []).map(t => (
              <span key={t.id} className="text-xs bg-zinc-700 text-zinc-200 px-2 py-1 rounded">{t.name}</span>
            ))}
          </div>
        </Card>
      )}
      <Card title="Tags encontrados en la muestra de contactos">
        <div className="flex flex-wrap gap-1.5">
          {(data?.fromContacts || []).length === 0
            ? <p className="text-zinc-500 text-sm">Sin tags en la muestra de contactos</p>
            : (data?.fromContacts || []).map(t => (
                <span key={t} className="text-xs bg-blue-900/40 text-blue-300 px-2 py-1 rounded">{t}</span>
              ))
          }
        </div>
      </Card>
      <Card title="Raw endpoint tags">
        <div className="text-sm font-mono">
          <JsonValue val={data?.rawEndpoint} depth={1} />
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMPONENTE PRINCIPAL                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function AuditView() {
  const [activeTab, setActiveTab] = useState("location");
  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  async function fetchAudit() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/audit");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "Error en /api/audit");
      setAuditData(json);
      setFetchedAt(new Date(json.fetchedAt));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAudit(); }, []);

  const sectionMap = {
    location:      <SectionLocation      data={auditData?.location}      />,
    users:         <SectionUsers         data={auditData?.users}         />,
    customFields:  <SectionCustomFields  data={auditData?.customFields}  />,
    contacts:      <SectionContacts      data={auditData?.contacts}      />,
    opportunities: <SectionOpps         data={auditData?.opportunities}  />,
    pipelines:     <SectionPipelines     data={auditData?.pipelines}     />,
    conversations: <SectionConversations data={auditData?.conversations}  />,
    messages:      <SectionMessages      data={auditData?.messages}      />,
    calendars:     <SectionCalendars     data={auditData?.calendars}     />,
    tags:          <SectionTags          data={auditData?.tags}          />,
  };

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-xl font-bold">🔍 Auditoría de Datos GHL</h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              Todos los datos disponibles en GoHighLevel — organizados por segmento
            </p>
          </div>
          <div className="flex items-center gap-3">
            {fetchedAt && (
              <span className="text-xs text-zinc-500">
                Actualizado {fetchedAt.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchAudit}
              disabled={loading}
              className="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : "↻"}
              {loading ? "Cargando…" : "Actualizar"}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300">
            ❌ {error}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !auditData && (
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col items-center gap-4">
          <svg className="w-10 h-10 animate-spin text-zinc-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <p className="text-zinc-400">Barriendo todos los endpoints de GHL…</p>
        </div>
      )}

      {auditData && (
        <div className="max-w-7xl mx-auto px-6 py-4">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1 mb-6 bg-zinc-800/40 p-1 rounded-xl">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Contenido de la sección activa */}
          <div>{sectionMap[activeTab]}</div>
        </div>
      )}
    </div>
  );
}
