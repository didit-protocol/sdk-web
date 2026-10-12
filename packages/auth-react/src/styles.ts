const light = [
  "--da-surface:#fff",
  "--da-surface-2:#f8f8f8",
  "--da-line:#ededed",
  "--da-line-soft:#f3f3f3",
  "--da-line-strong:#e1e1e1",
  "--da-heading:#1a1a1a",
  "--da-text:#333",
  "--da-text-subtle:#777",
  "--da-danger:#c4281c",
  "--da-danger-bg:#ffe9e7",
  "--da-danger-dot:#ff3b30",
  "--da-success:#1b7a3a",
  "--da-success-bg:#e7f7ec",
  "--da-wordmark:#191919",
  "--da-brand:var(--didit-auth-brand,#2567ff)"
].join(";");

const dark = [
  "--da-surface:#151517",
  "--da-surface-2:#1c1c1f",
  "--da-line:#2a2a2e",
  "--da-line-soft:#222225",
  "--da-line-strong:#34343a",
  "--da-heading:#f5f5f7",
  "--da-text:#e8e8ea",
  "--da-text-subtle:#9a9aa2",
  "--da-danger:#ff7a70",
  "--da-danger-bg:rgba(255,65,65,.14)",
  "--da-danger-dot:#ff5a52",
  "--da-success:#5bd68f",
  "--da-success-bg:rgba(65,217,127,.14)",
  "--da-wordmark:#fefefe",
  "--da-brand:var(--didit-auth-brand-dark,var(--didit-auth-brand,#2567ff))"
].join(";");

const card = "0 0 0 1px var(--da-line),0 16px 40px -28px rgba(15,30,80,.3)";

/** Every component's styles, scoped under `.didit-auth`. Rendered once by the provider. */
export const stylesheet = `
.didit-auth{${light};font-family:var(--didit-auth-font,inherit);font-optical-sizing:none;font-size:16px;line-height:1.55;color:var(--da-text);text-align:left;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.didit-auth[data-didit-theme=dark]{${dark}}
@media (prefers-color-scheme:dark){.didit-auth[data-didit-theme=auto]{${dark}}}
.didit-auth *,.didit-auth *::before,.didit-auth *::after{box-sizing:border-box}
.didit-ca{display:flex;flex-direction:column;min-width:0;border-radius:12px;background:var(--da-surface);box-shadow:${card};overflow:hidden}
.didit-ca-h{display:flex;flex-direction:column;gap:2px;padding:14px 16px 12px}
.didit-ca-title{margin:0;font-size:14px;font-weight:600;line-height:1.55;letter-spacing:-.2px;color:var(--da-heading)}
.didit-ca-sub{margin:0;font-size:12px;line-height:17px;color:var(--da-text-subtle)}
.didit-ca-list{margin:0;padding:0;list-style:none}
.didit-ca-r{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-top:1px solid var(--da-line-soft)}
.didit-ca-r.is-gone{background:var(--da-surface-2)}
.didit-ca-av{width:30px;height:30px;border-radius:9px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:var(--da-surface-2);box-shadow:inset 0 0 0 1px var(--da-line-strong);color:var(--da-heading);font-size:13px;font-weight:600}
.didit-ca-r.is-gone .didit-ca-av{opacity:.45}
.didit-ca-tx{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.didit-ca-n{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 6px}
.didit-ca-n b{font-size:13px;font-weight:600;color:var(--da-heading)}
.didit-ca-n span{font-size:11.5px;color:var(--da-text-subtle)}
.didit-ca-d{font-size:12px;line-height:17px;color:var(--da-text);text-wrap:pretty}
.didit-ca-m{font-size:11.5px;line-height:16px;color:var(--da-text-subtle)}
.didit-ca-btn{appearance:none;margin:0;display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:9999px;border:1px solid var(--da-line-strong);background:var(--da-surface);font:inherit;font-size:12px;font-weight:500;line-height:1.55;color:var(--da-danger);flex-shrink:0;white-space:nowrap;cursor:pointer}
.didit-ca-btn:disabled{cursor:default;opacity:.6}
.didit-ca-btn:focus-visible,.didit-ub-trigger:focus-visible{outline:2px solid var(--da-brand);outline-offset:2px}
.didit-status{position:relative;display:inline-flex;align-items:center;height:24px;padding:0 10px 0 24px;border-radius:9999px;font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;flex-shrink:0;background:var(--da-danger-bg);color:var(--da-danger)}
.didit-status::before{content:"";position:absolute;left:9px;top:9px;width:6px;height:6px;border-radius:9999px;background:var(--da-danger-dot)}
.didit-ca-empty{margin:0;padding:12px 16px;border-top:1px solid var(--da-line-soft);font-size:12px;line-height:17px;color:var(--da-text-subtle)}
.didit-ca-toast{display:flex;align-items:flex-start;gap:7px;margin:0 16px 12px;padding:8px 10px;border-radius:10px;background:var(--da-success-bg);color:var(--da-text);font-size:12px;line-height:17px}
.didit-ca-toast>svg{display:block;flex-shrink:0;margin-top:1px;color:var(--da-success)}
.didit-ca-toast.is-error{background:var(--da-danger-bg)}
.didit-ca-toast.is-error>svg{color:var(--da-danger)}
.didit-ca-foot{display:flex;align-items:center;justify-content:center;height:32px;border-top:1px solid var(--da-line-soft);background:var(--da-surface-2);font-size:11px;line-height:1.55;color:var(--da-text-subtle)}
.didit-lockup{position:relative;display:inline-block;height:12px;line-height:0;vertical-align:middle;margin-left:5px;color:var(--da-wordmark)}
.didit-lockup>svg{display:block}
.didit-lockup>.didit-wordmark{height:100%;width:auto}
.didit-lockup>.didit-ring{position:absolute;left:0;top:0}
.didit-ub{position:relative;display:inline-flex}
.didit-ub-trigger{appearance:none;margin:0;padding:0;border:0;background:none;border-radius:9999px;display:inline-flex;cursor:pointer}
.didit-ub-av{width:26px;height:26px;border-radius:9999px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--da-brand) 16%,transparent);color:var(--da-brand);font-size:10px;font-weight:700;line-height:1}
.didit-ub-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:50;min-width:232px;max-width:min(320px,calc(100vw - 24px));padding:6px;border-radius:12px;background:var(--da-surface);box-shadow:${card}}
.didit-ub-id{display:flex;align-items:center;gap:10px;margin-bottom:6px;padding:8px 8px 10px;border-bottom:1px solid var(--da-line-soft)}
.didit-ub-email{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--da-heading)}
.didit-ub-item{appearance:none;width:100%;display:flex;align-items:center;height:32px;margin:0;padding:0 8px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;line-height:1.55;color:var(--da-heading);text-align:left;cursor:pointer}
.didit-ub-item:hover,.didit-ub-item:focus-visible{background:var(--da-surface-2);outline:none}
@media (max-width:640px){
.didit-ca-h{padding:12px 12px 10px}
.didit-ca-r{flex-wrap:wrap;row-gap:8px;padding:10px 12px}
.didit-ca-tx{flex:1 1 calc(100% - 44px)}
.didit-ca-btn,.didit-ca-r>.didit-status{margin-left:40px}
.didit-ca-empty{padding:10px 12px}
.didit-ca-toast{margin:0 12px 10px;font-size:11.5px}
.didit-ca-foot .didit-lockup{height:10px}
}
`;
