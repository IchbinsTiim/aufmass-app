/** Wortmarke der Anwendung – auf allen Seiten der Hülle dieselbe. */
export function Marke({ untertitel }: { untertitel?: string }) {
  return (
    <div className="auth-marke">
      <p className="auth-eyebrow">Gerüstbau · Aufmaß-Suite</p>
      <span className="auth-logo">
        <span className="auth-logo-mark" aria-hidden="true" />
        Aufmaß<span className="auth-logo-x">X</span>
      </span>
      {untertitel ? <p className="auth-sub">{untertitel}</p> : null}
    </div>
  );
}
