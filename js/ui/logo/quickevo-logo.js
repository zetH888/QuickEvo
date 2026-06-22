/**
 * @module ui/logo/quickevo-logo
 *
 * @description
 * Renderowanie i animacja SVG logotypu QuickEvo (wersja nagłówkowa i ekran powitalny).
 * Moduł utrzymuje własny stan animacji (WeakMap kontrolerów RAF) oraz licznik instancji SVG,
 * aby unikać kolizji ID w `<defs>`.
 *
 * @publicznyInterfejs
 * - buildQuickEvoLogoSvg
 * - startLogoOrbit
 * - startLogoOrbitInContainer
 * - getLogoOrbitConfig
 * - getLogoPalette
 */
 
import { parseCssNumber } from '../../core/utils.js';
 
/** @type {WeakMap<SVGElement, { rafId: number }>} Kontrolery animacji orbit logo. */
const logoOrbitControllers = new WeakMap();
 
/** @type {number} Licznik instancji loga dla unikalnych ID SVG. */
let logoInstanceCounter = 0;
 
function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Buduje kod SVG logo QuickEvo.
 *
 * @param {{ size: 'header' | 'welcome' }} cfg
 * @returns {string}
 */
export function buildQuickEvoLogoSvg({ size }) {
    const prefix = `qe${++logoInstanceCounter}`;
    const palette = getLogoPalette();
    const defs = buildLogoDefs(prefix, palette, size);
    if (size === 'welcome') {
        return `<svg viewBox="0 0 1120 420" role="img" aria-label="QuickEvo" xmlns="http://www.w3.org/2000/svg" data-qe-logo-size="${size}"><defs>${defs}</defs>${buildWelcomeComposition(prefix, palette)}</svg>`;
    }
    return `<svg viewBox="0 0 760 190" role="img" aria-label="QuickEvo" xmlns="http://www.w3.org/2000/svg" data-qe-logo-size="${size}"><defs>${defs}</defs>${buildHeaderComposition(prefix, palette)}</svg>`;
}

/**
 * Zwraca definicje `<defs>` wspólne dla wariantów logo.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @param {'header' | 'welcome'} size
 * @returns {string}
 */
function buildLogoDefs(prefix, palette, size) {
    const glowBlur = size === 'welcome' ? 14 : 10;
    const shadowBlur = size === 'welcome' ? 9 : 7;
    return `
        <linearGradient id="${prefix}Accent" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.accentStart}"></stop>
            <stop offset="58%" stop-color="${palette.accentMid}"></stop>
            <stop offset="100%" stop-color="${palette.accentEnd}"></stop>
        </linearGradient>
        <linearGradient id="${prefix}AccentSoft" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.accentStart}" stop-opacity="0.98"></stop>
            <stop offset="100%" stop-color="${palette.accentEnd}" stop-opacity="0.82"></stop>
        </linearGradient>
        <linearGradient id="${prefix}Needle" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.accentStart}"></stop>
            <stop offset="100%" stop-color="${palette.accentEnd}"></stop>
        </linearGradient>
        <linearGradient id="${prefix}Circuit" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="${palette.accentSoft}" stop-opacity="0.95"></stop>
            <stop offset="100%" stop-color="${palette.accentEnd}" stop-opacity="0.95"></stop>
        </linearGradient>
        <linearGradient id="${prefix}WhiteFade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${palette.wordmarkStrong}" stop-opacity="0.96"></stop>
            <stop offset="100%" stop-color="${palette.wordmarkSoft}" stop-opacity="0.88"></stop>
        </linearGradient>
        <radialGradient id="${prefix}Halo" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stop-color="${palette.accentEnd}" stop-opacity="0.55"></stop>
            <stop offset="100%" stop-color="${palette.accentEnd}" stop-opacity="0"></stop>
        </radialGradient>
        <filter id="${prefix}Shadow" x="-35%" y="-45%" width="170%" height="190%">
            <feDropShadow dx="0" dy="10" stdDeviation="${shadowBlur}" flood-color="${palette.shadowColor}" flood-opacity="0.28"></feDropShadow>
        </filter>
        <filter id="${prefix}SoftGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="${glowBlur}" result="blur"></feGaussianBlur>
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.85 0"></feColorMatrix>
        </filter>
        <filter id="${prefix}CardShadow" x="-40%" y="-60%" width="180%" height="220%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#7DA8D8" flood-opacity="0.18"></feDropShadow>
        </filter>
        <filter id="${prefix}WordmarkShadow" x="-25%" y="-35%" width="150%" height="170%">
            <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="${palette.wordmarkShadow}" flood-opacity="${palette.wordmarkShadowOpacity}"></feDropShadow>
        </filter>
    `;
}

/**
 * Buduje prostszy wariant logotypu do headera.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @returns {string}
 */
function buildHeaderComposition(prefix, palette) {
    return `
        <g transform="translate(0 0)">
            ${buildCoreLogo(prefix, palette, { x: 0, y: 0, compact: true })}
        </g>
    `;
}

/**
 * Buduje pełniejszy wariant logotypu do ekranu powitalnego.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @returns {string}
 */
function buildWelcomeComposition(prefix, palette) {
    return `
        <g opacity="0.98">
            ${buildDataCard(prefix, palette, { x: 160, y: 62, width: 186, height: 68, opacity: 0.96 })}
            ${buildDataCard(prefix, palette, { x: 846, y: 132, width: 176, height: 66, opacity: 0.92 })}
            ${buildDataCard(prefix, palette, { x: 584, y: 288, width: 168, height: 64, opacity: 0.9 })}
            ${buildCircuitLayer(prefix, palette)}
            ${buildMapPin(prefix, 128, 128, 0.96)}
            ${buildMapPin(prefix, 710, 52, 0.96)}
            ${buildMapPin(prefix, 176, 310, 0.9)}
            ${buildMapPin(prefix, 918, 312, 0.92)}
            <g transform="translate(150 118)">
                ${buildCoreLogo(prefix, palette, { x: 0, y: 0, compact: false })}
            </g>
        </g>
    `;
}

/**
 * Buduje rdzeń logo: sygnet, napis i zębatkę zastępującą literę "o".
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @param {{ x: number, y: number, compact: boolean }} cfg
 * @returns {string}
 */
function buildCoreLogo(prefix, palette, { x, y, compact }) {
    const layout = compact
        ? { wordmarkY: 122, quickSize: 98, quickX: x + 104, quickText: 'uick', quickLength: 210, evoSize: 102, evoX: x + 330, evoLength: 114, gearCx: x + 482, gearCy: y + 83 }
        : { wordmarkY: 126, quickSize: 104, quickX: x + 116, quickText: 'uick', quickLength: 228, evoSize: 108, evoX: x + 360, evoLength: 122, gearCx: x + 530, gearCy: y + 84 };
    const iconCx = x + 78;
    const iconCy = y + 82;
    const orbitGroup = `
        <g class="qe-orbit" data-qe-orbit="1" transform="translate(${iconCx} ${iconCy})">
            <circle class="qe-orbit-dot qe-orbit-dot--a" data-qe-orbit-dot="a" cx="44" cy="0" r="5.5" fill="${palette.accentStart}"></circle>
            <circle class="qe-orbit-dot qe-orbit-dot--b" data-qe-orbit-dot="b" cx="-20" cy="35" r="4" fill="${palette.accentEnd}" fill-opacity="0.82"></circle>
        </g>
    `;
    return `
        <g filter="url(#${prefix}Shadow)">
            <circle class="qe-pulse" cx="${iconCx}" cy="${iconCy}" r="${compact ? 35 : 38}" fill="url(#${prefix}Halo)" opacity="0.85"></circle>
            ${buildCompassMark(prefix, palette, { cx: iconCx, cy: iconCy, compact })}
            ${orbitGroup}
            ${buildWordmark(prefix, palette, layout)}
            ${buildGearGlyph(prefix, { cx: layout.gearCx, cy: layout.gearCy, outerRadius: compact ? 31 : 33, innerRadius: compact ? 12.5 : 13.5 })}
        </g>
    `;
}

/**
 * Buduje napis `uickEv`, gdzie sygnet pełni wizualnie rolę litery `Q`.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @param {{ wordmarkY: number, quickSize: number, quickX: number, quickText: string, quickLength: number, evoSize: number, evoX: number, evoLength: number }} layout
 * @returns {string}
 */
function buildWordmark(prefix, palette, layout) {
    return `
        <g class="qe-wordmark" aria-hidden="true" filter="url(#${prefix}WordmarkShadow)">
            <text x="${layout.quickX}" y="${layout.wordmarkY}" font-family="Segoe UI, Inter, system-ui, Arial, sans-serif" font-size="${layout.quickSize}" font-weight="800" letter-spacing="-2.2" textLength="${layout.quickLength}" lengthAdjust="spacingAndGlyphs" fill="url(#${prefix}WhiteFade)" stroke="${palette.wordmarkStroke}" stroke-width="${palette.wordmarkStrokeWidth}" paint-order="stroke fill">${layout.quickText}</text>
            <text x="${layout.evoX}" y="${layout.wordmarkY}" font-family="Segoe UI, Inter, system-ui, Arial, sans-serif" font-size="${layout.evoSize}" font-weight="800" letter-spacing="-2.1" textLength="${layout.evoLength}" lengthAdjust="spacingAndGlyphs" fill="url(#${prefix}Accent)" stroke="${palette.accentStroke}" stroke-width="${palette.accentStrokeWidth}" paint-order="stroke fill">Ev</text>
        </g>
    `;
}

/**
 * Buduje sygnet kompasu z miękkim ringiem i igłą.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @param {{ cx: number, cy: number, compact: boolean }} cfg
 * @returns {string}
 */
function buildCompassMark(prefix, palette, { cx, cy, compact }) {
    const outerRadius = compact ? 51 : 55;
    const innerRadius = compact ? 28 : 30;
    const toothHeight = compact ? 15 : 17;
    const toothWidth = compact ? 10 : 11;
    return `
        <g aria-hidden="true">
            ${buildGearTeeth({ cx, cy, count: 8, radius: outerRadius + 1, toothWidth, toothHeight, rotation: 0, fill: palette.wordmarkStrong, opacity: 0.98 })}
            <path d="${buildDonutPath(cx, cy, outerRadius, innerRadius)}" fill="${palette.wordmarkStrong}" fill-rule="evenodd"></path>
            <path d="${buildQTailPath(cx, cy, outerRadius, innerRadius, compact)}" fill="${palette.wordmarkStrong}" opacity="0.98"></path>
            <path d="${buildArcBandPath(cx, cy, compact ? 47 : 51, compact ? 33.5 : 36.5, -36, 46)}" fill="url(#${prefix}AccentSoft)" opacity="0.98"></path>
            <path d="${buildNeedlePath(cx, cy, { angleDeg: -48, tipLength: compact ? 66 : 70, tailLength: compact ? 48 : 52, width: compact ? 12.5 : 13.5 })}" fill="url(#${prefix}Needle)"></path>
            <circle cx="${cx}" cy="${cy}" r="${compact ? 10 : 11}" fill="${palette.wordmarkStrong}"></circle>
            <circle cx="${cx}" cy="${cy}" r="${compact ? 3.2 : 3.4}" fill="${palette.accentStart}" opacity="0.9"></circle>
        </g>
    `;
}

/**
 * Buduje zębatkę w roli litery "o".
 *
 * @param {string} prefix
 * @param {{ cx: number, cy: number, outerRadius: number, innerRadius: number }} cfg
 * @returns {string}
 */
function buildGearGlyph(prefix, { cx, cy, outerRadius, innerRadius }) {
    return `
        <g aria-hidden="true">
            ${buildGearTeeth({ cx, cy, count: 8, radius: outerRadius + 1, toothWidth: 9, toothHeight: 15, rotation: 4, fill: `url(#${prefix}Accent)`, opacity: 1 })}
            <path d="${buildDonutPath(cx, cy, outerRadius, innerRadius)}" fill="url(#${prefix}Accent)" fill-rule="evenodd"></path>
        </g>
    `;
}

/**
 * Buduje dekoracyjną warstwę linii i punktów dla welcome.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @returns {string}
 */
function buildCircuitLayer(prefix, palette) {
    return `
        <g aria-hidden="true">
            <path class="qe-circuit-line qe-circuit-line--accent" d="M154 176 L154 140 L208 140 L244 102 L352 102 L402 48" fill="none" stroke="url(#${prefix}Circuit)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--ghost" d="M292 88 L350 88 L382 60 L430 60" fill="none" stroke="${palette.lineGhost}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line" d="M344 98 L430 98 L464 66 L646 66 L690 24" fill="none" stroke="${palette.lineSoft}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--accent" d="M318 146 L468 146 L498 110 L602 110" fill="none" stroke="url(#${prefix}Circuit)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line" d="M610 110 L820 110 L854 78 L918 78" fill="none" stroke="${palette.lineSoft}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--accent" d="M132 248 L246 248 L282 212 L390 212" fill="none" stroke="url(#${prefix}Circuit)" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line" d="M408 210 L662 210 L706 178 L886 178 L950 178" fill="none" stroke="${palette.lineSoft}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--accent" d="M292 328 L432 328 L514 246 L594 246" fill="none" stroke="url(#${prefix}Circuit)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line" d="M564 286 L720 286 L770 244 L952 244" fill="none" stroke="${palette.lineSoft}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--ghost" d="M260 312 L346 312 L418 252 L502 252" fill="none" stroke="${palette.lineGhost}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--ghost" d="M470 166 L552 166 L618 128 L754 128" fill="none" stroke="${palette.lineGhost}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path class="qe-circuit-line qe-circuit-line--ghost" d="M632 316 L748 316 L792 274 L862 274" fill="none" stroke="${palette.lineGhost}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path>
            ${buildCircuitNode(palette, 154, 176, 8.5, palette.accentStart)}
            ${buildCircuitNode(palette, 402, 48, 7.8, palette.accentEnd)}
            ${buildCircuitNode(palette, 498, 110, 12, palette.accentStart, true)}
            ${buildCircuitNode(palette, 390, 212, 6.4, palette.accentEnd)}
            ${buildCircuitNode(palette, 594, 246, 9.2, palette.accentEnd)}
            ${buildCircuitNode(palette, 432, 328, 10.8, palette.accentStart, true)}
            ${buildCircuitNode(palette, 952, 244, 8.6, palette.accentStart)}
            ${buildCircuitNode(palette, 820, 178, 5.4, palette.accentEnd)}
            ${buildCircuitNode(palette, 430, 60, 5.4, palette.accentSoft)}
            ${buildCircuitNode(palette, 862, 274, 5.8, palette.accentSoft)}
            ${buildDotCluster(662, 58, palette.accentEnd)}
            ${buildDotCluster(320, 284, palette.accentSoft)}
            ${buildDotCluster(860, 94, palette.lineGhost)}
            ${buildDotCluster(704, 238, palette.accentSoft)}
        </g>
    `;
}

/**
 * Buduje prostą kartę danych inspirowaną PNG.
 *
 * @param {string} prefix
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @param {{ x: number, y: number, width: number, height: number, opacity: number }} cfg
 * @returns {string}
 */
function buildDataCard(prefix, palette, { x, y, width, height, opacity }) {
    const baseY = y + 18;
    return `
        <g class="qe-deco-card" filter="url(#${prefix}CardShadow)" opacity="${opacity}">
            <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="rgba(255,255,255,0.82)"></rect>
            <rect x="${x + 1.5}" y="${y + 1.5}" width="${width - 3}" height="${height - 3}" rx="12.5" fill="rgba(255,255,255,0.72)" stroke="${palette.panelStroke}" stroke-width="1"></rect>
            <circle cx="${x + 18}" cy="${baseY}" r="6.4" fill="url(#${prefix}Accent)"></circle>
            <line x1="${x + 42}" y1="${baseY}" x2="${x + 92}" y2="${baseY}" stroke="url(#${prefix}Accent)" stroke-width="3.2" stroke-linecap="round"></line>
            <line x1="${x + 42}" y1="${baseY + 12}" x2="${x + 106}" y2="${baseY + 12}" stroke="${palette.panelLineStrong}" stroke-width="3" stroke-linecap="round"></line>
            <line x1="${x + 42}" y1="${baseY + 24}" x2="${x + 98}" y2="${baseY + 24}" stroke="${palette.panelLineSoft}" stroke-width="3" stroke-linecap="round"></line>
            <circle cx="${x + 18}" cy="${baseY + 24}" r="3.4" fill="${palette.panelLineSoft}"></circle>
        </g>
    `;
}

/**
 * Buduje pinezkę mapy używaną w dekoracjach.
 *
 * @param {string} prefix
 * @param {number} cx
 * @param {number} cy
 * @param {number} opacity
 * @returns {string}
 */
function buildMapPin(prefix, cx, cy, opacity) {
    return `
        <g class="qe-map-pin" opacity="${opacity}" filter="url(#${prefix}Shadow)">
            <path d="M ${cx} ${cy} C ${cx - 14} ${cy} ${cx - 24} ${cy - 10} ${cx - 24} ${cy - 24} C ${cx - 24} ${cy - 40} ${cx - 12} ${cy - 52} ${cx} ${cy - 52} C ${cx + 12} ${cy - 52} ${cx + 24} ${cy - 40} ${cx + 24} ${cy - 24} C ${cx + 24} ${cy - 10} ${cx + 14} ${cy} ${cx} ${cy} L ${cx} ${cy + 18} Z" fill="url(#${prefix}Accent)"></path>
            <circle cx="${cx}" cy="${cy - 25}" r="6.4" fill="#F9FCFF"></circle>
        </g>
    `;
}

/**
 * Buduje punkt obwodu w dekoracjach.
 *
 * @param {ReturnType<typeof getLogoPalette>} palette
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {string} fill
 * @param {boolean} emphasized
 * @returns {string}
 */
function buildCircuitNode(palette, cx, cy, radius, fill, emphasized = false) {
    const outer = emphasized ? radius + 6 : radius + 3.2;
    const ringOpacity = emphasized ? 0.4 : 0.24;
    return `
        <g class="qe-circuit-node">
            <circle cx="${cx}" cy="${cy}" r="${outer}" fill="${palette.nodeHalo}" stroke="${fill}" stroke-opacity="${ringOpacity}" stroke-width="2"></circle>
            <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}"></circle>
            <circle cx="${cx}" cy="${cy}" r="${Math.max(2.4, radius * 0.34)}" fill="#F8FCFF"></circle>
        </g>
    `;
}

/**
 * Buduje skupisko kropek dekoracyjnych.
 *
 * @param {number} startX
 * @param {number} y
 * @param {string} color
 * @returns {string}
 */
function buildDotCluster(startX, y, color) {
    const dots = [];
    for (let index = 0; index < 4; index += 1) {
        dots.push(`<circle cx="${startX + (index * 18)}" cy="${y}" r="4" fill="${color}" opacity="${0.92 - (index * 0.12)}"></circle>`);
    }
    return `<g aria-hidden="true">${dots.join('')}</g>`;
}

/**
 * Buduje prosty zestaw zębów koła zębatego.
 *
 * @param {{ cx: number, cy: number, count: number, radius: number, toothWidth: number, toothHeight: number, rotation: number, fill: string, opacity: number }} cfg
 * @returns {string}
 */
function buildGearTeeth({ cx, cy, count, radius, toothWidth, toothHeight, rotation, fill, opacity }) {
    const teeth = [];
    for (let index = 0; index < count; index += 1) {
        const angle = rotation + ((360 / count) * index);
        teeth.push(`<rect x="${cx - (toothWidth / 2)}" y="${cy - radius - toothHeight + 2}" width="${toothWidth}" height="${toothHeight}" rx="${Math.min(2.4, toothWidth / 2)}" fill="${fill}" opacity="${opacity}" transform="rotate(${angle} ${cx} ${cy})"></rect>`);
    }
    return `<g>${teeth.join('')}</g>`;
}

/**
 * Buduje kształt igły kompasu.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {{ angleDeg: number, tipLength: number, tailLength: number, width: number }} cfg
 * @returns {string}
 */
function buildNeedlePath(cx, cy, { angleDeg, tipLength, tailLength, width }) {
    const angle = (angleDeg * Math.PI) / 180;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const px = -uy;
    const py = ux;
    const tipX = cx + (ux * tipLength);
    const tipY = cy + (uy * tipLength);
    const tailX = cx - (ux * tailLength);
    const tailY = cy - (uy * tailLength);
    const rightX = cx + (px * width);
    const rightY = cy + (py * width);
    const leftX = cx - (px * width);
    const leftY = cy - (py * width);
    return `M ${tailX.toFixed(2)} ${tailY.toFixed(2)} L ${rightX.toFixed(2)} ${rightY.toFixed(2)} L ${tipX.toFixed(2)} ${tipY.toFixed(2)} L ${leftX.toFixed(2)} ${leftY.toFixed(2)} Z`;
}

/**
 * Buduje ścieżkę pierścienia z wyciętym środkiem.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} outerRadius
 * @param {number} innerRadius
 * @returns {string}
 */
function buildDonutPath(cx, cy, outerRadius, innerRadius) {
    return [
        `M ${cx} ${cy - outerRadius}`,
        `A ${outerRadius} ${outerRadius} 0 1 1 ${cx} ${cy + outerRadius}`,
        `A ${outerRadius} ${outerRadius} 0 1 1 ${cx} ${cy - outerRadius}`,
        'Z',
        `M ${cx} ${cy - innerRadius}`,
        `A ${innerRadius} ${innerRadius} 0 1 0 ${cx} ${cy + innerRadius}`,
        `A ${innerRadius} ${innerRadius} 0 1 0 ${cx} ${cy - innerRadius}`,
        'Z'
    ].join(' ');
}

/**
 * Buduje łuk akcentowy na pierścieniu kompasu.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {string}
 */
function buildArcPath(cx, cy, radius, startDeg, endDeg) {
    const start = polarToCartesian(cx, cy, radius, startDeg);
    const end = polarToCartesian(cx, cy, radius, endDeg);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    const sweep = endDeg > startDeg ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/**
 * Buduje pełniejszy pas akcentu na pierścieniu sygnetu, bliższy referencji PNG.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} outerRadius
 * @param {number} innerRadius
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {string}
 */
function buildArcBandPath(cx, cy, outerRadius, innerRadius, startDeg, endDeg) {
    const outerStart = polarToCartesian(cx, cy, outerRadius, startDeg);
    const outerEnd = polarToCartesian(cx, cy, outerRadius, endDeg);
    const innerEnd = polarToCartesian(cx, cy, innerRadius, endDeg);
    const innerStart = polarToCartesian(cx, cy, innerRadius, startDeg);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return [
        `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
        `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
        'Z'
    ].join(' ');
}

/**
 * Buduje ogon litery Q wychodzący z pierścienia.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} outerRadius
 * @param {number} innerRadius
 * @returns {string}
 */
function buildQTailPath(cx, cy, outerRadius, innerRadius, compact) {
    const outerA = polarToCartesian(cx, cy, outerRadius - 2, 37);
    const outerB = polarToCartesian(cx, cy, outerRadius + (compact ? 8 : 9), 58);
    const tip = { x: cx + (outerRadius * (compact ? 1.08 : 1.1)), y: cy + (outerRadius * (compact ? 1.08 : 1.1)) };
    const innerA = polarToCartesian(cx, cy, innerRadius + 4, 27);
    const innerB = polarToCartesian(cx, cy, innerRadius + 1, 45);
    return [
        `M ${outerA.x.toFixed(2)} ${outerA.y.toFixed(2)}`,
        `L ${outerB.x.toFixed(2)} ${outerB.y.toFixed(2)}`,
        `L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`,
        `L ${innerB.x.toFixed(2)} ${innerB.y.toFixed(2)}`,
        `L ${innerA.x.toFixed(2)} ${innerA.y.toFixed(2)}`,
        'Z'
    ].join(' ');
}

/**
 * Zwraca punkt na okręgu dla podanego kąta.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} angleDeg
 * @returns {{ x: number, y: number }}
 */
function polarToCartesian(cx, cy, radius, angleDeg) {
    const angle = (angleDeg * Math.PI) / 180;
    return { x: cx + (Math.cos(angle) * radius), y: cy + (Math.sin(angle) * radius) };
}
 
/**
 * Uruchamia animację orbity w logo.
 *
 * @param {SVGElement | null} svg
 * @param {'header' | 'welcome'} size
 */
export function startLogoOrbit(svg, size) {
    if (!svg || logoOrbitControllers.has(svg) || prefersReducedMotion()) return;
    const orbitGroup = svg.querySelector('g[data-qe-orbit="1"]'); if (!orbitGroup) return;
    const dotA = orbitGroup.querySelector('[data-qe-orbit-dot="a"]'), dotB = orbitGroup.querySelector('[data-qe-orbit-dot="b"]');
    if (!dotA || !dotB) return;
    let cfg = getLogoOrbitConfig(size), lastCfgTs = 0; const startTs = performance.now();
    const tick = (ts) => {
        if (!svg.isConnected || prefersReducedMotion()) { logoOrbitControllers.delete(svg); return; }
        if ((ts - lastCfgTs) > 700) { cfg = getLogoOrbitConfig(size); lastCfgTs = ts; }
        const t = (ts - startTs) / 1000, theta = cfg.dir * (t / cfg.period) * Math.PI * 2;
        dotA.setAttribute('cx', (cfg.radius * Math.cos(theta)).toFixed(2)); dotA.setAttribute('cy', (cfg.radius * Math.sin(theta)).toFixed(2));
        dotB.setAttribute('cx', (cfg.radius * 0.72 * Math.cos(theta + 2.05)).toFixed(2)); dotB.setAttribute('cy', (cfg.radius * 0.72 * Math.sin(theta + 2.05)).toFixed(2));
        logoOrbitControllers.set(svg, { rafId: window.requestAnimationFrame(tick) });
    };
    logoOrbitControllers.set(svg, { rafId: window.requestAnimationFrame(tick) });
}
 
/**
 * Uruchamia animację orbity w kontenerze.
 *
 * @param {HTMLElement | null} container
 * @param {'header' | 'welcome'} size
 */
export function startLogoOrbitInContainer(container, size) {
    const svg = container?.querySelector('svg'); if (svg) startLogoOrbit(svg, size);
}
 
/**
 * Pobiera konfigurację animacji orbity.
 *
 * @param {'header' | 'welcome'} size
 * @returns {{ radius: number, period: number, dir: 1 | -1 }}
 */
export function getLogoOrbitConfig(size) {
    const rootStyle = getComputedStyle(document.documentElement);
    const radius = parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-radius-${size}`), 52);
    const period = Math.max(0.2, parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-period-${size}`), size === 'header' ? 4.8 : 3.2));
    const dir = parseCssNumber(rootStyle.getPropertyValue(`--qe-orbit-direction-${size}`), 1) >= 0 ? 1 : -1;
    return { radius, period, dir };
}
 
/**
 * Pobiera paletę kolorów dla logo na podstawie motywu.
 *
 * @returns {{
 *   primary: string,
 *   accentStart: string,
 *   accentMid: string,
 *   accentEnd: string,
 *   accentSoft: string,
 *   wordmarkStrong: string,
 *   wordmarkSoft: string,
 *   wordmarkStroke: string,
 *   wordmarkStrokeWidth: number,
 *   wordmarkShadow: string,
 *   wordmarkShadowOpacity: number,
 *   accentStroke: string,
 *   accentStrokeWidth: number,
 *   shadowColor: string,
 *   panelStroke: string,
 *   panelLineStrong: string,
 *   panelLineSoft: string,
 *   nodeHalo: string,
 *   lineSoft: string,
 *   lineGhost: string
 * }}
 */
export function getLogoPalette() {
    const bodyStyle = getComputedStyle(document.body);
    const primary = bodyStyle.getPropertyValue('--primary-color').trim() || '#0066CC';
    const isMatrix = document.body.classList.contains('matrix-theme') || Boolean(window.isMatrixThemeActive);
    const isDark = document.body.classList.contains('dark-theme');
    if (isMatrix) {
        return {
            primary,
            accentStart: '#00D26A',
            accentMid: '#2DFF8F',
            accentEnd: '#7BFFC0',
            accentSoft: '#4AFFA7',
            wordmarkStrong: 'rgba(237, 255, 243, 0.96)',
            wordmarkSoft: 'rgba(179, 255, 205, 0.88)',
            wordmarkStroke: 'rgba(8, 54, 24, 0.32)',
            wordmarkStrokeWidth: 1.25,
            wordmarkShadow: 'rgba(0, 54, 22, 0.6)',
            wordmarkShadowOpacity: 0.34,
            accentStroke: 'rgba(0, 60, 24, 0.24)',
            accentStrokeWidth: 1,
            shadowColor: 'rgba(0, 73, 28, 0.6)',
            panelStroke: 'rgba(110, 220, 156, 0.52)',
            panelLineStrong: 'rgba(66, 255, 162, 0.44)',
            panelLineSoft: 'rgba(126, 255, 192, 0.38)',
            nodeHalo: 'rgba(37, 183, 255, 0.06)',
            lineSoft: 'rgba(175, 255, 210, 0.42)',
            lineGhost: 'rgba(175, 255, 210, 0.2)'
        };
    }
    if (!isDark) {
        return {
            primary,
            accentStart: '#8B7355',
            accentMid: '#9A8263',
            accentEnd: '#B09879',
            accentSoft: '#C6B294',
            wordmarkStrong: '#F4F1EC',
            wordmarkSoft: 'rgba(227, 220, 211, 0.98)',
            wordmarkStroke: 'rgba(190, 180, 168, 0.98)',
            wordmarkStrokeWidth: 1.72,
            wordmarkShadow: 'rgba(145, 131, 115, 0.66)',
            wordmarkShadowOpacity: 0.44,
            accentStroke: 'rgba(114, 92, 66, 0.22)',
            accentStrokeWidth: 0.92,
            shadowColor: 'rgba(140, 122, 98, 0.34)',
            panelStroke: 'rgba(193, 178, 160, 0.7)',
            panelLineStrong: 'rgba(160, 136, 105, 0.56)',
            panelLineSoft: 'rgba(191, 174, 151, 0.48)',
            nodeHalo: 'rgba(139, 115, 85, 0.08)',
            lineSoft: 'rgba(214, 202, 188, 0.88)',
            lineGhost: 'rgba(206, 192, 176, 0.58)'
        };
    }
    return {
        primary,
        accentStart: '#187BFF',
        accentMid: '#1EA3FF',
        accentEnd: '#23D2FF',
        accentSoft: '#7CCEFF',
        wordmarkStrong: isDark ? '#F8FBFF' : '#F2F6FC',
        wordmarkSoft: isDark ? 'rgba(232, 242, 255, 0.92)' : 'rgba(224, 232, 242, 0.98)',
        wordmarkStroke: isDark ? 'rgba(110, 178, 255, 0.10)' : 'rgba(187, 198, 212, 0.98)',
        wordmarkStrokeWidth: isDark ? 0.5 : 1.72,
        wordmarkShadow: isDark ? 'rgba(7, 18, 38, 0.68)' : 'rgba(145, 156, 172, 0.72)',
        wordmarkShadowOpacity: isDark ? 0.28 : 0.42,
        accentStroke: isDark ? 'rgba(200, 232, 255, 0.08)' : 'rgba(24, 123, 255, 0.18)',
        accentStrokeWidth: isDark ? 0.5 : 0.85,
        shadowColor: isDark ? 'rgba(4, 18, 42, 0.62)' : 'rgba(135, 150, 170, 0.34)',
        panelStroke: 'rgba(190,214,240,0.7)',
        panelLineStrong: 'rgba(72,142,255,0.48)',
        panelLineSoft: 'rgba(157,205,255,0.42)',
        nodeHalo: 'rgba(37,183,255,0.06)',
        lineSoft: isDark ? 'rgba(237, 245, 255, 0.76)' : 'rgba(211, 223, 235, 0.88)',
        lineGhost: isDark ? 'rgba(224, 236, 251, 0.44)' : 'rgba(206, 217, 231, 0.58)'
    };
}
