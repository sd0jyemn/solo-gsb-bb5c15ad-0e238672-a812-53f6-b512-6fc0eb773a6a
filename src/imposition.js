'use strict';

const { parseFitInput, attachFit } = require('./fitCheck');
const { parseChapterStarts, planChapterSplit } = require('./chapterSplit');

/**
 * 骑马钉（saddle-stitch）拼版计算核心。
 *
 * 基本概念：
 * - 一「帖」由若干张纸叠放后对折而成；每张纸正、反面各印 2 页，
 *   故 每帖页数 = 每帖张数 × 4。
 * - 同一帖内，第 i 张纸（由外向内，i 从 0 起）：
 *     小号页对 = start + 2i（正面）与 start + 2i + 1（其背面）
 *     大号页对 = end   - 2i（正面）与 end   - 2i - 1（其背面）
 * - 装订方向决定正面左右页位：
 *     左装订：正面左位放大号页、右位放小号页（第 1 页在右侧，书脊在左）；
 *     右装订：镜像（第 1 页在左侧，书脊在右）。
 * - 背面页位按双面翻转方式做坐标变换（纸张坐标系，与正面同一视角）：
 *     长边翻转：绕水平长边翻转，(x, y) -> (x, H - y)，左右页位不变，内容旋转 180°；
 *     短边翻转：绕垂直短边翻转，(x, y) -> (W - x, y)，左右页位互换，内容方向不变。
 * - 成品页数不足整帖时，在末尾自动补空白页。
 *
 * 分帖模式：
 * - 固定分帖（balancedSplit 缺省 / false，默认）：每帖固定 sheetsPerSignature 张，
 *   末帖不足部分整体补白。
 * - 均衡分帖（balancedSplit = true）：仍以每帖张数为上限，先按上限求出最少帖数，
 *   再把整本所需纸张 ceil(总页数 / 4) 在这些帖间均匀分配，各帖实际张数差不超过 1；
 *   各帖按自身页数连续编号，空白页只会出现在末帖末尾（页码最大的若干页位）。
 *   每帖返回 actualSheetCount；顶层 balanced.savedBlankPages 给出相对固定分帖
 *   少补的空白页数；爬移补偿按各帖实际层数（实际张数）独立重算。
 * - 章节优先分帖（chapterSplit = true + chapterStarts，与均衡分帖互斥）：
 *   每章从新的帖开始、章与章不共用同一帖，按「章节被拆分次数最少 → 补白页总数最少
 *   → 帖数最少 → 前帖优先装满」确定唯一方案；章节末尾允许插入帖内空白，
 *   后续章节的真实页码保持连续、正确进入下一帖。每帖返回 chapterIndex /
 *   chapterLabel / realPageStart / realPageEnd，顶层 chapterSplit 汇总各章规划。
 *
 * 爬移补偿（creep compensation）：
 * - 内帖书背处向外隆起，内层纸页裁切后会比外层短，需要把内层页位向外侧平移补偿。
 * - 每帖第 i 张纸（由外向内，i 从 0 起）的补偿量：
 *     creep = min(i × 纸张厚度 × 2, 最大补偿量)（单位 mm）
 *   （乘 2 是因为每张纸在折缝两侧各贡献一个厚度；每帖独立从 i=0 起算。）
 * - 偏移符号：左装订时左页位取正、右页位取负；右装订时符号整体反转。
 * - 每个页位（含空白页）都带 offsetMm；纸张厚度或最大补偿量任一为 0（或缺省）时
 *   全部 offsetMm 为 0，页码拼版结果与不启用时完全一致。
 */

const MAX_TOTAL_PAGES = 10000;
const MAX_SHEETS_PER_SIGNATURE = 100;

function toInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * 解析非负长度参数（mm）。
 * 缺省（undefined / null）视为 0（不启用）；空串等非法值返回 NaN 由调用方报错。
 */
function toNonNegativeMm(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

/** 保留 4 位小数，避免 0.1×3×2 这一类浮点尾数进入 JSON。 */
function round4(n) {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}

/** 生成一个页位；超出本帖真实页范围（realEnd）的页位为帖内补白空白页。 */
function makeSlot(page, realEnd) {
  if (page > realEnd) {
    return { page: null, blank: true };
  }
  return { page, blank: false };
}

/**
 * 计算整本册子的拼版。
 *
 * @param {object} input
 * @param {number} input.totalPages         成品页数（≥1 的整数）
 * @param {number} input.sheetsPerSignature 每帖张数（≥1 的整数）
 * @param {string} input.binding            装订方式：'left' | 'right'
 * @param {string} input.flip               双面翻转方式：'long' | 'short'
 * @param {number} [input.paperThickness]   纸张厚度（mm，≥0，缺省 0 = 不做爬移补偿）
 * @param {number} [input.maxCompensation]  爬移最大补偿量（mm，≥0，缺省 0 = 不做爬移补偿）
 * @param {number} [input.paperWidth]       纸张宽（mm，>0 启用适配检查；四项尺寸全缺省则不检查）
 * @param {number} [input.paperHeight]      纸张高（mm）
 * @param {number} [input.pageWidth]        成品页宽（mm）
 * @param {number} [input.pageHeight]       成品页高（mm）
 * @param {number} [input.bleedMm]          出血（mm，≥0，缺省 0）
 * @param {number} [input.safetyMm]         安全边距（mm，≥0，缺省 0）
 * @param {boolean} [input.balancedSplit]   是否启用均衡分帖（缺省 false = 固定每帖张数）
 * @param {boolean} [input.chapterSplit]    是否启用章节优先分帖（缺省 false；与均衡分帖互斥）
 * @param {number[]} [input.chapterStarts]  章节起始页（启用章节优先分帖时必填：
 *                                          严格递增、不重复、每项为 1 ~ 成品页数 的整数）
 * @returns {object} 拼版结果（按帖 -> 张 -> 正/背面 -> 左/右页位；启用适配检查时每个页位带 fit）
 */
function computeImposition(input) {
  const totalPages = toInteger(input && input.totalPages);
  const sheetsPerSignature = toInteger(input && input.sheetsPerSignature);
  const binding = input && input.binding;
  const flip = input && input.flip;
  const paperThickness = toNonNegativeMm(input && input.paperThickness);
  const maxCompensation = toNonNegativeMm(input && input.maxCompensation);
  const balancedSplit = input && input.balancedSplit === true;
  const chapterSplitOn = input && input.chapterSplit === true;
  const fit = parseFitInput(input || {});

  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > MAX_TOTAL_PAGES) {
    throw new Error(`成品页数必须为 1 ~ ${MAX_TOTAL_PAGES} 的整数`);
  }
  if (!Number.isInteger(sheetsPerSignature) || sheetsPerSignature < 1 || sheetsPerSignature > MAX_SHEETS_PER_SIGNATURE) {
    throw new Error(`每帖张数必须为 1 ~ ${MAX_SHEETS_PER_SIGNATURE} 的整数`);
  }
  if (binding !== 'left' && binding !== 'right') {
    throw new Error("装订方式必须为 'left'（左装订）或 'right'（右装订）");
  }
  if (flip !== 'long' && flip !== 'short') {
    throw new Error("双面翻转方式必须为 'long'（长边翻转）或 'short'（短边翻转）");
  }
  if (Number.isNaN(paperThickness)) {
    throw new Error('纸张厚度必须为 ≥ 0 的数字（单位 mm）');
  }
  if (Number.isNaN(maxCompensation)) {
    throw new Error('最大补偿量必须为 ≥ 0 的数字（单位 mm）');
  }
  if (input && input.balancedSplit !== undefined && typeof input.balancedSplit !== 'boolean') {
    throw new Error('均衡分帖开关必须为布尔值（true / false）');
  }
  if (input && input.chapterSplit !== undefined && typeof input.chapterSplit !== 'boolean') {
    throw new Error('章节优先分帖开关必须为布尔值（true / false）');
  }
  if (chapterSplitOn && balancedSplit) {
    throw new Error('章节优先分帖与均衡分帖不能同时启用');
  }
  // 章节优先分帖：校验章节起始页并规划各章页段；未启用时 chapterStarts 一律忽略（向后兼容）。
  const chapterStarts = chapterSplitOn ? parseChapterStarts(input.chapterStarts, totalPages) : null;
  const chapterPlan = chapterSplitOn ? planChapterSplit(totalPages, sheetsPerSignature, chapterStarts) : null;

  const maxPagesPerSignature = sheetsPerSignature * 4;

  // 固定分帖：每帖固定 sheetsPerSignature 张，末帖整体补白。
  // 均衡分帖：以每帖张数为上限取最少帖数，整本所需纸张在各帖间均匀分配，
  // 各帖实际张数 = base 或 base + 1（多出的 remainder 帖依次靠前分配），差不超过 1。
  // 章节优先分帖：按章节规划（见 src/chapterSplit.js），各章页段连续相接。
  const fixedSignatureCount = Math.ceil(totalPages / maxPagesPerSignature);
  const fixedPaddedPages = fixedSignatureCount * maxPagesPerSignature;

  // 均衡分帖下最少帖数与固定分帖相同（每帖容量仍为 maxPagesPerSignature）。
  let sheetCounts;
  if (chapterPlan) {
    sheetCounts = chapterPlan.sheetCounts;
  } else if (balancedSplit) {
    const totalSheetsNeeded = Math.ceil(totalPages / 4);
    const base = Math.floor(totalSheetsNeeded / fixedSignatureCount);
    const remainder = totalSheetsNeeded - base * fixedSignatureCount;
    sheetCounts = Array.from({ length: fixedSignatureCount }, (_, s) => base + (s < remainder ? 1 : 0));
  } else {
    sheetCounts = Array.from({ length: fixedSignatureCount }, () => sheetsPerSignature);
  }
  const signatureCount = sheetCounts.length;

  const paddedPages = sheetCounts.reduce((sum, n) => sum + n * 4, 0);

  // 爬移补偿：每帖独立从最外层（i=0）起算，按该帖实际层数（实际张数）给出补偿量。
  // 任一参数为 0 时补偿量恒为 0，拼版页位与原结果完全一致。
  const creepEnabled = paperThickness > 0 && maxCompensation > 0;
  function compensationFor(sheetCount) {
    const arr = [];
    for (let i = 0; i < sheetCount; i++) {
      const creep = creepEnabled ? Math.min(i * paperThickness * 2, maxCompensation) : 0;
      arr.push(round4(creep));
    }
    return arr;
  }
  // 顶层数组按每帖张数上限给出（固定分帖时即各帖补偿量；各帖同序号纸张补偿量相同）。
  const sheetCompensationMm = compensationFor(sheetsPerSignature);
  // 左装订：左页位为正、右页位为负；右装订：符号整体反转。
  const sideSign = binding === 'left' ? 1 : -1;

  // 每帖页段规划：起始页位置、实际张数与最后一个真实页（超出即为帖内补白）。
  // 固定 / 均衡分帖：页段连续相接，真实页到成品页数为止（补白只在末帖末尾）；
  // 章节优先分帖：页段按章节规划，章末帖内补白，下一章真实页码连续进入下一帖。
  const sigPlans = [];
  if (chapterPlan) {
    chapterPlan.signaturePlans.forEach((p) => sigPlans.push(p));
  } else {
    let cursor = 1;
    sheetCounts.forEach((n) => {
      sigPlans.push({ sheetCount: n, start: cursor, realEnd: totalPages, chapterIndex: null });
      cursor += n * 4;
    });
  }

  const signatures = [];
  for (let s = 0; s < signatureCount; s++) {
    const plan = sigPlans[s];
    const actualSheetCount = plan.sheetCount;
    const pagesInSignature = actualSheetCount * 4;
    const start = plan.start;
    const end = start + pagesInSignature - 1;
    const realEnd = plan.realEnd;
    const sigCompensationMm = compensationFor(actualSheetCount);
    let sigBlankPages = 0;
    const sheets = [];

    for (let i = 0; i < actualSheetCount; i++) {
      const lowFront = start + 2 * i; // 小号页（正面）
      const lowBack = lowFront + 1;   // 小号页之背
      const highFront = end - 2 * i;  // 大号页（正面）
      const highBack = highFront - 1; // 大号页之背

      // 正面左右页位（左装订：第 1 页在右；右装订镜像）
      const frontLeft = binding === 'left' ? highFront : lowFront;
      const frontRight = binding === 'left' ? lowFront : highFront;

      // 各正面页位「物理正后方」应承接的页（保证折叠后阅读顺序连续）
      const behindLeft = binding === 'left' ? highBack : lowBack;
      const behindRight = binding === 'left' ? lowBack : highBack;

      // 背面坐标变换：
      //   长边翻转 (x,y)->(x,H-y)：左右页位不变，背面内容需旋转 180°；
      //   短边翻转 (x,y)->(W-x,y)：左右页位互换，背面内容方向不变。
      const backLeft = flip === 'long' ? behindLeft : behindRight;
      const backRight = flip === 'long' ? behindRight : behindLeft;

      const front = {
        left: makeSlot(frontLeft, realEnd),
        right: makeSlot(frontRight, realEnd),
      };
      const back = {
        left: makeSlot(backLeft, realEnd),
        right: makeSlot(backRight, realEnd),
      };
      [front.left, front.right, back.left, back.right].forEach((slot) => {
        if (slot.blank) sigBlankPages += 1;
      });

      // 爬移偏移量：正反面同方向（由装订侧决定），空白页同样保留偏移。
      const creep = sigCompensationMm[i];
      front.left.offsetMm = round4(sideSign * creep);
      front.right.offsetMm = round4(-sideSign * creep);
      back.left.offsetMm = round4(sideSign * creep);
      back.right.offsetMm = round4(-sideSign * creep);

      // 标注每个背面页位物理上位于哪一正面页之后（用于校验折叠后的阅读顺序）
      back.left.backOf = flip === 'long' ? front.left.page : front.right.page;
      back.right.backOf = flip === 'long' ? front.right.page : front.left.page;

      sheets.push({ index: i + 1, front, back });
    }

    signatures.push({
      index: s + 1,
      pageStart: start,
      pageEnd: end,
      // 章节优先分帖：本帖所属章节与真实页范围（pageEnd 超出 realPageEnd 的部分为帖内补白）
      ...(chapterPlan
        ? {
            chapterIndex: plan.chapterIndex,
            chapterLabel: chapterPlan.chapters[plan.chapterIndex - 1].label,
            realPageStart: start,
            realPageEnd: realEnd,
          }
        : {}),
      actualSheetCount,
      actualPageCount: pagesInSignature,
      blankPages: sigBlankPages,
      sheetCompensationMm: sigCompensationMm,
      sheets,
    });
  }

  const result = {
    meta: {
      app: 'saddle-stitch-imposition',
      version: '1.4.0',
      generatedAt: new Date().toISOString(),
    },
    input: {
      totalPages,
      sheetsPerSignature,
      balancedSplit,
      chapterSplit: chapterSplitOn,
      chapterStarts,
      binding,
      flip,
      paperThickness,
      maxCompensation,
      paperWidth: fit.paperWidth,
      paperHeight: fit.paperHeight,
      pageWidth: fit.pageWidth,
      pageHeight: fit.pageHeight,
      bleedMm: fit.bleedMm,
      safetyMm: fit.safetyMm,
    },
    pagesPerSignature: maxPagesPerSignature,
    signatureCount,
    paddedPages,
    blankPages: paddedPages - totalPages,
    creep: {
      paperThickness,
      maxCompensation,
      enabled: creepEnabled,
      // 按每帖张数上限由外向内第 i 张纸的补偿量（mm）；
      // 固定分帖时与各帖补偿量一致；均衡分帖请以各帖 sheetCompensationMm 为准
      sheetCompensationMm,
    },
    balanced: balancedSplit
      ? {
          enabled: true,
          maxSheetsPerSignature: sheetsPerSignature,
          totalSheets: sheetCounts.reduce((sum, n) => sum + n, 0),
          fixedSignatureCount,
          fixedPaddedPages,
          fixedBlankPages: fixedPaddedPages - totalPages,
          savedBlankPages: fixedPaddedPages - paddedPages,
          actualSheetCounts: sheetCounts.slice(),
        }
      : { enabled: false },
    // 章节优先分帖汇总：各章页码范围、帖数、拆分次数、补白页数与逐帖页段规划
    chapterSplit: chapterPlan
      ? {
          enabled: true,
          maxSheetsPerSignature: sheetsPerSignature,
          chapterStarts,
          chapterCount: chapterPlan.chapters.length,
          totalSplits: chapterPlan.totalSplits,
          totalSheets: chapterPlan.totalSheets,
          chapters: chapterPlan.chapters,
        }
      : { enabled: false },
    signatures,
  };

  // 纸张规格与出血 / 安全区适配检查：逐页位计算并附加 slot.fit 与顶层 fit 汇总。
  // 未提供纸张 / 成品页尺寸时 fit.enabled = false，页码拼版与爬移结果完全不受影响。
  result.fit = attachFit(result, fit);
  return result;
}

module.exports = { computeImposition };
