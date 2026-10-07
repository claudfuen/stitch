// The script as a document to share: a title page, the cast, then a two-column AV script (picture | sound and
// dialogue) with timecodes, the standard layout for commercials. /api/script-pdf prints this page to a PDF.
// Always light, whatever the app's theme, because it is paper.

import { load } from "@/lib/store"
import { runtime, words } from "@/lib/process"

const tc = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`

export default async function PrintScript({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p: slug } = await searchParams
  const project = await load(slug || undefined)
  const pr = project.process
  const concept = pr?.concepts.find((c) => c.id === (pr.script.concept ?? pr.pick))
  const beats = pr?.script.beats ?? []
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const script = pr?.stages.find((s) => s.id === "script")

  return (
    <div className="script-doc">
      <style>{css}</style>

      <section className="title-page">
        <p className="kicker">Comp AI · {project.runtimeTarget}-second spot</p>
        <h1>{concept?.title ?? project.title}</h1>
        <p className="logline">{concept?.logline ?? project.logline}</p>
        <p className="meta">
          Draft {pr?.script.version ?? 1} · {date} · {tc(runtime(beats))} · {words(beats)} words
          {script && script.status !== "pending" ? ` · ${script.status === "approved" ? "Approved" : script.status === "changes" ? "Changes requested" : "Rejected"}` : " · For review"}
        </p>
        {concept?.pitch && (
          <div className="block">
            <h2>The idea</h2>
            <p>{concept.pitch}</p>
            {concept.why && <p className="muted">{concept.why}</p>}
          </div>
        )}
        {pr?.cast?.length ? (
          <div className="block">
            <h2>Cast</h2>
            <dl className="cast">
              {pr.cast.map((c) => (
                <div key={c.id}>
                  <dt>{c.name}</dt>
                  <dd>{c.who}</dd>
                  <dd className="muted">{c.playedBy} · {c.voice}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>

      <section className="script">
        <h2>Script</h2>
        <table>
          <thead>
            <tr>
              <th className="col-time">Time</th>
              <th>Picture</th>
              <th>Sound and dialogue</th>
            </tr>
          </thead>
          <tbody>
            {beats.map((b, i) => (
              <tr key={b.id}>
                <td className="col-time">
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <br />
                  {tc(b.t0)}
                </td>
                <td>
                  <p className="beat">{b.title}</p>
                  <p>{b.picture}</p>
                  {b.camera && <p className="muted">{b.camera}</p>}
                </td>
                <td>
                  {b.lines.map((l, j) => (
                    <div key={j} className="line">
                      <p className="who">
                        {l.who}
                        {(l.vo || l.how) && <span className="how"> ({[l.vo && "V.O.", l.how].filter(Boolean).join(", ")})</span>}
                      </p>
                      <p>{l.text}</p>
                    </div>
                  ))}
                  {b.sound && <p className="muted">{b.sound}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

const css = `
@page { size: letter; margin: 0.7in 0.75in; @bottom-right { content: counter(page); font: 9pt Inter, sans-serif; color: #777; } }
html, body { background: #fff !important; }
.script-doc { background: #fff; color: #111; font-family: var(--font-sans), Inter, -apple-system, sans-serif; font-size: 11pt; line-height: 1.5; max-width: 8in; margin: 0 auto; padding: 0.5in 0; }
@media print { .script-doc { padding: 0; max-width: none; } }
.script-doc p { margin: 0; }
.script-doc h1 { font-size: 28pt; line-height: 1.1; font-weight: 650; letter-spacing: -0.01em; margin: 0.15in 0 0.12in; }
.script-doc h2 { font-size: 9pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; margin: 0 0 0.1in; }
.kicker { font-size: 9pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; }
.logline { font-size: 13pt; line-height: 1.45; max-width: 6in; }
.meta { margin-top: 0.12in !important; font-size: 9.5pt; color: #555; }
.muted { color: #5c5c5c; font-size: 10pt; }
.block { margin-top: 0.3in; }
.block > p { max-width: 6.2in; }
.block p + p { margin-top: 0.08in; }
.cast { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.14in 0.3in; }
.cast dd { font-size: 10pt; line-height: 1.4; }
.cast dt { font-size: 9.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.cast dd { margin: 0; }
.title-page { break-after: page; }
.script table { width: 100%; border-collapse: collapse; }
.script th { text-align: left; font-size: 8.5pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; border-bottom: 1.5px solid #111; padding: 0 0.12in 0.06in 0; }
.script td { vertical-align: top; padding: 0.12in 0.16in 0.12in 0; border-bottom: 1px solid #ddd; }
.script tr { break-inside: avoid; }
.script td:nth-child(2) { width: 48%; }
.col-time { width: 0.55in; font-family: var(--font-mono), ui-monospace, monospace; font-size: 9pt; color: #555; white-space: nowrap; }
.num { color: #111; font-weight: 600; }
.beat { font-weight: 650; margin-bottom: 0.04in !important; }
.script td p + p { margin-top: 0.05in; }
.line + .line { margin-top: 0.08in; }
.who { font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.how { font-weight: 400; letter-spacing: 0; text-transform: none; color: #5c5c5c; }
`
