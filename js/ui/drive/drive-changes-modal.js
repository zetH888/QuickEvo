import { parseTableModelFromSource } from '../../core/excel-processor.js';
import { escapeHtml } from '../../core/utils.js';
import { docsGetBlob } from '../../storage/docs-db.js';

export function createDriveChangesModalController({ modalOverlay, modalContent, setElementHtml, prefersReducedMotion, formatFileName } = {}) {
    let state = null;

    function formatDriveTimestamp(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '-';
        try { return new Date(n).toLocaleString('pl-PL'); } catch { return String(n); }
    }

    function buildDriveChangesModalHtml(changed) {
        const safeList = Array.isArray(changed) ? changed : [];
        const items = safeList.map((f) => {
            const rawName = String(f?.name || '').trim();
            const rawNameEsc = escapeHtml(rawName);
            const name = escapeHtml(formatFileName ? formatFileName(rawName) : rawName);
            const fileId = escapeHtml(String(f?.id || '').trim());
            const isNewInDb = Boolean(f?.isNewInDb);
            const reasonRaw = String(f?.changeReason || '').trim() || 'Zmieniono';
            const reason = escapeHtml(reasonRaw);
            const prevTs = Number(f?.previousDriveModifiedAt);
            const nextTs = Number(f?.driveModifiedAt);
            const prev = Number.isFinite(prevTs) && prevTs > 0 ? escapeHtml(formatDriveTimestamp(prevTs)) : '';
            const next = Number.isFinite(nextTs) && nextTs > 0 ? escapeHtml(formatDriveTimestamp(nextTs)) : '';
            const prevRow = prev ? `<div class="qe-drive-kv"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">${prev}</span></div>` : `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Poprzednio</span><span class="qe-drive-v qe-drive-v--prev">Brak danych</span></div>`;
            const nextRow = next ? `<div class="qe-drive-kv"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">${next}</span></div>` : `<div class="qe-drive-kv is-muted"><span class="qe-drive-k">Na Dysku</span><span class="qe-drive-v qe-drive-v--next">Brak danych</span></div>`;
            const chevron = `<svg class="qe-drive-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            const customDisabledLabel = String(f?.diffDisabledLabel || '').trim();
            const customDisabledStatus = String(f?.diffDisabledStatus || '').trim();
            const hasCustomDisabled = Boolean(customDisabledLabel);
            const diffDisabled = (isNewInDb || hasCustomDisabled) ? ' disabled' : '';
            const diffBtnLabel = hasCustomDisabled ? customDisabledLabel : (isNewInDb ? 'Nowy plik — brak różnic' : 'Pokaż różnice');
            const diffBtn = `<button class="qe-drive-diff-btn" type="button"${diffDisabled}>${diffBtnLabel}</button>`;
            const diffStatus = `<div class="qe-drive-diff-status" aria-hidden="true">
            <div class="qe-drive-diff-status-spinner" hidden><div class="qe-spinner" aria-hidden="true"></div></div>
            <div class="qe-drive-diff-status-check" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7L10.2 17 4 10.8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="qe-drive-diff-status-x" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg></div>
        </div>`;
            const diffState = hasCustomDisabled
                ? (customDisabledStatus === 'check' ? 'blocked_ok' : 'blocked')
                : (isNewInDb ? 'blocked' : 'idle');
            const diffShell = `<div class="qe-drive-diff" data-qe-diff-state="${diffState}" data-qe-diff-visible="0">
            <div class="qe-drive-diff-actions">${diffBtn}${diffStatus}</div>
            <div class="qe-drive-diff-body" hidden>
                <div class="qe-drive-diff-error" hidden></div>
                <div class="qe-drive-diff-view" data-qe-diff-view="unified" hidden></div>
            </div>
        </div>`;
            return `<li class="qe-drive-change" data-qe-drive-name="${rawNameEsc}" data-qe-drive-id="${fileId}" data-qe-drive-is-new="${isNewInDb ? '1' : '0'}">
            <button class="qe-drive-change-toggle" type="button" aria-expanded="false">
                <div class="qe-drive-change-head">
                    <div class="qe-drive-change-name">${name}</div>
                    <div class="qe-drive-change-right">
                        <div class="qe-drive-chip">${reason}</div>
                        ${chevron}
                    </div>
                </div>
            </button>
            <div class="qe-drive-change-panel" hidden>
                <div class="qe-drive-change-meta">${prevRow}${nextRow}</div>
                ${diffShell}
            </div>
        </li>`;
        }).join('');

        const expandAllIcon = `<svg class="qe-drive-expandall-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.60"/><path d="M7 16l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        return `<div class="qe-drive-modal" data-qe-drive-changes="1">
        <div class="qe-drive-summary-row">
            <div class="qe-drive-summary">Wykryto <strong>${escapeHtml(safeList.length)}</strong> plik(ów) zmienionych od ostatniej synchronizacji.</div>
            <button class="qe-drive-expandall" type="button" aria-pressed="false" aria-label="Rozwiń wszystkie kafelki">${expandAllIcon}</button>
        </div>
        <div class="qe-drive-scroll-wrap">
            <div class="qe-drive-scroll" tabindex="0">
                <ul class="qe-drive-changes">${items}</ul>
            </div>
            <div class="qe-drive-scrollbar" aria-hidden="true">
                <div class="qe-drive-scrollbar-thumb"></div>
            </div>
        </div>
        <div class="qe-drive-question">Nadpisać zmienione pliki?</div>
    </div>`;
    }

    function teardown() {
        if (!state) return;
        try { state.abortAll?.(); } catch { }
        state = null;
        try { modalOverlay?.classList.remove('modal-overlay--drive'); } catch { }
    }

    function init({ files, token, api } = {}) {
        const list = Array.isArray(files) ? files : [];
        const accessToken = String(token || '').trim();
        if (!modalOverlay || !modalContent || !api || !accessToken) return;
        const root = modalContent?.querySelector?.('.qe-drive-modal[data-qe-drive-changes="1"]');
        if (!root) return;

        teardown();
        modalOverlay.classList.add('modal-overlay--drive');

        const fileByDomId = new Map();
        for (const f of list) {
            const id = String(f?.id || '').trim();
            const name = String(f?.name || '').trim();
            if (!id || !name) continue;
            fileByDomId.set(id, f);
        }

        const abortControllers = new Set();
        const diffCache = new Map();
        const inFlight = new WeakMap();
        let detachScrollbar = null;

        const abortAll = () => {
            try { detachScrollbar?.(); } catch { }
            for (const c of abortControllers) { try { c.abort(); } catch { } }
            abortControllers.clear();
        };

        state = { abortAll };

        const scrollEl = root.querySelector('.qe-drive-scroll');
        const scrollbarEl = root.querySelector('.qe-drive-scrollbar');
        const scrollbarThumb = root.querySelector('.qe-drive-scrollbar-thumb');
        detachScrollbar = (scrollEl && scrollbarEl && scrollbarThumb) ? attachOverlayScrollbar(scrollEl, scrollbarEl, scrollbarThumb) : null;

        const expandAllBtn = root.querySelector('.qe-drive-expandall');
        const items = Array.from(root.querySelectorAll('.qe-drive-change'));
        for (const el of items) {
            const diff = el.querySelector('.qe-drive-diff');
            if (!diff) continue;
            const initialState = String(diff?.dataset?.qeDiffState || '').trim() || 'idle';
            driveDiffSetStatus(diff, initialState);
            diff.dataset.qeDiffVisible = '0';
            const btn = diff.querySelector('.qe-drive-diff-btn');
            if (btn && !btn.disabled && btn.textContent !== 'Pokaż różnice') btn.textContent = 'Pokaż różnice';
        }

        const setPanelInteractivity = (panelEl, enabled) => {
            if (!panelEl) return;
            try {
                if ('inert' in panelEl) panelEl.inert = !enabled;
            } catch { }
            const focusables = panelEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
            for (const el of focusables) {
                if (!(el instanceof HTMLElement)) continue;
                const tag = String(el.tagName || '').toLowerCase();
                const isButton = tag === 'button';
                if (!enabled) {
                    if (!el.dataset.qePrevTabindex) el.dataset.qePrevTabindex = String(el.getAttribute('tabindex') ?? '');
                    el.setAttribute('tabindex', '-1');
                    if (isButton) {
                        const btn = el;
                        if (!btn.dataset.qePrevDisabled) btn.dataset.qePrevDisabled = btn.disabled ? '1' : '0';
                        btn.disabled = true;
                    }
                } else {
                    const prev = el.dataset.qePrevTabindex;
                    if (prev === '') el.removeAttribute('tabindex');
                    else if (prev) el.setAttribute('tabindex', prev);
                    else el.removeAttribute('tabindex');
                    delete el.dataset.qePrevTabindex;
                    if (isButton) {
                        const btn = el;
                        const wasDisabled = btn.dataset.qePrevDisabled === '1';
                        btn.disabled = wasDisabled;
                        delete btn.dataset.qePrevDisabled;
                    }
                }
            }
        };

        const syncPanelHeight = (itemEl, expanded) => {
            const panel = itemEl?.querySelector?.('.qe-drive-change-panel');
            if (!panel) return;
            if (!expanded) {
                panel.style.setProperty('--qe-drive-panel-max', '0px');
                return;
            }
            const height = panel.scrollHeight;
            panel.style.setProperty('--qe-drive-panel-max', `${height}px`);
        };

        const setExpanded = (itemEl, expanded, { animate = true } = {}) => {
            const btn = itemEl?.querySelector?.('.qe-drive-change-toggle');
            const panel = itemEl?.querySelector?.('.qe-drive-change-panel');
            if (!btn || !panel) return;
            const wasExpanded = itemEl.classList.contains('is-expanded');
            const heightBefore = (!expanded && wasExpanded) ? panel.scrollHeight : 0;
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            itemEl.classList.toggle('is-expanded', expanded);
            if (!animate || prefersReducedMotion?.()) {
                panel.hidden = !expanded;
                panel.style.removeProperty('--qe-drive-panel-max');
                setPanelInteractivity(panel, expanded);
                if (expanded) syncPanelHeight(itemEl, true);
                return;
            }
            panel.hidden = false;
            if (expanded) {
                setPanelInteractivity(panel, true);
                panel.style.setProperty('--qe-drive-panel-max', '0px');
                window.requestAnimationFrame(() => {
                    syncPanelHeight(itemEl, true);
                    scrollEl?.dispatchEvent?.(new Event('scroll'));
                });
                return;
            }
            panel.style.setProperty('--qe-drive-panel-max', `${heightBefore}px`);
            void panel.offsetHeight;
            const onEnd = (e) => {
                if (e && e.propertyName !== 'max-height') return;
                panel.removeEventListener('transitionend', onEnd);
                if (!itemEl.classList.contains('is-expanded')) panel.hidden = true;
                setPanelInteractivity(panel, false);
                scrollEl?.dispatchEvent?.(new Event('scroll'));
            };
            panel.addEventListener('transitionend', onEnd);
            panel.style.setProperty('--qe-drive-panel-max', '0px');
        };

        const computeExpandedState = () => items.every((el) => el.classList.contains('is-expanded'));

        const updateExpandAllUi = () => {
            if (!expandAllBtn) return;
            const allExpanded = computeExpandedState();
            expandAllBtn.setAttribute('aria-pressed', allExpanded ? 'true' : 'false');
            expandAllBtn.setAttribute('aria-label', allExpanded ? 'Zwiń wszystkie kafelki' : 'Rozwiń wszystkie kafelki');
            expandAllBtn.classList.toggle('is-expanded', allExpanded);
        };

        updateExpandAllUi();

        expandAllBtn?.addEventListener?.('click', () => {
            const next = !computeExpandedState();
            for (const el of items) setExpanded(el, next, { animate: true });
            updateExpandAllUi();
            scrollEl?.dispatchEvent?.(new Event('scroll'));
        });

        root.addEventListener('click', async (ev) => {
            const toggle = ev.target?.closest?.('.qe-drive-change-toggle');
            if (toggle) {
                const item = toggle.closest('.qe-drive-change');
                const isExpanded = item?.classList?.contains('is-expanded');
                setExpanded(item, !isExpanded, { animate: true });
                updateExpandAllUi();
                scrollEl?.dispatchEvent?.(new Event('scroll'));
                return;
            }

            const diffBtn = ev.target?.closest?.('.qe-drive-diff-btn');
            if (!diffBtn) return;
            const itemEl = diffBtn.closest('.qe-drive-change');
            const isNewInDb = String(itemEl?.dataset?.qeDriveIsNew || '') === '1';
            const fileId = String(itemEl?.dataset?.qeDriveId || '').trim();
            const fileName = String(itemEl?.dataset?.qeDriveName || '').trim();
            const file = fileByDomId.get(fileId);
            if (!fileId || !fileName || !file) return;

            const diffContainer = itemEl.querySelector('.qe-drive-diff');
            if (!diffContainer) return;
            if (isNewInDb) {
                driveDiffSetStatus(diffContainer, 'blocked');
                return;
            }

            const body = diffContainer.querySelector('.qe-drive-diff-body');
            const visible = String(diffContainer.dataset.qeDiffVisible || '0') === '1';
            if (visible) {
                const inflight = inFlight.get(diffContainer);
                if (diffContainer.dataset.qeDiffState === 'loading' && inflight) {
                    try { inflight.abort(); } catch { }
                }
                if (body) body.hidden = true;
                diffContainer.dataset.qeDiffVisible = '0';
                if (!diffBtn.disabled) diffBtn.textContent = 'Pokaż różnice';
                if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
                scrollEl?.dispatchEvent?.(new Event('scroll'));
                return;
            }

            if (body) body.hidden = false;
            diffContainer.dataset.qeDiffVisible = '1';
            if (!diffBtn.disabled) diffBtn.textContent = 'Ukryj różnice';

            const cacheKey = `${fileId}:${String(file?.driveModifiedAt ?? '')}:${String(file?.previousDriveModifiedAt ?? '')}`;
            if (diffCache.has(cacheKey)) {
                driveDiffApplyResult(diffContainer, diffCache.get(cacheKey));
                driveDiffSetStatus(diffContainer, 'ready');
                if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
                return;
            }

            const abortController = new AbortController();
            abortControllers.add(abortController);
            inFlight.set(diffContainer, abortController);
            try {
                driveDiffSetLoading(diffContainer, true);
                driveDiffSetStatus(diffContainer, 'loading');
                const result = await computeDriveFileDiff({
                    api,
                    token: accessToken,
                    fileId,
                    fileName,
                    signal: abortController.signal
                });
                diffCache.set(cacheKey, result);
                driveDiffApplyResult(diffContainer, result);
                driveDiffSetStatus(diffContainer, 'ready');
                if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
            } catch (err) {
                if (err?.name === 'AbortError') return;
                driveDiffSetError(diffContainer, err?.message ? String(err.message) : 'Błąd generowania różnic');
                driveDiffSetStatus(diffContainer, 'error');
                if (itemEl?.classList?.contains('is-expanded')) syncPanelHeight(itemEl, true);
            } finally {
                abortControllers.delete(abortController);
                inFlight.delete(diffContainer);
                driveDiffSetLoading(diffContainer, false);
                scrollEl?.dispatchEvent?.(new Event('scroll'));
            }
        }, { passive: true });
    }

    function driveDiffSetLoading(container, loading) {
        const body = container.querySelector('.qe-drive-diff-body');
        const err = container.querySelector('.qe-drive-diff-error');
        if (body) body.hidden = false;
        if (err) err.hidden = true;
        if (loading) container.dataset.qeDiffState = 'loading';
        else if (container.dataset.qeDiffState === 'loading') container.dataset.qeDiffState = 'idle';
    }

    function driveDiffSetStatus(container, status) {
        const s = String(status || '').trim();
        const spinnerWrap = container.querySelector('.qe-drive-diff-status-spinner');
        const checkWrap = container.querySelector('.qe-drive-diff-status-check');
        const xWrap = container.querySelector('.qe-drive-diff-status-x');
        if (spinnerWrap) spinnerWrap.hidden = !(s === 'loading' || s === 'idle');
        if (checkWrap) checkWrap.hidden = !(s === 'ready' || s === 'blocked_ok');
        if (xWrap) xWrap.hidden = !(s === 'blocked' || s === 'error');
    }

    function driveDiffSetError(container, message) {
        const body = container.querySelector('.qe-drive-diff-body');
        const err = container.querySelector('.qe-drive-diff-error');
        if (body) body.hidden = false;
        if (err) { err.hidden = false; err.textContent = String(message || 'Błąd'); }
        container.dataset.qeDiffState = 'error';
    }

    function driveDiffApplyResult(container, result) {
        const body = container.querySelector('.qe-drive-diff-body');
        const err = container.querySelector('.qe-drive-diff-error');
        if (body) body.hidden = false;
        if (err) err.hidden = true;
        container.dataset.qeDiffState = 'ready';
        const unified = container.querySelector('.qe-drive-diff-view[data-qe-diff-view=\"unified\"]');
        if (unified) setElementHtml(unified, renderUnifiedRecordDiffHtml(result, { contextLines: 3 }));
        if (unified) unified.hidden = false;
    }

    async function computeDriveFileDiff({ api, token, fileId, fileName, signal } = {}) {
        if (!api || !token || !fileId || !fileName) throw new Error('Brak danych do porównania');
        if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError');

        const oldBlob = await docsGetBlob(fileName);
        if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError');
        const newBuffer = await api.downloadFileArrayBuffer(fileId, token);
        if (signal?.aborted) throw new DOMException('Przerwano', 'AbortError');

        const MAX_DIFF_BYTES = 1_800_000;
        const oldBytes = Number(oldBlob?.size || 0);
        const newBytes = Number(newBuffer?.byteLength || 0);
        if (!oldBlob) {
            return { truncated: false, oldCount: 0, newCount: 0, ops: [], note: 'Brak poprzedniej wersji pliku w bazie. Widok różnic jest niedostępny.' };
        }
        if (oldBytes > MAX_DIFF_BYTES || newBytes > MAX_DIFF_BYTES) {
            return { truncated: false, oldCount: 0, newCount: 0, ops: [], note: 'Plik jest zbyt duży, aby bezpiecznie wygenerować różnice w interfejsie (limit wydajności).' };
        }

        const [oldModel, newModel] = await Promise.all([
            parseTableModelFromSource(oldBlob, fileName),
            parseTableModelFromSource(newBuffer, fileName)
        ]);

        const old = tableModelToRecordList(oldModel);
        const next = tableModelToRecordList(newModel);
        const diff = computeRecordDiff(old.records, next.records);
        const noteParts = [];
        if (old.warnings.length > 0 || next.warnings.length > 0) {
            noteParts.push('Uwaga: wykryto nieprawidłowe lub zduplikowane ID w pierwszej kolumnie; diff może być mniej precyzyjny.');
        }
        return {
            truncated: false,
            oldCount: old.records.length,
            newCount: next.records.length,
            ops: diff.ops,
            note: noteParts.join(' ')
        };
    }

    function hashStringDjb2(input) {
        const s = String(input ?? '');
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return (h >>> 0).toString(36);
    }

    function tryNormalizeRecordId(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const upper = raw.toUpperCase();
        if (/^R\\d{1,6}$/i.test(upper)) return upper;
        return null;
    }

    function extractRecordIdFromRowCells(cells) {
        const row = Array.isArray(cells) ? cells : [];
        const first = tryNormalizeRecordId(row[0]);
        if (first) return { id: first, idIndex: 0, warning: null };
        for (let i = 0; i < row.length; i++) {
            const v = tryNormalizeRecordId(row[i]);
            if (v) return { id: v, idIndex: i, warning: 'ID nie znajduje się w pierwszej kolumnie.' };
        }
        return { id: null, idIndex: -1, warning: 'Brak ID w formacie Rxx.' };
    }

    function selectRecordDataCells(model, rowCells, idIndex) {
        const cells = Array.isArray(rowCells) ? rowCells : [];
        const m = model && typeof model === 'object' ? model : null;
        if (m?.isCompleteStructure && m?.headerMap) {
            const h = m.headerMap;
            const indices = [h.NR_POL, h.GODZ, h.ADRES, h.NAZWA_PLACOWKI, h.UWAGI]
                .filter((v) => Number.isInteger(v) && v >= 0 && v !== idIndex);
            return indices.map((i) => String(cells[i] ?? '').trim());
        }
        const out = [];
        for (let i = 0; i < cells.length; i++) {
            if (i === idIndex) continue;
            out.push(String(cells[i] ?? '').trim());
        }
        return out;
    }

    function tableModelToRecordList(model) {
        const rows = Array.isArray(model?.rows) ? model.rows : [];
        const warnings = [];
        const records = [];
        for (const row of rows) {
            const cells = Array.isArray(row?.cells) ? row.cells : [];
            const { id, idIndex, warning } = extractRecordIdFromRowCells(cells);
            if (warning) warnings.push(warning);
            const dataCells = selectRecordDataCells(model, cells, idIndex);
            const stableId = id ?? `?${hashStringDjb2(`${dataCells.join('\\u241F')}`)}`;
            records.push({
                id: stableId,
                dataCells,
                originalRowIndex: Number(row?.originalRowIndex ?? 0) || 0
            });
        }

        const seen = new Map();
        for (const r of records) {
            const base = String(r.id || '').trim();
            const next = (seen.get(base) ?? 0) + 1;
            seen.set(base, next);
            if (next > 1) {
                r.id = `${base}#${next}`;
                warnings.push('Zduplikowane ID w pliku.');
            }
        }
        return { records, warnings };
    }

    function computeLcsIds(a, b) {
        const A = Array.isArray(a) ? a : [];
        const B = Array.isArray(b) ? b : [];
        const n = A.length;
        const m = B.length;
        const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = A[i] === B[j] ? (dp[i + 1][j + 1] + 1) : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const lcs = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (A[i] === B[j]) {
                lcs.push(A[i]);
                i++; j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
            else j++;
        }
        return lcs;
    }

    function diffIdsUsingLcs(oldIds, newIds) {
        const A = Array.isArray(oldIds) ? oldIds : [];
        const B = Array.isArray(newIds) ? newIds : [];
        const lcs = computeLcsIds(A, B);
        const ops = [];
        let i = 0, j = 0, k = 0;
        while (i < A.length || j < B.length) {
            const target = k < lcs.length ? lcs[k] : null;
            if (target !== null && i < A.length && j < B.length && A[i] === target && B[j] === target) {
                ops.push({ t: 'eq', id: target });
                i++; j++; k++;
                continue;
            }
            if (i < A.length && (target === null || A[i] !== target)) {
                ops.push({ t: 'del', id: A[i] });
                i++;
                continue;
            }
            if (j < B.length && (target === null || B[j] !== target)) {
                ops.push({ t: 'ins', id: B[j] });
                j++;
                continue;
            }
            if (i < A.length) { ops.push({ t: 'del', id: A[i] }); i++; continue; }
            if (j < B.length) { ops.push({ t: 'ins', id: B[j] }); j++; continue; }
        }
        return ops;
    }

    function computeChangedCellIndices(oldCells, newCells) {
        const A = Array.isArray(oldCells) ? oldCells : [];
        const B = Array.isArray(newCells) ? newCells : [];
        const max = Math.max(A.length, B.length);
        const changed = [];
        for (let i = 0; i < max; i++) {
            const a = String(A[i] ?? '').trim();
            const b = String(B[i] ?? '').trim();
            if (a !== b) changed.push(i);
        }
        return changed;
    }

    function computeRecordDiff(oldRecords, newRecords) {
        const oldList = Array.isArray(oldRecords) ? oldRecords : [];
        const newList = Array.isArray(newRecords) ? newRecords : [];
        const oldById = new Map(oldList.map((r) => [String(r?.id ?? ''), r]));
        const newById = new Map(newList.map((r) => [String(r?.id ?? ''), r]));
        const oldIds = oldList.map((r) => String(r?.id ?? ''));
        const newIds = newList.map((r) => String(r?.id ?? ''));

        const baseOps = diffIdsUsingLcs(oldIds, newIds);
        const ops = [];
        for (const op of baseOps) {
            if (!op) continue;
            if (op.t === 'eq') {
                const id = String(op.id ?? '');
                const a = oldById.get(id);
                const b = newById.get(id);
                const oldCells = a?.dataCells ?? [];
                const newCells = b?.dataCells ?? [];
                const changedIdxs = computeChangedCellIndices(oldCells, newCells);
                if (changedIdxs.length > 0) {
                    ops.push({ t: 'del', id, rec: a, peerRec: b, changedIdxs });
                    ops.push({ t: 'ins', id, rec: b, peerRec: a, changedIdxs });
                } else {
                    ops.push({ t: 'eq', id, rec: a });
                }
            } else if (op.t === 'del') {
                const id = String(op.id ?? '');
                const oldRec = oldById.get(id) ?? null;
                const newRec = newById.get(id) ?? null;
                if (oldRec && newRec) {
                    const changedIdxs = computeChangedCellIndices(oldRec?.dataCells ?? [], newRec?.dataCells ?? []);
                    ops.push({ t: 'del', id, rec: oldRec, peerRec: newRec, changedIdxs });
                } else {
                    ops.push({ t: 'del', id, rec: oldRec });
                }
            } else if (op.t === 'ins') {
                const id = String(op.id ?? '');
                const newRec = newById.get(id) ?? null;
                const oldRec = oldById.get(id) ?? null;
                if (oldRec && newRec) {
                    const changedIdxs = computeChangedCellIndices(oldRec?.dataCells ?? [], newRec?.dataCells ?? []);
                    ops.push({ t: 'ins', id, rec: newRec, peerRec: oldRec, changedIdxs });
                } else {
                    ops.push({ t: 'ins', id, rec: newRec });
                }
            }
        }
        return { ops };
    }

    function computeDiffContextSegments(ops, { contextLines } = {}) {
        const list = Array.isArray(ops) ? ops : [];
        const ctx = Math.max(0, Math.min(10, Number(contextLines) || 0));
        if (list.length === 0) return [];
        const segments = [];
        for (let i = 0; i < list.length; i++) {
            if (list[i]?.t === 'eq') continue;
            const start = Math.max(0, i - ctx);
            let end = Math.min(list.length - 1, i + ctx);
            let j = i;
            while (j <= end && j < list.length) {
                if (list[j]?.t !== 'eq') end = Math.min(list.length - 1, j + ctx);
                j += 1;
            }
            if (segments.length > 0) {
                const last = segments[segments.length - 1];
                if (start <= last.end + 1) {
                    last.end = Math.max(last.end, end);
                } else {
                    segments.push({ start, end });
                }
            } else {
                segments.push({ start, end });
            }
            i = end;
        }
        return segments;
    }

    function computeUnifiedColumnWidths(ops, segments) {
        const list = Array.isArray(ops) ? ops : [];
        const segs = Array.isArray(segments) ? segments : [];
        const widths = [];

        for (const seg of segs) {
            const start = Math.max(0, Number(seg?.start ?? 0) || 0);
            const end = Math.min(list.length - 1, Number(seg?.end ?? -1) || -1);
            for (let i = start; i <= end; i++) {
                const op = list[i];
                const rec = op?.rec && typeof op.rec === 'object' ? op.rec : null;
                const dataCells = Array.isArray(rec?.dataCells) ? rec.dataCells : [];
                if (dataCells.length > widths.length) widths.length = dataCells.length;
                for (let c = 0; c < dataCells.length; c++) {
                    const len = String(dataCells[c] ?? '').trim().length;
                    widths[c] = Math.max(Number(widths[c] ?? 0), len);
                }
            }
        }

        for (let i = 0; i < widths.length; i++) widths[i] = Math.max(1, Number(widths[i] ?? 1) || 1);
        return widths;
    }

    function renderRecordLineHtml(op, colWidths) {
        const t = String(op?.t || '');
        const rec = op?.rec && typeof op.rec === 'object' ? op.rec : null;
        const peerRec = op?.peerRec && typeof op.peerRec === 'object' ? op.peerRec : null;
        const dataCells = Array.isArray(rec?.dataCells) ? rec.dataCells : [];
        const peerCells = Array.isArray(peerRec?.dataCells) ? peerRec.dataCells : [];
        const changedIdxs = Array.isArray(op?.changedIdxs) ? op.changedIdxs : [];
        const changedSet = new Set(changedIdxs.map((n) => Number(n)));

        const cellsHtml = [];
        const widths = Array.isArray(colWidths) ? colWidths : [];
        const colCount = Math.max(widths.length, dataCells.length, peerCells.length);
        for (let i = 0; i < colCount; i++) {
            const raw = String(dataCells[i] ?? '').trim();
            const peer = String(peerCells[i] ?? '').trim();
            const v = escapeHtml(raw);
            const w = Math.max(1, Number(widths[i] ?? 1) || 1);
            let cellCls = 'qe-drive-diff-cell';
            if ((t === 'del' || t === 'ins') && changedSet.has(i)) {
                const isEmpty = raw.length === 0;
                const isPeerEmpty = peer.length === 0;
                if (t === 'ins') {
                    if (!isEmpty && isPeerEmpty) cellCls += ' is-changed is-cell-add';
                    else if (!isEmpty && !isPeerEmpty) cellCls += ' is-changed is-cell-add';
                } else if (t === 'del') {
                    if (!isEmpty && isPeerEmpty) cellCls += ' is-changed is-cell-del';
                    else if (!isEmpty && !isPeerEmpty) cellCls += ' is-changed is-cell-del';
                }
            }
            cellsHtml.push(`<span class="${cellCls}" style="min-width:${w}ch;display:inline-block;">${v || '&nbsp;'}</span>`);
            if (i < colCount - 1) cellsHtml.push(`<span class="qe-drive-diff-u-sep"> | </span>`);
        }
        const isCellLevel = (t === 'ins' || t === 'del') && changedIdxs.length > 0;
        const prefix = isCellLevel ? '&nbsp;' : (t === 'ins' ? '+' : (t === 'del' ? '-' : '&nbsp;'));
        const cls = isCellLevel ? 'is-eq' : (t === 'ins' ? 'is-ins' : (t === 'del' ? 'is-del' : 'is-eq'));
        return `<div class="qe-drive-diff-u-row ${cls}"><div class="qe-drive-diff-u-prefix" aria-hidden="true">${prefix}</div><div class="qe-drive-diff-u-cells">${cellsHtml.join('')}</div></div>`;
    }

    function renderRecordModificationLineHtml(delOp, insOp, colWidths) {
        const oldRec = delOp?.rec && typeof delOp.rec === 'object' ? delOp.rec : null;
        const newRec = insOp?.rec && typeof insOp.rec === 'object' ? insOp.rec : null;
        const oldCells = Array.isArray(oldRec?.dataCells) ? oldRec.dataCells : [];
        const newCells = Array.isArray(newRec?.dataCells) ? newRec.dataCells : [];
        const widths = Array.isArray(colWidths) ? colWidths : [];
        const colCount = Math.max(widths.length, oldCells.length, newCells.length);
        const cellsHtml = [];

        for (let i = 0; i < colCount; i++) {
            const rawOld = String(oldCells[i] ?? '').trim();
            const rawNew = String(newCells[i] ?? '').trim();
            const w = Math.max(1, Number(widths[i] ?? 1) || 1);

            if (rawOld === rawNew) {
                const v = escapeHtml(rawNew);
                cellsHtml.push(`<span class="qe-drive-diff-cell" style="min-width:${w}ch;display:inline-block;">${v || '&nbsp;'}</span>`);
            } else {
                const oldEmpty = rawOld.length === 0;
                const newEmpty = rawNew.length === 0;
                if (oldEmpty && !newEmpty) {
                    const vNew = escapeHtml(rawNew);
                    cellsHtml.push(`<span class="qe-drive-diff-cell is-changed is-cell-add" style="min-width:${w}ch;display:inline-block;">${vNew || '&nbsp;'}</span>`);
                } else if (!oldEmpty && newEmpty) {
                    const vOld = escapeHtml(rawOld);
                    cellsHtml.push(`<span class="qe-drive-diff-cell is-changed is-cell-del" style="min-width:${w}ch;display:inline-block;">${vOld || '&nbsp;'}</span>`);
                } else {
                    const vOld = escapeHtml(rawOld);
                    const vNew = escapeHtml(rawNew);
                    cellsHtml.push(
                        `<span class="qe-drive-diff-cell is-cell-mod" style="min-width:${w}ch;display:inline-block;">` +
                        `<span class="qe-drive-diff-cell-delta is-old is-changed">${vOld || '&nbsp;'}</span>` +
                        `<span class="qe-drive-diff-cell-arrow" aria-hidden="true">→</span>` +
                        `<span class="qe-drive-diff-cell-delta is-new is-changed">${vNew || '&nbsp;'}</span>` +
                        `</span>`
                    );
                }
            }

            if (i < colCount - 1) cellsHtml.push(`<span class="qe-drive-diff-u-sep"> | </span>`);
        }

        return `<div class="qe-drive-diff-u-row is-eq"><div class="qe-drive-diff-u-prefix" aria-hidden="true">&nbsp;</div><div class="qe-drive-diff-u-cells">${cellsHtml.join('')}</div></div>`;
    }

    function renderUnifiedRecordDiffHtml(result, { contextLines } = {}) {
        const ops = Array.isArray(result?.ops) ? result.ops : [];
        const note = String(result?.note || '').trim();
        const ctx = Math.max(0, Math.min(999, Number(contextLines) || 0));
        const segments = ctx >= 999 ? (ops.length > 0 ? [{ start: 0, end: ops.length - 1 }] : []) : computeDiffContextSegments(ops, { contextLines: ctx });
        const widths = computeUnifiedColumnWidths(ops, segments);
        const rows = [];
        if (note) rows.push(`<div class="qe-drive-diff-note">${escapeHtml(note)}</div>`);
        rows.push('<div class="qe-drive-diff-unified"><div class="qe-drive-diff-unified-scroll"><div class="qe-drive-diff-unified-body">');
        if (segments.length === 0) {
            rows.push('<div class="qe-drive-diff-u-empty">Brak różnic</div>');
        } else {
            let lastEnd = -1;
            for (const seg of segments) {
                if (lastEnd >= 0 && seg.start > lastEnd + 1) rows.push('<div class="qe-drive-diff-u-gap">…</div>');
                for (let i = seg.start; i <= seg.end; i++) {
                    const op = ops[i];
                    const next = i + 1 <= seg.end ? ops[i + 1] : null;
                    const isDelMod = op?.t === 'del' && Array.isArray(op?.changedIdxs) && op.changedIdxs.length > 0;
                    const isInsMod = next?.t === 'ins' && Array.isArray(next?.changedIdxs) && next.changedIdxs.length > 0;
                    const sameId = String(op?.id ?? '') && String(op?.id ?? '') === String(next?.id ?? '');
                    if (isDelMod && isInsMod && sameId) {
                        rows.push(renderRecordModificationLineHtml(op, next, widths));
                        i += 1;
                        continue;
                    }
                    rows.push(renderRecordLineHtml(op, widths));
                }
                lastEnd = seg.end;
            }
        }
        rows.push('</div></div></div>');
        return rows.join('\n');
    }

    function attachOverlayScrollbar(scrollEl, trackEl, thumbEl) {
        let raf = 0;
        let hideTimer = 0;
        let dragging = false;
        let dragStartY = 0;
        let dragStartScrollTop = 0;

        const show = () => {
            trackEl.classList.add('is-visible');
            if (hideTimer) window.clearTimeout(hideTimer);
            hideTimer = window.setTimeout(() => trackEl.classList.remove('is-visible'), 1100);
        };

        const update = () => {
            raf = 0;
            const height = scrollEl.clientHeight;
            const total = scrollEl.scrollHeight;
            const canScroll = total > height + 1;
            trackEl.hidden = !canScroll;
            if (!canScroll) return;

            const ratio = height / total;
            const thumbMin = 36;
            const thumbH = Math.max(thumbMin, Math.round(height * ratio));
            const maxThumbTop = Math.max(1, height - thumbH);
            const maxScrollTop = Math.max(1, total - height);
            const thumbTop = Math.round((scrollEl.scrollTop / maxScrollTop) * maxThumbTop);

            thumbEl.style.height = `${thumbH}px`;
            thumbEl.style.transform = `translateY(${thumbTop}px)`;
        };

        const schedule = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(update);
        };

        const onScroll = () => { show(); schedule(); };

        const onPointerDownThumb = (e) => {
            dragging = true;
            dragStartY = e.clientY;
            dragStartScrollTop = scrollEl.scrollTop;
            thumbEl.setPointerCapture?.(e.pointerId);
            show();
            e.preventDefault();
        };

        const onPointerMove = (e) => {
            if (!dragging) return;
            const height = scrollEl.clientHeight;
            const total = scrollEl.scrollHeight;
            const ratio = height / total;
            const thumbMin = 36;
            const thumbH = Math.max(thumbMin, Math.round(height * ratio));
            const maxThumbTop = Math.max(1, height - thumbH);
            const maxScrollTop = Math.max(1, total - height);
            const deltaY = e.clientY - dragStartY;
            const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop;
            scrollEl.scrollTop = dragStartScrollTop + scrollDelta;
            show();
            schedule();
        };

        const onPointerUp = (e) => {
            if (!dragging) return;
            dragging = false;
            try { thumbEl.releasePointerCapture?.(e.pointerId); } catch { }
            show();
        };

        const onTrackPointerDown = (e) => {
            if (e.target === thumbEl) return;
            const rect = trackEl.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const height = scrollEl.clientHeight;
            const total = scrollEl.scrollHeight;
            const ratio = height / total;
            const thumbMin = 36;
            const thumbH = Math.max(thumbMin, Math.round(height * ratio));
            const maxThumbTop = Math.max(1, height - thumbH);
            const maxScrollTop = Math.max(1, total - height);
            const targetThumbTop = Math.max(0, Math.min(maxThumbTop, y - (thumbH / 2)));
            scrollEl.scrollTop = (targetThumbTop / maxThumbTop) * maxScrollTop;
            show();
            schedule();
        };

        const ro = new ResizeObserver(() => schedule());
        ro.observe(scrollEl);

        scrollEl.addEventListener('scroll', onScroll, { passive: true });
        scrollEl.addEventListener('pointerenter', show, { passive: true });
        scrollEl.addEventListener('pointermove', show, { passive: true });
        trackEl.addEventListener('pointerenter', show, { passive: true });
        trackEl.addEventListener('pointermove', show, { passive: true });
        thumbEl.addEventListener('pointerdown', onPointerDownThumb);
        trackEl.addEventListener('pointerdown', onTrackPointerDown);
        const onTrackWheel = (e) => {
            scrollEl.scrollTop += e.deltaY;
            show();
            schedule();
            e.preventDefault();
        };
        trackEl.addEventListener('wheel', onTrackWheel, { passive: false });
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);

        schedule();
        return () => {
            try { if (raf) window.cancelAnimationFrame(raf); } catch { }
            try { if (hideTimer) window.clearTimeout(hideTimer); } catch { }
            try { ro.disconnect(); } catch { }
            try { scrollEl.removeEventListener('scroll', onScroll); } catch { }
            try { scrollEl.removeEventListener('pointerenter', show); } catch { }
            try { scrollEl.removeEventListener('pointermove', show); } catch { }
            try { thumbEl.removeEventListener('pointerdown', onPointerDownThumb); } catch { }
            try { trackEl.removeEventListener('pointerdown', onTrackPointerDown); } catch { }
            try { trackEl.removeEventListener('wheel', onTrackWheel); } catch { }
            try { trackEl.removeEventListener('pointerenter', show); } catch { }
            try { trackEl.removeEventListener('pointermove', show); } catch { }
            try { window.removeEventListener('pointermove', onPointerMove); } catch { }
            try { window.removeEventListener('pointerup', onPointerUp); } catch { }
        };
    }

    return {
        buildChangesModalHtml: buildDriveChangesModalHtml,
        init,
        teardown
    };
}
