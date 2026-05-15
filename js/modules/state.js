/**
 * @module state
 *
 * @description
 * Moduł odpowiedzialny za inicjalizację i utrzymanie stanu aplikacji, przekazywanego pomiędzy modułami.
 * W QuickEvo stan obejmuje m.in. cache wyszukiwania oraz prekompilowane reguły (np. KeyLab).
 *
 * @zaleznosci
 * - utils.js — implementacja LRUCache.
 * - search-engine.js — definicja i kompilacja reguł KeyLab.
 *
 * @publicznyInterfejs
 * - createAppState — tworzy nową, izolowaną instancję stanu aplikacji.
 */
 
import { LRUCache } from './utils.js';
import { compileKeyLabTokenSets, KEY_LAB_TOKEN_SETS } from './search-engine.js';
 
/**
 * Tworzy nową instancję stanu aplikacji.
 * Funkcja jest deterministyczna i nie ma efektów ubocznych poza stworzeniem struktur danych w pamięci.
 *
 * @returns {{
 *   search: {
 *     searchCache: LRUCache,
 *     compiledKeyLabTokenSets: Array<Array<string>>
 *   },
 *   predictive: {
 *     predictiveSuggestionsCache: LRUCache
 *   }
 * }}
 */
export function createAppState() {
    return {
        search: {
            searchCache: new LRUCache(100),
            compiledKeyLabTokenSets: compileKeyLabTokenSets(KEY_LAB_TOKEN_SETS)
        },
        predictive: {
            predictiveSuggestionsCache: new LRUCache(150)
        }
    };
}
