'use strict';

/**
 * 章节优先分帖（chapter-priority split）规划器。
 *
 * 用户给出严格递增的章节起始页，系统把每个章节（第一个起始页大于 1 时，
 * 其前的页面作为「前言」段一并参与规划）单独划分为若干连续页段的帖：
 *
 * 约束：
 * - 每帖张数为整数且不超过每帖张数上限 S（每帖页数 = 张数 × 4）；
 * - 每章从新的帖开始，章与章不共用同一帖；
 * - 章节末尾允许插入帖内空白（补在该章末帖的高号页位），
 *   后续章节的真实页码保持连续、从下一帖第 1 个页位开始。
 *
 * 目标（按优先级依次确定唯一方案）：
 * 1. 章节被拆分次数最少：页数 L 的章取最少帖数 k = ceil(L / 4S)（拆分 k − 1 次）；
 * 2. 补白页总数最少：每章实际纸张取最少 T = ceil(L / 4) 张，章末补白 4T − L 页；
 * 3. 帖数最少：已由第 1 条保证（k 即该章最少帖数）；
 * 4. 前帖优先装满：T 张纸在 k 帖间按 [S, …, S, r]（1 ≤ r ≤ S）从前向后分配。
 */

/**
 * 解析并校验章节起始页：至少 1 个、每项为 1 ~ totalPages 的整数、严格递增且不重复。
 * 非法、重复或越界的起始页抛出带明确原因的错误。
 *
 * @param {Array} chapterStarts 用户输入的章节起始页
 * @param {number} totalPages   成品页数（已校验）
 * @returns {number[]} 规范化后的起始页数组
 */
function parseChapterStarts(chapterStarts, totalPages) {
  if (!Array.isArray(chapterStarts) || chapterStarts.length === 0) {
    throw new Error('启用章节优先分帖时必须提供章节起始页数组 chapterStarts（至少 1 个）');
  }
  const starts = chapterStarts.map((raw, i) => {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      throw new Error(`章节起始页第 ${i + 1} 项必须为整数`);
    }
    if (n < 1 || n > totalPages) {
      throw new Error(`章节起始页第 ${i + 1} 项 ${n} 越界：必须在 1 ~ ${totalPages}（成品页数）之间`);
    }
    return n;
  });
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] === starts[i - 1]) {
      throw new Error(`章节起始页第 ${i + 1} 项 ${starts[i]} 与前一项重复：章节起始页不得重复`);
    }
    if (starts[i] < starts[i - 1]) {
      throw new Error(`章节起始页必须严格递增（第 ${i + 1} 项 ${starts[i]} 小于前一项 ${starts[i - 1]}）`);
    }
  }
  return starts;
}

/**
 * 按章节规划整本分帖。
 *
 * @param {number} totalPages         成品页数
 * @param {number} sheetsPerSignature 每帖张数上限 S
 * @param {number[]} chapterStarts    已校验的章节起始页（严格递增）
 * @returns {object} {
 *   chapters:       各章汇总（页码范围、张数、帖数、拆分次数、补白页数、覆盖帖序号）,
 *   signaturePlans: 逐帖页段规划（起始页位置、张数、最后一个真实页、所属章节）,
 *   sheetCounts:    逐帖张数（与 signaturePlans 同序）,
 *   totalSplits:    章节被拆分总次数,
 *   totalSheets:    整本实际用纸总张数
 * }
 */
function planChapterSplit(totalPages, sheetsPerSignature, chapterStarts) {
  const hasFrontMatter = chapterStarts[0] > 1;
  const starts = hasFrontMatter ? [1, ...chapterStarts] : chapterStarts.slice();
  const chapters = [];
  const signaturePlans = [];

  for (let c = 0; c < starts.length; c++) {
    const pageStart = starts[c];
    const pageEnd = c + 1 < starts.length ? starts[c + 1] - 1 : totalPages;
    const pageCount = pageEnd - pageStart + 1;

    // 目标 2：该章实际纸张取最少 T = ceil(L / 4)，补白全部落在末帖高号页位。
    const totalSheets = Math.ceil(pageCount / 4);
    // 目标 1 + 4：最少帖数 k = ceil(T / S)，张数前帖优先装满 [S, …, S, r]。
    const counts = [];
    let remaining = totalSheets;
    while (remaining > sheetsPerSignature) {
      counts.push(sheetsPerSignature);
      remaining -= sheetsPerSignature;
    }
    counts.push(remaining);

    const signatureIndices = [];
    let cursor = pageStart;
    counts.forEach((sheetCount) => {
      const start = cursor;
      const end = start + sheetCount * 4 - 1;
      signatureIndices.push(signaturePlans.length + 1);
      signaturePlans.push({
        index: signaturePlans.length + 1,
        chapterIndex: c + 1,
        sheetCount,
        start,
        end,
        realStart: start,
        realEnd: Math.min(end, pageEnd),
      });
      cursor = end + 1;
    });

    chapters.push({
      index: c + 1,
      label: hasFrontMatter ? (c === 0 ? '前言' : `第 ${c} 章`) : `第 ${c + 1} 章`,
      pageStart,
      pageEnd,
      pageCount,
      sheetCount: totalSheets,
      signatureCount: counts.length,
      splits: counts.length - 1,
      blankPages: totalSheets * 4 - pageCount,
      signatureIndices,
    });
  }

  return {
    chapters,
    signaturePlans,
    sheetCounts: signaturePlans.map((p) => p.sheetCount),
    totalSplits: chapters.reduce((sum, ch) => sum + ch.splits, 0),
    totalSheets: chapters.reduce((sum, ch) => sum + ch.sheetCount, 0),
  };
}

module.exports = { parseChapterStarts, planChapterSplit };
