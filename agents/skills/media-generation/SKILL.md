---
name: media-generation
description: Generate images and videos from a prompt on an omg.dev Computer with omg_generate_image and omg_generate_video. Every call spends the user's omg credits. Use when the task needs a new picture, icon, illustration, or short clip, not for editing a file that already exists.
metadata:
  short-description: Make images and videos with omg credits
---

# Generate images and videos

These tools spend the user's omg credits. 1 credit is 1 USD. Treat every call as a purchase.

## When to use

- Use them when the task needs new visual media: a hero image, an icon, a logo, an illustration, a short clip.
- Do not use them for a screenshot, a chart, or anything you can draw with code or SVG.
- Do not generate many variations "to be safe". Make one, show it, and ask if the user wants another.

## Rules

1. Leave `model` out unless the request needs a specific look. With no model the router picks the cheapest curated model for the task ("auto") and names it in the result.
2. Each result has `model` and `costUsd`. Tell the user both in your reply, for example "Generated with flux-schnell for $0.003."
3. A call is refused above the per-call cap ($1.00 default) or when the daily cap ($5.00 default, UTC day) is used up. The error says how much is left. Do not work around the cap. Tell the user.
4. If the result has `pending: true`, call `omg_media_job` with the `jobId`. Do not generate again; that charges twice.
5. If the error says the credits are used up, tell the user to add credits at omg.dev. Do not retry.
6. Show images with `omg_display_image`. Show videos with `omg_display_video`.
7. A video for the iPhone app must be under 6 MB, H.264, with faststart. The tools already remux downloads to faststart. Check the size. If it is larger, re-encode and keep the original:

   ```sh
   ffmpeg -i in.mp4 -vf scale=480:-2 -c:v libx264 -profile:v main -crf 27 -maxrate 1800k -bufsize 3600k -c:a aac -b:a 96k -movflags +faststart out.mp4
   ```

## Choosing a model

- Usually pass no `model`. The router picks the cheapest suitable model for the task and names it in the result.
- Pass `model` only when the request needs a specific look, for example readable text, SVG, or best-quality video.
- `omg_media_models` lists the top models with prices. `omg_media_models {all: true, q: "kling"}` searches the full list.
- A model outside the top list is priced before it runs. If it cannot be priced, the call is refused; pick another.

Video takes 30 seconds to 5 minutes. Images take 3 to 20 seconds.

## Fields

- Friendly fields map to provider input: `prompt`, `aspectRatio` to `aspect_ratio`, `durationSeconds` to `duration`, `resolution` to `resolution`.
- Put any other provider field in `input`, for example `{"generate_audio": false}` or `{"quality": "high"}`.
- Files save to `~/omg-media/<date>/<jobId>-<n>.<ext>` unless you pass `outputPath`.
