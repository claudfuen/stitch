#!/bin/zsh
# A film's look as one deterministic grade, applied to every still (sets, props, cast in the world) and later to
# every take, so a whole film reads as one piece. Add a look per film; keep each one a single ffmpeg chain.
#
#   scripts/look.sh <look> <in> <out> [width]
#     betacam  1994 US cable on Betacam, played back from VHS: soft, lifted blacks, warm, chroma bleed, tape noise
#     before   the infomercial "before": black and white, bright and high-contrast, heavy vignette, grain, soft
#
# Tonal match: each image's own range (10th to 90th percentile of luma, measured on the centre so the vignette does
# not count) is mapped onto the range of the approved look frame for that look, so a dark night set and a bright
# room land at the same brightness and contrast. Targets come from the look frames picked at stage 02:
#   betacam  look-colour-2 (GPT Image 2.5 Sunburst)  centre luma 56..185
#   before   look-before-1 (FLUX 2 Max)              centre luma 13..222
set -e
look=$1; in=$2; out=$3; w=${4:-1920}
sd="scale=720:-2:flags=area,scale=${w}:-2:flags=bicubic"
case $look in
  betacam) lo_t=56; hi_t=185; pre="format=yuv420p" ;;
  before)  lo_t=13; hi_t=222; pre="format=yuv420p,hue=s=0" ;;
  *) echo "unknown look $look (betacam|before)" >&2; exit 1 ;;
esac

stats=$(ffmpeg -v error -i "$in" -vf "${sd},${pre},crop=iw*0.6:ih*0.6,signalstats,metadata=print:file=-" -frames:v 1 -f null - 2>/dev/null)
lo=$(print -r -- "$stats" | sed -n 's/.*signalstats.YLOW=\([0-9.]*\).*/\1/p' | head -1)
hi=$(print -r -- "$stats" | sed -n 's/.*signalstats.YHIGH=\([0-9.]*\).*/\1/p' | head -1)
(( hi - lo < 8 )) && hi=$(( lo + 8 ))
match="lutyuv=y='clip((val-${lo})*${$(( (hi_t - lo_t) * 1.0 / (hi - lo) ))}+${lo_t},0,255)'"

case $look in
  betacam)
    chain="${sd},${pre},${match},chromashift=cbh=3:crh=-2,eq=saturation=1.12:gamma_r=1.03:gamma_b=0.97,noise=alls=7:allf=t+u,gblur=sigma=0.6" ;;
  before)
    chain="${sd},${pre},${match},vignette=angle=PI/3.2,noise=alls=12:allf=t+u,gblur=sigma=0.8" ;;
esac
ffmpeg -v error -y -i "$in" -vf "$chain" -frames:v 1 -q:v 2 "$out"
