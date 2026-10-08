(() => {
  const PRICE = (window.PIXEL_PAY && window.PIXEL_PAY.price) || '2.88';
  const DEV_KEY = 'pixel-lab-device';
  const LIC_KEY = 'pixel-lab-license';

  const $ = (id) => document.getElementById(id);

  function deviceId() {
    let id = localStorage.getItem(DEV_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `d${Date.now()}${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEV_KEY, id);
    }
    return id;
  }

  function apiBase() {
    return ((window.PIXEL_PAY && window.PIXEL_PAY.api) || '').replace(/\/$/, '');
  }

  function setPaid(code) {
    if (code) localStorage.setItem(LIC_KEY, code);
    window.__pixelPaid = true;
    document.documentElement.classList.add('paid');
    const wall = $('paywall');
    if (wall) wall.classList.add('hidden');
  }

  function setLocked() {
    window.__pixelPaid = false;
    document.documentElement.classList.remove('paid');
    const wall = $('paywall');
    if (wall) wall.classList.remove('hidden');
  }

  window.pixelPaid = () => !!window.__pixelPaid;

  async function check(code) {
    const api = apiBase();
    const license = (code || localStorage.getItem(LIC_KEY) || '').trim();
    if (!api) {
      setPaid(license || undefined);
      return true;
    }
    try {
      const u = new URL('/api/status', `${api}/`);
      if (license) u.searchParams.set('code', license);
      u.searchParams.set('device', deviceId());
      const res = await fetch(u.href, {
        headers: { 'X-License': license, 'X-Device': deviceId() },
      });
      const data = await res.json();
      if (data && data.ok) {
        setPaid(data.code || license);
        return true;
      }
    } catch (_) {}
    if (license && !api) {
      setPaid(license);
      return true;
    }
    setLocked();
    return false;
  }

  async function startPay() {
    const api = apiBase();
    const btn = $('btnPay');
    if (!api) {
      toast('还不能在线付款：需要店主开通支付宝商户并填收款地址');
      return;
    }
    btn.disabled = true;
    btn.textContent = '正在打开支付宝…';
    try {
      const res = await fetch(`${api}/api/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      const data = await res.json();
      if (data.already && data.code) {
        setPaid(data.code);
        toast('已经解锁过了');
        return;
      }
      if (!data.ok || !data.payUrl) {
        toast(data.error || '暂时无法付款');
        return;
      }
      sessionStorage.setItem('pixel-lab-order', data.outTradeNo || '');
      location.href = data.payUrl;
    } catch (_) {
      toast('网络不好，请再试一次');
    } finally {
      btn.disabled = false;
      btn.textContent = `支付宝支付 ¥${PRICE}`;
    }
  }

  async function restore() {
    const input = $('restoreCode');
    const code = (input.value || '').trim().toUpperCase();
    if (!code) {
      toast('请填写付款后的终身凭证');
      return;
    }
    const api = apiBase();
    if (!api) {
      setPaid(code);
      toast('已在本机解锁');
      return;
    }
    try {
      const res = await fetch(`${api}/api/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, deviceId: deviceId() }),
      });
      const data = await res.json();
      if (data && data.ok) {
        setPaid(data.code || code);
        toast('已终身解锁');
      } else {
        toast(data.error || '凭证无效');
      }
    } catch (_) {
      toast('网络不好，请再试一次');
    }
  }

  async function queryPending() {
    const api = apiBase();
    const order = sessionStorage.getItem('pixel-lab-order');
    if (!api || !order) return;
    try {
      const res = await fetch(`${api}/api/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outTradeNo: order, deviceId: deviceId() }),
      });
      const data = await res.json();
      if (data && data.ok && data.code) {
        sessionStorage.removeItem('pixel-lab-order');
        setPaid(data.code);
        toast('已付款，终身解锁');
      }
    } catch (_) {}
  }

  function toast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('on'), 1800);
  }

  function fromUrl() {
    const q = new URLSearchParams(location.search);
    const code = q.get('unlock');
    if (code) {
      localStorage.setItem(LIC_KEY, code.trim().toUpperCase());
      history.replaceState({}, '', location.pathname);
    }
    if (q.get('pay') === 'fail') {
      toast('支付没有完成');
      history.replaceState({}, '', location.pathname);
    }
    if (q.get('pay') === 'pending') {
      toast('正在确认付款…');
      history.replaceState({}, '', location.pathname);
    }
  }

  function bind() {
    const pay = $('btnPay');
    const go = $('btnRestore');
    const show = $('btnShowRestore');
    if (pay) pay.addEventListener('click', startPay);
    if (go) go.addEventListener('click', restore);
    if (show) {
      show.addEventListener('click', () => {
        $('restoreBox').classList.remove('hidden');
        show.classList.add('hidden');
      });
    }
  }

  fromUrl();
  bind();
  check().then((ok) => {
    if (!ok) queryPending();
  });
})();
