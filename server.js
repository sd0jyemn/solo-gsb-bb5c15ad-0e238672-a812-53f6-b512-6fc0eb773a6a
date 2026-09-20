'use strict';

const path = require('path');
const express = require('express');
const { computeImposition } = require('./src/imposition');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * 拼版计算接口。
 * 请求体：{
 *   totalPages, sheetsPerSignature, binding: 'left'|'right', flip: 'long'|'short',
 *   paperThickness?, maxCompensation?,                       // 可选，纸张厚度与爬移最大补偿量（mm，缺省/为 0 不补偿）
 *   balancedSplit?,                                          // 可选，true = 均衡分帖（缺省 false = 固定分帖）
 *   chapterSplit?, chapterStarts?                            // 可选，章节优先分帖（与均衡分帖互斥）：
 *                                                            //   chapterSplit = true 时 chapterStarts 为严格递增的章节起始页数组
 * }
 * 响应：拼版清单 JSON（与前端「导出拼版清单 JSON」内容一致）
 */
app.post('/api/impose', (req, res) => {
  try {
    const result = computeImposition(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => {
  console.log(`骑马钉拼版预演已启动: http://localhost:${PORT}`);
});
