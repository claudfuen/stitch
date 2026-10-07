#!/bin/zsh
# A film's look as one deterministic grade, applied to every still (sets, props, cast in the world) and later to
# every take, so a whole film reads as one piece. Add a look per film; keep each one a single ffmpeg chain.
#
#   scripts/look.sh <look> <in> <out> [width]
#     betacam  1994 US cable on Betacam, played back from VHS: soft, lifted blacks, warm, chroma bleed, tape noise
#     before   the infomercial "before": black and white, crushed contrast, heavy vignette, grain, soft
set -e
look=$1; in=$2; out=$3; w=${4:-1920}
# Soften like standard definition: down to 720 wide and back up.
sd="scale=720:-2:flags=area,scale=${w}:-2:flags=bicubic"
case $look in
  betacam)
    chain="${sd},format=yuv420p,chromashift=cbh=3:crh=-2,eq=contrast=0.92:brightness=0.03:saturation=1.12:gamma_r=1.03:gamma_b=0.97,curves=all='0/0.06 0.5/0.52 1/0.96',noise=alls=7:allf=t+u,gblur=sigma=0.6"
    ;;
  before)
    chain="${sd},format=yuv420p,hue=s=0,normalize=strength=0.9,eq=contrast=1.25:brightness=0.02:gamma=1.25,vignette=angle=PI/3.2,noise=alls=12:allf=t+u,gblur=sigma=0.8"
    ;;
  *) echo "unknown look $look (betacam|before)" >&2; exit 1 ;;
esac
ffmpeg -v error -y -i "$in" -vf "$chain" -frames:v 1 -q:v 2 "$out"
