# Shader source of truth — native glass migration

These files are the user-supplied source of truth for Liquid Glass and Candy Glass. Do not rewrite their optical formulas silently during the migration.

| File | Source | SHA-256 | Lines |
| --- | --- | --- | --- |
| `LiquidGlassRefraction.hlsl` | User-pasted refraction shader, credited to OverShifted | `5f696fd0bb33a18f35fa6c5d1bf2e55fbe219bb2956cd28d0c1bf21fdf77c9b3` | 590 |
| `GlassGPU.hlsl` | User-pasted D3D11 capture/crop/Dual-Kawase shader | `f47e9e091b7a0be6ee29d6f67b6a13a9e64a1f0f623ccfe3d77b52ad8bfd8f5b` | 88 |
| `CandyGlass.hlsli` | `C:/Users/Lycaon/Downloads/CandyGlass.hlsli` | `4679d73f6773e2335dc4942f33a7a49516555e80ae901f26cd2954a4428eb38e` | 104 |

## Build contract stated by the sources

- `GlassGPU.hlsl` says the refraction body is appended from `LiquidGlassRefraction.hlsl` at build time.
- `CandyGlass.hlsli` says it is included after `GlassConstants` declarations and before `finishGlass()`.
- Candy Glass requires replacing the final `finishGlass()` call inside `shadeGlass()` with `candyFinish(col, localPos + halfSize, insidePixels, rimRadius)`.
- The pure-backdrop early-out path must continue using `finishGlass()` so the area outside the bevel is not tinted.

## Integration constraint observed, not resolved

`LiquidGlassRefraction.hlsl` uses legacy/WPF-style HLSL syntax (`sampler2D input`, `tex2D`, `register(cN)`), while `GlassGPU.hlsl` uses D3D11 syntax (`Texture2D`, `SamplerState`, `cbuffer GlassConstants` with `float4 lens[32]`).

This repository stores both exactly as supplied. A build-time adapter or generated intermediate shader will be needed before D3D11 compilation; that decision belongs to the wayfinder ticket about the HLSL build contract. Do not alter the optical formulas to make them compile unless the user explicitly approves the translated version as the new source of truth.
