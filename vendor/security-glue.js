"use strict";
(self.rspackChunkdg4 = self.rspackChunkdg4 || []).push([
  [9015],
  {
    68906(e, n, r) {
      r.a(e, async function (e, _) {
        try {
          r.r(n);
          var t = r(3720),
            a = r(38646),
            c = e([t]);
          ((t = (c.then ? (await c)() : c)[0]),
            (0, a.lI)(t),
            r.d(n, {
              __wbg_error_7534b8e9a36f1ab4: () => a.WY,
              __wbg_getRandomValues_1c61fac11405ffdc: () => a.Tt,
              __wbg_new_8a6f238a6ece86ea: () => a.$P,
              __wbg_now_f2fad0055da717c7: () => a.eQ,
              __wbg_set_wasm: () => a.lI,
              __wbg_stack_0ed75d68575b0f3c: () => a.x$,
              __wbindgen_cast_2241b6af4c4b2941: () => a.pY,
              __wbindgen_object_drop_ref: () => a.bk,
              akita: () => a.b8,
              decrypt: () => a.Yc,
              encrypt: () => a.w,
              shiba: () => a.e,
              uid: () => a.Ld,
              verify: () => a.MX,
            }),
            _());
        } catch (e) {
          _(e);
        }
      });
    },
    38646(e, n, r) {
      function _(e) {
        a = e;
      }
      function t(e) {
        d === f.length && f.push(f.length + 1);
        var n = d;
        return ((d = f[n]), (f[n] = e), n);
      }
      (r(69160),
        r(46041),
        r(62355),
        r(5951),
        r(24910),
        r(93994),
        r(9366),
        r(51459),
        r(1254),
        r(79706),
        r(76609),
        r(45556),
        r(77423),
        r(28395),
        r(55453),
        r(35210),
        r(4607),
        r(80932),
        r(50567),
        r(56416),
        r(68513),
        r(73239),
        r(73967),
        r(79261),
        r(29397),
        r(43315),
        r(27718));
      var a,
        c = null;
      function o() {
        return (
          (null === c ||
            !0 === c.buffer.detached ||
            (void 0 === c.buffer.detached && c.buffer !== a.memory.buffer)) &&
            (c = new DataView(a.memory.buffer)),
          c
        );
      }
      var i = null;
      function l() {
        return (
          (null === i || 0 === i.byteLength) &&
            (i = new Uint8Array(a.memory.buffer)),
          i
        );
      }
      var f = Array(128).fill(void 0);
      f.push(void 0, null, !0, !1);
      var d = f.length;
      function u(e, n, r) {
        if (void 0 === r) {
          var _ = v.encode(e),
            t = n(_.length, 1) >>> 0;
          return (
            l()
              .subarray(t, t + _.length)
              .set(_),
            (h = _.length),
            t
          );
        }
        for (var a = e.length, c = n(a, 1) >>> 0, o = l(), i = 0; i < a; i++) {
          var f = e.charCodeAt(i);
          if (f > 127) break;
          o[c + i] = f;
        }
        if (i !== a) {
          (0 !== i && (e = e.slice(i)),
            (c = r(c, a, (a = i + 3 * e.length), 1) >>> 0));
          var d = l().subarray(c + i, c + a);
          ((i += v.encodeInto(e, d).written), (c = r(c, a, i, 1) >>> 0));
        }
        return ((h = i), c);
      }
      function b(e) {
        var n = f[e];
        return (e < 132 || ((f[e] = d), (d = e)), n);
      }
      var g = new TextDecoder("utf-8", { ignoreBOM: !0, fatal: !0 });
      g.decode();
      var w = 0;
      function s(e, n) {
        return (
          (w += n) >= 0x7ff00000 &&
            ((g = new TextDecoder("utf-8", {
              ignoreBOM: !0,
              fatal: !0,
            })).decode(),
            (w = n)),
          g.decode(l().subarray(e, e + n))
        );
      }
      var v = new TextEncoder();
      "encodeInto" in v ||
        (v.encodeInto = function (e, n) {
          var r = v.encode(e);
          return (n.set(r), { read: e.length, written: r.length });
        });
      var h = 0;
      function y(e, n) {
        var r = u(e, a.__wbindgen_malloc, a.__wbindgen_realloc),
          _ = h,
          t = u(n, a.__wbindgen_malloc, a.__wbindgen_realloc),
          c = h;
        return b(a.akita(r, _, t, c));
      }
      function m(e) {
        var n = u(e, a.__wbindgen_malloc, a.__wbindgen_realloc),
          r = h;
        return b(a.decrypt(n, r));
      }
      function p(e, n) {
        var r = u(e, a.__wbindgen_malloc, a.__wbindgen_realloc),
          _ = h,
          t = null == n ? 0 : u(n, a.__wbindgen_malloc, a.__wbindgen_realloc),
          c = h;
        return b(a.encrypt(r, _, t, c));
      }
      function k(e) {
        var n = u(e, a.__wbindgen_malloc, a.__wbindgen_realloc),
          r = h;
        return b(a.shiba(n, r));
      }
      function x(e) {
        var n = u(e, a.__wbindgen_malloc, a.__wbindgen_realloc),
          r = h;
        return b(a.uid(n, r));
      }
      function I(e) {
        var n = u(e, a.__wbindgen_malloc, a.__wbindgen_realloc),
          r = h;
        return b(a.verify(n, r));
      }
      function Y(e, n) {
        var r, _, t;
        try {
          ((r = e), (_ = n), console.error(((t = e), s((t >>>= 0), n))));
        } finally {
          a.__wbindgen_free(r, _, 1);
        }
      }
      function T() {
        return (function (e, n) {
          try {
            return e.apply(this, n);
          } catch (e) {
            a.__wbindgen_exn_store(t(e));
          }
        })(function (e, n) {
          var r;
          globalThis.crypto.getRandomValues(
            ((r = e >>> 0), l().subarray(r / 1, r / 1 + n)),
          );
        }, arguments);
      }
      function $() {
        return t(Error());
      }
      function D() {
        return Date.now();
      }
      function M(e, n) {
        var r = u(f[n].stack, a.__wbindgen_malloc, a.__wbindgen_realloc),
          _ = h;
        (o().setInt32(e + 4, _, !0), o().setInt32(e + 0, r, !0));
      }
      function V(e, n) {
        return t(s(e >>> 0, n));
      }
      function j(e) {
        b(e);
      }
      r.d(n, {
        $P: () => $,
        Ld: () => x,
        MX: () => I,
        Tt: () => T,
        WY: () => Y,
        Yc: () => m,
        b8: () => y,
        bk: () => j,
        e: () => k,
        eQ: () => D,
        lI: () => _,
        pY: () => V,
        w: () => p,
        x$: () => M,
      });
    },
    3720(e, n, r) {
      var _ = r(38646);
      e.exports = r.v(n, e.id, "a2041415a1b983fd", {
        "./security_web_bg.js": {
          __wbg_now_f2fad0055da717c7: _.eQ,
          __wbg_new_8a6f238a6ece86ea: _.$P,
          __wbg_stack_0ed75d68575b0f3c: _.x$,
          __wbg_error_7534b8e9a36f1ab4: _.WY,
          __wbindgen_object_drop_ref: _.bk,
          __wbg_getRandomValues_1c61fac11405ffdc: _.Tt,
          __wbindgen_cast_2241b6af4c4b2941: _.pY,
        },
      });
    },
  },
]);
//# sourceMappingURL=9015.fd05b86ee7.js.map
