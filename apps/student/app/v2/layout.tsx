/**
 * /v2 — local layout. Loads Computer Modern Serif (the prototype's CDN) and
 * defines the three design keyframes (ldPop / ldGlow / ldFlip). Scoped to /v2;
 * does not affect any other route.
 */
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Computer Modern Serif — exact CDN used by the design prototype. */}
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/aaaakshat/cm-web-fonts@latest/fonts.css" />
      <style>{`
        @keyframes ldPop{0%{transform:scale(1)}40%{transform:scale(1.025)}100%{transform:scale(1)}}
        @keyframes ldGlow{0%{box-shadow:0 0 0 0 rgba(16,185,129,0)}30%{box-shadow:0 0 0 5px rgba(16,185,129,.22)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
        @keyframes ldFlip{0%{opacity:0;transform:rotateX(-8deg) translateY(5px)}100%{opacity:1;transform:rotateX(0) translateY(0)}}
        @keyframes ldShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes ldSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
        .ld-serif{font-family:'Computer Modern Serif',Georgia,serif;}
        .ld-tl-row:hover{background:#f5f7ff}
        .ld-dock-row:hover{background:#f5f5f5}
        .ld-iconbtn:hover{background:#eff6ff;color:#4f46e5}
        .ld-railicon:hover{background:#eff6ff;color:#4f46e5}
        .ld-act:hover{border-color:#bfdbfe;box-shadow:0 4px 16px 0 rgba(59,130,246,.12)}
        .ld-resize:hover{background:#dbeafe}
        .ld-tipwrap{position:relative}
        .ld-tip{position:absolute;left:-2px;top:calc(100% + 7px);width:196px;background:#171717;color:#fff;font-size:11px;font-weight:400;line-height:1.45;letter-spacing:normal;text-transform:none;padding:8px 10px;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.22);opacity:0;visibility:hidden;transform:translateY(-3px);transition:opacity .12s,transform .12s,visibility .12s;z-index:40;pointer-events:none}
        .ld-tipwrap:hover .ld-tip{opacity:1;visibility:visible;transform:translateY(0)}
        .ld-dots::-webkit-scrollbar{display:none}
      `}</style>
      {children}
    </>
  );
}
