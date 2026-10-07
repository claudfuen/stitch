/* eslint-disable @next/next/no-img-element */
// The look book: stage 02's proposal as a document to share and keep refining against. Art direction, the world in
// that look, then each character inside the world with the reference sheet the video models use. Every image is
// captioned with the model and provider that made it. /api/script-pdf?doc=look prints this page to a PDF.

import { load } from "@/lib/store"
import type { Candidate, SheetItem } from "@/lib/process"

const img = (file: string, w = 1280, v?: string) => `/api/thumb?src=${encodeURIComponent("/" + file)}&w=${w}${v ? `&v=${encodeURIComponent(v)}` : ""}`
const picked = (x: SheetItem) => x.candidates.find((c) => c.file === x.pick)
const cap = (c?: Candidate) => (c ? `${c.model} · ${c.provider}` : "")

export default async function LookBook({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p: slug } = await searchParams
  const project = await load(slug || undefined)
  const pr = project.process
  const items = pr?.sheets ?? []
  const of = (k: SheetItem["kind"]) => items.filter((x) => x.kind === k && !x.from)
  const world = [...of("location"), ...of("prop"), ...items.filter((x) => x.id === "audience")]
  const cast = of("cast").filter((x) => x.id !== "audience")
  const concept = pr?.concepts.find((c) => c.id === (pr.script.concept ?? pr.pick))
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const stage = pr?.stages.find((s) => s.id === "sheets")

  return (
    <div className="look-doc">
      <style>{css}</style>
      <section className="cover">
        <p className="kicker">Look book · {date} · {stage?.status === "approved" ? "Approved" : "For review"}</p>
        <h1>{concept?.title ?? project.title}</h1>
        <p className="logline">{concept?.logline ?? project.logline}</p>
        <h2>Art direction</h2>
        <div className="two">
          {of("look").map((x) => (
            <figure key={x.id}>
              {picked(x) && <img src={img(picked(x)!.file, 960, picked(x)!.at)} alt="" />}
              <figcaption><b>{x.name}</b> {x.brief}<span>{cap(picked(x))}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="page">
        <h2>The world</h2>
        <div className="three">
          {world.map((x) => (
            <figure key={x.id}>
              {picked(x) && <img src={img(picked(x)!.file, 640, picked(x)!.at)} alt="" />}
              <figcaption><b>{x.name}</b><span>{cap(picked(x))}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      {cast.map((x) => {
        const hero = x.scene ?? picked(x)
        const refs = x.views?.length ? x.views : []
        return (
          <section key={x.id} className="page character">
            <h2>{x.name}</h2>
            <p className="brief">{x.brief}</p>
            {hero && (
              <figure>
                <img src={img(hero.file, 960, hero.at)} alt="" />
                <figcaption><span>In the film: {cap(hero)}</span></figcaption>
              </figure>
            )}
            {refs.length > 0 && (
              <>
                <h3>Reference sheet · {refs.length} views · {[...new Set(refs.map(cap))].join(" / ")}</h3>
                <div className="sheet">
                  {refs.map((v) => (
                    <figure key={v.file}>
                      <img src={img(v.file, 320, v.at)} alt="" />
                      <figcaption><span>{v.view}</span></figcaption>
                    </figure>
                  ))}
                </div>
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}

const css = `
@page { size: letter landscape; margin: 0.5in 0.55in; @bottom-right { content: counter(page); font: 9pt Inter, sans-serif; color: #777; } }
html, body { background: #fff !important; }
.look-doc { background: #fff; color: #111; font-family: var(--font-sans), Inter, -apple-system, sans-serif; font-size: 10.5pt; line-height: 1.45; max-width: 10in; margin: 0 auto; padding: 0.4in 0; }
@media print { .look-doc { padding: 0; max-width: none; } }
.look-doc p, .look-doc figure { margin: 0; }
.look-doc img { display: block; width: 100%; height: auto; border-radius: 3px; }
.look-doc h1 { font-size: 26pt; line-height: 1.1; font-weight: 650; margin: 0.08in 0 0.08in; }
.look-doc h2 { font-size: 9pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; margin: 0.22in 0 0.1in; }
.look-doc h3 { font-size: 8.5pt; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #555; margin: 0.14in 0 0.06in; }
.kicker { font-size: 9pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; }
.logline { font-size: 12pt; max-width: 7.5in; }
figcaption { margin-top: 0.05in; font-size: 9pt; }
figcaption span { display: block; color: #666; font-size: 8pt; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.2in; }
.three { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.16in 0.14in; }
.page { break-before: page; }
.page > h2:first-child { margin-top: 0; }
.character .brief { max-width: 8in; margin-bottom: 0.1in; color: #333; }
.character > figure img { max-height: 4.1in; object-fit: cover; }
.sheet { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.08in; }
.sheet img { aspect-ratio: 1; object-fit: cover; object-position: top; }
figure { break-inside: avoid; }
`
