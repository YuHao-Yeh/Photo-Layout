// UI text in English and Traditional Chinese. Static text in index.html is
// tagged with data-i18n="key"; script messages call t(key, values).

export const LANGUAGES = ['en', 'zh-Hant'];

export const STRINGS = {
  en: {
    appTitle: 'Photo Layout',
    switchLanguage: '中文',
    switchLanguageLabel: 'Switch to Traditional Chinese',
    emptyTitle: 'Lay out 2–12 photos on one page',
    emptyHint:
      'Photos are arranged, scaled and rotated automatically to fill the paper. ' +
      'Afterwards, tap a photo to move, zoom, rotate or swap it, and drag the ' +
      'lines between photos to resize the frames.',
    addPhotos: 'Add photos',
    loading: 'Loading photos…',
    add: 'Add',
    layout: 'Layout',
    paper: 'Paper',
    export: 'Export',
    rotate: 'Rotate',
    smaller: 'Smaller',
    larger: 'Larger',
    reset: 'Reset',
    swap: 'Swap',
    remove: 'Remove',
    done: 'Done',
    close: 'Close',
    size: 'Size',
    custom: 'Custom',
    width: 'Width (mm)',
    height: 'Height (mm)',
    orientation: 'Orientation',
    portrait: 'Portrait',
    landscape: 'Landscape',
    bestFit: 'Best fit',
    margin: 'Margin',
    gap: 'Space between photos',
    allowRotate: 'Rotate photos to fit better',
    background: 'Background',
    quality: 'Quality',
    dpiStandard: 'Standard (150 dpi)',
    dpiPrint: 'Print (300 dpi)',
    createPdf: 'Create PDF',
    createJpg: 'Create JPG',
    share: 'Share / Save…',
    download: 'Download',
    photoCount: ({ n }) => `${n} photo${n === 1 ? '' : 's'}`,
    tooLarge: 'The margin and spacing are too large for this paper size.',
    maxPhotos: ({ max }) => `A page holds at most ${max} photos.`,
    partialAdd: ({ room, max }) => `Only the first ${room} photo(s) were added; the limit is ${max}.`,
    openFailed: ({ n }) => `${n} file(s) could not be opened.`,
    addOneMore: 'Add at least one more photo.',
    swapHint: 'Tap the photo to swap with.',
    rendering: 'Rendering…',
    ready: ({ name, mb }) => `${name} is ready (${mb} MB).`,
    exportFailed: 'Export failed. Try the Standard quality setting.',
    shareFailed: 'Sharing failed. Use Download instead.',
  },
  'zh-Hant': {
    appTitle: '相片排版',
    switchLanguage: 'EN',
    switchLanguageLabel: '切換為英文',
    emptyTitle: '將 2–12 張相片排在同一頁',
    emptyHint:
      '相片會自動排列、縮放和旋轉，填滿整張紙。' +
      '之後可以點選相片來移動、縮放、旋轉或交換，也可以拖曳相片之間的分隔線來調整相框大小。',
    addPhotos: '加入相片',
    loading: '正在載入相片…',
    add: '加入',
    layout: '版面',
    paper: '紙張',
    export: '匯出',
    rotate: '旋轉',
    smaller: '縮小',
    larger: '放大',
    reset: '重設',
    swap: '交換',
    remove: '移除',
    done: '完成',
    close: '關閉',
    size: '尺寸',
    custom: '自訂',
    width: '寬度 (mm)',
    height: '高度 (mm)',
    orientation: '方向',
    portrait: '直向',
    landscape: '橫向',
    bestFit: '自動最佳',
    margin: '邊界',
    gap: '相片間距',
    allowRotate: '旋轉相片以更貼合版面',
    background: '背景顏色',
    quality: '品質',
    dpiStandard: '標準 (150 dpi)',
    dpiPrint: '列印 (300 dpi)',
    createPdf: '製作 PDF',
    createJpg: '製作 JPG',
    share: '分享／儲存…',
    download: '下載',
    photoCount: ({ n }) => `${n} 張相片`,
    tooLarge: '邊界和間距對這個紙張尺寸來說太大了。',
    maxPhotos: ({ max }) => `每頁最多 ${max} 張相片。`,
    partialAdd: ({ room, max }) => `只加入了前 ${room} 張相片，上限是 ${max} 張。`,
    openFailed: ({ n }) => `有 ${n} 個檔案無法開啟。`,
    addOneMore: '請再加入至少一張相片。',
    swapHint: '請點選要交換的相片。',
    rendering: '正在產生檔案…',
    ready: ({ name, mb }) => `${name} 已完成（${mb} MB）。`,
    exportFailed: '匯出失敗，請改用「標準」品質再試一次。',
    shareFailed: '分享失敗，請改用「下載」。',
  },
};

let current = 'en';

/** Traditional Chinese for any Chinese device language, otherwise English. */
export function detectLanguage() {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  return langs.some((l) => /^zh/i.test(l)) ? 'zh-Hant' : 'en';
}

export function t(key, values = {}) {
  const entry = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  return typeof entry === 'function' ? entry(values) : entry;
}

/** Switches the language and rewrites every tagged element on the page. */
export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : 'en';
  document.documentElement.lang = current;
  document.title = t('appTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  }
  return current;
}
