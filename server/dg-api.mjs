import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export class ApiError extends Error {
  constructor(message, code = 400, details = {}) { super(message); this.code = code; this.details = details; }
}

export async function loadSecurity() {
  const context = vm.createContext({ TextEncoder, TextDecoder, crypto: webcrypto, console: { error() {} }, self: {}, exported: {} });
  vm.runInContext(await fs.readFile(new URL('../vendor/security-glue.js', import.meta.url), 'utf8'), context, { timeout: 2000 });
  vm.runInContext(`const r = () => undefined; r.d = (o, g) => { for (const [k, get] of Object.entries(g)) Object.defineProperty(o, k, { get }); }; self.rspackChunkdg4[0][1][38646]({}, exported, r);`, context, { timeout: 2000 });
  const g = context.exported;
  const imports = { './security_web_bg.js': {
    __wbg_now_f2fad0055da717c7: g.eQ, __wbg_new_8a6f238a6ece86ea: g.$P,
    __wbg_stack_0ed75d68575b0f3c: g.x$, __wbg_error_7534b8e9a36f1ab4: g.WY,
    __wbindgen_object_drop_ref: g.bk, __wbg_getRandomValues_1c61fac11405ffdc: g.Tt,
    __wbindgen_cast_2241b6af4c4b2941: g.pY,
  } };
  const { instance } = await WebAssembly.instantiate(await fs.readFile(new URL('../vendor/security.wasm', import.meta.url)), imports);
  g.lI(instance.exports);
  return { encrypt: g.w, decrypt: g.Yc };
}

export class DgApi {
  constructor({ baseUrl = 'https://api4.dungeon-lab.cn/api', fetcher = fetch } = {}) {
    this.baseUrl = baseUrl; this.fetcher = fetcher; this.token = null; this.cookies = new Map(); this.security = loadSecurity();
  }
  credentials() { return { token: this.token, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }; }
  async request(route, body, method = body === undefined ? 'GET' : 'POST', credentials = this.credentials()) {
    if (!route.startsWith('/') || route.startsWith('//')) throw new ApiError('接口路径无效');
    const security = await this.security;
    const [encrypted, transformed] = security.encrypt(body === undefined ? '' : JSON.stringify(body), credentials.token).split('|');
    if (transformed === undefined) throw new ApiError('请求加密失败，请重新登录');
    const token = transformed.replace(/\.([^.]+)\./, (_, s) => `.${Buffer.from(s, 'utf8').toString('base64')}.`);
    const headers = { 'Content-Type': 'application/json;charset=utf-8', 'X-Locale': 'zh-CN' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (credentials.cookie) headers.Cookie = credentials.cookie;
    let response;
    try { response = await this.fetcher(this.baseUrl + route, { method, headers, body: body === undefined ? undefined : JSON.stringify([`dg-${encrypted}`]), redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new ApiError('无法连接官方服务，请检查服务器网络', 502); }
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const pair = cookie.split(';', 1)[0], at = pair.indexOf('=');
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    let value;
    try { value = await response.json(); } catch { throw new ApiError('官方服务要求完成图形验证。请先在官方 App 登录，再使用登录令牌连接。', 428, { verificationRequired: true }); }
    if (Array.isArray(value) && value[0]?.startsWith('dg-')) {
      try { value = JSON.parse(security.decrypt(value[0].slice(3))); }
      catch { throw new ApiError('官方响应解密失败，请重试', 502); }
    }
    if (!response.ok || (value.code !== undefined && value.code !== 200)) {
      const messages = { 401: '登录已失效，请重新登录', 429: '请求过于频繁，请稍后再试' };
      throw new ApiError(messages[value.code] || value.message || '官方接口拒绝了请求', response.status === 401 ? 401 : 400, { upstreamCode: value.code });
    }
    return value.data;
  }
  async login({ phone, email, password, phoneCountryCode = '86', token }) {
    if (token) this.token = String(token).trim();
    else {
      if (!password || (!phone && !email)) throw new ApiError('请填写账号和密码');
      this.token = null;
      const body = email ? { email: email.trim(), password: password.trim() } : { phone: phone.trim(), phoneCountryCode: String(phoneCountryCode).replace(/^\+/, ''), password: password.trim() };
      const data = await this.request(`/app/login/${email ? 'email' : 'phone'}-password`, body);
      if (!data?.token) throw new ApiError('登录响应没有返回有效令牌', 502);
      this.token = data.token;
    }
    try {
      const user = await this.request('/app/user/me');
      return { nickname: user.nickname || user.name || '已登录用户', id: user.id };
    } catch (error) { this.token = null; throw error; }
  }
  async join(code, password) { return this.request('/remote/room/join', { remoteCode: parseRoomCode(code), ...(password ? { roomPassword: password } : {}) }); }
  async leave(roomId, credentials = this.credentials()) { return this.request(`/remote/room/${encodeURIComponent(roomId)}/leave`, {}, 'POST', credentials); }
}

export function parseRoomCode(input) {
  let code = String(input || '').trim();
  if (/^(https?:|dglab4:)/i.test(code)) {
    try {
      const url = new URL(code);
      if (url.searchParams.get('action') !== 'remote') throw new Error();
      code = url.searchParams.get('code') || '';
    } catch { throw new ApiError('请粘贴官方远程房间邀请链接'); }
  }
  if (code.includes('#DGLAB-4#')) code = code.split('#DGLAB-4#')[1];
  if (!/^[A-Za-z0-9]{4,32}$/.test(code)) throw new ApiError('请输入有效远程码，或粘贴完整邀请链接');
  return code;
}
