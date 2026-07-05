const supabase = require('./supabase');

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
 * Punto de entrada del flujo de combustible: el capataz mandó una foto
 * de un remito o de una factura de carga.
 *
 * PASO 1 (este archivo): identifica al capataz, valida y descarga la
 * imagen, y confirma la recepción.
 * PASO 2 (siguiente): mandar la imagen a la API de Claude para extraer
 * los datos, resolver la unidad por patente y crear la fila en
 * cargas_combustible.
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

  // PASO 1: solo confirmamos la recepción.
  // (En el paso siguiente reemplazamos esto por: extracción con Claude +
  //  alta en cargas_combustible.)
  return `📸 Recibí tu comprobante, *${nombre}*.\n` +
         `Lo estoy procesando para registrar la carga de combustible…`;
}

module.exports = { procesarComprobante };
