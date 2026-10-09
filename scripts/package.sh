#!/usr/bin/env bash
# Package a finished cut for delivery: 1080p masters (VHS + clean), the social cuts, captions, stems and phone copies.
#
#   scripts/package.sh <cut-dir> <base-name> <out-dir> <srt> <dialogue.wav> <score.wav> <sfx.wav>
#
# The masters are finished at 1280x720 (the VHS look throws away detail anyway); they are scaled to 1920x1080 with
# Lanczos so platforms serve their 1080p bitrate. Phone copies stay under 30 MB for sending.
set -euo pipefail
cut="$1"; base="$2"; out="$3"; srt="$4"; dlg="$5"; score="$6"; sfx="$7"
mkdir -p "$out/stems" "$out/phone"
enc=(-c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart)
ffmpeg -v error -y -i "$cut/$base-vhs.mp4" -vf "scale=1920:1080:flags=lanczos" "${enc[@]}" "$out/Order-Now-VHS-1080p.mp4"
ffmpeg -v error -y -i "$cut/$base-clean.mp4" -vf "scale=1920:1080:flags=lanczos" "${enc[@]}" "$out/Order-Now-clean-1080p.mp4"
cp "$cut/$base-9x16.mp4" "$out/Order-Now-9x16.mp4"
cp "$cut/$base-1x1.mp4" "$out/Order-Now-1x1.mp4"
cp "$srt" "$out/Order-Now.srt"
len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/Order-Now-VHS-1080p.mp4")
for pair in "$dlg:dialogue" "$score:score" "$sfx:sfx-crowd"; do  # pre-mix stems, all conformed to the film's length
  ffmpeg -v error -y -i "${pair%%:*}" -af "apad,atrim=0:$len" -ar 48000 -c:a pcm_s24le "$out/stems/${pair##*:}.wav"
done
small=(-c:v libx264 -preset slow -c:a aac -b:a 160k -movflags +faststart)
ffmpeg -v error -y -i "$out/Order-Now-VHS-1080p.mp4" -vf scale=960:540 -b:v 1050k -maxrate 1500k -bufsize 3000k "${small[@]}" "$out/phone/Order-Now-VHS-phone.mp4"
ffmpeg -v error -y -i "$out/Order-Now-9x16.mp4" -vf scale=720:1280 -b:v 1500k -maxrate 2000k -bufsize 4000k "${small[@]}" "$out/phone/Order-Now-9x16-phone.mp4"
ffmpeg -v error -y -i "$out/Order-Now-1x1.mp4" -vf scale=720:720 -b:v 1200k -maxrate 1600k -bufsize 3200k "${small[@]}" "$out/phone/Order-Now-1x1-phone.mp4"
ls -la "$out" "$out/stems" "$out/phone"
