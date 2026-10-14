// Protocol/state tests only: mock network and Node crypto do not replace UTS compilation,
// Android secure-random validation, real IAM login, or iOS/HarmonyOS acceptance.
const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert/strict'),
  crypto = require('crypto');
const ts = require('typescript');
const path = require('node:path');
const check = require('node:test');
function configFixture(values) {
  const source = fs.readFileSync(path.join(__dirname, '../app/services/config.uts'), 'utf8');
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  Object.assign(context.exports.appEnvironment, values);
  return context.exports;
}
check('native app lifecycle accepts missing launch/show options and forwards actual auth links', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/App.uvue'), 'utf8');
  const nativeScript = app.split('// #ifdef APP')[1].split('// #endif')[0];
  const hooks = {}, links = [];
  const lifecycle = ts.transpileModule(nativeScript, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(lifecycle, {
    exports: {},
    require: () => ({ handleAuthCallback: (link) => links.push(link) }),
    onLaunch: (hook) => { hooks.launch = hook; },
    onAppShow: (hook) => { hooks.show = hook; },
  });
  for (const hook of Object.values(hooks)) {
    assert.doesNotThrow(() => hook(null));
    assert.doesNotThrow(() => hook(undefined));
    assert.doesNotThrow(() => hook({}));
    hook({ appScheme: 'com.rigour.workbench://auth/callback?code=scheme' });
    hook({ appLink: 'https://example.test/auth/callback?code=link' });
  }
  assert.equal(links.length, 4);
  assert.equal(links[0], 'com.rigour.workbench://auth/callback?code=scheme');
  assert.equal(links[1], 'https://example.test/auth/callback?code=link');
});
const filename = path.join(__dirname, '../app/services/auth.uts');
let source = fs.readFileSync(filename, 'utf8'),
  enabled = true,
  stack = [];
source = source
  .split('\n')
  .filter((line) => {
    const m = line.match(/\/\/ #(ifdef|ifndef) APP-ANDROID/);
    if (m) {
      stack.push(enabled);
      enabled = enabled && m[1] === 'ifdef';
      return false;
    }
    if (line.includes('// #endif')) {
      enabled = stack.pop();
      return false;
    }
    return enabled;
  })
  .join('\n');
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;
class Obj {
  constructor(data) {
    this.data = data;
  }
  getString(k) {
    return typeof this.data[k] === 'string' ? this.data[k] : null;
  }
  getNumber(k) {
    return typeof this.data[k] === 'number' ? this.data[k] : null;
  }
  getArray(k) {
    return Array.isArray(this.data[k]) ? this.data[k] : null;
  }
  getJSON(k) {
    return this.data[k] && typeof this.data[k] === 'object' && !Array.isArray(this.data[k])
      ? new Obj(this.data[k])
      : null;
  }
}
function fixture() {
  const requests = [],
    errors = [],
    urls = [],
    sessions = { authenticated: false, revision: 0 };
  let completed = 0,
    now = 100000;
  const env = {
    environment: 'production',
    gatewayOrigin: 'https://gateway.example.test',
    issuer: 'https://iam.example.test',
    clientId: 'test-public',
    redirectUri: 'com.rigour.workbench://auth/callback',
  };
  function clear() {
    sessions.authenticated = false;
    sessions.accessToken = '';
    sessions.revision++;
  }
  const config = configFixture(env);
  const modules = {
    './config.uts': config,
    './session.uts': { session: sessions, clearSession: clear },
    'java.security.SecureRandom': class {
      generateSeed(n) {
        return crypto.randomBytes(n);
      }
    },
    'java.security.MessageDigest': {
      getInstance: () => ({ digest: (v) => crypto.createHash('sha256').update(v).digest() }),
    },
    'android.util.Base64': {
      URL_SAFE: 8,
      NO_WRAP: 2,
      NO_PADDING: 1,
      encodeToString: (v) => Buffer.from(v).toString('base64url'),
    },
    'android.content.Intent': class {
      static ACTION_VIEW = 'VIEW';
      constructor(action, url) {
        this.url = url;
      }
    },
    'android.net.Uri': { parse: (x) => x },
    'kotlin.text.Charsets': { US_ASCII: 'ascii' },
    'io.dcloud.uts': {
      UTSAndroid: { getUniActivity: () => ({ startActivity: (i) => urls.push(i.url) }) },
    },
  };
  const context = {
    exports: {},
    UTSAndroid: modules['io.dcloud.uts'].UTSAndroid,
    require: (n) => modules[n],
    Buffer,
    uni: { request: (r) => requests.push(r), showToast: (r) => errors.push(r.title) },
    Date: { now: () => now },
    setTimeout: () => 1,
    clearTimeout: () => {},
    encodeURIComponent,
    decodeURIComponent,
  };
  vm.createContext(context);
  vm.runInContext(
    'String.prototype.toByteArray=function(){return Buffer.from(this.toString(),"ascii")}',
    context,
  );
  vm.runInContext(js, context);
  function begin() {
    context.exports.beginCompanyLogin(
      () => completed++,
      (m) => errors.push(m),
    );
  }
  function metadata(overrides = {}) {
    requests[0].success({
      statusCode: 200,
      data: new Obj({
        issuer: env.issuer,
        authorization_endpoint: env.issuer + '/oauth2/authorize',
        token_endpoint: env.issuer + '/oauth2/token',
        ...overrides,
      }),
    });
  }
  function callback(extra = '') {
    const u = new URL(urls[0]);
    return (
      env.redirectUri + '?state=' + u.searchParams.get('state') + '&code=one-time-code' + extra
    );
  }
  return {
    api: context.exports,
    env: config.appEnvironment,
    requests,
    errors,
    urls,
    sessions,
    begin,
    metadata,
    callback,
    get completed() {
      return completed;
    },
    advance: (n) => (now += n),
  };
}

check('unconfigured client does not request network', () => {
  const f = fixture();
  f.env.clientId = '';
  f.begin();
  assert.equal(f.requests.length, 0);
  assert.equal(f.errors.length, 1);
});
check('discovery endpoint cannot move token exchange off issuer origin', () => {
  const f = fixture();
  f.begin();
  f.metadata({ token_endpoint: 'https://attacker.example/token' });
  assert.equal(f.urls.length, 0);
  assert.equal(f.errors.length, 1);
});
check('real S256 challenge and independent crypto state', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  const url = new URL(f.urls[0]);
  assert.equal(url.searchParams.get('scope'), 'profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  f.api.handleAuthCallback(f.callback());
  const body = new URLSearchParams(f.requests[1].data);
  assert.equal(
    crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
    url.searchParams.get('code_challenge'),
  );
  assert.notEqual(body.get('code_verifier'), url.searchParams.get('state'));
});
check('identity requires authenticated me, not successful token response', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.callback());
  f.requests[1].success({
    statusCode: 200,
    data: new Obj({ access_token: 'test-access', token_type: 'Bearer', expires_in: 900 }),
  });
  assert.equal(f.sessions.authenticated, false);
  assert.equal(f.requests[2].url, f.env.gatewayOrigin + '/api/v1/me');
  f.requests[2].success({
    statusCode: 200,
    data: new Obj({
      id: 'u1',
      tenantId: 't1',
      principalScope: 'TENANT',
      username: 'sales-test',
      displayName: 'Test',
      permissions: ['order:read'],
    }),
  });
  assert.equal(f.completed, 1);
  assert.equal(f.sessions.authenticated, true);
});
check('wrong state never exchanges a code', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.env.redirectUri + '?state=wrong&code=abc');
  assert.equal(f.requests.length, 1);
  assert.equal(f.errors.length, 1);
});
check('duplicate callback is single use while exchange in flight', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  const url = f.callback();
  f.api.handleAuthCallback(url);
  f.api.handleAuthCallback(url);
  assert.equal(f.requests.length, 2);
});
check('duplicate state query parameters rejected', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.callback('&state=duplicate'));
  assert.equal(f.requests.length, 1);
  assert.equal(f.errors.length, 1);
});
check('expired callback rejected', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.advance(300001);
  f.api.handleAuthCallback(f.callback());
  assert.equal(f.requests.length, 1);
});
check('logout invalidates delayed token response', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.callback());
  f.api.logoutCompany();
  f.requests[1].success({
    statusCode: 200,
    data: new Obj({ access_token: 'test', token_type: 'Bearer', expires_in: 900 }),
  });
  assert.equal(f.requests.length, 2);
  assert.equal(f.sessions.authenticated, false);
});
check('wrong callback path ignored and never exchanges', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.callback().replace('/callback?', '/attacker?'));
  assert.equal(f.requests.length, 1);
  f.api.handleAuthCallback(f.callback());
  assert.equal(f.requests.length, 2);
});
check('implicit-token fragment rejected', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.callback() + '#access_token=test');
  assert.equal(f.requests.length, 1);
});
check('platform administrator without tenant cannot become sales user', () => {
  const f = fixture();
  f.begin();
  f.metadata();
  f.api.handleAuthCallback(f.callback());
  f.requests[1].success({
    statusCode: 200,
    data: new Obj({ access_token: 'test', token_type: 'Bearer', expires_in: 900 }),
  });
  f.requests[2].success({
    statusCode: 200,
    data: new Obj({ id: 'u1', principalScope: 'PLATFORM', permissions: ['*'] }),
  });
  assert.equal(f.sessions.authenticated, false);
  assert.equal(f.errors.length, 1);
});
