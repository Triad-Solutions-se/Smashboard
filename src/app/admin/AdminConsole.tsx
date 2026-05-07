"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerCustomer, inviteOwner, deleteTenant, uploadLogo } from "./actions";

export type CustomerRow = {
  id: string;
  slug: string;
  name: string;
  primary_color: string | null;
  logo_url: string | null;
  created_at: string;
  owners: { email: string; confirmed: boolean }[];
  memberCount: number;
};

const APP_DOMAIN = "triadsolutions.se";

export function AdminConsole({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#9fc843");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [reinviteFor, setReinviteFor] = useState<string | null>(null);
  const [reinviteEmail, setReinviteEmail] = useState("");
  const [reinviteMsg, setReinviteMsg] = useState<string | null>(null);

  function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
    setLogoUrl("");
  }

  function clearLogo() {
    setLogoFile(null);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    setLogoUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    start(async () => {
      let resolvedLogoUrl: string | null = null;

      if (logoFile) {
        setUploading(true);
        const fd = new FormData();
        fd.append("file", logoFile);
        const up = await uploadLogo(fd);
        setUploading(false);
        if (!up.ok) {
          setError(up.error);
          return;
        }
        resolvedLogoUrl = up.url;
      }

      const r = await registerCustomer({
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        primary_color: color,
        logo_url: resolvedLogoUrl,
        ownerEmail: ownerEmail.trim(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSuccessMsg(
        `${name} registrerad. Inbjudan skickad till ${ownerEmail}.`
      );
      setSlug("");
      setName("");
      setOwnerEmail("");
      clearLogo();
      router.refresh();
    });
  }

  function onReinvite(tenantId: string) {
    setReinviteMsg(null);
    start(async () => {
      const r = await inviteOwner({ tenantId, email: reinviteEmail.trim() });
      if (!r.ok) {
        setReinviteMsg(`Fel: ${r.error}`);
        return;
      }
      setReinviteMsg(`Ny inbjudan skickad till ${reinviteEmail}`);
      setReinviteEmail("");
      router.refresh();
    });
  }

  function onDelete(tenantId: string, tenantName: string) {
    if (!confirm(`Ta bort ${tenantName}? Detta raderar all data permanent.`)) return;
    start(async () => {
      const r = await deleteTenant({ tenantId });
      if (!r.ok) {
        alert(`Fel: ${r.error}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Smashboard Admin</h1>
            <p className="text-sm text-neutral-500">
              Triad Solutions — {customers.length}{" "}
              {customers.length === 1 ? "kund" : "kunder"}
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button className="text-sm text-neutral-600 hover:text-neutral-900">
              Logga ut
            </button>
          </form>
        </header>

        <section className="bg-white border border-neutral-200 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-medium mb-1">Registrera ny kund</h2>
          <p className="text-sm text-neutral-500 mb-4">
            Skapar anläggning + skickar inbjudan till ägaren i ett steg.
          </p>
          <form onSubmit={onRegister} className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Företagsnamn
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bon Padel"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white placeholder:text-neutral-400"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Subdomän
              </label>
              <div className="flex items-center border border-neutral-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500 bg-white">
                <input
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="bonpadel"
                  className="flex-1 px-3 py-2 text-sm outline-none text-neutral-900 placeholder:text-neutral-400"
                />
                <span className="px-3 py-2 text-sm text-neutral-500 bg-neutral-50 border-l border-neutral-300">
                  .{APP_DOMAIN}
                </span>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Färg
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="border border-neutral-300 rounded-lg h-10 w-14 cursor-pointer bg-white"
                />
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-neutral-300 bg-white font-mono text-xs text-neutral-900"
                />
              </div>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Logotyp <span className="text-neutral-400">(valfritt)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={onLogoChange}
                  className="hidden"
                  id="logo-file-input"
                />
                <label
                  htmlFor="logo-file-input"
                  className="cursor-pointer flex items-center gap-2 border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-600 bg-white hover:bg-neutral-50 transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                  {logoFile ? logoFile.name : "Välj fil…"}
                </label>
                {logoFile && (
                  <button
                    type="button"
                    onClick={clearLogo}
                    className="text-neutral-400 hover:text-neutral-700 text-lg leading-none"
                    aria-label="Ta bort logo"
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-neutral-400">PNG, JPEG, WebP, SVG · max 2 MB</p>
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Förhandsvisning
              </label>
              <BrandPreview name={name} color={color} logoUrl={logoPreview ?? logoUrl} />
            </div>
            <div className="md:col-span-6">
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Ägarens e-post
              </label>
              <input
                required
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="agare@bonpadel.se"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900 bg-white placeholder:text-neutral-400"
              />
            </div>
            <button
              type="submit"
              disabled={pending || uploading}
              className="md:col-span-6 bg-neutral-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
            >
              {uploading ? "Laddar upp logotyp…" : pending ? "Registrerar…" : "Registrera kund + skicka inbjudan"}
            </button>
            {error && <p className="text-sm text-red-600 md:col-span-6">{error}</p>}
            {successMsg && (
              <p className="text-sm text-emerald-700 md:col-span-6 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                {successMsg}
              </p>
            )}
          </form>
        </section>

        <section className="bg-white border border-neutral-200 rounded-2xl p-6">
          <h2 className="text-lg font-medium mb-4">Kunder</h2>
          {customers.length === 0 ? (
            <p className="text-sm text-neutral-500">Inga kunder registrerade än.</p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {customers.map((c) => {
                const accent = c.primary_color || "#9fc843";
                const pendingOwner = c.owners.some((o) => !o.confirmed);
                return (
                  <li key={c.id} className="py-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className="inline-flex items-center justify-center h-10 w-10 rounded-lg font-black shrink-0 overflow-hidden"
                          style={{ backgroundColor: `${accent}22`, color: accent }}
                        >
                          {c.logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.logo_url}
                              alt=""
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            c.name.charAt(0).toUpperCase()
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium truncate text-neutral-900">{c.name}</p>
                          <a
                            className="text-sm text-neutral-500 hover:text-neutral-900 underline"
                            href={`https://${c.slug}.${APP_DOMAIN}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {c.slug}.{APP_DOMAIN}
                          </a>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {c.owners.length === 0 ? (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                Ingen ägare
                              </span>
                            ) : (
                              c.owners.map((o) => (
                                <span
                                  key={o.email}
                                  className={`text-xs px-2 py-0.5 rounded border ${
                                    o.confirmed
                                      ? "bg-neutral-50 text-neutral-700 border-neutral-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  }`}
                                  title={o.confirmed ? "Aktiverad" : "Inbjuden, ej aktiverad"}
                                >
                                  {o.email}
                                  {!o.confirmed && " · väntar"}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-neutral-400">
                          {new Date(c.created_at).toLocaleDateString("sv-SE")}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              setReinviteFor(reinviteFor === c.id ? null : c.id)
                            }
                            className="text-sm text-emerald-700 hover:underline"
                          >
                            {reinviteFor === c.id ? "Avbryt" : pendingOwner ? "Ny inbjudan" : "Bjud in fler"}
                          </button>
                          <button
                            onClick={() => onDelete(c.id, c.name)}
                            disabled={pending}
                            className="text-sm text-red-600 hover:underline disabled:opacity-50"
                          >
                            Ta bort
                          </button>
                        </div>
                      </div>
                    </div>
                    {reinviteFor === c.id && (
                      <div className="flex flex-col gap-2 pl-13">
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={reinviteEmail}
                            onChange={(e) => setReinviteEmail(e.target.value)}
                            placeholder="ny@email.se"
                            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm flex-1 text-neutral-900 bg-white placeholder:text-neutral-400"
                          />
                          <button
                            onClick={() => onReinvite(c.id)}
                            disabled={pending || !reinviteEmail}
                            className="bg-neutral-900 text-white rounded-lg px-4 text-sm disabled:opacity-50"
                          >
                            Skicka
                          </button>
                        </div>
                        {reinviteMsg && (
                          <p className="text-xs text-neutral-600">{reinviteMsg}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function BrandPreview({
  name,
  color,
  logoUrl,
}: {
  name: string;
  color: string;
  logoUrl: string;
}) {
  const accent = color || "#9fc843";
  const initial = (name || "?").charAt(0).toUpperCase();
  const validLogo = /^(https?:|blob:)/i.test(logoUrl.trim());
  return (
    <div className="h-10 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2">
      <span
        className="inline-flex items-center justify-center h-7 w-7 rounded-md font-black text-sm overflow-hidden shrink-0"
        style={{ backgroundColor: `${accent}22`, color: accent }}
      >
        {validLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          initial
        )}
      </span>
      <span
        className="px-2 py-1 rounded-md text-white text-[11px] font-semibold"
        style={{ backgroundColor: accent }}
      >
        Knapp
      </span>
    </div>
  );
}
