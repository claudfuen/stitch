import React from "react"
import { Composition } from "remotion"
import { Captions, CaptionGood, CaptionImpossible } from "./Captions"
import { CalendarFlip } from "./CalendarFlip"
import { DashboardScore } from "./DashboardScore"
import { EndCard } from "./EndCard"
import { CaptionTrack, type CaptionProps } from "./CaptionTrack"
import { FormStamp } from "./FormStamp"
import { LaptopScreen } from "./LaptopScreen"
import { MinistrySign } from "./MinistrySign"
import { TicketDisplay } from "./TicketDisplay"

const base = { width: 1920, height: 1080, fps: 24 }
export const COMPS = [
  { id: "MinistrySign", component: MinistrySign, durationInFrames: 48 },
  { id: "TicketDisplay", component: TicketDisplay, durationInFrames: 96 },
  { id: "FormStamp", component: FormStamp, durationInFrames: 120 },
  { id: "CalendarFlip", component: CalendarFlip, durationInFrames: 96 },
  { id: "DashboardScore", component: DashboardScore, durationInFrames: 120 },
  { id: "Captions", component: Captions, durationInFrames: 132 },
  { id: "CaptionImpossible", component: CaptionImpossible, durationInFrames: 144 },
  { id: "CaptionGood", component: CaptionGood, durationInFrames: 96 },
  { id: "EndCard", component: EndCard, durationInFrames: 72 },
]

const captionDefaults: CaptionProps = { lines: [{ text: "In Europe, we would call this impossible.", from: 0.5, to: 3.5 }], bugUntil: 5, duration: 6 }

export const Root: React.FC = () => (
  <>
    {COMPS.map((c) => (
      <Composition key={c.id} id={c.id} component={c.component} durationInFrames={c.durationInFrames} {...base} />
    ))}
    <Composition id="LaptopScreen" component={LaptopScreen} durationInFrames={84} width={1440} height={900} fps={24} />
    <Composition id="CaptionTrack" component={CaptionTrack} durationInFrames={144} {...base} defaultProps={captionDefaults}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(props.duration * base.fps)) })} />
  </>
)
