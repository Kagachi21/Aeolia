# Native composition prototype — wayfinder issue #7

**PROTOTYPE. Throwaway. Not production code.** Built on branch
`prototype/native-composition` in worktree `D:/Project/Aeolia/_worktrees/native-composition`.
The main working tree (`D:/Project/Aeolia/dynamic-island`) was not touched.

## Question this spike answers

> Can a thin native Windows application render the supplied glass HLSL through
> D3D11, draw crisp content with Direct2D/DirectWrite, and mount egui only for
> Expanded Mode on the same shared DXGI surface?

**Answer: Yes, for the composition mechanics.** The shared-device path in
ADR-0005 / composition Option A works end-to-end on this machine. See
"Observed result" below for the actual log.

## Exact run command

```bash
cd D:/Project/Aeolia/_worktrees/native-composition/prototype/native-composition
cargo run -- --self-test
```

Rust is installed at `C:/Users/Lycaon/.cargo/bin` but is **not on PATH** in the
default shell. If `cargo` is not found, prefix the command:

```bash
export PATH="/c/Users/Lycaon/.cargo/bin:$PATH"
cargo run -- --self-test
```

`--frames N` optionally changes the frame count (default 4). The self-test
creates a **hidden** HWND, runs a deterministic frame sequence, prints the full
state, and exits — no human interaction and no visible window required.

`cargo build` alone also runs the shader adapter and fails the build if any
supplied shader hash changes.

## What it proves

1. **One shared D3D11 device with BGRA support** can be created on this machine
   (hardware driver, feature level 11.0 = `0xb000`) together with an HWND swap
   chain (`DXGI_SWAP_EFFECT_DISCARD`, `DXGI_FORMAT_B8G8R8A8_UNORM`).
2. **Direct2D / DirectWrite derives from that same device**: `IDXGIDevice` is
   queried from the D3D11 device, `ID2D1Factory1::CreateDevice` produces the D2D
   device/context, and the swap-chain back buffer is wrapped as a D2D target via
   `CreateBitmapFromDxgiSurface`.
3. **egui-directx11 (`0.13.0+egui-0.35.0`) is created on that same device** and
   renders through the shared device context/RTV.
4. **Frame order works**: HLSL glass pass → D2D/DirectWrite text → egui →
   `Present`, with `Present` returning `S_OK` (`hr=0x00000000`) on every frame.
5. **egui is mounted only in Expanded Mode**. The state line is drawn with
   DirectWrite and printed to the log; Pill frames report `egui=SKIPPED
   (Pill is click-through)`, Expanded frames report `egui=MOUNTED`.
6. **The supplied HLSL is buildable as D3D11 HLSL** without editing the sources.
   The generated base shader and the optional Candy Glass variant both compile
   with `fxc.exe` to D3D11-loadable DXBC (VS `vs_5_0`, PS `ps_5_0`).
7. **Source hashes are enforced at build time**: any change to the three files
   in `../../shaders/` fails the build.

## What it does NOT prove

- **No visual/pixel verification.** The window is hidden; the run captures no
  screenshot. The glass draw executes and `Present` succeeds, but this spike
  does not prove the refracted result looks correct, only that the pipeline
  runs. Optical parity and color-space behavior remain open.
- **No real desktop capture.** The glass shader samples a small procedural
  64×64 gradient texture, not a captured desktop. Whether the supplied HLSL can
  refract a live WGC capture is a separate capture-adapter seam.
- **No DirectComposition.** This is the HWND swap-chain baseline only.
- **No real AppState, persistence, encoder, notifications, hotkeys, media, or
  OS integrations.** `AppState` is a minimal in-memory stand-in that only
  alternates Pill / Expanded Mode.
- **No actual click-through window style or real input events.** Pill
  click-through is represented as visible state + log output and by *not*
  feeding input to egui. The Win32 hit-testing/transparency policy belongs to
  the native-window seam.
- **No resize or device-loss handling.** Those are real runtime concerns but
  out of scope for a one-shot self-test.
- **Candy Glass optical parity is not attempted.** The preset is injected and
  the final `finishGlass()` call in `shadeGlass()` is replaced as documented;
  compilation proves parseability, not visual equivalence.

## Observed result (this machine, 2026-11-21)

```
[shader] build status = COMPILED
[shader] candy variant = COMPILED
[window] HWND=HWND(...) client=464x141 (hidden, swap-chain presentation baseline)
[device] driver=HARDWARE feature_level=0xb000
[device] D2D device/context created from the same IDXGIDevice
[device] egui renderer = true
[state] INITIAL frame=0 mode=Pill click_through=true egui_input=false egui_render=SKIPPED
[frame 1 ] mode=Pill          | glass=DRAWN | d2d=DRAWN | egui=SKIPPED (Pill is click-through) | Present(hr=0x00000000)
[frame 2 ] mode=Expanded Mode | glass=DRAWN | d2d=DRAWN | egui=MOUNTED                        | Present(hr=0x00000000)
[frame 3 ] mode=Pill          | glass=DRAWN | d2d=DRAWN | egui=SKIPPED (Pill is click-through) | Present(hr=0x00000000)
[frame 4 ] mode=Expanded Mode | glass=DRAWN | d2d=DRAWN | egui=MOUNTED                        | Present(hr=0x00000000)
[PASS] self-test complete: 4 frames, all stages executed.
[PASS] shared D3D11 device validated for glass + D2D/DW + egui.
```

Exit code `0`. Full unabridged log is produced by the command above.

## Build adapter details

`build.rs` reads the three untouched sources in `../../shaders/`, verifies their
SHA-256 hashes against `shaders/README.md`, and writes two generated artifacts
into `generated/` (committed build artifacts, not new sources of truth):

| Artifact | Purpose |
| --- | --- |
| `generated/glass_d3d11.hlsl` | `GlassGPU.hlsl` + transformed `LiquidGlassRefraction.hlsl` |
| `generated/glass_d3d11_candy.hlsl` | Same, with `CandyGlass.hlsli` injected and the final `finishGlass()` replaced by `candyFinish()` |
| `generated/SOURCE_HASHES.txt` | Source + generated artifact hashes |

Transformations applied to the legacy refraction source (optical formulas left
verbatim):

- `sampler2D input : register(s0);` → D3D11 `Texture2D` + `SamplerState`
  (`sourceTexture` / `linearSampler`, already declared in `GlassGPU.hlsl`).
- `tex2D(input, uv)` → `sourceTexture.Sample(linearSampler, uv)`.
- `float name : register(cN);` → `#define name legacyParams[N]` from generated
  `cbuffer LegacyGlassParams : register(b1)`. A dedicated legacy cbuffer is used
  (rather than overloading `lens[32]`) so the packed D3D11 `lens[]` contract in
  `GlassGPU.hlsl` stays intact and no optical formula is rewritten.
- `GLASS_PREFILTERED_BACKDROP` stays defined, so the legacy `main()` is excluded
  and a generated `glassPs` entry point calls `shadeGlass()` directly.
- Candy variant: preset injected after the constants with forward declarations
  for `finishGlass()` / `rand()`, and exactly one call site replaced:
  `col = candyFinish(col, localPos + halfSize, insidePixels, rimRadius);`. The
  pure-backdrop early-out still uses `finishGlass()`.

### Environment findings worth carrying forward

- **Hashes in `shaders/README.md` are of LF-normalized content.** The working
  tree checks the files out with CRLF on Windows; `build.rs` strips `\r` before
  hashing. Verified independently with `Get-FileHash` and a byte-wise LF
  normalization (all three match exactly).
- **Use `fxc.exe`, not `dxc.exe`, for D3D11 bytecode.** `dxc -T vs_5_0` on this
  SDK produces a container with a `DXIL` chunk; `ID3D11Device::CreateVertexShader`
  rejects it with `E_INVALIDARG`. `fxc /T vs_5_0` produces loadable DXBC. Both
  compilers are at `C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/`.
- **`CreateBitmapFromDxgiSurface` on this machine needs
  `D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW`.** `TARGET`
  alone returned `E_INVALIDARG` for both premultiplied and ignore alpha modes.
  The prototype tries variants and logs which one worked.
- **Shader resource views need an explicit `D3D11_TEX2D_SRV { MipLevels: 1 }`.**
  A zeroed union (MipLevels = 0) also returned `E_INVALIDARG`.

## Layout

```
prototype/native-composition/
  Cargo.toml          # egui 0.35, egui-directx11 0.13, windows 0.62.2
  build.rs            # hash validation + HLSL adapter + fxc compile
  README.md           # this file
  src/
    main.rs           # CLI, hidden HWND, self-test orchestration, state log
    app_state.rs      # minimal canonical-state stand-in (Pill / Expanded)
    host.rs           # one D3D11 device, D2D/DW, egui, frame order
  generated/          # committed generated HLSL + hash manifest
```

## Conclusion for issue #7

The shared-device approach (ADR-0005 Option A) is **validated for composition
mechanics**. No fallback Option B is required for the frame order or device
sharing itself. Option B remains relevant only if later work needs the glass
shader to sample D2D/egui layers or the captured desktop, or if gamma-space
requirements force an intermediate target — none of which this spike exercised.
