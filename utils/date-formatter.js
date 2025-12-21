/**
 * Utilidades de formateo de fechas para Biller API
 * @module utils/date-formatter
 */

/**
 * Formatear fecha para Biller API (dd/mm/aaaa)
 * @param {Date} [date] - Fecha a formatear, default: hoy
 * @returns {string} Fecha en formato dd/mm/aaaa
 */
function formatDateForBiller(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) {
    // Si la fecha es inválida, usar hoy
    return formatDateForBiller(new Date());
  }

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Formatear fecha ISO para referencias (aaaa-mm-dd)
 * @param {Date} [date] - Fecha a formatear
 * @returns {string} Fecha en formato aaaa-mm-dd
 */
function formatDateISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) {
    return formatDateISO(new Date());
  }

  return d.toISOString().split('T')[0];
}

/**
 * Parsear monto seguro (evita NaN)
 * @param {any} value - Valor a parsear
 * @param {number} [defaultValue=0] - Valor por defecto si es NaN
 * @returns {number} Monto parseado
 */
function parseMontoSeguro(value, defaultValue = 0) {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  const parsed = parseFloat(value);

  if (isNaN(parsed) || !isFinite(parsed)) {
    return defaultValue;
  }

  return parsed;
}

/**
 * Truncar string a longitud máxima (para cumplir límites Biller)
 * @param {string} str - String a truncar
 * @param {number} maxLength - Longitud máxima
 * @returns {string} String truncado
 */
function truncateForBiller(str, maxLength) {
  if (!str) return '';
  return String(str).substring(0, maxLength);
}

/**
 * Límites de longitud de campos según Biller API v2
 */
const BILLER_FIELD_LIMITS = {
  CONCEPTO: 80,
  RAZON_SOCIAL: 70,
  NOMBRE_FANTASIA: 30,
  DIRECCION: 70,
  CIUDAD: 30,
  DEPARTAMENTO: 30,
  CODIGO_PRODUCTO: 35,
  NUMERO_INTERNO: 50
};

module.exports = {
  formatDateForBiller,
  formatDateISO,
  parseMontoSeguro,
  truncateForBiller,
  BILLER_FIELD_LIMITS
};
