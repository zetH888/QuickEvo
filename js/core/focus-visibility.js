/**
 * Zwraca aktualnie aktywny element HTML, jesli jest dostepny.
 *
 * @param {Document | null | undefined} [doc]
 * @returns {HTMLElement | null}
 */
export function getActiveHtmlElement(doc = document) {
    return doc?.activeElement instanceof HTMLElement ? doc.activeElement : null;
}

/**
 * Sprawdza, czy element moze przyjac fokus jako cel przywracania.
 *
 * @param {unknown} element
 * @returns {element is HTMLElement}
 */
export function isRestorableFocusTarget(element) {
    return element instanceof HTMLElement
        && element.isConnected
        && !element.hasAttribute('disabled')
        && element.getAttribute('aria-hidden') !== 'true';
}

/**
 * Bezpiecznie ustawia fokus na wskazanym elemencie.
 *
 * @param {HTMLElement | null | undefined} element
 * @returns {boolean}
 */
export function focusElementSafely(element) {
    if (!isRestorableFocusTarget(element)) return false;
    try {
        element.focus({ preventScroll: true });
        return element.ownerDocument?.activeElement === element;
    } catch {
        return false;
    }
}

/**
 * Bezpiecznie przenosi fokus na `body`, aby zdjac go z ukrywanego kontenera.
 *
 * @param {Document | null | undefined} [doc]
 * @returns {boolean}
 */
export function focusBodySafely(doc = document) {
    const body = doc?.body;
    if (!(body instanceof HTMLElement)) return false;
    const previousTabIndex = body.getAttribute('tabindex');
    body.setAttribute('tabindex', '-1');
    let focused = false;
    try {
        body.focus({ preventScroll: true });
        focused = doc?.activeElement === body;
    } catch {
        focused = false;
    }
    if (previousTabIndex == null) body.removeAttribute('tabindex');
    else body.setAttribute('tabindex', previousTabIndex);
    return focused;
}

/**
 * Przenosi fokus poza wskazany kontener, zanim ten zostanie ukryty dla AT.
 *
 * @param {HTMLElement | null | undefined} container
 * @param {{ preferredTarget?: HTMLElement | null }} [options]
 * @returns {boolean}
 */
export function moveFocusOutsideContainer(container, options = {}) {
    if (!(container instanceof HTMLElement)) return false;
    const doc = container.ownerDocument || document;
    const activeElement = getActiveHtmlElement(doc);
    if (!activeElement || !container.contains(activeElement)) return false;

    const preferredTarget = options?.preferredTarget ?? null;
    if (isRestorableFocusTarget(preferredTarget) && !container.contains(preferredTarget) && focusElementSafely(preferredTarget)) {
        return true;
    }

    try { activeElement.blur?.(); } catch { }
    return focusBodySafely(doc);
}

/**
 * Ustawia atrybut `inert`, jesli dana przegladarka go wspiera.
 *
 * @param {HTMLElement | null | undefined} element
 * @param {boolean} inert
 * @returns {void}
 */
export function setElementInert(element, inert) {
    if (!(element instanceof HTMLElement)) return;
    try {
        if ('inert' in element) element.inert = Boolean(inert);
    } catch { }
}
