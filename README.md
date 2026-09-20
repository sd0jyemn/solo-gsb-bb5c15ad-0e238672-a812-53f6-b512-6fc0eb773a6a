# 骑马钉小册子拼版预演

基于 **Node.js + Express + 原生 Canvas** 的骑马钉（saddle-stitch）拼版预演 Web 应用。

输入成品页数、每帖张数上限、装订方向与双面翻转方式后，系统会：

- 成品页数不足整帖时，**自动在末尾补空白页**；
- **固定分帖（默认）**：每帖固定张数（每帖页数 = 每帖张数 × 4），末帖不足整体补白；
- **均衡分帖（可选）**：仍以每帖张数为上限，先取最少帖数，再把整本所需纸张在各帖间均匀分配，**各帖实际张数差不超过 1**，各帖按自身页数连续编号，**空白页只出现在末帖末尾**；每帖返回 `actualSheetCount`，并汇总相对固定分帖 `savedBlankPages` 节省的空白页数；
- **章节优先分帖（可选，与均衡分帖互斥）**：输入递增的章节起始页，每章从新的帖开始、章与章不共用同一帖，按「**章节被拆分次数最少 → 补白页总数最少 → 帖数最少 → 前帖优先装满**」确定唯一方案；章节末尾允许插入帖内空白，后续章节真实页码保持连续、正确进入下一帖；逐帖展示覆盖章节、真实页范围与补白位置；
- **按帖拆分页码**，生成每张纸正、反面的左右页位；
- 背面依据 **长边 / 短边翻转** 执行坐标变换，保证裁切折叠后的阅读顺序；
- 可选 **爬移补偿（creep compensation）**：按纸张厚度由外向内平移内层页位，画布叠加原始页位虚线框与补偿后实线框，每个页位（含空白页）输出 `offsetMm`；均衡分帖下按**各帖实际层数**独立重算；
- 可选 **纸张规格与出血 / 安全区适配检查**：输入纸张宽高、成品页宽高、出血与安全边距后，按每个正反页位的实际方向计算可用矩形，逐页位判定成品页是否放得下、出血是否落在纸张内、安全边距是否过大，并在逐张预览与清单中标出不合格页位；
- 画布**逐张显示**纸面、页码、空白页位与翻转方向示意；
- 一键**导出拼版清单 JSON**（包含适配检查结果）。

## 快速开始（Docker）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

## 本地开发

```bash
npm install
npm start          # 启动服务，默认 8080 端口（可用 PORT 环境变量覆盖）
npm test           # 运行拼版逻辑单元测试
```

## 拼版规则说明

- **帖与张**：一帖由若干张纸叠放对折而成，每张纸正反面各印 2 页，故每帖页数 = 每帖张数 × 4。
- **页码配对**：同一帖内由外向内，第 i 张纸的正面为「最大未排页 + 最小未排页」，背面为与其相邻的两页。
- **装订方向**：
  - 左装订：第 1 页在正面右页位（书脊在左）；
  - 右装订：镜像，第 1 页在正面左页位（书脊在右）。
- **双面翻转（背面坐标变换，纸张坐标系与正面同视角）**：
  - 长边翻转：绕水平长边翻转，`(x, y) → (x, H − y)`，背面左右页位不变，内容旋转 180°（页首朝下）；
  - 短边翻转：绕垂直短边翻转，`(x, y) → (W − x, y)`，背面左右页位互换，内容方向不变。
- **阅读顺序校验**：画布上每个背面页位都标注了它物理上位于哪一正面页之背（页码首尾相接）。

### 均衡分帖（balanced split）

表单勾选「均衡分帖」（API 传 `balancedSplit: true`）后启用；不勾选 / 不传 / 传 `false` 时为**固定分帖**，结果与旧版本完全一致。

规则（`N` = 成品页数，`S` = 每帖张数上限）：

- 每帖容量仍为 `4S` 页，故**最少帖数** `k = ceil(N / 4S)`，与固定分帖的帖数相同；
- 整本所需纸张 `T = ceil(N / 4)` 在 `k` 帖间均匀分配：每帖 `floor(T/k)` 或 `ceil(T/k)` 张，**各帖实际张数差不超过 1**（多出的帖依次靠前分配），且任何一帖都不超过上限 `S`；
- 各帖按自身页数**连续编号**，页码范围首尾相接；空白页只补在末帖（页码最大的若干页位，即末帖外层高号页与其背面），**前面各帖均无空白页**；
- 每帖返回 `actualSheetCount` / `actualPageCount` / `blankPages` 与该帖的 `sheetCompensationMm`；
- 顶层汇总 `balanced`：`fixedPaddedPages`（固定分帖补白后页数）、`savedBlankPages = fixedPaddedPages − paddedPages`（相对固定分帖节省的空白页数）、`actualSheetCounts`（各帖实际张数）等；
- 爬移补偿按**该帖实际层数**（实际张数）由外向内独立重算；顶层 `creep.sheetCompensationMm` 仍按每帖张数上限给出，各帖以自身的 `sheetCompensationMm` 为准。

示例：17 页、每帖上限 2 张（8 页/帖）时，固定分帖为 `[8, 8, 8] = 24` 页、补 7 个空白页；均衡分帖为 `[2, 2, 1]` 张、`[8, 8, 4] = 20` 页，空白页仅 3 个且全部在末帖，`savedBlankPages = 4`。

### 章节优先分帖（chapter-priority split）

表单勾选「章节优先分帖」并填写章节起始页（API 传 `chapterSplit: true` + `chapterStarts: [1, 9, …]`）后启用；与均衡分帖**互斥**（同时启用返回 400）。不勾选 / 不传 / 传 `false` 时 `chapterStarts` 一律被忽略，固定 / 均衡分帖结果与旧版本完全一致。

规则（`N` = 成品页数，`S` = 每帖张数上限）：

- 章节起始页必须为 **1 ~ N 的整数、严格递增、不得重复**，至少 1 个；第一个起始页大于 1 时，前面的页面作为「前言」段一并参与规划；非法、重复或越界的起始页返回明确错误；
- **每章从新的帖开始**，章与章不共用同一帖；每帖张数为整数且不超过 `S`；
- 方案按以下优先级**唯一确定**：
  1. **章节被拆分次数最少**：页数 `L` 的章取最少帖数 `k = ceil(L / 4S)`（拆分 `k − 1` 次）；
  2. **补白页总数最少**：每章实际纸张取最少 `T = ceil(L / 4)` 张，章末补白 `4T − L` 页；
  3. **帖数最少**：已由最少拆分保证（`k` 即该章最少帖数）；
  4. **前帖优先装满**：`T` 张纸按 `[S, …, S, r]`（1 ≤ r ≤ S）从前向后分配；
- 章节末尾的补白插在该章**末帖的高号页位**（帖内空白），下一章的真实页码保持连续、从下一帖第 1 个页位开始；
- 每帖返回 `chapterIndex` / `chapterLabel` / `realPageStart` / `realPageEnd`（`pageEnd` 超出 `realPageEnd` 的部分即本帖补白位置）；顶层 `chapterSplit` 汇总 `chapterCount` / `totalSplits` / `totalSheets` 与各章的页码范围、帖数、拆分次数、补白页数及覆盖帖序号；
- 爬移补偿仍按各帖实际层数独立重算；适配检查、画布逐张预览与导出 JSON 均按该方案生成。

示例：20 页、每帖上限 2 张、章节起始页 `[1, 9]`：第 1 章 1–8 页 → 1 帖（2 张）；第 2 章 9–20 页 → 2 帖（`[2, 1]` 张，拆分 1 次）；共 3 帖、补白 0 页。若成品为 13 页，则第 2 章 9–13 页 → 1 帖（2 张），章末补白 3 页（页位 14–16），真实页 9–13 连续进入该帖。

### 爬移补偿（creep compensation）

骑马钉装订时内层纸页在书背处被向外推出，折页裁切后内层页会比外层短，需要把内层页位向切口方向平移补偿。表单中的两个可选参数（均为 mm）：

- **纸张厚度** `paperThickness`：单张纸的厚度；
- **最大补偿量** `maxCompensation`：单张纸补偿量的封顶值。

规则：

- 每帖第 `i` 张纸由外向内以 `0` 起算，补偿量 = `min(i × 纸张厚度 × 2, 最大补偿量)`（一张纸在折缝两侧各贡献一个厚度，故乘 2；各帖独立从 `i = 0` 起算）；
- 偏移符号：**左装订时左页位取正、右页位取负**；**右装订时符号整体反转**（左负右正）；
- 偏移与双面翻转方式无关，正、背面同方向平移；
- 每个页位（包括自动补齐的**空白页**）都输出 `offsetMm`；
- **纸张厚度或最大补偿量任一为 0（或缺省）时，所有 `offsetMm` 为 0，页码拼版结果与不启用时完全一致**（向后兼容）。

画布上橙色**虚线框**表示补偿前的原始页位，橙色**实线框**表示补偿后页位；画布位移为示意性放大（非真实 mm 等比），精确数值以清单和导出 JSON 中的 `offsetMm` 为准。

### 纸张规格与出血 / 安全区适配检查

表单中可选填写（均为 mm）：**纸张宽 / 高**、**成品页宽 / 高**、**出血**、**安全边距**。四项尺寸全部留空（或为 0）时不检查，行为与旧版本完全一致；一旦填写其中任意一项，四项尺寸必须全部大于 0，出血与安全边距缺省为 0。

检查规则（纸张坐标系，与正面同一视角）：

- 每个页位的**可用矩形**为纸张的一半：左页位 `[0, W/2] × [0, H]`，右页位 `[W/2, W] × [0, H]`；背面页位与正面共用同一坐标系（长边翻转左右不变、短边翻转左右互换），每个页位同时返回内容方向 `rotation`（长边翻转的背面为 180°，其余为 0°）；
- 成品页在页位内**居中放置**，并叠加该页位的爬移偏移 `offsetMm`，得到裁切框 `trim`；
- **出血框** `bleedBox` = `trim` 四边各外扩出血，必须完全落在纸张矩形内（折线一侧的出血进入相邻页位属正常工艺，仅纸张外边界构成约束）；
- **安全区** `safeBox` = `trim` 四边各内缩安全边距；`2 × 安全边距` 超过成品页宽 / 高时安全区不存在，记为超限。

每个页位（含空白页）输出 `fit`：`{ ok, rotation, rect, trim, bleedBox, safeBox, violations }`，`violations` 逐条给出超限原因（`page-too-wide` / `page-too-tall` / `bleed-overflow-{left,top,right,bottom}` / `safety-too-wide` / `safety-too-tall`，含具体超出量）；顶层 `fit` 汇总 `ok / totalSlots / failCount`。画布上蓝框 = 裁切线、绿/红虚框 = 出血范围（红 = 超出纸张）、灰点框 = 安全区，不合格页位带红色圆徽，清单对应单元格标红并列出原因。

## API

### `POST /api/impose`

请求体：

```json
{
  "totalPages": 16,
  "sheetsPerSignature": 2,
  "balancedSplit": false,
  "chapterSplit": false,
  "chapterStarts": [1, 9],
  "binding": "left",
  "flip": "short",
  "paperThickness": 0.1,
  "maxCompensation": 2,
  "paperWidth": 440,
  "paperHeight": 310,
  "pageWidth": 210,
  "pageHeight": 297,
  "bleedMm": 3,
  "safetyMm": 5
}
```

- `totalPages`：成品页数，1 ~ 10000 的整数
- `sheetsPerSignature`：每帖张数上限，1 ~ 100 的整数
- `balancedSplit`：**可选**，`true` 启用均衡分帖（在最少帖数间均匀分配纸张，各帖实际张数差 ≤ 1，空白页只留在末帖末尾）；缺省 / `false` 为固定分帖（向后兼容）
- `chapterSplit`：**可选**，`true` 启用章节优先分帖（与均衡分帖互斥）；缺省 / `false` 时 `chapterStarts` 被忽略，结果与旧版本一致
- `chapterStarts`：启用章节优先分帖时**必填**，章节起始页数组（至少 1 个，每项为 1 ~ `totalPages` 的整数，严格递增且不重复）
- `binding`：`left`（左装订）或 `right`（右装订）
- `flip`：`long`（长边翻转）或 `short`（短边翻转）
- `paperThickness`：**可选**，纸张厚度（mm，≥ 0，缺省为 0）
- `maxCompensation`：**可选**，爬移最大补偿量（mm，≥ 0，缺省为 0）
- `paperWidth` / `paperHeight` / `pageWidth` / `pageHeight`：**可选**，纸张与成品页宽高（mm）；全部缺省或为 0 时不做适配检查，提供任意一项则四项必须全部 > 0
- `bleedMm` / `safetyMm`：**可选**，出血与安全边距（mm，≥ 0，缺省为 0）

后两个爬移参数任一为 0（或不传）时不做爬移补偿，所有页位 `offsetMm` 为 0，旧调用方无需改动。

响应（节选）：完整拼版清单，与前端导出的 JSON 一致。`creep.sheetCompensationMm` 按每帖张数上限由外向内给出补偿量；**每个帖对象另带 `actualSheetCount`（实际张数）、`actualPageCount`（实际页数）、`blankPages`（本帖空白页数）与按该帖实际层数重算的 `sheetCompensationMm`**；每个页位对象（含空白页）都带 `offsetMm`；启用适配检查时每个页位另带 `fit`，顶层 `fit` 给出整体汇总。

顶层 `balanced` 汇总分帖模式：

- 固定分帖（`balancedSplit` 缺省 / `false`）：`{ "enabled": false }`；
- 均衡分帖：

```json
{
  "enabled": true,
  "maxSheetsPerSignature": 2,
  "totalSheets": 5,
  "fixedSignatureCount": 3,
  "fixedPaddedPages": 24,
  "fixedBlankPages": 7,
  "savedBlankPages": 4,
  "actualSheetCounts": [2, 2, 1]
}
```

顶层 `chapterSplit` 汇总章节优先分帖（未启用时为 `{ "enabled": false }`）；启用章节优先分帖时每个帖对象另带 `chapterIndex` / `chapterLabel` / `realPageStart` / `realPageEnd`：

```json
{
  "enabled": true,
  "maxSheetsPerSignature": 2,
  "chapterStarts": [1, 9],
  "chapterCount": 2,
  "totalSplits": 1,
  "totalSheets": 5,
  "chapters": [
    {
      "index": 1,
      "label": "第 1 章",
      "pageStart": 1,
      "pageEnd": 8,
      "pageCount": 8,
      "sheetCount": 2,
      "signatureCount": 1,
      "splits": 0,
      "blankPages": 0,
      "signatureIndices": [1]
    },
    {
      "index": 2,
      "label": "第 2 章",
      "pageStart": 9,
      "pageEnd": 20,
      "pageCount": 12,
      "sheetCount": 3,
      "signatureCount": 2,
      "splits": 1,
      "blankPages": 0,
      "signatureIndices": [2, 3]
    }
  ]
}
```

```json
{
  "input": {
    "totalPages": 8,
    "sheetsPerSignature": 2,
    "balancedSplit": false,
    "binding": "left",
    "flip": "short",
    "paperThickness": 0.1,
    "maxCompensation": 0.15
  },
  "pagesPerSignature": 8,
  "signatureCount": 1,
  "paddedPages": 8,
  "blankPages": 0,
  "balanced": { "enabled": false },
  "creep": {
    "paperThickness": 0.1,
    "maxCompensation": 0.15,
    "enabled": true,
    "sheetCompensationMm": [0, 0.15]
  },
  "signatures": [
    {
      "index": 1,
      "pageStart": 1,
      "pageEnd": 8,
      "actualSheetCount": 2,
      "actualPageCount": 8,
      "blankPages": 0,
      "sheetCompensationMm": [0, 0.15],
      "sheets": [
        {
          "index": 1,
          "front": {
            "left": { "page": 8, "blank": false, "offsetMm": 0 },
            "right": { "page": 1, "blank": false, "offsetMm": 0 }
          },
          "back": {
            "left": { "page": 2, "blank": false, "offsetMm": 0, "backOf": 1 },
            "right": { "page": 7, "blank": false, "offsetMm": 0, "backOf": 8 }
          }
        },
        {
          "index": 2,
          "front": {
            "left": { "page": 6, "blank": false, "offsetMm": 0.15 },
            "right": { "page": 3, "blank": false, "offsetMm": -0.15 }
          }
        }
      ]
    }
  ]
}
```

启用适配检查时，每个页位对象增加 `fit`，例如：

```json
{
  "page": 8,
  "blank": false,
  "offsetMm": 0,
  "fit": {
    "ok": false,
    "rotation": 0,
    "rect": { "x": 0, "y": 0, "width": 220, "height": 310 },
    "trim": { "x": 5, "y": 6.5, "width": 210, "height": 297 },
    "bleedBox": { "x": 2, "y": 3.5, "width": 216, "height": 303 },
    "safeBox": { "x": 10, "y": 11.5, "width": 200, "height": 287 },
    "violations": [
      { "code": "bleed-overflow-left", "message": "左侧出血超出纸张 2mm（出血 5mm，含爬移偏移 0mm）" }
    ]
  }
}
```

顶层 `fit` 汇总：`{ enabled, paperWidth, paperHeight, pageWidth, pageHeight, bleedMm, safetyMm, slotWidth, slotHeight, ok, totalSlots, failCount }`；未启用时仅为 `{ "enabled": false }`。

参数非法时返回 `400` 与错误信息（含纸张厚度 / 最大补偿量为负，尺寸参数为负、非数字或只提供部分尺寸，`balancedSplit` / `chapterSplit` 非布尔值，章节优先分帖与均衡分帖同时启用，章节起始页缺失、非整数、重复、非递增或越界等情况）。另提供 `GET /api/health` 健康检查。

## 目录结构

```
├── server.js            # Express 服务：静态页面 + /api/impose
├── src/imposition.js    # 拼版计算核心（固定 / 均衡 / 章节优先分帖、正反面页位、翻转坐标变换、爬移补偿 offsetMm）
├── src/chapterSplit.js  # 章节优先分帖规划器（起始页校验、按优先级确定唯一分帖方案）
├── src/fitCheck.js      # 纸张规格与出血 / 安全区适配检查（可用矩形、trim/bleed/safe、超限原因）
├── public/              # 前端（原生 Canvas 逐张绘制、原始/补偿页位叠加、适配标记、章节规划展示、JSON 导出）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── test/imposition.test.js
├── test/chapterSplit.test.js
├── test/fitCheck.test.js
├── Dockerfile
└── docker-compose.yml
```
