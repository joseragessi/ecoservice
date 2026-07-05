const supabase = require('./supabase');
const { extraerComprobante } = require('./extraccion');

/**
 * Descarga la imagen del comprobante desde Twilio.
 * Las MediaUrl de Twilio son privadas: requieren autenticación básica
 * con el Account SID + Auth Token.
 * @param {string} mediaUrl
 * @returns {Promise<Buffer>} bytes de la imagen
 */
async function descargarImagen(mediaUrl) {
  const auth = Buffer
    .from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`)
    .toString('base64');

  const resp = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!resp.ok) {
    throw new Error(`No se pudo descargar la imagen (HTTP ${resp.status})`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Formatea un número al estilo argentino ($ 147.141,40) para mostrar al capataz.
 */
function pesos(n) {
  if (n == null) return '—';
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Punto de entrada del flujo de combustible: el capataz mandó una foto
 * de un remito o de una factura de carga.
 *
 * PASO 2 (este archivo): descarga la imagen, la manda a Claude para
 * extraer los datos, y le confirma al capataz lo que se leyó.
 * PASO 3 (siguiente): resolver la unidad por patente contra el maestro
 * y crear la fila en cargas_combustible + sus items.
 *
 * @param {string} telefono   - formato whatsapp:+549351...
 * @param {string} mediaUrl   - URL de la imagen en Twilio
 * @param {string} mediaType  - content-type (ej: image/jpeg)
 * @returns {Promise<string>} respuesta a enviar al capataz
 */
async function procesarComprobante(telefono, mediaUrl, mediaType) {
  const tel = telefono.replace('whatsapp:', '').replace('+', '');

  // Identificar al capataz por teléfono (misma lógica que incidencias)
  const { data: capataz } = await supabase
    .from('capataces')
    .select('id, nombre, objetivo_id')
    .eq('telefono', tel)
    .eq('activo', true)
    .single();

  if (!capataz) {
    return '❌ Tu número no está registrado en el sistema EcoService. Contactá a administración.';
  }

  const nombre = capataz.nombre.split(' ')[0];

  // Validar que sea una imagen
  if (!mediaType || !mediaType.startsWith('image/')) {
    return `Recibí un archivo, pero no es una imagen. Mandame la *foto* del remito o la factura, ${nombre}.`;
  }

  // Descargar la imagen (con auth de Twilio)
  let imagen;
  try {
    imagen = await descargarImagen(mediaUrl);
  } catch (err) {
    console.error('Error descargando imagen:', err);
    return '⚠️ No pude descargar la foto. Probá mandarla de nuevo en un momento.';
  }

  console.log(`[COMBUSTIBLE] ${capataz.nombre}: imagen de ${imagen.length} bytes (${mediaType})`);

  // Extraer los datos con Claude
  let datos;
  try {
    datos = await extraerComprobante(imagen, mediaType);
  } catch (err) {
    console.error('Error extrayendo comprobante:', err);
    return '⚠️ Recibí la foto pero no pude leer bien los datos. ¿Podés sacarla más nítida y mandarla de nuevo?';
  }

  console.log('[COMBUSTIBLE] extraído:', JSON.stringify(datos));

  // Armar el resumen de lo leído para confirmarle al capataz
  const litros = (datos.items || [])
    .filter(i => i.es_combustible)
    .reduce((s, i) => s + (i.litros || 0), 0);

  const productos = (datos.items || [])
    .map(i => `  • ${i.producto}: ${i.litros ?? '—'} lt`)
    .join('\n');

  const cabecera = datos.tipo_doc === 'factura'
    ? `📄 Factura ${datos.numero} — ${pesos(datos.total)}`
    : `📄 Remito ${datos.numero} — sin facturar`;

  return `📸 Leí tu comprobante, *${nombre}*:\n\n` +
         `⛽ ${datos.proveedor}\n` +
         `🚗 Patente: ${datos.patente || '—'}\n` +
         `${cabecera}\n` +
         `${productos}\n` +
         `Total combustible: ${litros.toFixed(2)} lt\n\n` +
         `_La carga se está registrando…_`;
  // NOTA paso 3: acá va el match de patente -> unidad_id y el INSERT
  //             en cargas_combustible + cargas_combustible_items.
}

module.exports = { procesarComprobante };
