# 相片排版 Photo Layout — 技術手冊

> 適用版本：2026 年 10 月（`main` 分支）
> 對象：要維護、修改或擴充本專案的開發者

---

## 目錄

1. [專案概述](#1-專案概述)
2. [技術選型](#2-技術選型)
3. [目錄結構](#3-目錄結構)
4. [整體架構與資料流](#4-整體架構與資料流)
5. [核心資料結構](#5-核心資料結構)
6. [版面引擎 layout.js](#6-版面引擎-layoutjs)
7. [繪製與座標系統 render.js](#7-繪製與座標系統-renderjs)
8. [互動與手勢](#8-互動與手勢)
9. [調色 adjust.js](#9-調色-adjustjs)
10. [匯出：JPG 與 PDF](#10-匯出jpg-與-pdf)
11. [多語系 i18n.js](#11-多語系-i18njs)
12. [主題系統](#12-主題系統)
13. [設定與儲存](#13-設定與儲存)
14. [離線支援（PWA）](#14-離線支援pwa)
15. [資訊安全](#15-資訊安全)
16. [開發、測試與部署](#16-開發測試與部署)
17. [常數一覽](#17-常數一覽)
18. [擴充指南](#18-擴充指南)
19. [已知限制](#19-已知限制)

---

## 1. 專案概述

相片排版是一個**純前端網站**：使用者選擇 2–12 張尺寸不一的相片，程式自動把它們排列、縮放、旋轉，填滿一整張紙（預設 A4），再匯出成 PDF 或 JPG。主要在 iPhone / iPad 的 Safari 上使用，也支援電腦瀏覽器。

主要功能：

| 功能 | 說明 |
| --- | --- |
| 自動排版 | 以「切割樹」搜尋最少裁切的版面，「版面」按鈕可切換多種候選版面 |
| 紙張設定 | A3、A4、A5、Letter、Legal、4×6 in、5×7 in 或自訂尺寸；直向／橫向／自動最佳；邊界、間距、紙張底色 |
| 單張編輯 | 拖曳移動、雙指縮放、旋轉、完整顯示（雙擊）、交換、更換、移除 |
| 調整相框 | 拖曳相片之間的分隔線，兩側相框同時改變大小，頁面始終填滿 |
| 調色 | 亮度、對比、飽和度、色溫，以及原圖／黑白／鮮豔／暖色／冷色預設 |
| 頁面縮放 | 雙指、滑鼠滾輪、觸控板、− 100% + 控制項、鍵盤 + / − / 0 |
| 匯出 | 依紙張實際尺寸輸出 PDF 或 JPG（150 / 300 dpi） |
| 介面 | 英文／繁體中文切換；五種主題；適應手機、平板、筆電、大螢幕 |

**隱私原則：相片永遠不離開使用者的裝置。** 程式碼中沒有任何網路請求，所有運算都在瀏覽器內完成。

---

## 2. 技術選型

| 項目 | 選擇 | 原因 |
| --- | --- | --- |
| 語言 | 原生 JavaScript（ES Modules）、HTML、CSS | 不需編譯、不需框架，直接部署成靜態檔案 |
| 繪圖 | Canvas 2D | 預覽與匯出共用同一套繪圖程式，所見即所得 |
| PDF | 自寫最小 PDF 產生器（`js/pdf.js`） | 只需「一頁一張 JPEG」，不必引入大型函式庫 |
| 調色 | 自寫像素處理（`js/adjust.js`） | Canvas 的 `filter` 屬性在 Safari 要 iOS 18 才支援 |
| 外部套件 | **無** | 沒有供應鏈風險，可套用嚴格的內容安全政策（CSP） |
| 測試 | Node.js 內建 `node --test` | 不需安裝任何套件 |
| 部署 | GitHub Pages | 免費、HTTPS、推送即上線 |

開發環境只需要 Node.js 18 以上。

---

## 3. 目錄結構

```
photo-layout/
├── index.html            頁面結構：工具列、對話框、CSP 標籤
├── manifest.webmanifest  加入主畫面用的 App 資訊
├── sw.js                 Service Worker：離線快取
├── css/
│   ├── app.css           基本樣式（簡約主題、亮／暗色、各種螢幕尺寸）
│   └── themes.css        Frutiger Aero 三種主題、方塊主題、主題選擇器
├── img/                  主題背景圖（手繪 SVG）
├── icons/                App 圖示（由 scripts/make-icons.mjs 產生）
├── js/
│   ├── app.js            主程式：狀態、介面、手勢、設定、匯出
│   ├── layout.js         版面引擎（不依賴 DOM，可在 Node 測試）
│   ├── render.js         把版面畫到 Canvas（預覽與匯出共用）
│   ├── adjust.js         調色的像素運算
│   ├── pdf.js            最小 PDF 產生器
│   ├── i18n.js           英文／繁體中文字串
│   └── theme-boot.js     在畫面出現前套用已儲存的主題
├── scripts/
│   ├── serve.mjs         本機開發伺服器（區網內手機可連線）
│   └── make-icons.mjs    產生 PNG 圖示（不需影像函式庫）
├── tests/                單元測試
├── doc/                  文件（本手冊）
├── README.md             英文說明
└── SECURITY.md           資安說明
```

---

## 4. 整體架構與資料流

```
 使用者選相片 (input[type=file])
        │
        ▼
 loadPhoto()  ── 解碼、預覽用縮小到約 350 萬像素（保留原檔）──►  state.photos[]
        │                                         { img, original, aspect, adjust }
        ▼
 regenerate()  ── generateLayouts(aspects, page) ──►  state.layouts[]（候選版面）
        │
        ▼
 showLayout(i) ── 複製切割樹、建立 cells ──►  state.tree / state.cells / state.dividers
        │
        ▼
 draw()  ── drawPage(ctx, page, cells, photos, 縮放比例) ──►  預覽畫布
        │
        ▼
 使用者操作（手勢、工具列、設定）
        │   修改 cells（平移、縮放、旋轉）、tree（分隔線位置）、photos（調色、更換）
        ▼
 requestDraw()  ──►  下一個畫面更新時重畫
        │
        ▼
 匯出：renderExportCanvas() 重新讀取原檔，以列印解析度逐張重畫 ──► JPEG ──►（PDF：buildPdf 包裝）
```

模組相依關係：

```
app.js ──► layout.js   （純運算）
       ──► render.js   （純繪圖）
       ──► adjust.js   （純運算）
       ──► pdf.js      （純運算）
       ──► i18n.js     （字串與 DOM 套用）
```

`layout.js`、`adjust.js`、`pdf.js` 完全不碰 DOM，因此都能在 Node.js 中做單元測試。

---

## 5. 核心資料結構

### 5.1 `state`（app.js）

| 欄位 | 說明 |
| --- | --- |
| `photos` | 已載入的相片陣列（見 5.2） |
| `settings` | 使用者設定（見第 13 節） |
| `layouts` / `layoutIndex` | 候選版面與目前顯示的索引 |
| `layoutsStale` | 更換相片後為 `true`，下次按「版面」會重新計算 |
| `page` | 目前紙張：`{ width, height, margin, gap }`，單位公釐 |
| `tree` | 目前版面的切割樹副本（分隔線拖曳會修改它的 `split`） |
| `treeAspects` | 建立版面時的相片長寬比；更換相片後相框位置仍依此計算 |
| `cells` | 每個相框的位置與使用者編輯（見 5.3） |
| `dividers` | 每條分隔線的位置，用於拖曳 |
| `selected` / `swapFrom` | 選取中的相框、等待交換的相框（-1 表示無） |
| `adjusting` / `cellGroup` | 調色面板是否開啟、工具列開啟的第二列 |
| `view` | 預覽視角：`{ k, dpr, zoom, cx, cy, w, h }`（見第 7 節） |
| `language` / `shadowColor` | 目前語言、頁面陰影顏色（隨主題變化） |

### 5.2 相片物件

```js
{
  img,        // 實際繪製的畫布：原圖，或調色後的副本
  original,   // 縮小後的原始畫布（永不修改，調色重設時無損還原）
  aspect,     // 寬 / 高
  adjust,     // { brightness, contrast, saturation, warmth }，各 -100..100
  preview,    // 拖曳滑桿時使用的小尺寸調色畫布（重複使用）
  adjusted,   // 全尺寸調色畫布（重複使用）
}
```

### 5.3 相框 cell

```js
{
  photo,      // 對應 state.photos 的索引
  rotated,    // 版面引擎是否把相片轉 90° 以減少裁切
  x, y, w, h, // 位置與大小（公釐，含邊界偏移）
  rot,        // 0 / 90 / 180 / 270，相片在框內的順時針旋轉
  fit,        // false = 填滿相框（會裁切）；true = 完整顯示
  zoom,       // ≥ 1，1 表示剛好填滿（或剛好完整顯示）
  panX, panY, // -1..1，相片在可移動範圍內的位置
}
```

---

## 6. 版面引擎 layout.js

### 6.1 切割樹

版面以**切割樹（slicing tree / guillotine cut）**表示：

- **內部節點**把矩形切成兩半：`dir: 'h'` 左右並排，`dir: 'v'` 上下堆疊。
- **葉節點**是一張相片：`{ photo, rotated }`。

因為每張相片的長寬比已知，整棵樹有一個精確的「自然長寬比」：

```
左右並排：a = a1 + a2
上下堆疊：1/a = 1/a1 + 1/a2
```

如果樹的自然長寬比剛好等於紙張的可用區域，相片就能完全不裁切地填滿頁面。引擎的工作就是找出這樣的樹。

### 6.2 擺放 `place()`

由上而下分配矩形：左右並排時，扣掉間距後按子樹長寬比分配寬度；上下堆疊時按長寬比倒數分配高度。若節點有 `split`（0..1，使用者拖曳分隔線產生），就改用 `split` 決定第一個子節點佔的比例。

如果樹的長寬比和頁面不完全吻合，差異會**平均分攤**到所有相片，而不是集中在某一張。

### 6.3 搜尋演算法

`generateLayouts(aspects, page, options)`：

1. **隨機重新開始** `restarts = 120` 次：每次打亂相片順序，建立一棵隨機樹（分割點偏向中間，每張相片有 25% 機率先旋轉）。
2. 每棵樹做 `steps = 80` 步**爬山法**，每步隨機選一種變異：

   | 機率 | 變異 |
   | --- | --- |
   | 35% | 翻轉某節點的方向（h ↔ v） |
   | 25% | 交換兩張相片的位置 |
   | 15% | 切換某張相片是否旋轉（允許旋轉時） |
   | 其餘 | 樹旋轉 `(A,(B,C)) → ((A,B),C)`，或交換子節點 |

   分數不變差就接受新樹。
3. 每次重新開始的最佳結果依**粗略幾何指紋**去重（座標量化為頁面的 1/20），避免候選版面只差一公釐。
4. 依分數排序，取前 `maxResults = 12` 個。

在一般電腦上一次搜尋約 10 ms。亂數產生器 `createRng(seed)` 可重現，相同種子得到相同結果。

### 6.4 評分（分數越低越好）

```
分數 = 加權平均裁切比例
     + 0.5  × 最大單張裁切比例          （WEIGHT_MAX_CROP，避免某張被裁太多）
     + 0.25 × 相片大小的變異係數        （WEIGHT_SIZE_SPREAD，避免大小懸殊）
     + 0.01 × 旋轉的相片數              （WEIGHT_ROTATION，略偏好正向）
```

單張裁切比例 `cropLoss(框長寬比, 相片長寬比) = 1 − min(c/p, p/c)`。任何相框小於 1 mm（`MIN_CELL`）的版面直接淘汰。

app.js 在「自動最佳」方向時會分別搜尋直向和橫向，合併後排序；只保留分數不超過最佳 +0.3（`ALTERNATIVE_SCORE_RANGE`）的候選版面。

### 6.5 對外函式

| 函式 | 用途 |
| --- | --- |
| `generateLayouts(aspects, page, options)` | 產生候選版面，每個含 `page`、`tree`、`cells`、`score` |
| `layoutTree(tree, aspects, page)` | 依樹（含使用者的 `split`）重新擺放，回傳 `cells` 與 `dividers` |
| `splitAt(divider, pos, gap)` | 分隔線要通過位置 `pos` 時，對應的 `split` 值 |
| `cloneTree(tree)` | 深層複製（含 `split`） |
| `cropLoss` / `shouldRotate` | 裁切比例、是否應旋轉 90° |
| `PAPER_SIZES` | 內建紙張尺寸（公釐） |

### 6.6 分隔線拖曳

`moveDivider()`（app.js）把拖曳位置換成 `split`，重新呼叫 `layoutTree()`。若有相框小於 `MIN_FRAME_MM = 8` mm，會用二分法找出最接近目標、又不違反最小尺寸的位置，讓分隔線剛好停在極限上。相框順序固定，因此每張相片的平移、縮放、旋轉設定都會保留。

---

## 7. 繪製與座標系統 render.js

### 7.1 單位

- **頁面座標**：公釐，原點在紙張左上角。
- **畫面座標**：CSS 像素。轉換比例 `K = k × zoom`：
  - `k`：剛好放下整頁時的比例（`resize()` 計算，四周留白 `max(12, 短邊 × 4%)`）
  - `zoom`：使用者的頁面縮放，1–6（`MAX_VIEW_ZOOM`）
- `(cx, cy)`：位於預覽區中央的頁面座標。頁面原點在畫面上的位置：

  ```
  x0 = w/2 − cx × K
  y0 = h/2 − cy × K
  ```

- 實際畫布像素再乘以 `dpr`（裝置像素比，上限 3）。

預覽畫布**永遠等於預覽區大小**，放大時只改變繪製比例，不會放大畫布本身，避免超過 iPhone Safari 的畫布記憶體上限。

### 7.2 `cellGeometry(cell, img, k)`

計算相片在框內的縮放比例與可平移範圍：

```
旋轉 90° / 270° 時交換相片寬高
基本比例 = fit ? min(框寬/相寬, 框高/相高)   // 完整顯示
               : max(框寬/相寬, 框高/相高)   // 填滿
比例 = 基本比例 × cell.zoom
maxX = max(0, (相寬 × 比例 − 框寬) / 2)       // 可左右移動的距離
```

`panX = ±1` 表示移到可移動範圍的邊緣。因為所有量都相對於框大小，同一份 cell 資料在預覽和高解析度匯出時結果一致。

### 7.3 `drawPage(ctx, page, cells, photos, k, opts)`

1. 填滿紙張底色。
2. 每個相框：裁切到框內 → 移到框中心加平移量 → 旋轉 → 畫相片。
3. 只在預覽時：畫交換中（橘色虛線）與選取中（藍色）的外框、分隔線上的白色把手。

匯出時不傳 `selected`、`dividers` 等選項，所以輸出檔案不會有任何介面元素。

---

## 8. 互動與手勢

所有手勢使用 Pointer Events，一套程式同時支援手指、Apple Pencil、滑鼠。畫布設定 `touch-action: none`，並攔截 Safari 的 `gesturestart`，避免瀏覽器自己縮放整個網頁。

### 8.1 手勢狀態 `gesture.type`

| 類型 | 觸發方式 | 作用 |
| --- | --- | --- |
| `pan` | 單指按在相片上 | 選取相片並拖曳框內相片 |
| `pinch` | 雙指都在**原本就已選取**的相片上 | 縮放框內相片（1–5 倍） |
| `view-pan` | 單指按在頁面外的空白處、或滑鼠中鍵 | 拖曳整個頁面 |
| `view-pinch` | 其他雙指手勢 | 縮放並移動整個頁面，手指下的點保持不動 |
| `divider` | 按在分隔線附近（14 CSS px 內） | 調整相框大小 |

判斷順序（`pointerdown`）：雙指 → 滑鼠中鍵 → 分隔線 → 交換模式 → 相片 → 空白處。

若第一根手指剛選到一張相片、第二根手指接著放下，會判定為**頁面縮放**，並取消剛才那次選取，避免使用者想放大頁面卻意外縮放了相片。

### 8.2 點擊判斷

- 移動少於 `TAP_SLOP_PX = 10` px 視為點擊。
- 兩次點擊間隔小於 `DOUBLE_TAP_MS = 350` ms 視為雙擊：
  - 雙擊相片：切換「填滿／完整顯示」。
  - 雙擊空白處：頁面縮回 100%。
- 單擊空白處：取消選取。

### 8.3 滑鼠與鍵盤

- 滾輪：以游標為中心縮放頁面；在已選取的相片上則縮放該相片。
  縮放係數 `exp(−deltaY × 0.0015)`；觸控板雙指捏合以 `ctrlKey` 的滾輪事件送出，係數改用 `0.01`。以「行」為單位的滑鼠（`deltaMode = 1`）乘以 33。
- 觸控板左右滑動（`deltaX`）會平移頁面。
- 鍵盤 `+` / `−` / `0`：放大、縮小、整頁（輸入欄位或對話框開啟時不作用）。

### 8.4 工具列

選取相片後，底部工具列顯示四個按鈕：

| 按鈕 | 第二列內容 |
| --- | --- |
| 縮放旋轉 | 旋轉、縮小、放大、完整顯示、重設 |
| 調色 | （開啟調色面板） |
| 相片 | 交換、更換、移除 |
| 完成 | （取消選取） |

點擊事件統一由 `document` 上的一個監聽器處理，依按鈕的 `data-action` 分派到 `cellEdits`（修改選取中的相框）或 `actions`（其他動作）。

---

## 9. 調色 adjust.js

### 9.1 運算順序

對每個像素（RGBA，`Uint8ClampedArray` 自動四捨五入並限制在 0–255）：

1. **亮度與對比**（查表，三個色版共用）：
   ```
   位移 = 亮度 × 0.64                         // 最多 ±64 階
   增益 = 對比 ≥ 0 ? 1 + 對比/100 × 1.5 : 1 + 對比/100   // 0 .. 2.5
   v' = (v + 位移 − 128) × 增益 + 128
   ```
2. **飽和度**：`灰 = 0.299R + 0.587G + 0.114B`，每個色版 `灰 + (值 − 灰) × (1 + 飽和度/100)`。−100 為完全灰階。
3. **色溫**：R 加、B 減 `色溫 × 0.3`（最多 ±30 階）。

色溫放在飽和度**之後**，所以「黑白 + 暖色」會得到懷舊的棕褐色調。

### 9.2 預設值

| 預設 | 亮度 | 對比 | 飽和度 | 色溫 |
| --- | --- | --- | --- | --- |
| 原圖 | 0 | 0 | 0 | 0 |
| 黑白 | 0 | 15 | −100 | 0 |
| 鮮豔 | 0 | 15 | 40 | 0 |
| 暖色 | 5 | 0 | 10 | 40 |
| 冷色 | 0 | 5 | 0 | −40 |

### 9.3 效能策略

全尺寸（約 350 萬像素）調色在電腦上約 30 ms，iPhone 約 3 倍。因此：

- 拖曳滑桿時（`input` 事件）：以 `requestAnimationFrame` 節流，只處理長邊 900 px（`PREVIEW_MAX_SIDE`）的小圖。
- 放開滑桿時（`change` 事件）：處理全尺寸。
- 每張相片的 `preview` 與 `adjusted` 畫布會重複使用，因為 iOS 釋放畫布記憶體很慢。
- 匯出前與切換相片時呼叫 `finishAdjusting()`，確保輸出用的是全尺寸結果。

---

## 10. 匯出：JPG 與 PDF

### 10.1 解析度

```
dpi = min(使用者選的 dpi, √(16,000,000 / 紙張面積(平方英吋)))
```

iOS Safari 的畫布上限約 1,670 萬像素，所以 A4 可完整輸出 300 dpi（2480 × 3508），A3 會自動降到約 287 dpi。匯出畫布用完立即把寬高設為 0 以釋放記憶體。

預覽用的相片只有約 350 萬像素，直接拿來匯出會不夠清楚（一張佔半頁的相片會被放大），所以 `loadPhoto` 會保留原始檔案 `photo.file`。匯出時 `exportSource` 逐張重新解碼原檔：

1. 用 `cellGeometry` 算出這張相片在列印解析度下的縮放比例。
2. 若比例小於 1，先以 `imageSmoothingQuality = 'high'` 縮到實際列印大小（畫質好、也省記憶體）。
3. 有調色就對這份像素套用 `applyAdjustments`。
4. 畫進匯出畫布後立刻釋放。

一次只有一張全尺寸相片在記憶體中，所以 12 張相片也不會超過 iPhone 的限制。若原檔已無法讀取，就退回使用預覽用的相片。

### 10.2 JPG

`canvas.toBlob('image/jpeg', 0.92)`。

### 10.3 PDF（pdf.js）

產生 PDF 1.4，固定五個物件：

| 物件 | 內容 |
| --- | --- |
| 1 | Catalog |
| 2 | Pages |
| 3 | Page，`MediaBox` = 紙張尺寸（點，1 pt = 1/72 in；公釐 × 72 / 25.4） |
| 4 | Image XObject，`/Filter /DCTDecode`，直接嵌入上一步的 JPEG |
| 5 | 內容串流：`q W 0 0 H 0 0 cm /Im0 Do Q`，把圖片放滿整頁 |

最後寫入 `xref` 交叉參照表（每筆固定 20 位元組）與 `trailer`。測試會檢查每個偏移量都指向正確的物件。

### 10.4 分享與下載

iOS 必須在使用者點擊的當下呼叫 `navigator.share()`，耗時的繪製無法放在同一次點擊內。所以匯出分兩步：先「製作 PDF／JPG」，完成後再按「分享／儲存」或「下載」。

### 10.5 匯出之後：返回編輯或重新開始

檔案製作完成後，匯出視窗下方會出現 `#afterExport` 區塊：一行說明「相片只存在這台裝置上」，以及兩個按鈕。

- **返回編輯**（`backToEdit`）：只關閉視窗，版面與所有編輯都保留。
- **重新開始**（`startOver`）：需要點兩次。第一次點擊只會讓按鈕變紅並顯示「再點一次確認清除」，4 秒內沒再點就自動恢復（`disarmStartOver`）。第二次點擊才會清空 `state.photos`、釋放匯出檔的 blob URL，再呼叫 `regenerate()` 回到空白頁。設定不會被清除。

每次重新打開匯出視窗時，這個區塊會先隱藏，直到再次製作出檔案。

---

## 11. 多語系 i18n.js

- `STRINGS` 物件含 `en` 與 `zh-Hant` 兩組字串；值可以是字串，或接受參數的函式（例如 `` photoCount: ({ n }) => `${n} 張相片` ``）。
- HTML 中以 `data-i18n="key"` 標記文字，`data-i18n-label="key"` 標記無障礙標籤（`aria-label`）。
- `setLanguage(lang)` 更新 `<html lang>`、網頁標題與所有標記元素；`t(key, values)` 供程式內的訊息使用。
- 第一次造訪依裝置語言決定（任何 `zh` 開頭的語言 → 繁體中文）；使用者按過切換鈕後才寫入設定。
- 測試會檢查兩種語言的鍵完全相同，且 HTML 用到的每個鍵都存在。

---

## 12. 主題系統

| 主題 ID | 名稱 | 類型 |
| --- | --- | --- |
| `sky` | 晴空 Aero Sky（預設） | Aero |
| `wave` | 水波 Aero Wave | Aero |
| `candy` | 糖果 Aero Candy | Aero |
| `tiles` | 方塊 Tiles | 獨立樣式 |
| `classic` | 簡約 Classic | 基本樣式，跟隨裝置亮／暗色 |

運作方式：

1. `js/theme-boot.js` 在 `<head>` 中同步執行，於畫面出現前在 `<html>` 設定 `data-theme`，Aero 主題再加上 `aero` class，避免閃爍。
2. `css/app.css` 以 CSS 變數（`--bg`、`--accent` 等）定義簡約主題。
3. `css/themes.css`：
   - `:root[data-theme="…"]` 覆寫各主題的顏色變數。
   - `.aero …` 定義三個 Aero 主題共用的玻璃質感與光澤按鈕（`--gloss` 漸層）。
   - `[data-theme="tiles"] …` 定義方塊主題。
4. app.js 的 `applyTheme()` 在使用者切換時同步更新上述屬性、瀏覽器工具列顏色（`THEME_COLORS`）與頁面陰影顏色。

所有背景圖都是 `img/` 中手寫的 SVG，僅由基本形狀與漸層組成，不含任何外部圖片、角色或商標。

---

## 13. 設定與儲存

設定以 JSON 存在 `localStorage` 的 `photo-layout:settings` 鍵中：

| 鍵 | 預設值 | 合法值 |
| --- | --- | --- |
| `paper` | `A4` | `PAPER_SIZES` 的鍵或 `Custom` |
| `customWidth` / `customHeight` | 210 / 297 | 20–1000（公釐） |
| `orientation` | `portrait` | `portrait`、`landscape`、`auto` |
| `margin` | 5 | 0–25（公釐） |
| `gap` | 3 | 0–15（公釐） |
| `allowRotate` | `true` | 布林值 |
| `background` | `#ffffff` | `#rrggbb` |
| `dpi` | 300 | 150、300 |
| `language` | `null`（跟隨裝置） | `en`、`zh-Hant` |
| `theme` | `sky` | 見第 12 節 |

讀取時由 `sanitizeSettings()` 逐項檢查，不合法的值一律改回預設。查表一律用 `hasOwn()`（`Object.prototype.hasOwnProperty`），因為 `in` 也會接受 `__proto__`、`toString` 等內建屬性。

相片與版面**不會**儲存；重新整理頁面後需重新選取相片。

---

## 14. 離線支援（PWA）

- `manifest.webmanifest` 讓 iPhone / iPad 可「加入主畫面」，以全螢幕開啟。
- `sw.js` 採**網路優先**策略：連線時永遠取得最新版本並更新快取，離線時才使用快取。只快取同網站且成功（`response.ok`）的回應。
- 只在 HTTPS 或 `localhost` 註冊（瀏覽器規定）。
- **每次修改任何檔案後，都要把 `sw.js` 的 `CACHE` 版本號加一**；新增檔案時也要加入 `ASSETS` 清單。

---

## 15. 資訊安全

詳見 [SECURITY.md](../SECURITY.md)。重點：

- **內容安全政策（CSP）**：只允許本網站自己的腳本、樣式與圖片；禁止內嵌腳本、`eval`、外掛、框架與其他網站；所有請求升級為 HTTPS。`blob:` 僅用於使用者選取的相片。
- **不送出 Referrer**。
- **安全的 DOM 操作**：只用 `textContent`，不使用 `innerHTML`、`eval`、`new Function`、`document.write`。
- **輸入驗證**：設定逐項檢查；檔案必須是圖片且小於 80 MB。
- **無第三方程式碼**。

`tests/security.test.mjs` 會在每次 `npm test` 時檢查上述規則，避免日後不小心加入內嵌腳本或危險寫法。

注意：GitHub Pages 無法設定自訂 HTTP 標頭，因此無法啟用 `frame-ancestors`（防止被嵌入框架）。最大的實際風險是發布網站的 GitHub 帳號，請務必開啟兩步驟驗證。

---

## 16. 開發、測試與部署

### 16.1 本機執行

```sh
npm start
```

終端機會顯示兩個網址：`http://localhost:5173/`（本機）與 `http://192.168.x.x:5173/`（同一個 Wi-Fi 下的手機或平板）。可用 `PORT` 環境變數改連接埠。

### 16.2 測試

```sh
npm test
```

| 檔案 | 內容 |
| --- | --- |
| `tests/layout.test.mjs` | 2–12 張相片：每張出現一次、在邊界內、不重疊、裁切夠少；分隔線拖曳；可重現性 |
| `tests/pdf.test.mjs` | PDF 結構與交叉參照偏移量 |
| `tests/adjust.test.mjs` | 各項調色、數值範圍、預設值、棕褐色調 |
| `tests/i18n.test.mjs` | 兩種語言的鍵一致、HTML 用到的鍵都存在 |
| `tests/security.test.mjs` | CSP 內容、無內嵌腳本與危險寫法、不載入外部資源 |

介面相關功能（手勢、主題、匯出）目前以無頭 Chrome 搭配 DevTools 協定手動驗證，尚未納入自動測試。

### 16.3 部署（GitHub Pages）

儲存庫：`https://github.com/YuHao-Yeh/Photo-Layout`
網站：`https://yuhao-yeh.github.io/Photo-Layout/`（網址大小寫需正確）

發布前檢查清單：

1. `npm test` 全部通過。
2. 修改過檔案 → 把 `sw.js` 的 `CACHE` 版本號加一；新檔案加入 `ASSETS`。
3. `git commit` 後 `git push`，GitHub Actions 約 1–2 分鐘完成部署。
4. 使用者端若仍看到舊版，關閉分頁或主畫面 App 後重新開啟即可。

### 16.4 重新產生圖示

```sh
npm run icons
```

---

## 17. 常數一覽

| 常數 | 值 | 位置 | 說明 |
| --- | --- | --- | --- |
| `MAX_PHOTOS` | 12 | app.js | 每頁最多相片數 |
| `MAX_FILE_BYTES` | 80 MB | app.js | 單一檔案上限 |
| `LOAD_MAX_PIXELS` | 350 萬 | app.js | 預覽用相片縮小到的像素數，控制記憶體（匯出改讀原檔） |
| `MAX_EXPORT_PIXELS` | 1,600 萬 | app.js | 匯出畫布上限（iOS 限制） |
| `MAX_ZOOM` | 5 | app.js | 框內相片最大縮放 |
| `MAX_VIEW_ZOOM` | 6 | app.js | 頁面最大縮放 |
| `PREVIEW_MAX_SIDE` | 900 px | app.js | 拖曳滑桿時的預覽尺寸 |
| `MIN_FRAME_MM` | 8 mm | app.js | 拖曳分隔線時相框最小尺寸 |
| `DOUBLE_TAP_MS` | 350 ms | app.js | 雙擊判定時間 |
| `TAP_SLOP_PX` | 10 px | app.js | 點擊判定移動距離 |
| `DIVIDER_HIT_PX` | 14 px | app.js | 分隔線可抓取範圍 |
| `MAX_ALTERNATIVES` | 12 | app.js | 候選版面數上限 |
| `ALTERNATIVE_SCORE_RANGE` | 0.3 | app.js | 候選版面與最佳分數的最大差距 |
| `WEIGHT_MAX_CROP` | 0.5 | layout.js | 最大單張裁切的權重 |
| `WEIGHT_SIZE_SPREAD` | 0.25 | layout.js | 大小差異的權重 |
| `WEIGHT_ROTATION` | 0.01 | layout.js | 旋轉的權重 |
| `MIN_CELL` | 1 mm | layout.js | 搜尋時相框最小尺寸 |
| `restarts` / `steps` | 120 / 80 | layout.js | 搜尋的重新開始次數與每次步數 |

---

## 18. 擴充指南

### 新增紙張尺寸

在 `js/layout.js` 的 `PAPER_SIZES` 加入 `名稱: { width, height }`（公釐，直向）。設定選單會自動出現。

### 新增語言

1. 在 `js/i18n.js` 的 `STRINGS` 加入新語言（鍵必須與 `en` 完全相同），並加入 `LANGUAGES`。
2. 修改 `detectLanguage()` 的判斷與 app.js 的切換按鈕邏輯（目前是兩種語言互換）。
3. 更新 `sanitizeSettings()` 中允許的 `language` 值。
4. `npm test` 會檢查鍵是否齊全。

### 新增主題

1. 在 `img/` 加入背景 SVG（只用基本形狀，勿使用他人圖片或商標）。
2. 在 `css/themes.css` 加入 `:root[data-theme="新ID"]` 顏色變數，以及需要的樣式；若屬 Aero 風格，加入 `AERO_THEMES`（app.js）與 `theme-boot.js` 的判斷。
3. 加入 `.swatch-新ID` 選擇器縮圖樣式。
4. `index.html` 主題選擇器加一個選項；`i18n.js` 兩種語言各加名稱。
5. app.js 的 `THEME_COLORS`、`theme-boot.js` 的 `themes` 清單都要加入。
6. `sw.js` 的 `ASSETS` 加入新 SVG，並把 `CACHE` 版本加一。

### 新增調色參數

1. `js/adjust.js`：在 `NEUTRAL` 與每個 `PRESETS` 加入新鍵，並在 `applyAdjustments()` 實作。
2. `index.html` 的 `#adjustForm` 加一個 `name` 相同的滑桿；`i18n.js` 加標籤。
3. `tests/adjust.test.mjs` 補測試（預設值測試會檢查每個預設都含所有鍵）。

### 調整排版偏好

修改 `layout.js` 的三個 `WEIGHT_*` 權重。例如想讓相片大小更平均，就提高 `WEIGHT_SIZE_SPREAD`。修改後執行 `npm test`，確認「裁切夠少」的測試仍通過。

---

## 19. 已知限制

- 匯出時會重新讀取原始相片，清晰度只受原檔像素與紙張解析度上限（約 1,600 萬像素）限制。
- A3 等大尺寸紙張的匯出解析度受 iOS 畫布上限影響，約 230 dpi。
- 只有兩張相片時，部分長寬比組合（例如 4:3 加 1:1 在直向 A4）無法避免明顯裁切；「自動最佳」方向可改善。
- 相片、版面與編輯內容不會儲存，重新整理後需重新開始。
- 切換到其他版面再切回來，分隔線拖曳與單張編輯會重設。
- 放大到相片填滿整個畫面時，單指拖曳會移動相片而非頁面；觸控裝置請改用雙指拖曳。
- GitHub Pages 無法設定 HTTP 安全標頭（見第 15 節）。
