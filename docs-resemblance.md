# Getting a real person's likeness to hold: what we measured

Metric: ArcFace cosine similarity (`scripts/face-score.py`) against six real stills. Two different real frames of the same man score **0.82**, so that is the ceiling. Voice: resemblyzer speaker embedding against his real recordings (two real lines of his score 0.71).

## Face

| Method | Score |
|---|---|
| Edit one real still ("keep the face identical, change only the setting"), `gpt_image_2_5` | **0.75 to 0.82** |
| Generate from 3 real stills | 0.76 to 0.79 |
| Generate from a character sheet plus stills | 0.60 to 0.67 |
| Generate with a face grid as a reference | 0.68 to 0.72 (worse than none) |
| Kling 3.0 pro clips from a sheet-based keyframe | 0.46 to 0.63 |
| Seedance 2.5 omni_reference, 1080p, real stills + voice reference | **0.76** (0.73 to 0.80) |
| Face replacement on an existing clip (Genjutsu, Kling Omni Edit, Seedance video_edit) | no gain (0.44 to 0.46 vs 0.46) |

Rules that follow:
1. Build every keyframe by editing a real still, not by generating from a sheet. More references dilute the face.
2. Keep the face large in frame. Full-body shots score low simply because the face is small.
3. Animate with Seedance 2.5 omni_reference, passing the real still as the start image, 2 to 3 real stills as image_references and a clean recording as audio_references.
4. Do not plan on fixing a face afterward. The video-edit tools did not move the score.

## Voice

| Method | Score |
|---|---|
| Seedance 2.5 native voice, real recording as audio reference | **0.86** |
| Index TTS 2 cloned from four real isolated lines | 0.76 to 0.85 |
| ElevenLabs engine on a Higgsfield cloned voice | 0.64 to 0.82 (weak on very short lines) |

Seedance garbles a prompt that has two lines and a pause. Generate one line per clip and cut them together.
