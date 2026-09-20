'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeImposition } = require('../src/imposition');
const { parseChapterStarts, planChapterSplit } = require('../src/chapterSplit');

const BASE = { totalPages: 20, sheetsPerSignature: 2, binding: 'left', flip: 'short' };

/** 收集拼版结果中的全部页位（每张纸正反 × 左右）。 */
function allSlotsOf(r) {
  const slots = [];
  r.signatures.forEach((sig) => {
    sig.sheets.forEach((sheet) => {
      slots.push(sheet.front.left, sheet.front.right, sheet.back.left, sheet.back.right);
    });
  });
  return slots;
}

/** 各帖实际张数序列。 */
function sheetCountsOf(r) {
  return r.signatures.map((sig) => sig.actualSheetCount);
}

/* ------------------------------ 规划器（核心算法） ------------------------------ */

test('规划器：20 页、上限 2 张、章节 [1, 9] -> [2, 2, 1]，第 2 章拆分 1 次', () => {
  const plan = planChapterSplit(20, 2, [1, 9]);
  assert.deepEqual(plan.sheetCounts, [2, 2, 1]);
  assert.equal(plan.totalSplits, 1);
  assert.equal(plan.totalSheets, 5);
  assert.equal(plan.chapters.length, 2);
  assert.deepEqual(
    plan.chapters.map((c) => [c.label, c.pageStart, c.pageEnd, c.signatureCount, c.splits, c.blankPages]),
    [['第 1 章', 1, 8, 1, 0, 0], ['第 2 章', 9, 20, 2, 1, 0]]
  );
  // 逐帖页段：第 2 章两帖页段连续相接
  assert.deepEqual(
    plan.signaturePlans.map((p) => [p.start, p.end, p.realEnd, p.chapterIndex]),
    [[1, 8, 8, 1], [9, 16, 16, 2], [17, 20, 20, 2]]
  );
});

test('规划器：第一个起始页大于 1 时生成「前言」段', () => {
  const plan = planChapterSplit(12, 2, [5]);
  assert.deepEqual(plan.sheetCounts, [1, 2]);
  assert.equal(plan.chapters[0].label, '前言');
  assert.deepEqual([plan.chapters[0].pageStart, plan.chapters[0].pageEnd], [1, 4]);
  assert.equal(plan.chapters[1].label, '第 1 章');
  assert.deepEqual([plan.chapters[1].pageStart, plan.chapters[1].pageEnd], [5, 12]);
});

test('规划器：前帖优先装满（25 页、上限 3 张 -> [3, 3, 1]，而非均衡的 [3, 2, 2]）', () => {
  const plan = planChapterSplit(25, 3, [1]);
  assert.deepEqual(plan.sheetCounts, [3, 3, 1]);
  assert.equal(plan.chapters[0].blankPages, 3); // 28 - 25
  assert.equal(plan.chapters[0].splits, 2);
});

test('起始页解析：接受数字与数字字符串，拒绝非法 / 重复 / 越界 / 非递增', () => {
  assert.deepEqual(parseChapterStarts([1, 9, 25], 30), [1, 9, 25]);
  assert.deepEqual(parseChapterStarts(['1', '9'], 30), [1, 9]);
  assert.throws(() => parseChapterStarts(undefined, 30), /章节起始页/);
  assert.throws(() => parseChapterStarts([], 30), /至少 1 个/);
  assert.throws(() => parseChapterStarts('1,9', 30), /章节起始页/);
  assert.throws(() => parseChapterStarts([1.5], 30), /整数/);
  assert.throws(() => parseChapterStarts(['abc'], 30), /整数/);
  assert.throws(() => parseChapterStarts([0], 30), /越界/);
  assert.throws(() => parseChapterStarts([31], 30), /越界/);
  assert.throws(() => parseChapterStarts([-2], 30), /越界/);
  assert.throws(() => parseChapterStarts([1, 5, 5], 30), /重复/);
  assert.throws(() => parseChapterStarts([9, 1], 30), /严格递增/);
});

/* ------------------------------ 分帖方案与页位布局 ------------------------------ */

test('章节模式：20 页、上限 2 张、[1, 9] -> 3 帖 [2, 2, 1]，无补白', () => {
  const r = computeImposition({ ...BASE, chapterSplit: true, chapterStarts: [1, 9] });
  assert.equal(r.chapterSplit.enabled, true);
  assert.equal(r.balanced.enabled, false);
  assert.equal(r.signatureCount, 3);
  assert.deepEqual(sheetCountsOf(r), [2, 2, 1]);
  assert.equal(r.paddedPages, 20);
  assert.equal(r.blankPages, 0);
  assert.equal(r.chapterSplit.totalSplits, 1);
  assert.deepEqual(r.chapterSplit.chapterStarts, [1, 9]);
  // 逐帖：覆盖章节、真实页范围
  assert.deepEqual(
    r.signatures.map((s) => [s.chapterIndex, s.chapterLabel, s.pageStart, s.pageEnd, s.realPageStart, s.realPageEnd]),
    [[1, '第 1 章', 1, 8, 1, 8], [2, '第 2 章', 9, 16, 9, 16], [2, '第 2 章', 17, 20, 17, 20]]
  );
  // 第 2 章第 1 帖从真实页 9 开始（正确进入下一帖）
  const s1 = r.signatures[1].sheets[0];
  assert.deepEqual([s1.front.left.page, s1.front.right.page], [16, 9]);
});

test('章节模式：章末帖内补白，后续真实页码连续进入下一帖（13 页、[1, 9]）', () => {
  const r = computeImposition({ totalPages: 13, sheetsPerSignature: 2, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts: [1, 9] });
  assert.equal(r.signatureCount, 2);
  assert.equal(r.paddedPages, 16);
  assert.equal(r.blankPages, 3);
  const sig2 = r.signatures[1];
  // 第 2 章 9–13（5 页）-> 2 张 8 页位，补白 3 页位于页位 14–16
  assert.deepEqual([sig2.pageStart, sig2.pageEnd], [9, 16]);
  assert.deepEqual([sig2.realPageStart, sig2.realPageEnd], [9, 13]);
  assert.equal(sig2.blankPages, 3);
  const [s1, s2] = sig2.sheets;
  // 第 1 张：正面 [空白(16), 9]，背面 [10, 空白(15)]
  assert.equal(s1.front.left.blank, true);
  assert.equal(s1.front.right.page, 9);
  assert.equal(s1.back.left.page, 10);
  assert.equal(s1.back.left.backOf, 9);
  assert.equal(s1.back.right.blank, true);
  // 第 2 张：正面 [空白(14), 11]，背面 [12, 13]（最后一页为真实页 13）
  assert.equal(s2.front.left.blank, true);
  assert.equal(s2.front.right.page, 11);
  assert.equal(s2.back.left.page, 12);
  assert.equal(s2.back.right.page, 13);
  // 整本真实页恰好 1..13 各一次
  const printed = allSlotsOf(r).filter((s) => !s.blank).map((s) => s.page).sort((a, b) => a - b);
  assert.deepEqual(printed, Array.from({ length: 13 }, (_, i) => i + 1));
});

test('章节模式：章内页位配对与经典布局一致（左装订短边翻转 [8,1]/[2,7]）', () => {
  const r = computeImposition({ ...BASE, chapterSplit: true, chapterStarts: [1, 9] });
  const [s1, s2] = r.signatures[0].sheets;
  assert.deepEqual([s1.front.left.page, s1.front.right.page], [8, 1]);
  assert.deepEqual([s1.back.left.page, s1.back.right.page], [2, 7]);
  assert.deepEqual([s2.front.left.page, s2.front.right.page], [6, 3]);
  assert.deepEqual([s2.back.left.page, s2.back.right.page], [4, 5]);
});

test('章节模式：每章一页段边界 = 帖边界，单页章与跨章补白位置重叠不影响真实页连续', () => {
  // 第 2 章只有第 8 页；第 1 章 1–7 末帖补白 1 页（页位 8），第 2 章真实页 8 仍正确进入下一帖
  const r = computeImposition({ totalPages: 8, sheetsPerSignature: 2, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts: [1, 8] });
  assert.equal(r.signatureCount, 2);
  assert.deepEqual(sheetCountsOf(r), [2, 1]);
  const [sig1, sig2] = r.signatures;
  assert.deepEqual([sig1.realPageStart, sig1.realPageEnd], [1, 7]);
  assert.equal(sig1.blankPages, 1); // 页位 8 为帖内补白
  assert.deepEqual([sig2.pageStart, sig2.pageEnd], [8, 11]);
  assert.deepEqual([sig2.realPageStart, sig2.realPageEnd], [8, 8]);
  assert.equal(sig2.blankPages, 3); // 页位 9–11
  assert.equal(sig2.sheets[0].front.right.page, 8);
  const printed = allSlotsOf(r).filter((s) => !s.blank).map((s) => s.page).sort((a, b) => a - b);
  assert.deepEqual(printed, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('章节模式：长章按最少拆分 + 前帖装满（17 页单章、上限 2 张 -> [2, 2, 1]，拆分 2 次）', () => {
  const r = computeImposition({ totalPages: 17, sheetsPerSignature: 2, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts: [1] });
  assert.deepEqual(sheetCountsOf(r), [2, 2, 1]);
  assert.equal(r.chapterSplit.totalSplits, 2);
  assert.equal(r.blankPages, 3); // 20 - 17，全部在末帖末尾
  assert.equal(r.signatures[2].realPageEnd, 17);
  assert.equal(r.signatures[2].blankPages, 3);
});

test('章节模式：前言段参与规划（12 页、[5] -> 前言 1 帖 + 第 1 章 1 帖）', () => {
  const r = computeImposition({ totalPages: 12, sheetsPerSignature: 2, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts: [5] });
  assert.equal(r.signatureCount, 2);
  assert.deepEqual(sheetCountsOf(r), [1, 2]);
  assert.equal(r.signatures[0].chapterLabel, '前言');
  assert.deepEqual([r.signatures[0].pageStart, r.signatures[0].pageEnd], [1, 4]);
  assert.equal(r.signatures[1].chapterLabel, '第 1 章');
  assert.deepEqual([r.signatures[1].realPageStart, r.signatures[1].realPageEnd], [5, 12]);
  assert.equal(r.blankPages, 0);
});

test('章节模式：每章恰好一帖（16 页、[1, 5, 9, 13] -> 4 帖各 1 张，零拆分零补白）', () => {
  const r = computeImposition({ totalPages: 16, sheetsPerSignature: 2, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts: [1, 5, 9, 13] });
  assert.equal(r.signatureCount, 4);
  assert.deepEqual(sheetCountsOf(r), [1, 1, 1, 1]);
  assert.equal(r.chapterSplit.totalSplits, 0);
  assert.equal(r.blankPages, 0);
  assert.deepEqual(
    r.signatures.map((s) => [s.chapterLabel, s.realPageStart, s.realPageEnd]),
    [['第 1 章', 1, 4], ['第 2 章', 5, 8], ['第 3 章', 9, 12], ['第 4 章', 13, 16]]
  );
});

test('章节模式：右装订 + 长边翻转仍决定页位', () => {
  const r = computeImposition({ totalPages: 13, sheetsPerSignature: 2, binding: 'right', flip: 'long', chapterSplit: true, chapterStarts: [1, 9] });
  const s1 = r.signatures[1].sheets[0];
  // 第 2 章首帖（9–16，真实页 9–13）：右装订正面 [9, 空白(16)]；长边翻转背面左右不变 -> [10, 空白(15)]
  assert.equal(s1.front.left.page, 9);
  assert.equal(s1.front.right.blank, true);
  assert.equal(s1.back.left.page, 10);
  assert.equal(s1.back.right.blank, true);
});

/* ------------------------------ 与爬移 / 适配检查的组合 ------------------------------ */

test('章节模式：爬移补偿按各帖实际层数重算，章末空白页同样带偏移', () => {
  const r = computeImposition({
    totalPages: 13, sheetsPerSignature: 2, binding: 'left', flip: 'short',
    paperThickness: 0.1, maxCompensation: 5, chapterSplit: true, chapterStarts: [1, 9],
  });
  assert.equal(r.creep.enabled, true);
  assert.deepEqual(r.signatures[0].sheetCompensationMm, [0, 0.2]);
  assert.deepEqual(r.signatures[1].sheetCompensationMm, [0, 0.2]);
  const inner = r.signatures[1].sheets[1]; // 第 2 帖第 2 张（i=1）：含章末空白页
  assert.equal(inner.front.left.blank, true); // 页位 14
  assert.equal(inner.front.left.offsetMm, 0.2);
  assert.equal(inner.front.right.offsetMm, -0.2);
  assert.equal(inner.back.left.offsetMm, 0.2);
  assert.equal(inner.back.right.offsetMm, -0.2);
});

test('章节模式：适配检查按全部页位统计（含章末补白）', () => {
  const r = computeImposition({
    totalPages: 13, sheetsPerSignature: 2, binding: 'left', flip: 'short',
    chapterSplit: true, chapterStarts: [1, 9],
    paperWidth: 440, paperHeight: 310, pageWidth: 210, pageHeight: 297, bleedMm: 3, safetyMm: 5,
  });
  assert.equal(r.fit.enabled, true);
  assert.equal(r.fit.totalSlots, 16);
  assert.equal(r.fit.ok, true);
  allSlotsOf(r).forEach((s) => assert.ok(s.fit));
});

/* ------------------------------ 参数校验 ------------------------------ */

test('章节模式：非法、重复或越界起始页返回明确错误', () => {
  const on = { totalPages: 13, sheetsPerSignature: 2, binding: 'left', flip: 'short', chapterSplit: true };
  assert.throws(() => computeImposition({ ...on }), /章节起始页/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: [] }), /至少 1 个/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: '1,9' }), /章节起始页/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: [1.5] }), /整数/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: [0] }), /越界/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: [14] }), /越界/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: [1, 5, 5] }), /重复/);
  assert.throws(() => computeImposition({ ...on, chapterStarts: [9, 1] }), /严格递增/);
});

test('章节模式：开关必须为布尔值，且与均衡分帖互斥', () => {
  const base = { totalPages: 13, sheetsPerSignature: 2, binding: 'left', flip: 'short' };
  assert.throws(() => computeImposition({ ...base, chapterSplit: 'yes', chapterStarts: [1] }), /布尔值/);
  assert.throws(() => computeImposition({ ...base, chapterSplit: 1, chapterStarts: [1] }), /布尔值/);
  assert.throws(
    () => computeImposition({ ...base, chapterSplit: true, balancedSplit: true, chapterStarts: [1] }),
    /不能同时启用/
  );
});

/* ------------------------------ 关闭模式：固定 / 均衡结果不变 ------------------------------ */

test('关闭章节模式：chapterSplit 缺省 / false 时结果与旧版本一致，chapterStarts 被忽略', () => {
  const common = { totalPages: 23, sheetsPerSignature: 3, binding: 'left', flip: 'long', paperThickness: 0.1, maxCompensation: 1 };
  const baseline = computeImposition(common);
  assert.equal(baseline.chapterSplit.enabled, false);
  assert.equal(baseline.input.chapterSplit, false);
  assert.equal(baseline.input.chapterStarts, null);
  // 未启用时帖对象不带章节字段
  baseline.signatures.forEach((sig) => {
    assert.equal(sig.chapterIndex, undefined);
    assert.equal(sig.realPageStart, undefined);
    assert.equal(sig.realPageEnd, undefined);
  });
  // 显式 false + 提供 chapterStarts（即使内容非法）也不影响结果
  const withFalse = computeImposition({ ...common, chapterSplit: false, chapterStarts: [3, 3] });
  // 缺省但误传 chapterStarts：同样被忽略
  const withStarts = computeImposition({ ...common, chapterStarts: [3, 3] });
  [withFalse, withStarts].forEach((r) => {
    delete r.meta.generatedAt;
    const base = JSON.parse(JSON.stringify(baseline));
    delete base.meta.generatedAt;
    assert.deepEqual(r, base);
  });
});

test('关闭章节模式：均衡分帖结果不受 chapterStarts 影响', () => {
  const common = { totalPages: 17, sheetsPerSignature: 2, binding: 'left', flip: 'short', balancedSplit: true };
  const a = computeImposition(common);
  const b = computeImposition({ ...common, chapterStarts: [1, 9] });
  delete a.meta.generatedAt;
  delete b.meta.generatedAt;
  assert.deepEqual(b, a);
  assert.equal(b.balanced.enabled, true);
  assert.deepEqual(b.balanced.actualSheetCounts, [2, 2, 1]);
});

/* ------------------------------ 最优性与穷举校验 ------------------------------ */

/** 枚举 total 的 parts 组分（每组 1..maxPart），用于暴力搜索最优分帖。 */
function* compositions(total, parts, maxPart) {
  if (parts === 1) {
    if (total >= 1 && total <= maxPart) yield [total];
    return;
  }
  for (let first = 1; first <= Math.min(maxPart, total - (parts - 1)); first++) {
    for (const rest of compositions(total - first, parts - 1, maxPart)) {
      yield [first, ...rest];
    }
  }
}

function lexCompare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 暴力搜索单章最优分帖：目标依次为
 * 拆分最少（帖数 - 1）-> 补白最少（4T - L）-> 帖数最少 -> 前帖优先装满（靠前帖张数越大越优）。
 */
function bestChapterPlanBruteForce(L, S) {
  const minSheets = Math.ceil(L / 4);
  const minSignatures = Math.ceil(L / (4 * S));
  let best = null;
  for (let k = minSignatures; k <= minSignatures + 2; k++) {
    for (let sheets = minSheets; sheets <= k * S; sheets++) {
      const blanks = 4 * sheets - L;
      for (const comp of compositions(sheets, k, S)) {
        const key = [k - 1, blanks, k, ...comp.map((n) => -n)];
        if (!best || lexCompare(key, best.key) < 0) {
          best = { key, comp };
        }
      }
    }
  }
  return best.comp;
}

test('章节模式：方案唯一且最优 —— 与暴力搜索（拆分→补白→帖数→前帖装满）一致', () => {
  for (let L = 1; L <= 40; L++) {
    for (let S = 1; S <= 4; S++) {
      const r = computeImposition({ totalPages: L, sheetsPerSignature: S, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts: [1] });
      const expected = bestChapterPlanBruteForce(L, S);
      assert.deepEqual(sheetCountsOf(r), expected, `L=${L} S=${S}`);
      // 目标值本身也可直接核对
      const ch = r.chapterSplit.chapters[0];
      assert.equal(ch.splits, expected.length - 1);
      assert.equal(ch.blankPages, expected.reduce((a, b) => a + b, 0) * 4 - L);
    }
  }
});

test('章节模式：多章方案 = 各章独立最优方案的拼接', () => {
  const cases = [
    [20, 2, [1, 9]],
    [30, 3, [1, 7, 19]],
    [13, 2, [1, 9]],
    [25, 3, [4, 11]],
  ];
  cases.forEach(([N, S, starts]) => {
    const plan = planChapterSplit(N, S, starts);
    const segStarts = starts[0] === 1 ? starts : [1, ...starts];
    const expected = [];
    segStarts.forEach((s, i) => {
      const end = i + 1 < segStarts.length ? segStarts[i + 1] - 1 : N;
      expected.push(...bestChapterPlanBruteForce(end - s + 1, S));
    });
    assert.deepEqual(plan.sheetCounts, expected, `N=${N} S=${S} starts=${starts}`);
  });
});

test('章节模式：穷举页数 / 上限 / 章节组合，真实页连续唯一、空白只在章末、每帖不超限', () => {
  function startsCases(N) {
    const cases = [[1]];
    if (N >= 2) cases.push([1, Math.floor(N / 2) + 1]);
    if (N >= 3) cases.push([2]); // 含前言段
    if (N >= 5) cases.push([1, 3, N - 1]);
    return cases;
  }
  for (let N = 1; N <= 40; N++) {
    for (let S = 1; S <= 4; S++) {
      startsCases(N).forEach((chapterStarts) => {
        const r = computeImposition({ totalPages: N, sheetsPerSignature: S, binding: 'left', flip: 'short', chapterSplit: true, chapterStarts });
        // 每帖张数为整数且不超上限
        r.signatures.forEach((sig) => {
          assert.ok(Number.isInteger(sig.actualSheetCount));
          assert.ok(sig.actualSheetCount >= 1 && sig.actualSheetCount <= S);
        });
        // 真实页恰好覆盖 1..N 各一次
        const printed = allSlotsOf(r).filter((s) => !s.blank).map((s) => s.page).sort((a, b) => a - b);
        assert.deepEqual(printed, Array.from({ length: N }, (_, i) => i + 1), `N=${N} S=${S} starts=${chapterStarts}`);
        // 真实页范围跨帖连续：下一帖真实页紧接上一帖
        assert.equal(r.signatures[0].realPageStart, 1);
        for (let i = 1; i < r.signatures.length; i++) {
          assert.equal(r.signatures[i].realPageStart, r.signatures[i - 1].realPageEnd + 1);
        }
        assert.equal(r.signatures[r.signatures.length - 1].realPageEnd, N);
        // 空白只出现在各章末帖的末尾页位
        r.signatures.forEach((sig) => {
          assert.equal(sig.realPageStart, sig.pageStart);
          assert.equal(sig.blankPages, sig.pageEnd - sig.realPageEnd);
          const ch = r.chapterSplit.chapters[sig.chapterIndex - 1];
          if (sig.blankPages > 0) {
            assert.equal(sig.index, ch.signatureIndices[ch.signatureIndices.length - 1]);
            assert.equal(sig.realPageEnd, ch.pageEnd);
          }
        });
        // 章边界与用户输入一致，各章页段连续相接
        const chapters = r.chapterSplit.chapters;
        chapters.forEach((ch, i) => {
          assert.equal(ch.pageStart, i === 0 ? 1 : chapters[i - 1].pageEnd + 1);
          assert.equal(ch.splits, ch.signatureCount - 1);
          assert.equal(ch.blankPages, ch.sheetCount * 4 - ch.pageCount);
        });
        assert.equal(chapters[chapters.length - 1].pageEnd, N);
        chapterStarts.forEach((s) => {
          assert.ok(chapters.some((ch) => ch.pageStart === s));
        });
        // 顶层汇总一致
        assert.equal(r.blankPages, r.paddedPages - N);
        assert.equal(r.signatureCount, chapters.reduce((sum, c) => sum + c.signatureCount, 0));
        assert.equal(r.chapterSplit.totalSplits, chapters.reduce((sum, c) => sum + c.splits, 0));
        assert.equal(r.chapterSplit.totalSheets, chapters.reduce((sum, c) => sum + c.sheetCount, 0));
      });
    }
  }
});
