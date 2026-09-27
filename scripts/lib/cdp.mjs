/**
 * 极简 CDP 客户端 —— 只用 Node 22 自带的 `fetch` + 全局 `WebSocket`，**零依赖**。
 *
 * 用途：连到 Android WebView 的 devtools 端点，在页面里跑 JS、派发触摸事件。
 *
 * 前置（在宿主机执行）：
 *   adb -s <serial> shell cat /proc/net/unix | grep devtools     # 找 @webview_devtools_remote_<pid>
 *   adb -s <serial> forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *
 * 背景：wry 在 debug 构建下会调 `WebView.setWebContentsDebuggingEnabled(true)`
 * （`wry/src/android/main_pipe.rs`，`#[cfg(any(debug_assertions, feature = "devtools"))]`），
 * 所以 debug 包天然可调试 —— 这条通道是移动端唯一能"脚本化验收"的路子
 * （`adb shell input` 做不了双指，而验收要求模拟多指）。
 */

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9222;

/** 列出 devtools 端点下的所有目标（page / iframe / worker …）。 */
export async function listTargets({ host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 10000 } = {}) {
  const url = `http://${host}:${port}/json/list`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/** 选一个 page 目标。默认优先匹配 tauri.localhost（就是这个应用的 WebView）。 */
export async function pickPage({ host, port, match = /tauri\.localhost|^https?:\/\// } = {}) {
  const targets = await listTargets({ host, port });
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (pages.length === 0) {
    throw new Error('没有 type=page 的目标 —— 应用起来了吗？转发端口对吗？');
  }
  return pages.find((p) => match.test(p.url || '')) ?? pages[0];
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this._seq = 0;
    this._pending = new Map();
    this._handlers = new Map();
  }

  /**
   * 连接（自动挑 page 目标）。
   * @returns {Promise<Cdp>}
   */
  static async attach({ host, port, match } = {}) {
    const page = await pickPage({ host, port, match });
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error(`连不上 ${page.webSocketDebuggerUrl}`)), { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (ev) => cdp._dispatch(ev.data));
    cdp.page = page;
    return cdp;
  }

  _dispatch(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, reject, timer } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.error) {
        const extra = msg.error.data ? `: ${msg.error.data}` : '';
        reject(new Error(`${msg.error.message}${extra} [${msg.method ?? ''}]`));
      } else {
        resolve(msg.result);
      }
      return;
    }
    if (msg.method) {
      for (const cb of this._handlers.get(msg.method) ?? []) cb(msg.params);
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP 超时 ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, cb) {
    const list = this._handlers.get(method) ?? [];
    list.push(cb);
    this._handlers.set(method, list);
  }

  /**
   * 在页面里求值。
   * ⚠️ 嵌套的对象/数组要 `returnByValue`（默认开），否则拿回的是 handle。
   */
  async evaluate(expression, { awaitPromise = true, returnByValue = true, timeoutMs = 30000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue }, timeoutMs);
    if (r.exceptionDetails) {
      const desc = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error(`页面内异常：${desc}`);
    }
    return r.result?.value;
  }

  /** 在页面里执行一个函数（自动序列化，内部可以正常写反引号/模板串）。 */
  async call(fn, ...args) {
    const src = `(${fn.toString()})(...${JSON.stringify(args)})`;
    return this.evaluate(src);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
