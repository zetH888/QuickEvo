/**
 * @module ui-components
 *
 * Warstwa zgodności wstecznej: publiczny interfejs pozostaje bez zmian,
 * a implementacje są rozbite na wyspecjalizowane moduły w `ui/loading`, `ui/results`, `ui/preview`.
 */

export { LoadingTitleRotator, animateLoadingTitleSwap, getLoadingTitleCategoryForProgress, pickRandomNonRepeating, setLoadingTitleContent } from './loading/loading-title.js';
export { createLoadingProgressController } from './loading/loading-progress-controller.js';
export { applyWelcomeElementsInitStateDom, clearLoadingErrorDom, clearWelcomeElementsInitStateDom, hideLoadingOverlayDom, scheduleWelcomeLogoEntranceDom, setLoadingStatusTextDom, setLoadingTitleTextDom, showLoadingErrorDom, showLoadingOverlayDom } from './loading/loading-overlay-dom.js';
export { createWelcomeProgressRenderer } from './loading/welcome-progress-renderer.js';
export { createLogoRenderer } from './loading/logo-renderer.js';

export { createModalController } from './preview/modal-controller.js';
export { createPreviewController } from './preview/preview-controller.js';
export { highlightLabsInPreviewTableDom } from './preview/preview-labs-highlight.js';

export { createScheduleController } from './schedule-controller.js';

export { createResultsCategoryController } from './results/results-category-controller.js';
export { createResultsRenderer } from './results/results-renderer.js';
export { prepareResultsListDom, updateResultsCountInfoDom } from './results/results-dom.js';

export { createImportSummaryRenderer } from './import/import-summary-renderer.js';
