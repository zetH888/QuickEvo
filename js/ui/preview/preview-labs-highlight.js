/**
 * Podświetla wiersze „laboratorium” w tabeli podglądu.
 *
 * Reguła bezpieczeństwa: dopasowanie wykonuje wyłącznie na nazwie placówki (kolumna .facility-column),
 * aby tokeny występujące w innych kolumnach (np. „do lab. Dzika” w uwagach) nie aktywowały badge.
 */
export function highlightLabsInPreviewTableDom(cfg) {
    const tbody = cfg?.tbody || null;
    const rowMatchesKeyLab = typeof cfg?.rowMatchesKeyLab === 'function' ? cfg.rowMatchesKeyLab : (() => false);
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const toTitleCase = typeof cfg?.toTitleCase === 'function' ? cfg.toTitleCase : ((x) => String(x || ''));
    const getFacilityTextFromRow = typeof cfg?.getFacilityTextFromRow === 'function'
        ? cfg.getFacilityTextFromRow
        : (tr) => {
            const cell = tr?.querySelector?.('.facility-column') || null;
            return cell ? String(cell.textContent || '') : '';
        };

    if (!tbody || !tbody.rows) return;

    for (let r = 0; r < tbody.rows.length; r++) {
        const tr = tbody.rows[r];
        const facilityText = getFacilityTextFromRow(tr);
        const isLab = rowMatchesKeyLab(facilityText);
        tr.classList.toggle('highlight-lab', isLab);

        const facilityCell = tr.querySelector?.('.facility-column') || null;
        if (!facilityCell) continue;

        const existingBadge = facilityCell.querySelector?.('.lab-badge') || null;
        if (isLab) {
            if (!existingBadge) {
                facilityCell.dataset.originalText = String(facilityCell.textContent || '');
                facilityCell.innerHTML = `<span class="lab-badge">${escapeHtml(toTitleCase(facilityCell.dataset.originalText))}</span>`;
            }
        } else {
            if (existingBadge) {
                const original = String(facilityCell.dataset.originalText || '');
                facilityCell.textContent = original;
                delete facilityCell.dataset.originalText;
            }
        }
    }
}
