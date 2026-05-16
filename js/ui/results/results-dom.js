export function updateResultsCountInfoDom(resultsInfoEl, { matchedCount = 0, loadedFileCount = 0 } = {}) {
    if (!resultsInfoEl) return;
    const a = Number.isFinite(matchedCount) ? matchedCount : 0;
    const b = Number.isFinite(loadedFileCount) ? loadedFileCount : 0;
    resultsInfoEl.innerHTML = `Trasy: ${a} / ${b}`;
}

export async function prepareResultsListDom(resultsListEl, { append = false, reduceMotion = false, exitClass = 'qe-results-exiting', exitDelayMs = 160 } = {}) {
    if (!resultsListEl) return;
    if (!append && resultsListEl.children.length > 0 && !reduceMotion) {
        resultsListEl.classList.add(exitClass);
        await new Promise(resolve => window.setTimeout(resolve, Math.max(0, Number(exitDelayMs) || 0)));
        resultsListEl.classList.remove(exitClass);
        resultsListEl.replaceChildren();
        return;
    }
    if (!append) {
        resultsListEl.replaceChildren();
    }
}

