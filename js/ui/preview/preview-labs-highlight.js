/** Wyróżnia laboratoria na podstawie źródłowej nazwy placówki. */
export function highlightLabsInPreviewTableDom({ tbody, getLabLabel }) {
    if (!tbody?.rows) return;
    for (const row of tbody.rows) {
        const cell = row.querySelector('.facility-column');
        if (!cell) continue;
        const badge = cell.querySelector('.lab-badge');
        const original = badge ? cell.dataset.originalText ?? cell.textContent : cell.textContent;
        const label = getLabLabel(original);
        row.classList.toggle('highlight-lab', Boolean(label));
        if (label) {
            const span = badge || cell.ownerDocument.createElement('span');
            span.className = 'lab-badge';
            span.textContent = label;
            cell.dataset.originalText = original;
            if (!badge) cell.replaceChildren(span);
        } else {
            if (badge) cell.textContent = original;
            delete cell.dataset.originalText;
        }
    }
}
