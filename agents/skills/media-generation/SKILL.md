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

1. Choose the cheapest model that fits the request. Start from the defaults below.
2. Each result has `costUsd`. Tell the user the price in your reply, for example "Generated with recraft v4.1 flash for $0.008."
3. A call is refused above the per-call cap ($1.00 default) or when the daily cap ($5.00 default, UTC day) is used up. The error says how much is left. Do not work around the cap. Tell the user.
4. If the result has `pending: true`, call `omg_media_job` with the `jobId`. Do not generate again; that charges twice.
5. If the error says the credits are used up, tell the user to add credits at omg.dev. Do not retry.
6. Show images with `omg_display_image`. Show videos with `omg_display_video`.
7. A video for the iPhone app must be under 6 MB, H.264, with faststart. The tools already remux downloads to faststart. Check the size. If it is larger, re-encode and keep the original:

   ```sh
   ffmpeg -i in.mp4 -vf scale=480:-2 -c:v libx264 -profile:v main -crf 27 -maxrate 1800k -bufsize 3600k -c:a aac -b:a 96k -movflags +faststart out.mp4
   ```

`omg_media_models` lists the live models, their default prices, the caps, and today's spend.

## Image models

| Model | Price | Use for |
| --- | --- | --- |
| `recraft-ai/recraft-v4.1-flash/text-to-image` (default) | $0.008 | Fast, readable text, 1K. Aspect 1:1, 16:9, 9:16, 4:3, 3:4. |
| `wavespeed-ai/flux-schnell` | $0.003 | Cheapest drafts. |
| `openai/gpt-image-2.5-flare/text-to-image` | $0.024 default, $0.01 to $1.00 | Best text rendering. `quality` low, medium, high, xhigh, max. `resolution` 1k, 2k, 4k. Price rises with both. |
| `bytedance/seedream-v4` | $0.027 | Photoreal scenes. |
| `recraft-ai/recraft-20b-svg` | $0.044 | SVG icons and logos. |
| `google/nano-banana-2/text-to-image` | $0.07 | High quality. `/edit` variants edit an input image. |

## Video models

| Model | Price | Notes |
| --- | --- | --- |
| `wavespeed-ai/wan-2.2/t2v-480p-ultra-fast` | $0.01/s | 480p. Duration 5 or 8 only. |
| `pruna-ai/p-video-2/text-to-video` | $0.025/s 720p, $0.05/s 1080p | `draft: true` is 0.6x. Duration 1 to 20. |
| `bytedance/seedance-v1.5-pro/text-to-video-fast` (default) | $0.04/s 720p with audio | $0.02/s with `generate_audio: false`. 1080p $0.06/s, or $0.03/s silent. Duration 4 to 12. 5 s 720p with audio is $0.20. |
| `kwaivgi/kling-v3-turbo-std/text-to-video` | $0.112/s | Best quality. Duration 3 to 15. Aspect 16:9, 9:16, 1:1. |

Video takes 30 seconds to 5 minutes. Images take 3 to 20 seconds.

## Fields

- Friendly fields map to provider input: `prompt`, `aspectRatio` to `aspect_ratio`, `durationSeconds` to `duration`, `resolution` to `resolution`.
- Put any other provider field in `input`, for example `{"generate_audio": false}` or `{"quality": "high"}`.
- Files save to `~/omg-media/<date>/<jobId>-<n>.<ext>` unless you pass `outputPath`.
