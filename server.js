const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

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

const DEFAULT_ADMIN = { id:1, username:'admin', password:'admin123', role:'admin', name:'管理员', createdAt:'' };

// ══════════════════════════════════════════
// 读取所有数据（GET /api/data）
// ══════════════════════════════════════════
app.get('/api/data', async (req, res) => {
  try {
    // 并行读取所有表
    const [
      loansRes, paymentsRes, extensionsRes, expensesRes,
      appointmentsRes, usersRes, configRes
    ] = await Promise.all([
      supabase.from('loans').select('id, data').order('id'),
      supabase.from('payments').select('id, data').order('id'),
      supabase.from('extensions').select('id, data').order('id'),
      supabase.from('expenses').select('id, data').order('id'),
      supabase.from('appointments').select('id, data').order('id'),
      supabase.from('users').select('id, data').order('id'),
      supabase.from('config').select('key, value')
    ]);

    // 转换格式：每行的data字段就是原始对象
    if (loansRes.error) console.error('loans error:', loansRes.error.message);
    if (paymentsRes.error) console.error('payments error:', paymentsRes.error.message);
    if (usersRes.error) console.error('users error:', usersRes.error.message);

    const loans = (loansRes.data || []).map(r => ({ ...r.data, id: r.id }));
    const payments = (paymentsRes.data || []).map(r => ({ ...r.data, id: r.id }));
    const extensions = (extensionsRes.data || []).map(r => ({ ...r.data, id: r.id }));
    const expenses = (expensesRes.data || []).map(r => ({ ...r.data, id: r.id }));
    const appointments = (appointmentsRes.data || []).map(r => ({ ...r.data, id: r.id }));

    console.log(`Loaded: loans=${loans.length} payments=${payments.length} users=${(usersRes.data||[]).length}`);

    // 用户：如果没有则初始化
    let users = (usersRes.data || []).map(r => ({ ...r.data, id: r.id }));
    if (users.length === 0) {
      await supabase.from('users').upsert([{ id: 1, data: DEFAULT_ADMIN }], { onConflict: 'id' });
      users = [DEFAULT_ADMIN];
    }

    // 配置：stores、company、nextId
    const configMap = {};
    (configRes.data || []).forEach(r => { configMap[r.key] = r.value; });

    // nextId：取最大loan id + 1，或从config取
    let nextId = configMap['nextId'] || 1001;
    if (loans.length > 0) {
      const maxId = Math.max(...loans.map(l => +l.id || 0));
      if (maxId >= nextId) nextId = maxId + 1;
    }

    const result = {
      loans,
      payments,
      extensions,
      expenses,
      appointments,
      users,
      stores: configMap['stores'] || [],
      company: configMap['company'] || { name: 'PAWN SYSTEM', address: '', phone: '', note: '' },
      nextId
    };

    res.json(result);
  } catch(e) {
    console.error('GET /api/data error:', e.message);
    res.status(500).json({ error: 'DB_ERROR', message: e.message });
  }
});

// ══════════════════════════════════════════
// 保存数据（POST /api/data）
// 智能差量更新：只更新变化的记录
// ══════════════════════════════════════════
app.post('/api/data', async (req, res) => {
  try {
    const body = req.body;
    const ops = [];

    // 保存loans
    if (Array.isArray(body.loans)) {
      const rows = body.loans.map(l => ({ id: l.id, data: l }));
      if (rows.length > 0) {
        ops.push(supabase.from('loans').upsert(rows, { onConflict: 'id' }));
      }
    }

    // 保存payments
    if (Array.isArray(body.payments)) {
      const rows = body.payments.map(p => ({ id: p.id, loan_id: p.loanId, data: p }));
      if (rows.length > 0) {
        ops.push(supabase.from('payments').upsert(rows, { onConflict: 'id' }));
      }
    }

    // 保存extensions
    if (Array.isArray(body.extensions)) {
      const rows = body.extensions.map(e => ({ id: e.id, loan_id: e.loanId, data: e }));
      if (rows.length > 0) {
        ops.push(supabase.from('extensions').upsert(rows, { onConflict: 'id' }));
      }
    }

    // 保存expenses
    if (Array.isArray(body.expenses)) {
      const rows = body.expenses.map(e => ({ id: e.id, data: e }));
      if (rows.length > 0) {
        ops.push(supabase.from('expenses').upsert(rows, { onConflict: 'id' }));
      }
    }

    // 保存appointments
    if (Array.isArray(body.appointments)) {
      const rows = body.appointments.map(a => ({ id: a.id, data: a }));
      if (rows.length > 0) {
        ops.push(supabase.from('appointments').upsert(rows, { onConflict: 'id' }));
      }
    }

    // 保存users
    if (Array.isArray(body.users)) {
      const rows = body.users.map(u => ({ id: u.id, data: u }));
      if (rows.length > 0) {
        ops.push(supabase.from('users').upsert(rows, { onConflict: 'id' }));
      }
    }

    // 保存config（stores、company、nextId）
    const configRows = [];
    if (body.stores !== undefined) configRows.push({ key: 'stores', value: body.stores });
    if (body.company !== undefined) configRows.push({ key: 'company', value: body.company });
    if (body.nextId !== undefined) configRows.push({ key: 'nextId', value: body.nextId });
    if (configRows.length > 0) {
      ops.push(supabase.from('config').upsert(configRows, { onConflict: 'key' }));
    }

    // 并行执行所有操作
    const results = await Promise.all(ops);
    const errors = results.filter(r => r.error).map(r => r.error.message);
    if (errors.length > 0) {
      console.error('Save errors:', errors);
      return res.status(500).json({ error: errors.join('; ') });
    }

    res.json({ ok: true });
  } catch(e) {
    console.error('POST /api/data error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// 保存单条记录（POST /api/save-record）
// ══════════════════════════════════════════
app.post('/api/save-record', async (req, res) => {
  try {
    const { table, record } = req.body;
    const allowed = ['loans','payments','extensions','expenses','appointments','users'];
    if (!allowed.includes(table)) return res.json({ ok: false, error: '无效表名' });
    if (!record || !record.id) return res.json({ ok: false, error: '记录缺少id' });

    let row = { id: record.id, data: record };
    if (table === 'payments' || table === 'extensions') {
      row.loan_id = record.loanId || null;
    }

    const { error } = await supabase.from(table).upsert([row], { onConflict: 'id' });
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// 保存config（nextId、stores、company）
app.post('/api/save-config', async (req, res) => {
  try {
    const { key, value } = req.body;
    const allowed = ['nextId','stores','company'];
    if (!allowed.includes(key)) return res.json({ ok: false, error: '无效key' });
    const { error } = await supabase.from('config').upsert([{ key, value }], { onConflict: 'key' });
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════
// 删除单条记录（POST /api/delete-record）
// ══════════════════════════════════════════
app.post('/api/delete-record', async (req, res) => {
  try {
    const { table, id } = req.body;
    const allowed = ['loans','payments','extensions','expenses','appointments','users'];
    if (!allowed.includes(table)) return res.json({ ok: false, error: '无效表名' });
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════
// 测试连接
// ══════════════════════════════════════════
app.get('/api/test', async (req, res) => {
  try {
    const { data, error } = await supabase.from('loans').select('id').limit(1);
    if (error) return res.json({ ok: false, message: error.message });
    res.json({ ok: true, message: '数据库连接正常（新表结构）', loans: data.length });
  } catch(e) {
    res.json({ ok: false, message: e.message });
  }
});

// ══════════════════════════════════════════
// 重置管理员
// ══════════════════════════════════════════
app.get('/api/reset-admin', async (req, res) => {
  try {
    await supabase.from('users').upsert([{ id: 1, data: DEFAULT_ADMIN }], { onConflict: 'id' });
    res.json({ ok: true, message: '✅ 管理员账号已重置！用户名: admin，密码: admin123' });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════
// 备份
// ══════════════════════════════════════════
app.get('/api/backup', async (req, res) => {
  try {
    const [loansRes, paymentsRes, usersRes, configRes] = await Promise.all([
      supabase.from('loans').select('id, data').order('id'),
      supabase.from('payments').select('id, data').order('id'),
      supabase.from('users').select('id, data').order('id'),
      supabase.from('config').select('key, value')
    ]);
    const configMap = {};
    (configRes.data||[]).forEach(r=>{ configMap[r.key]=r.value; });
    const backup = {
      loans: (loansRes.data||[]).map(r=>({...r.data,id:r.id})),
      payments: (paymentsRes.data||[]).map(r=>({...r.data,id:r.id})),
      users: (usersRes.data||[]).map(r=>({...r.data,id:r.id})),
      stores: configMap['stores']||[],
      company: configMap['company']||{},
      nextId: configMap['nextId']||1001,
      backupDate: new Date().toISOString()
    };
    res.setHeader('Content-Disposition', `attachment; filename="pawn_backup_${new Date().toISOString().slice(0,10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// 材料上传
// ══════════════════════════════════════════
app.post('/api/upload-doc', async (req, res) => {
  try {
    const { loanId, docKey, base64 } = req.body;
    if (!loanId || !docKey || !base64) return res.json({ ok: false, error: '参数缺失' });
    const matches = base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches) return res.json({ ok: false, error: '图片格式错误' });
    const buffer = Buffer.from(matches[2], 'base64');
    const filePath = `loans/${loanId}/${docKey}.jpg`;
    const { error } = await supabase.storage
      .from('pawn-documents')
      .upload(filePath, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return res.json({ ok: false, error: error.message });
    const { data: urlData } = supabase.storage.from('pawn-documents').getPublicUrl(filePath);
    res.json({ ok: true, url: urlData.publicUrl });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/delete-doc', async (req, res) => {
  try {
    const { loanId, docKey } = req.body;
    const filePath = `loans/${loanId}/${docKey}.jpg`;
    await supabase.storage.from('pawn-documents').remove([filePath]);
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  📱 手机抵押贷款管理系统 v2.0`);
  console.log(`  ✅ 独立表结构 - 防并发覆盖`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`${'═'.repeat(50)}\n`);
});
