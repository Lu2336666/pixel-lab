import { createSign, createVerify, randomBytes } from 'node:crypto';

const PRICE = '2.88';
const SUBJECT = '像素风终身使用';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(extra.origin),
      ...extra.headers,
    },
  });
}

function corsHeaders(origin) {
  const allow = origin && /^https:\/\/([a-z0-9-]+\.)?github\.io$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ? origin
    : '*';
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'Content-Type, X-License, X-Device',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function envReady(env) {
  return !!(env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY && env.ALIPAY_PUBLIC_KEY && env.SITE_URL);
}

function beijingTime() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function signRSA2(content, pem) {
  const s = createSign('RSA-SHA256');
  s.update(content, 'utf8');
  return s.sign(normalizeKey(pem, 'PRIVATE'), 'base64');
}

function verifyRSA2(content, signature, pem) {
  const v = createVerify('RSA-SHA256');
  v.update(content, 'utf8');
  return v.verify(normalizeKey(pem, 'PUBLIC'), signature, 'base64');
}

function normalizeKey(pem, kind) {
  let t = String(pem || '').replace(/\\n/g, '\n').trim();
  if (!t.includes('BEGIN')) {
    if (kind === 'PRIVATE') {
      t = `-----BEGIN RSA PRIVATE KEY-----\n${t}\n-----END RSA PRIVATE KEY-----`;
    } else {
      t = `-----BEGIN PUBLIC KEY-----\n${t}\n-----END PUBLIC KEY-----`;
    }
  }
  return t;
}

function signContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

function alipayParams(env, extra) {
  const params = {
    app_id: env.ALIPAY_APP_ID,
    charset: 'utf-8',
    format: 'json',
    sign_type: 'RSA2',
    timestamp: beijingTime(),
    version: '1.0',
    ...extra,
  };
  params.sign = signRSA2(signContent(params), env.ALIPAY_PRIVATE_KEY);
  return params;
}

async function queryTrade(env, outTradeNo) {
  const params = alipayParams(env, {
    method: 'alipay.trade.query',
    biz_content: JSON.stringify({ out_trade_no: outTradeNo }),
  });
  const gateway = env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
  const res = await fetch(gateway, { method: 'POST', body: formBody(params) });
  return res.json();
}

function paidQuery(q) {
  return q && q.code === '10000' &&
    (q.trade_status === 'TRADE_SUCCESS' || q.trade_status === 'TRADE_FINISHED') &&
    String(q.total_amount) === PRICE;
}

function formBody(params) {
  const u = new URLSearchParams();
  Object.keys(params).forEach((k) => u.set(k, params[k]));
  return u;
}

async function parseBody(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return request.json();
  const text = await request.text();
  const u = new URLSearchParams(text);
  const o = {};
  for (const [k, v] of u.entries()) o[k] = v;
  return o;
}

function verifyNotify(params, env) {
  const sign = params.sign;
  if (!sign) return false;
  const copy = { ...params };
  delete copy.sign;
  delete copy.sign_type;
  return verifyRSA2(signContent(copy), sign, env.ALIPAY_PUBLIC_KEY);
}

function makeCode() {
  const n = randomBytes(5).toString('hex').toUpperCase();
  return `PX-${n.slice(0, 4)}-${n.slice(4)}`;
}

async function grantLicense(env, order) {
  const existing = order.deviceId ? await env.LICENSES.get(`dev:${order.deviceId}`, { type: 'json' }) : null;
  if (existing && existing.code) return existing;
  const code = makeCode();
  const rec = {
    code,
    deviceId: order.deviceId || '',
    tradeNo: order.tradeNo || '',
    outTradeNo: order.outTradeNo,
    paidAt: Date.now(),
    amount: PRICE,
  };
  await env.LICENSES.put(`code:${code}`, JSON.stringify(rec));
  if (order.deviceId) await env.LICENSES.put(`dev:${order.deviceId}`, JSON.stringify(rec));
  return rec;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const code = (request.headers.get('X-License') || url.searchParams.get('code') || '').trim().toUpperCase();
        const deviceId = (request.headers.get('X-Device') || url.searchParams.get('device') || '').trim();
        let rec = null;
        if (code) rec = await env.LICENSES.get(`code:${code}`, { type: 'json' });
        if (!rec && deviceId) rec = await env.LICENSES.get(`dev:${deviceId}`, { type: 'json' });
        if (!rec) return json({ ok: false }, 200, { origin });
        return json({ ok: true, code: rec.code, paidAt: rec.paidAt }, 200, { origin });
      }

      if (url.pathname === '/api/restore' && request.method === 'POST') {
        const body = await parseBody(request);
        const code = String(body.code || '').trim().toUpperCase();
        const deviceId = String(body.deviceId || '').trim();
        const rec = await env.LICENSES.get(`code:${code}`, { type: 'json' });
        if (!rec) return json({ ok: false, error: '凭证无效' }, 200, { origin });
        if (deviceId) {
          rec.deviceId = deviceId;
          await env.LICENSES.put(`code:${code}`, JSON.stringify(rec));
          await env.LICENSES.put(`dev:${deviceId}`, JSON.stringify(rec));
        }
        return json({ ok: true, code: rec.code }, 200, { origin });
      }

      if (url.pathname === '/api/pay' && request.method === 'POST') {
        if (!envReady(env)) {
          return json({ ok: false, error: '店主还没开通支付宝商户，暂时不能在线付款' }, 200, { origin });
        }
        const body = await parseBody(request);
        const deviceId = String(body.deviceId || '').trim();
        if (!deviceId) return json({ ok: false, error: '缺少设备号' }, 400, { origin });
        const owned = await env.LICENSES.get(`dev:${deviceId}`, { type: 'json' });
        if (owned && owned.code) return json({ ok: true, already: true, code: owned.code }, 200, { origin });

        const outTradeNo = `PX${Date.now()}${randomBytes(3).toString('hex')}`;
        const notifyUrl = new URL('/api/alipay/notify', url.origin).href;
        const returnUrl = new URL('/api/alipay/return', url.origin).href;
        const order = { deviceId, outTradeNo, status: 'pending', createdAt: Date.now() };
        await env.LICENSES.put(`order:${outTradeNo}`, JSON.stringify(order), { expirationTtl: 86400 * 7 });

        const biz = {
          subject: SUBJECT,
          out_trade_no: outTradeNo,
          total_amount: PRICE,
          product_code: 'QUICK_WAP_WAY',
          quit_url: env.SITE_URL,
        };
        const params = alipayParams(env, {
          method: 'alipay.trade.wap.pay',
          notify_url: notifyUrl,
          return_url: returnUrl,
          biz_content: JSON.stringify(biz),
        });
        const gateway = env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
        const payUrl = `${gateway}?${formBody(params).toString()}`;
        return json({ ok: true, payUrl, outTradeNo }, 200, { origin });
      }

      if (url.pathname === '/api/alipay/notify' && request.method === 'POST') {
        const params = await parseBody(request);
        if (!verifyNotify(params, env)) return new Response('fail', { status: 400 });
        if (params.app_id && params.app_id !== env.ALIPAY_APP_ID) return new Response('fail', { status: 400 });
        const okStatus = params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED';
        if (!okStatus) return new Response('success');
        if (String(params.total_amount) !== PRICE) return new Response('fail', { status: 400 });
        const outTradeNo = params.out_trade_no;
        const order = (await env.LICENSES.get(`order:${outTradeNo}`, { type: 'json' })) || { outTradeNo };
        order.status = 'paid';
        order.tradeNo = params.trade_no;
        order.buyerId = params.buyer_id || params.buyer_open_id || '';
        await env.LICENSES.put(`order:${outTradeNo}`, JSON.stringify(order));
        await grantLicense(env, order);
        return new Response('success');
      }

      if (url.pathname === '/api/alipay/return') {
        const params = Object.fromEntries(url.searchParams.entries());
        const site = (env.SITE_URL || 'https://lu2336666.github.io/pixel-lab/').replace(/\/?$/, '/');
        const outTradeNo = params.out_trade_no;
        if (!outTradeNo) return Response.redirect(`${site}?pay=fail`, 302);
        const data = await queryTrade(env, outTradeNo).catch(() => ({}));
        const q = data.alipay_trade_query_response || {};
        if (!paidQuery(q)) return Response.redirect(`${site}?pay=pending`, 302);
        const order = (await env.LICENSES.get(`order:${outTradeNo}`, { type: 'json' })) || { outTradeNo, deviceId: '' };
        order.status = 'paid';
        order.tradeNo = q.trade_no;
        await env.LICENSES.put(`order:${outTradeNo}`, JSON.stringify(order));
        const rec = await grantLicense(env, order);
        return Response.redirect(`${site}?unlock=${encodeURIComponent(rec.code)}`, 302);
      }

      if (url.pathname === '/api/query' && request.method === 'POST') {
        if (!envReady(env)) return json({ ok: false }, 200, { origin });
        const body = await parseBody(request);
        const outTradeNo = String(body.outTradeNo || '').trim();
        if (!outTradeNo) return json({ ok: false }, 400, { origin });
        const data = await queryTrade(env, outTradeNo).catch(() => ({}));
        const q = data.alipay_trade_query_response || {};
        if (paidQuery(q)) {
          const order = (await env.LICENSES.get(`order:${outTradeNo}`, { type: 'json' })) || { outTradeNo };
          if (body.deviceId && !order.deviceId) order.deviceId = String(body.deviceId);
          order.status = 'paid';
          order.tradeNo = q.trade_no;
          await env.LICENSES.put(`order:${outTradeNo}`, JSON.stringify(order));
          const rec = await grantLicense(env, order);
          return json({ ok: true, code: rec.code }, 200, { origin });
        }
        return json({ ok: false, pending: true }, 200, { origin });
      }

      return json({ ok: false, error: 'not found' }, 404, { origin });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500, { origin });
    }
  },
};
