# Dialogue takes

- `henrick_indextts2_*` : Henrick cloned with Index TTS 2 from his four real isolated lines (speaker match 0.76 to 0.85; two real lines of his score 0.71 against each other).
- `e_*` : Henrick through the ElevenLabs engine on a Higgsfield cloned voice (match 0.64 to 0.82, weaker on short lines).
- `f_*` founder, `c_*` clerk, `n_*` narrator: ElevenLabs v3 preset voices (Chris, Alice, Sarah) with delivery tags.
- Every take passes a Whisper round trip against the script. Seedance 2.5 with the real recording as an audio reference generated a voice scoring 0.86, the best so far.
