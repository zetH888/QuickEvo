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
    const { primary, textStrong, textSoft } = getLogoPalette();
    const fontSize = size === 'header' ? 40 : 56, lineY = size === 'header' ? 14 : 18, textY = size === 'header' ? 4 : 0;
    const prefix = `qe${++logoInstanceCounter}`;
    return `<svg viewBox="0 0 640 180" role="img" aria-label="QuickEvo" xmlns="http://www.w3.org/2000/svg" data-qe-logo-size="${size}"><defs><linearGradient id="${prefix}Grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}" stop-opacity="0.95"></stop><stop offset="1" stop-color="${primary}" stop-opacity="0.35"></stop></linearGradient><filter id="${prefix}Soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="blur"></feGaussianBlur><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0" result="soft"></feColorMatrix><feMerge><feMergeNode in="soft"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs><g transform="translate(72 90)" filter="url(#${prefix}Soft)"><circle class="qe-pulse" cx="0" cy="0" r="34" fill="url(#${prefix}Grad)"></circle><circle cx="0" cy="0" r="52" fill="none" stroke="${primary}" stroke-opacity="0.35" stroke-width="3"></circle><g class="qe-orbit" data-qe-orbit="1"><circle class="qe-orbit-dot qe-orbit-dot--a" data-qe-orbit-dot="a" cx="52" cy="0" r="6" fill="${primary}"></circle><circle class="qe-orbit-dot qe-orbit-dot--b" data-qe-orbit-dot="b" cx="-26" cy="45" r="4" fill="${primary}" fill-opacity="0.75"></circle></g></g><g transform="translate(150 110)"><text x="0" y="${textY}" font-family="Segoe UI, system-ui, -apple-system, Arial" font-size="${fontSize}" font-weight="800" fill="${textStrong}">Quick<tspan font-weight="300" fill="${textSoft}">Evo</tspan></text><path d="M0 ${lineY} H460" stroke="${primary}" stroke-opacity="0.30" stroke-width="3" stroke-linecap="round"></path></g></svg>`;
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
 * @returns {{ primary: string, textStrong: string, textSoft: string }}
 */
export function getLogoPalette() {
    const bodyStyle = getComputedStyle(document.body);
    const primary = bodyStyle.getPropertyValue('--primary-color').trim() || '#0066CC';
    const baseTextColor = bodyStyle.getPropertyValue('--text-color').trim() || '#333333';
    const isMatrix = document.body.classList.contains('matrix-theme') || Boolean(window.isMatrixThemeActive);
    if (isMatrix) return { primary, textStrong: 'rgba(0, 255, 65, 0.92)', textSoft: 'rgba(0, 255, 65, 0.72)' };
    const isDark = document.body.classList.contains('dark-theme');
    return { primary, textStrong: isDark ? 'rgba(255, 255, 255, 0.92)' : baseTextColor, textSoft: isDark ? 'rgba(255, 255, 255, 0.78)' : baseTextColor };
}
