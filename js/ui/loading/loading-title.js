import { clampNumber } from '../../core/utils.js';

export function getLoadingTitleCategoryForProgress(progressPercent) {
    const p = clampNumber(progressPercent, 0, 100);
    if (p >= 100) return 'powitalne';
    if (p <= 20) return 'startowe';
    if (p <= 50) return 'techniczne';
    if (p <= 80) return 'absurdalne';
    return 'finalizujace';
}

export function pickRandomNonRepeating(items, lastValue) {
    if (!Array.isArray(items) || items.length === 0) return '';
    if (items.length === 1) return items[0];
    let next = items[Math.floor(Math.random() * items.length)];
    if (typeof lastValue === 'string' && lastValue.length > 0) {
        let guard = 0;
        while (next === lastValue && guard < 12) {
            next = items[Math.floor(Math.random() * items.length)];
            guard += 1;
        }
    }
    return next;
}

export function setLoadingTitleContent(el, nextText) {
    if (!el) return;
    const raw = String(nextText || '').trim();
    if (raw.length === 0) return;
    const normalized = raw.replace(/[✅✔🗸]/g, '✓');
    let hasCheck = false;
    const frag = document.createDocumentFragment();
    for (const ch of Array.from(normalized)) {
        if (ch === '✓') {
            hasCheck = true;
            const s = document.createElement('span');
            s.className = 'qe-check';
            s.textContent = ch;
            frag.appendChild(s);
            continue;
        }
        frag.appendChild(document.createTextNode(ch));
    }
    el.replaceChildren(frag);
    el.classList.toggle('qe-title-has-check', hasCheck);
}

export async function animateLoadingTitleSwap(el, nextText, { reducedMotion, fadeOutMs = 0, fadeInMs = 0 } = {}) {
    if (!el) return;
    const text = String(nextText || '').trim();
    if (text.length === 0) return;
    if (reducedMotion) { setLoadingTitleContent(el, text); el.style.opacity = '1'; return; }

    const fade = (from, to, durationMs) => new Promise((resolve) => {
        try {
            if (typeof el.animate === 'function') {
                const anim = el.animate(
                    [{ opacity: from }, { opacity: to }],
                    { duration: durationMs, easing: 'ease', fill: 'forwards' }
                );
                anim.addEventListener('finish', () => resolve(), { once: true });
                anim.addEventListener('cancel', () => resolve(), { once: true });
            } else {
                el.style.transition = `opacity ${durationMs}ms ease`;
                el.style.opacity = String(to);
                window.setTimeout(() => resolve(), durationMs);
            }
        } catch {
            el.style.opacity = String(to);
            window.setTimeout(() => resolve(), durationMs);
        }
    });

    await fade(1, 0, fadeOutMs);
    setLoadingTitleContent(el, text);
    await fade(0, 1, fadeInMs);
    el.style.opacity = '1';
}

export class LoadingTitleRotator {
    constructor(cfg) {
        this._el = cfg?.el || null;
        this._getProgress = typeof cfg?.getProgress === 'function' ? cfg.getProgress : (() => 0);
        this._getMessagesForProgress = typeof cfg?.getMessagesForProgress === 'function' ? cfg.getMessagesForProgress : (() => []);
        this._prefersReducedMotion = typeof cfg?.prefersReducedMotion === 'function' ? cfg.prefersReducedMotion : (() => false);
        this._fadeOutMs = Number(cfg?.fadeOutMs || 0);
        this._fadeInMs = Number(cfg?.fadeInMs || 0);
        this._intervalMinMs = Number(cfg?.intervalMinMs || 0);
        this._intervalMaxMs = Number(cfg?.intervalMaxMs || 0);

        this._timer = null;
        this._running = false;
        this._reducedMotion = false;
        this._lastMessage = '';
        this._animSeq = 0;
    }

    start() {
        if (this._running) return;
        if (!this._el) return;
        this._running = true;
        this._reducedMotion = this._prefersReducedMotion();
        this._scheduleNext({ immediate: true });
    }

    stop() {
        this._running = false;
        this._animSeq += 1;
        if (this._timer !== null) {
            window.clearTimeout(this._timer);
            this._timer = null;
        }
        if (this._el) {
            this._el.style.opacity = '1';
        }
    }

    _scheduleNext({ immediate } = {}) {
        if (!this._running) return;
        if (!this._el) return;

        const min = Math.max(0, this._intervalMinMs);
        const max = Math.max(min, this._intervalMaxMs);
        const delay = immediate ? 0 : Math.floor(min + Math.random() * (max - min));

        if (this._timer !== null) window.clearTimeout(this._timer);
        this._timer = window.setTimeout(() => {
            this._timer = null;
            void this._tick();
        }, delay);
    }

    async _tick() {
        if (!this._running) return;
        if (!this._el) return;

        const progress = clampNumber(this._getProgress(), 0, 100);
        const pool = this._getMessagesForProgress(progress) || [];
        const next = pickRandomNonRepeating(pool, this._lastMessage);
        if (!next) {
            if (progress >= 100) { this.stop(); return; }
            this._scheduleNext();
            return;
        }

        const seq = (this._animSeq += 1);
        await animateLoadingTitleSwap(this._el, next, { reducedMotion: this._reducedMotion, fadeOutMs: this._fadeOutMs, fadeInMs: this._fadeInMs });
        if (!this._running) return;
        if (seq !== this._animSeq) return;
        this._lastMessage = next;
        if (progress >= 100) { this.stop(); return; }
        this._scheduleNext();
    }
}

