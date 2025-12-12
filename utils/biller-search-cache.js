/**
 * BillerSearchCache
 *
 * Cache inteligente para búsquedas en Biller con TTL de 5 minutos
 * Reduce llamadas a Biller API en ~80%
 *
 * Fase 2 - Mejora de performance y confiabilidad
 */

class BillerSearchCache {
  /**
   * Constructor
   * @param {number} ttlMs - Time To Live en milisegundos (default: 5 min)
   */
  constructor(ttlMs = 5 * 60 * 1000) {
    this.cache = new Map();
    this.ttl = ttlMs;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * Obtener valor del caché
   * @param {string} numeroInterno - Número interno (ej: ML-123456)
   * @returns {object|null} Comprobante si existe y no ha expirado, null si no
   */
  get(numeroInterno) {
    if (!numeroInterno) return null;

    const entry = this.cache.get(numeroInterno);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Verificar si ha expirado
    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > this.ttl) {
      // Ha expirado, eliminar
      this.cache.delete(numeroInterno);
      this.stats.evictions++;
      this.stats.misses++;
      return null;
    }

    // Cache hit
    this.stats.hits++;
    return entry.result;
  }

  /**
   * Guardar valor en caché
   * @param {string} numeroInterno - Número interno
   * @param {object} result - Resultado a cachear
   */
  set(numeroInterno, result) {
    if (!numeroInterno || !result) return;

    this.cache.set(numeroInterno, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Limpiar todo el caché
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.evictions += size;
  }

  /**
   * Limpiar entradas expiradas
   * Se puede llamar periódicamente para evitar memory leak
   */
  prune() {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        pruned++;
      }
    }

    this.stats.evictions += pruned;
    return pruned;
  }

  /**
   * Obtener estadísticas de uso del caché
   * @returns {object} Stats con hits, misses, rate
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 'N/A';

    return {
      ...this.stats,
      total,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      ttlMinutes: (this.ttl / 1000 / 60).toFixed(1)
    };
  }

  /**
   * Resetear estadísticas
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }
}

module.exports = BillerSearchCache;
