#!/usr/bin/env node
/**
 * push_repo.js — 把 index.html / data.json 推送到 GitHub Pages 仓库
 *
 * 用法:
 *   GITHUB_TOKEN=ghp_xxxxx node push_repo.js [owner/repo]
 *
 * 环境变量:
 *   GITHUB_TOKEN  — GitHub fine-grained PAT（仅授权目标仓库 Contents 读写）
 *
 * 可选参数:
 *   owner/repo    — 仓库全名，默认从 GH_REPO 环境变量读取，再默认 <username>.github.io
 *
 * 本脚本只推送 index.html 和 data.json，绝不碰 userData.json。
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.argv[2] || process.env.GH_REPO || '';

if (!TOKEN) {
  console.error('❌ 缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}
if (!REPO) {
  console.error('❌ 缺少仓库参数，用法: GITHUB_TOKEN=xxx node push_repo.js owner/owner.github.io');
  process.exit(1);
}

const API_HOST = 'api.github.com';
const FILES = ['index.html', 'data.json'];

function ghRequest(method, p, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: API_HOST,
      path: `/repos/${REPO}/contents/${p}`,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'qiao-workbench-push'
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function pushFile(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filename}`);
    return;
  }
  const content = fs.readFileSync(filePath);
  const b64 = Buffer.from(content).toString('base64');

  // 先 GET 获取 sha（文件已存在时需要 sha 才能 PUT 更新）
  let sha = null;
  const getRes = await ghRequest('GET', filename);
  if (getRes.status === 200 && getRes.json && getRes.json.sha) {
    sha = getRes.json.sha;
  }

  // PUT
  const putBody = {
    message: `chore: update ${filename} ${new Date().toISOString().slice(0, 16)}`,
    content: b64,
    branch: 'main'
  };
  if (sha) putBody.sha = sha;

  let putRes = await ghRequest('PUT', filename, putBody);

  // 409 重试一次
  if (putRes.status === 409) {
    console.log(`⚠️ 409 冲突，重试 ${filename}...`);
    const reGet = await ghRequest('GET', filename);
    if (reGet.status === 200 && reGet.json && reGet.json.sha) {
      putBody.sha = reGet.json.sha;
    }
    putRes = await ghRequest('PUT', filename, putBody);
  }

  if (putRes.status === 200 || putRes.status === 201) {
    console.log(`✅ ${filename} 推送成功`);
  } else {
    console.error(`❌ ${filename} 推送失败: ${putRes.status}`, putRes.json?.message || putRes.raw || '');
  }
}

(async () => {
  console.log(`🚀 开始推送到 ${REPO}`);
  for (const f of FILES) {
    await pushFile(f);
  }
  console.log('🎉 完成！');
})();
