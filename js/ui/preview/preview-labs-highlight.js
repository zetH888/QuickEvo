export function highlightLabsInPreviewTableDom(cfg) {
    const tbody = cfg?.tbody || null;
    const rowMatchesKeyLab = typeof cfg?.rowMatchesKeyLab === 'function' ? cfg.rowMatchesKeyLab : (() => false);
    const escapeHtml = typeof cfg?.escapeHtml === 'function' ? cfg.escapeHtml : ((x) => String(x ?? ''));
    const toTitleCase = typeof cfg?.toTitleCase === 'function' ? cfg.toTitleCase : ((x) => String(x || ''));

    if (!tbody || !tbody.rows) return;

    for (let r = 0; r < tbody.rows.length; r++) {
        const tr = tbody.rows[r];
        let rowText = '';
        for (let c = 0; c < tr.cells.length; c++) rowText += ` ${tr.cells[c]?.textContent || ''}`;
        const isLab = rowMatchesKeyLab(rowText);
        tr.classList.toggle('highlight-lab', isLab);
        if (isLab) {
            const facilityCell = tr.querySelector('.facility-column');
            if (facilityCell && !facilityCell.querySelector('.lab-badge')) {
                facilityCell.innerHTML = `<span class="lab-badge">${escapeHtml(toTitleCase(facilityCell.textContent))}</span>`;
            }
        }
    }
}

