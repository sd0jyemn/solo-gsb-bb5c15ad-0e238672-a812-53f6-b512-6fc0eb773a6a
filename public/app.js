'use strict';

/* 骑马钉拼版预演前端：调用 /api/impose 获取拼版结果，用原生 Canvas 逐张绘制纸面。 */

const BINDING_TEXT = { left: '左装订', right: '右装订' };
const FLIP_TEXT = { long: '长边翻转', short: '短边翻转' };

const CANVAS_W = 1240;
const CANVAS_H = 720;

const form = document.getElementById('imposeForm');
const errorBox = document.getElementById('errorBox');
const resultCard = document.getElementById('resultCard');
const summaryBox = document.getElementById('summary');
const sheetSelect = document.getElementById('sheetSelect');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const exportBtn = document.getElementById('exportBtn');
const canvas = document.getElementById('sheetCanvas');
const tableBody = document.querySelector('#sheetTable tbody');
const jsonPreview = document.getElementById('jsonPreview');

const state = {
  result: null,
  flat: [], // 展平的 (帖, 张) 索引，便于逐张浏览
  idx: 0,
};

/* ------------------------------ 数据获取与渲染 ------------------------------ */

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const payload = {
    totalPages: Number(document.getElementById('totalPages').value),
    sheetsPerSignature: Number(document.getElementById('sheetsPerSignature').value),
    balancedSplit: document.getElementById('balancedSplit').checked,
    binding: document.getElementById('binding').value,
    flip: document.getElementById('flip').value,
    paperThickness: Number(document.getElementById('paperThickness').value),
    maxCompensation: Number(document.getElementById('maxCompensation').value),
    paperWidth: Number(document.getElementById('paperWidth').value),
    paperHeight: Number(document.getElementById('paperHeight').value),
    pageWidth: Number(document.getElementById('pageWidth').value),
    pageHeight: Number(document.getElementById('pageHeight').value),
    bleedMm: Number(document.getElementById('bleedMm').value),
    safetyMm: Number(document.getElementById('safetyMm').value),
  };

  try {
    const resp = await fetch('/api/impose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || `服务器返回 ${resp.status}`);
    }
    state.result = data;
    state.flat = [];
    data.signatures.forEach((sig, si) => {
      sig.sheets.forEach((sheet, shi) => state.flat.push({ si, shi }));
    });
    state.idx = 0;
    resultCard.hidden = false;
    renderAll();
  } catch (err) {
    errorBox.textContent = `生成失败：${err.message}`;
    errorBox.hidden = false;
  }
});

prevBtn.addEventListener('click', () => {
  if (state.idx > 0) {
    state.idx -= 1;
    renderSheetNav();
    draw();
  }
});

nextBtn.addEventListener('click', () => {
  if (state.idx < state.flat.length - 1) {
    state.idx += 1;
    renderSheetNav();
    draw();
  }
});

sheetSelect.addEventListener('change', () => {
  state.idx = Number(sheetSelect.value);
  renderSheetNav();
  draw();
});

exportBtn.addEventListener('click', () => {
  if (!state.result) return;
  const blob = new Blob([JSON.stringify(state.result, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `imposition-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function renderAll() {
  renderSummary();
  renderSheetNav();
  renderTable();
  jsonPreview.textContent = JSON.stringify(state.result, null, 2);
  draw();
}

function renderSummary() {
  const r = state.result;
  const balanced = r.balanced && r.balanced.enabled;
  const modeText = balanced
    ? `均衡分帖：上限 ${r.input.sheetsPerSignature} 张/帖`
    : `固定分帖：每帖 ${r.input.sheetsPerSignature} 张（${r.pagesPerSignature} 页）`;
  const chips = [
    { text: `成品 ${r.input.totalPages} 页` },
    { text: modeText, cls: balanced ? 'balanced' : '' },
    { text: `共 ${r.signatureCount} 帖` },
    { text: `补白后 ${r.paddedPages} 页` },
    { text: r.blankPages > 0 ? `自动补空白页 ${r.blankPages} 页` : '无需补白', cls: r.blankPages > 0 ? 'warn' : '' },
    { text: BINDING_TEXT[r.input.binding] },
    { text: FLIP_TEXT[r.input.flip] },
  ];
  if (balanced) {
    const counts = r.balanced.actualSheetCounts;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    chips.push({
      text: min === max
        ? `各帖实际均为 ${min} 张`
        : `各帖实际 ${min}～${max} 张（[${counts.join(', ')}]）`,
      cls: 'balanced',
    });
    if (r.balanced.savedBlankPages > 0) {
      chips.push({
        text: `较固定分帖（${r.balanced.fixedPaddedPages} 页）节省空白页 ${r.balanced.savedBlankPages} 页`,
        cls: 'saved',
      });
    } else {
      chips.push({ text: '本页数下与固定分帖用纸相同', cls: 'balanced' });
    }
  }
  chips.push(
    r.creep.enabled
      ? { text: `爬移补偿：纸厚 ${formatMm(r.input.paperThickness)} mm · 上限 ${formatMm(r.input.maxCompensation)} mm`, cls: 'creep' }
      : { text: '爬移补偿：未启用', cls: 'creep-off' },
  );
  if (r.fit && r.fit.enabled) {
    chips.push(
      r.fit.ok
        ? { text: `适配检查：${r.fit.totalSlots} 个页位全部通过`, cls: 'fit-ok' }
        : { text: `适配检查：${r.fit.failCount} / ${r.fit.totalSlots} 页位不适配`, cls: 'fit-fail' }
    );
  }
  summaryBox.innerHTML = '';
  chips.forEach(({ text, cls }) => {
    const span = document.createElement('span');
    span.className = 'chip' + (cls ? ` ${cls}` : '');
    span.textContent = text;
    summaryBox.appendChild(span);
  });
}

/** mm 数值格式化为两位小数（保留正负号）。 */
function formatMm(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** 一张纸四个页位（正面左右 + 背面左右）。 */
function sheetSlots(sheet) {
  return [sheet.front.left, sheet.front.right, sheet.back.left, sheet.back.right];
}

/** 该张纸是否存在适配检查不合格的页位。 */
function sheetHasFitFail(sheet) {
  return sheetSlots(sheet).some((s) => s.fit && !s.fit.ok);
}

function renderSheetNav() {
  const r = state.result;
  const fitOn = r.fit && r.fit.enabled;
  sheetSelect.innerHTML = '';
  state.flat.forEach((pos, i) => {
    const sig = r.signatures[pos.si];
    const sheet = sig.sheets[pos.shi];
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `第 ${sig.index} 帖（${sig.actualSheetCount} 张） · 第 ${sheet.index} 张${fitOn && sheetHasFitFail(sheet) ? ' ⚠' : ''}`;
    sheetSelect.appendChild(opt);
  });
  sheetSelect.value = String(state.idx);
  prevBtn.disabled = state.idx === 0;
  nextBtn.disabled = state.idx === state.flat.length - 1;
}

function slotText(slot) {
  return slot.blank ? '空白' : `第 ${slot.page} 页`;
}

function renderTable() {
  const r = state.result;
  const creepOn = r.creep.enabled;
  const fitOn = r.fit && r.fit.enabled;
  const flipNote = r.input.flip === 'long'
    ? '背面：左右页位不变，内容旋转 180°'
    : '背面：左右页位互换';
  const creepNote = creepOn
    ? `爬移：左页位 ${r.input.binding === 'left' ? '+' : '−'} / 右页位 ${r.input.binding === 'left' ? '−' : '+'}，上限 ${formatMm(r.input.maxCompensation)} mm`
    : '爬移补偿未启用，offsetMm 均为 0';
  tableBody.innerHTML = '';
  r.signatures.forEach((sig) => {
    sig.sheets.forEach((sheet) => {
      [
        { name: '正面', side: sheet.front, note: '正面' },
        { name: '背面', side: sheet.back, note: flipNote },
      ].forEach(({ name, side, note }) => {
        const tr = document.createElement('tr');
        // 帖号单元格：均衡分帖下追加本帖实际张数（仅在每帖首行重复标注）
        const tdSig = document.createElement('td');
        tdSig.textContent = name === '正面'
          ? `${sig.index}${sig.actualSheetCount !== r.input.sheetsPerSignature ? `（${sig.actualSheetCount} 张）` : ''}`
          : '';
        tr.appendChild(tdSig);
        [String(sheet.index), name].forEach((t) => {
          const td = document.createElement('td');
          td.textContent = t;
          tr.appendChild(td);
        });
        [side.left, side.right].forEach((slot) => {
          const td = document.createElement('td');
          const main = document.createElement('div');
          main.textContent = slotText(slot);
          if (slot.blank) main.className = 'slot-blank';
          td.appendChild(main);
          const off = document.createElement('div');
          off.className = 'slot-offset' + (creepOn && slot.offsetMm !== 0 ? ' nonzero' : '');
          off.textContent = `偏移 ${slot.offsetMm > 0 ? '+' : ''}${formatMm(slot.offsetMm)} mm`;
          td.appendChild(off);
          if (fitOn && slot.fit) {
            const fitDiv = document.createElement('div');
            if (slot.fit.ok) {
              fitDiv.className = 'slot-fit ok';
              fitDiv.textContent = '✓ 适配';
            } else {
              const vs = slot.fit.violations;
              fitDiv.className = 'slot-fit fail';
              fitDiv.textContent = `⚠ ${vs[0].message}${vs.length > 1 ? `（共 ${vs.length} 项）` : ''}`;
              fitDiv.title = vs.map((v) => v.message).join('\n');
              td.classList.add('fit-fail');
            }
            td.appendChild(fitDiv);
          }
          if (slot.blank) td.classList.add('blank');
          tr.appendChild(td);
        });
        const tdNote = document.createElement('td');
        tdNote.textContent = `${note}；${creepNote}`;
        tr.appendChild(tdNote);
        tableBody.appendChild(tr);
      });
    });
  });
}

/* ------------------------------ Canvas 绘制 ------------------------------ */

function setupCanvas(height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  const r = state.result;
  if (!r) return;
  const pos = state.flat[state.idx];
  const sig = r.signatures[pos.si];
  const sheet = sig.sheets[pos.shi];
  const { flip, binding } = r.input;
  const fitOn = r.fit && r.fit.enabled;

  // 当前张全部超限原因（用于底部说明，并据此加高画布）
  const violations = [];
  if (fitOn) {
    [
      ['正面', sheet.front],
      ['背面', sheet.back],
    ].forEach(([sideName, side]) => {
      [
        ['左', side.left],
        ['右', side.right],
      ].forEach(([posName, slot]) => {
        if (slot.fit && !slot.fit.ok) {
          slot.fit.violations.forEach((v) => violations.push(`${sideName}${posName}页位（${slotText(slot)}）：${v.message}`));
        }
      });
    });
  }
  const noteLines = buildNotes(r.input, r.creep, fitOn ? r.fit : null, violations);
  const canvasH = Math.max(CANVAS_H, 540 + noteLines.length * 25 + 16);
  const ctx = setupCanvas(canvasH);

  // 背景
  ctx.fillStyle = '#f4f6fa';
  ctx.fillRect(0, 0, CANVAS_W, canvasH);

  // 标题区
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#16233b';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(
    `第 ${sig.index} / ${r.signatureCount} 帖 · 第 ${sheet.index} / ${sig.sheets.length} 张（本帖实际 ${sig.actualSheetCount} 张 · 页码 ${sig.pageStart}–${sig.pageEnd}）`,
    40, 44
  );
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#5a6b85';
  const sigCreepArr = sig.sheetCompensationMm || r.creep.sheetCompensationMm;
  const creepSubtitle = r.creep.enabled
    ? `　爬移补偿：纸厚 ${formatMm(r.input.paperThickness)} mm · 上限 ${formatMm(r.input.maxCompensation)} mm · 本张补偿 ${formatMm(sigCreepArr[sheet.index - 1])} mm`
    : '　爬移补偿未启用';
  const modeSubtitle = r.balanced && r.balanced.enabled
    ? `　均衡分帖（各帖实际张数差 ≤ 1）${r.balanced.savedBlankPages > 0 ? ` · 较固定分帖节省 ${r.balanced.savedBlankPages} 个空白页` : ''}`
    : '　固定分帖';
  ctx.fillText(
    `装订：${BINDING_TEXT[binding]}　双面翻转：${FLIP_TEXT[flip]}　成品 ${r.input.totalPages} 页 · 补白 ${r.blankPages} 页 · 共 ${r.paddedPages} 页${creepSubtitle}${modeSubtitle}`,
    40, 70
  );
  if (fitOn) {
    ctx.font = 'bold 14px system-ui, sans-serif';
    if (r.fit.ok) {
      ctx.fillStyle = '#1e7e34';
      ctx.fillText(
        `✓ 适配检查通过：纸张 ${formatMm(r.fit.paperWidth)}×${formatMm(r.fit.paperHeight)} mm，全部 ${r.fit.totalSlots} 个页位适配`,
        40, 94
      );
    } else {
      ctx.fillStyle = '#c92a2a';
      ctx.fillText(
        `✗ 适配检查未通过：${r.fit.failCount} / ${r.fit.totalSlots} 个页位超限（本张 ${violations.length} 项），详见下方说明与清单`,
        40, 94
      );
    }
  }

  const sheetW = 460;
  const sheetH = 340;
  const top = 136;
  const frontRect = { x: 70, y: top, w: sheetW, h: sheetH };
  const backRect = { x: 710, y: top, w: sheetW, h: sheetH };

  // 面板标题
  ctx.textAlign = 'center';
  ctx.fillStyle = '#16233b';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText('正面（第 1 面）', frontRect.x + sheetW / 2, top - 16);
  ctx.fillText(
    flip === 'long' ? '背面（第 2 面 · 内容旋转 180°）' : '背面（第 2 面）',
    backRect.x + sheetW / 2, top - 16
  );

  // 爬移像素比例：示意性放大，保证最大补偿量在页位内至少留 18px 边距且不超过页位宽 35%。
  // 均衡分帖下各帖按实际层数独立计算，故取所有帖补偿量的最大值。
  const perSigCreep = r.signatures.map((sg) => sg.sheetCompensationMm || r.creep.sheetCompensationMm);
  const allCreepVals = perSigCreep.flat();
  const maxCreepMm = r.creep.enabled && allCreepVals.length ? Math.max(...allCreepVals) : 0;
  const creepPxPerMm = maxCreepMm > 0
    ? Math.max(1, Math.min(30, (sheetW / 2 * 0.35 - 18) / maxCreepMm))
    : 0;
  const drawOpts = { creepPxPerMm, creepEnabled: r.creep.enabled, fitEnabled: fitOn };

  drawSheet(ctx, frontRect, sheet.front, { rotated: false, isBack: false, ...drawOpts });
  drawSheet(ctx, backRect, sheet.back, { rotated: flip === 'long', isBack: true, ...drawOpts });
  drawFlipDiagram(ctx, { x: 530, y: top, w: 180, h: sheetH }, flip);
  drawNotes(ctx, noteLines);
}

/** 绘制一张纸的一面：纸面、裁切角线、左右页位、折线与骑马钉。 */
function drawSheet(ctx, rect, side, opts) {
  // 阴影 + 纸面
  ctx.save();
  ctx.fillStyle = 'rgba(15, 30, 60, 0.12)';
  roundRect(ctx, rect.x + 5, rect.y + 7, rect.w, rect.h, 4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#33415c';
  ctx.lineWidth = 1.6;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawCropMarks(ctx, rect);

  const midX = rect.x + rect.w / 2;
  drawSlot(ctx, { x: rect.x, y: rect.y, w: rect.w / 2, h: rect.h }, side.left, opts, '左');
  drawSlot(ctx, { x: midX, y: rect.y, w: rect.w / 2, h: rect.h }, side.right, opts, '右');

  // 折线（订口）与骑马钉
  ctx.save();
  ctx.strokeStyle = '#d6336c';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(midX, rect.y + 2);
  ctx.lineTo(midX, rect.y + rect.h - 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8a94a6';
  [0.28, 0.72].forEach((t) => {
    const y = rect.y + rect.h * t;
    roundRect(ctx, midX - 2.5, y - 9, 5, 18, 2.5);
    ctx.fill();
  });
  ctx.fillStyle = '#d6336c';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('折线 · 订口（骑马钉）', midX, rect.y + rect.h + 20);
  ctx.restore();
}

/** 绘制一个页位：原始页位虚线框（爬移前）+ 补偿后实线框；页码 / 空白斜纹 / 页首方向 / 背面物理关系标注。 */
function drawSlot(ctx, rect, slot, opts, posName) {
  const pad = 10;
  const inner = { x: rect.x + pad, y: rect.y + pad, w: rect.w - pad * 2, h: rect.h - pad * 2 };

  // 爬移偏移（屏幕像素）：offsetMm 正 = 向右，负 = 向左
  let shiftPx = 0;
  if (opts.creepEnabled && slot.offsetMm) {
    shiftPx = slot.offsetMm * opts.creepPxPerMm;
    // 限制在页位内部，避免超出纸面
    const maxShift = rect.w - pad * 2 - 24;
    shiftPx = Math.max(-maxShift, Math.min(maxShift, shiftPx));
  }

  // 原始页位（爬移补偿前）：虚线框，仅在确有偏移时叠加显示
  if (shiftPx !== 0) {
    ctx.save();
    ctx.strokeStyle = '#b0691a';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(rect.x + pad, rect.y + pad, rect.w - pad * 2, rect.h - pad * 2);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 适配检查可视化：把页位可用矩形（mm）等比映射到页位内框，
  // 叠加成品页裁切框、出血框与安全区框（trim 坐标已含爬移偏移，故不随 shiftPx 平移）
  if (opts.fitEnabled && slot.fit) {
    const f = slot.fit;
    const sx = inner.w / f.rect.width;
    const sy = inner.h / f.rect.height;
    const map = (box) => ({
      x: inner.x + (box.x - f.rect.x) * sx,
      y: inner.y + (box.y - f.rect.y) * sy,
      w: Math.max(2, box.width * sx),
      h: Math.max(2, box.height * sy),
    });
    ctx.save();
    // 出血框：绿 = 落在纸张内，红 = 超出纸张
    const b = map(f.bleedBox);
    ctx.strokeStyle = f.ok ? '#2f9e44' : '#e03131';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    // 成品页裁切框
    const t = map(f.trim);
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(t.x, t.y, t.w, t.h);
    // 安全区框
    if (f.safeBox) {
      const s = map(f.safeBox);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // 不合格页位：红色圆徽标记
  if (opts.fitEnabled && slot.fit && !slot.fit.ok) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(rect.x + rect.w - 18, rect.y + 18, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#e03131';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', rect.x + rect.w - 18, rect.y + 19);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // 补偿后的页位（整体平移 shiftPx 后按原样式绘制）
  ctx.save();
  ctx.translate(shiftPx, 0);

  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;

  ctx.strokeStyle = shiftPx !== 0 ? '#e8820c' : '#c4ccd9';
  ctx.lineWidth = shiftPx !== 0 ? 1.8 : 1;
  ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);

  if (slot.blank) {
    // 空白页：灰色斜纹（补偿后位置）
    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip();
    ctx.strokeStyle = '#e3e8f0';
    for (let d = -inner.h; d < inner.w + inner.h; d += 12) {
      ctx.beginPath();
      ctx.moveTo(inner.x + d, inner.y);
      ctx.lineTo(inner.x + d + inner.h, inner.y + inner.h);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#9aa5b8';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('空白页', cx, cy);
    ctx.textBaseline = 'alphabetic';
  } else {
    ctx.save();
    if (opts.rotated) {
      // 长边翻转：背面内容旋转 180°（页首朝下）
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI);
      ctx.translate(-cx, -cy);
    }
    ctx.fillStyle = '#1d4ed8';
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(slot.page), cx, cy - 8);
    ctx.fillStyle = '#5a6b85';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(`第 ${slot.page} 页`, cx, cy + 30);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('▲ 页首', cx, inner.y + (shiftPx !== 0 ? 30 : 16));
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // 爬移偏移量标注（补偿后框内顶部）
  if (shiftPx !== 0) {
    ctx.fillStyle = '#b0691a';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const sign = slot.offsetMm > 0 ? '+' : '';
    ctx.fillText(`爬移 ${sign}${formatMm(slot.offsetMm)} mm`, cx, inner.y + 14);
  }

  // 页位角标
  ctx.fillStyle = '#8a94a6';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = posName === '左' ? 'left' : 'right';
  ctx.fillText(`${posName}页位`, posName === '左' ? inner.x + 2 : inner.x + inner.w - 2, inner.y + inner.h - 6);

  // 背面页位：标注物理上位于哪一正面页之背（折叠后阅读顺序校验）
  if (opts.isBack && !slot.blank && slot.backOf != null) {
    ctx.fillStyle = '#0f766e';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`位于正面第 ${slot.backOf} 页之背`, cx, inner.y + inner.h - 22);
  }
  ctx.restore();
}

/** 裁切角线。 */
function drawCropMarks(ctx, rect) {
  const len = 14;
  const gap = 5;
  const corners = [
    [rect.x, rect.y, -1, -1],
    [rect.x + rect.w, rect.y, 1, -1],
    [rect.x, rect.y + rect.h, -1, 1],
    [rect.x + rect.w, rect.y + rect.h, 1, 1],
  ];
  ctx.save();
  ctx.strokeStyle = '#8a94a6';
  ctx.lineWidth = 1;
  corners.forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * gap, y);
    ctx.lineTo(x + sx * (gap + len), y);
    ctx.moveTo(x, y + sy * gap);
    ctx.lineTo(x, y + sy * (gap + len));
    ctx.stroke();
  });
  ctx.restore();
}

function drawArrowHead(ctx, x, y, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-9, -5);
  ctx.lineTo(-9, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 正背面之间的翻转示意图：翻转轴 + 弧形箭头 + 说明。 */
function drawFlipDiagram(ctx, zone, flip) {
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;

  ctx.save();
  // 正面 -> 背面 大箭头
  const ay = zone.y + 34;
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#2563eb';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(zone.x + 10, ay);
  ctx.lineTo(zone.x + zone.w - 20, ay);
  ctx.stroke();
  drawArrowHead(ctx, zone.x + zone.w - 10, ay, 0, '#2563eb');
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('翻面印刷', cx, ay - 10);

  // 小纸张图标
  const iw = 84;
  const ih = 60;
  const ix = cx - iw / 2;
  const iy = cy - 46;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#33415c';
  ctx.lineWidth = 1.4;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.strokeRect(ix, iy, iw, ih);

  const iconCy = iy + ih / 2;
  const radius = iw / 2 + 16;

  ctx.strokeStyle = '#d6336c';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (flip === 'short') {
    ctx.moveTo(cx, iy - 18);
    ctx.lineTo(cx, iy + ih + 18);
  } else {
    ctx.moveTo(ix - 18, iconCy);
    ctx.lineTo(ix + iw + 18, iconCy);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 弧形翻转箭头
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (flip === 'short') {
    // 绕垂直轴：上方弧形箭头（左 -> 右）
    const a0 = Math.PI * 1.18;
    const a1 = Math.PI * 1.82;
    ctx.arc(cx, iconCy, radius, a0, a1);
    ctx.stroke();
    drawArrowHead(
      ctx,
      cx + radius * Math.cos(a1),
      iconCy + radius * Math.sin(a1),
      a1 + Math.PI / 2,
      '#2563eb'
    );
  } else {
    // 绕水平轴：右侧弧形箭头（上 -> 下）
    const a0 = -Math.PI / 3;
    const a1 = Math.PI / 3;
    ctx.arc(cx, iconCy, radius, a0, a1);
    ctx.stroke();
    drawArrowHead(
      ctx,
      cx + radius * Math.cos(a1),
      iconCy + radius * Math.sin(a1),
      a1 + Math.PI / 2,
      '#2563eb'
    );
  }

  // 说明文字
  ctx.fillStyle = '#16233b';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(FLIP_TEXT[flip], cx, iy + ih + 34);
  ctx.fillStyle = '#5a6b85';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(flip === 'short' ? '绕垂直短边翻转' : '绕水平长边翻转', cx, iy + ih + 54);
  ctx.fillText(flip === 'short' ? '背面左右页位互换' : '背面内容旋转 180°', cx, iy + ih + 72);
  ctx.restore();
}

/** 组装底部图例与规则说明行（含适配检查结果）。 */
function buildNotes(input, creep, fit, violations) {
  const lines = [
    { text: '图例：蓝色数字 = 成品页码；灰色斜纹 = 自动补齐的空白页；红色虚线 = 对折线（订口）；灰色小角线 = 裁切标记。' },
    {
      text: input.flip === 'long'
        ? '长边翻转：纸张绕水平长边翻转，背面左右页位与正面相同，背面内容旋转 180°（页首朝下）。'
        : '短边翻转：纸张绕垂直短边翻转，背面左右页位与正面互换，背面内容方向不变。',
    },
    {
      text: input.binding === 'left'
        ? '左装订：第 1 页位于正面右页位，书脊在左。'
        : '右装订：第 1 页位于正面左页位，书脊在右。',
    },
    { text: '背面每个页位标注了它物理上位于哪一正面页之背；沿折线对折并配帖装订后，页码首尾相接，阅读顺序连续。' },
  ];
  if (input.balancedSplit) {
    lines.push({
      text: '均衡分帖：以每帖张数为上限取最少帖数，整本所需纸张在各帖间均匀分配，各帖实际张数差不超过 1，各帖按自身页数连续编号，空白页只出现在末帖末尾；爬移补偿按各帖实际层数独立重算。',
      color: '#0b7285',
    });
  }
  if (creep && creep.enabled) {
    lines.push(
      {
        text: `爬移补偿：每帖由外向内第 i 张（i 从 0 起）补偿量 = min(i × ${formatMm(input.paperThickness)} mm × 2, ${formatMm(input.maxCompensation)} mm)；画布位移为示意性放大，非真实比例。`,
        color: '#b0691a',
      },
      {
        text: input.binding === 'left'
          ? '符号约定：左装订时左页位向外侧（+，向右）、右页位向外侧（−，向左）平移；橙色实线框为补偿后页位，橙色虚线框为原始页位。'
          : '符号约定：右装订时符号整体反转，右页位向外侧（+，向右）、左页位向外侧（−，向左）平移；橙色实线框为补偿后页位，橙色虚线框为原始页位。',
        color: '#b0691a',
      }
    );
  } else {
    lines.push({ text: '爬移补偿未启用（纸张厚度或最大补偿量为 0）：各页位 offsetMm 均为 0，仅显示原始拼版页位。', color: '#b0691a' });
  }
  if (fit && fit.enabled) {
    lines.push({
      text: `适配检查：纸张 ${formatMm(fit.paperWidth)}×${formatMm(fit.paperHeight)} mm · 页位 ${formatMm(fit.slotWidth)}×${formatMm(fit.slotHeight)} mm · 成品页 ${formatMm(fit.pageWidth)}×${formatMm(fit.pageHeight)} mm · 出血 ${formatMm(fit.bleedMm)} mm · 安全边距 ${formatMm(fit.safetyMm)} mm；蓝框 = 裁切线，绿/红虚框 = 出血范围（红 = 超出纸张），灰点框 = 安全区，红色圆徽 = 页位不适配。`,
    });
    if (violations.length === 0) {
      lines.push({ text: '✓ 本张全部页位适配通过。', color: '#1e7e34' });
    } else {
      violations.slice(0, 5).forEach((v) => lines.push({ text: `⚠ ${v}`, color: '#c92a2a' }));
      if (violations.length > 5) {
        lines.push({ text: `…其余 ${violations.length - 5} 项超限详见下方拼版清单。`, color: '#c92a2a' });
      }
    }
  }
  return lines;
}

/** 底部图例与规则说明。 */
function drawNotes(ctx, lines) {
  ctx.save();
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    ctx.fillStyle = line.color || '#5a6b85';
    ctx.fillText(`· ${line.text}`, 70, 540 + i * 25);
  });
  ctx.restore();
}
