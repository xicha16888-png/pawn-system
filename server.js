const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_KEY || '').trim();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getInitData() {
  return {
    loans: [], payments: [], extensions: [], expenses: [], stores: [],
    company: { name: 'PAWN SYSTEM', address: '', phone: '', note: '' },
    nextId: 1001,
    users: [{ id:1, username:'admin', password:'admin123', role:'admin', name:'管理员', createdAt:'' }]
  };
}

async function loadData() {
  const { data, error } = await supabase.from('pawndata').select('key, value');
  if (error) throw new Error('DB_READ_ERROR: ' + error.message);
  if (!data || data.length === 0) {
    const init = getInitData();
    const rows = Object.entries(init).map(([key, value]) => ({ key, value }));
    await supabase.from('pawndata').upsert(rows, { onConflict: 'key' });
    return init;
  }
  const result = {};
  data.forEach(row => { result[row.key] = row.value; });
  const init = getInitData();
  Object.keys(init).forEach(k => { if (result[k] === undefined) result[k] = init[k]; });
  return result;
}

app.get('/api/data', async (req, res) => {
  try {
    const data = await loadData();
    if (!data || typeof data !== 'object') return res.status(500).json({ error: 'DATA_INVALID' });
    const arrKeys = ['loans','payments','extensions','expenses','stores','users'];
    arrKeys.forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
    if (!data.nextId) data.nextId = 1001;
    if (!data.company) data.company = getInitData().company;
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: 'DB_ERROR', message: e.message });
  }
});

app.post('/api/data', async (req, res) => {
  try {
    const body = req.body;
    const allowed = ['loans','payments','extensions','expenses','stores','company','nextId','users'];
    const rows = Object.entries(body)
      .filter(([k]) => allowed.includes(k))
      .map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from('pawndata').upsert(rows, { onConflict: 'key' });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    const { data, error } = await supabase.from('pawndata').select('key').limit(1);
    if (error) return res.json({ ok: false, message: error.message });
    res.json({ ok: true, message: '数据库连接正常', rows: data.length });
  } catch(e) {
    res.json({ ok: false, message: e.message });
  }
});

// 紧急重置管理员账号（访问此接口即可重置）
app.get('/api/reset-admin', async (req, res) => {
  try {
    const { data, error } = await supabase.from('pawndata').select('key, value').eq('key', 'users');
    if (error) throw new Error(error.message);
    const defaultAdmin = { id:1, username:'admin', password:'admin123', role:'admin', name:'管理员', createdAt:'' };
    let users = [];
    if (data && data.length > 0 && Array.isArray(data[0].value)) {
      users = data[0].value;
      // 找到admin账号并重置，如果没有则新增
      const idx = users.findIndex(u => u.username === 'admin');
      if (idx >= 0) {
        users[idx] = { ...users[idx], password: 'admin123', role: 'admin' };
      } else {
        users.unshift(defaultAdmin);
      }
    } else {
      users = [defaultAdmin];
    }
    const { error: e2 } = await supabase.from('pawndata').upsert([{ key: 'users', value: users }], { onConflict: 'key' });
    if (e2) throw new Error(e2.message);
    res.json({ ok: true, message: '✅ 管理员账号已重置！用户名: admin，密码: admin123，请立即登录并修改密码。' });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/backup', async (req, res) => {
  try {
    const data = await loadData();
    res.setHeader('Content-Disposition', `attachment; filename="pawn_backup_${new Date().toISOString().slice(0,10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  📱 手机抵押贷款管理系统`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`${'═'.repeat(50)}\n`);
});
