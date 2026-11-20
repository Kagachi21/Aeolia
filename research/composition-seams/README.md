# Composition seams: D3D11/HLSL + Direct2D/DirectWrite + egui on one DXGI surface

Resolution for wayfinder issue #4 (parent #1). Read with `GLOSSARY.md`, ADR-0001/0002/0003.

## Scope and constraints

- The final runtime is native Rust + the Microsoft `windows` crate; Electron/WebView/Tauri are not retained [ADR-0001].
- Acceptance is Native Content Parity, not pixel parity [ADR-0002]; use the glossary terms **Pill**, **Expanded Mode**, **Island Content**, **Island Behavior**.
- Complete Liquid Glass / Candy Glass HLSL will be supplied by the user and is the source of truth. There is no HLSL in the repo today; no shader source is invented here [ADR-0003]. This note only defines the *seams* into which that HLSL must fit.
- "One shared DXGI surface" is read as: one swap-chain back buffer presented by one HWND. Producing separate windows/layers and letting the OS compose them is out of scope here (see research-os for the native window/capture seam).

## Short answer / recommendation

Use **Option A – one shared D3D11 device, all three producers drawing sequentially into the swap-chain back buffer** as the baseline. It has the smallest lifetime and synchronization surface and is explicitly the in-process, single-device interop pattern Microsoft describes [S3]. Keep **Option B – shared device with offscreen layers and a final HLSL composite pass** as the planned escape hatch when the supplied HLSL must sample the text/UI layers, or when gamma-space requirements force an intermediate target. Avoid **Option C – cross-device synchronized shared surfaces with a keyed mutex** unless a separate renderer device/thread/process becomes a hard requirement; it adds serialization and fails on WARP [S3].

All options still require the host to (a) keep the D3D11 device alive for the whole app lifetime, (b) define one premultiplied-alpha, gamma-space presentation convention, and (c) route input to egui only when the island is in Expanded Mode.

---

## Option A — Shared device, direct-to-back-buffer sequence (recommended baseline)

### How it works

1. Create one `ID3D11Device` with `D3D11_CREATE_DEVICE_BGRA_SUPPORT` (Direct2D requires BGRA order) [S1]. Create the DXGI swap chain and an `ID3D11RenderTargetView` on the back buffer.
2. Query `IDXGIDevice` from that same D3D11 device, create `ID2D1Device` via `ID2D1Factory1::CreateDevice`, then `ID2D1Device::CreateDeviceContext` [S1]. Modern Windows has D3D11.1+, so Direct2D↔D3D11 interop is supported; DirectX 11.0 only supported D2D↔D3D10.1 [S2].
3. Wrap the same back buffer for Direct2D: `ID3D11Texture2D` → `IDXGISurface` → `ID2D1DeviceContext::CreateBitmapFromDxgiSurface`, with `D2D1_BITMAP_OPTIONS_TARGET` so it can be passed to `SetTarget` [S4][S6]. The source surface **must** come from the same D3D device as the D2D context [S4].
4. Per frame, in this order: HLSL glass pass → `d2dContext->BeginDraw()` / DirectWrite text + vector / `EndDraw()` → egui renderer → `Present()`.

```
d3d: OMSetRenderTarget(backbufferRTV) -> draw glass (user HLSL)
d2d: SetTarget(backbufferBitmap); BeginDraw(); DrawText/DrawGeometry; EndDraw(); SetTarget(null)
egui: full_output = ctx.run_ui(raw_input, build_ui)
      split_output -> egui_directx11::Renderer::render(&d3dContext, &backbufferRTV, ...)
d3d: Present()
```

### Resource lifetime

- One device owns all GPU resources; there is one resource domain, so no shared handles or keyed mutex. This is the pattern Microsoft calls suitable for "in-process, single-threaded usage of one rendering device" [S3].
- Keep `ID3D11Device` alive as an explicit app-lifetime member. Microsoft warns that a D2D render target can be the last object holding a reference to the underlying D3D device; for the D3D11 path, do not rely on that — own the device directly [S2].
- The DXGI-surface-backed D2D bitmap cannot be resized; on swap-chain resize/release it and recreate it. Keep at least one D2D resource alive across that recreation to avoid tearing down the device [S2].
- Device-lost: recreate the D2D device/context, back-buffer bitmap, and the egui renderer (the community renderer documents "drop the Renderer and create a new one" on device loss) [S13].

### Alpha / compositing order

- Sequence defines order: glass (bottom) → D2D text/vectors → egui (top, only in Expanded Mode). Do **not** call `Clear` on the D2D target after glass has been drawn, or the glass is erased.
- Use premultiplied alpha end to end. `CreateBitmapFromDxgiSurface` defaults to premultiplied for common formats [S4]; `D2D1_COLOR_F` is always straight alpha and Direct2D converts it for you [S7][S8]. Non-`IGNORE` alpha modes switch text anti-aliasing from ClearType to grayscale, and ClearType on a transparent target is explicitly unpredictable — use an opaque backing rectangle or clip+clear behind text if ClearType is required [S7].
- egui's D3D11 renderer uses premultiplied-style RGB blending (`SrcBlend = ONE`, `DestBlend = INV_SRC_ALPHA`) and requires the render target to be in **gamma space, non-sRGB-aware**; do not use `_SRGB` formats/views [S13]. This is the main conflict risk with a linear-space glass shader — see Option B.
- Nothing synchronizes the surface for you: the DXGI surface render target "does not perform DXGI surface synchronization" [S2], and a bitmap bound as target on multiple render targets must be synchronized with `Flush` or `EndDraw` [S5]. `EndDraw` before `Present`.

### Input routing

- D2D/DirectWrite is passive. All interaction flows through egui's immediate-mode contract: feed `RawInput` (ordered `events`, `screen_rect` in points, monotonic `time`, `focused`) into `Context::run_ui`, then handle `FullOutput` [S9][S10][S11].
- The host should feed pointer/keyboard events to egui only while the island is in Expanded Mode and the hit is inside the island rect; in Pill state the window stays click-through. egui exposes `egui_wants_pointer_input` / `egui_wants_keyboard_input` (and `is_pointer_over_egui`) for the integration to arbitrate [S9]. Whether the window is actually transparent to clicks is the native-window seam, not a rendering seam.
- `FullOutput::platform_output` (cursor icon, clipboard, URL) must be executed by the Win32 integration; `textures_delta.push` must be applied before painting and `textures_delta.free` after [S11].
- Keep DPI consistent: egui coordinates are logical points with top-left origin and `pixels_per_point = zoom_factor * native_pixels_per_point` [S10]; D2D works in DIPs with target DPI (96 if unspecified when wrapping the DXGI surface) [S4]. Both must map to the same back-buffer pixels or text and widgets will drift apart.

### Risk

Lowest. Main risks: pipeline-state leakage (the egui renderer resets input layout, VS/PS, viewport, rasterizer, scissor, SRV/sampler slot 0, blend state and RTVs, and assumes no hull/domain/geometry shader active — save/restore around it if the HLSL uses those stages) [S13]; gamma mismatch; resize/device-loss handling; explicit ordering discipline. No cross-device serialization.

---

## Option B — Shared device, offscreen layers, final HLSL composite

### How it works

Render glass, D2D content, and egui into three offscreen `ID3D11Texture2D`s (`BIND_RENDER_TARGET | BIND_SHADER_RESOURCE`), then run a user-supplied fullscreen HLSL pass that samples them as SRVs and composites into the back buffer in a fixed order. D2D writes to its layer via `CreateBitmapFromDxgiSurface` + `SetTarget`; egui renders to its own RTV [S4][S5][S13].

### Resource lifetime

- Still one device/resource domain [S3]. Each layer texture and its D2D bitmap / D2D target binding must be released and recreated on resize; keep the D3D device and at least one D2D resource alive [S2].
- A bitmap used as a D2D target cannot simultaneously be sampled by D3D as an SRV in a way that violates bind flags; call `EndDraw()` and release the `SetTarget` binding before the HLSL pass samples its texture. Using a bitmap as source on the same context it is bound as target puts the context into `D2DERR_BITMAP_BOUND_AS_TARGET` [S5].

### Alpha / compositing order

- Order is now explicit in the final shader: glass texture → D2D layer → egui layer, with premultiplied source-over at each step. This removes reliance on call ordering and gives a single place to audit alpha.
- If the glass HLSL must refract the desktop behind the island, this is the natural place to bind the captured-desktop texture as another SRV (capture itself belongs to research-os).
- Gamma caveat remains: egui must be rendered into a gamma-space, non-sRGB RTV; if the final composite is linear/sRGB-aware, blit/copy the egui layer through an intermediate gamma target as the renderer documents [S13].

### Input routing

Identical to Option A — layering does not change who owns input. One subtlety: if the final composite is delayed by a frame, input hit-testing must use the *current* island geometry, not the composited layer's, to avoid off-by-one-frame interaction.

### Risk

Medium. Extra RTV/SRV resources and one fullscreen pass; more state to recreate on resize/device loss; gamma-space handling must be deliberate. Buys deterministic order and lets the supplied HLSL sample text/UI layers. Good choice if ADR-0003's HLSL turns out to expect layer inputs.

---

## Option C — Cross-device synchronized shared surface (keyed mutex)

### How it works

Give each API its own D3D11 device and share an offscreen texture via DXGI: create with `D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX`, export with `IDXGIResource1::CreateSharedHandle` / `OpenSharedResource1`, and synchronize with `IDXGIKeyedMutex::AcquireSync` / `ReleaseSync` around every render [S3]. Compose/present the shared texture from the device that owns the swap chain.

### Resource lifetime

- Each device owns its own resources; the shared texture survives while at least one handle/reference exists. Both the creating and opening device **must** call `AcquireSync` before rendering and `ReleaseSync` when done [S3].
- WARP and REF devices do not support shared resources — creation returns `E_OUTOFMEMORY` [S3]. This matters because a native fallback renderer may use WARP.

### Alpha / compositing order

- Same premultiplied convention, but ordering is now enforced by mutex keys rather than by call sequence. Alpha correctness still depends on the present-side device compositing layers in the right order.

### Input routing

Unchanged — the host window's message pump still decides; egui still receives `RawInput` [S10]. If the egui device lives on another thread, input must be marshalled to it, which adds latency and a queueing seam.

### Risk

Highest. Serialization per frame, format/bind-flag compatibility, no WARP fallback, device-loss handling across two devices, and much larger debugging surface. Microsoft explicitly reserves this for multi-device, multithreaded or cross-process scenarios [S3]; ADR-0001 describes one native app, so there is no present justification. Reject unless a separate renderer process/device is mandated later.

---

## Option D — Separate windows / OS composition (out of scope)

Each API presents to its own layered window and the desktop compositor stacks them. This is *not* "one shared DXGI surface" and pushes alpha/order/input problems onto the window manager. It also overlaps the native window/geometry seam owned by research-os. Not a candidate for issue #4.

---

## Cross-cutting seams (all options)

| Seam | Constraint | Source |
|---|---|---|
| Device | One D3D11 device created with `BGRA_SUPPORT`; D2D device derived from its `IDXGIDevice`; D3D11.1+ required for direct D2D↔D3D11 interop | [S1][S2] |
| Back-buffer wrap | `CreateBitmapFromDxgiSurface` requires same device; options compatible with bind flags; `TARGET` required for `SetTarget`; format compatible with SRV/RTV | [S4][S6] |
| Ownership | Keep D3D device alive explicitly; do not release the last D2D resource during target recreation; resize by release+recreate | [S2][S3] |
| Synchronization | No automatic DXGI surface sync; `EndDraw`/`Flush` before another consumer or `Present`; one image cannot be render target of two contexts at once | [S2][S5] |
| Alpha | Premultiplied end-to-end; `D2D1_COLOR_F` straight→converted by D2D; non-IGNORE alpha disables ClearType | [S4][S7][S8] |
| Color space | egui requires gamma-space, non-sRGB target; use intermediate gamma RTV if final target is linear/sRGB-aware | [S13] |
| egui frame | `RawInput` → `run_ui` → `FullOutput` → handle `platform_output`, apply `textures_delta`, `tessellate`, paint | [S9][S11] |
| egui geometry | Meshes are indexed triangles with one texture id; disable backface culling; clipping via scissor rects | [S12][S13] |
| Input | egui only in Expanded Mode; Pill is click-through; host arbitrates with `egui_wants_pointer_input` / `egui_wants_keyboard_input` | [S9][S10] |
| DPI | egui points vs D2D DIPs vs back-buffer pixels must share one scale factor | [S4][S10] |

## Unresolved decisions (need user input or another research ticket)

1. **Color space and alpha of the supplied HLSL.** Is its output premultiplied, and is it authored in linear or gamma space? Decides Option A vs B and whether an intermediate gamma RTV is mandatory. Blocked on issue #5 (user-supplied HLSL) per ADR-0003.
2. **Does the glass shader sample the desktop behind the island?** If yes, an offscreen layer/capture texture is required and Option B becomes the default (capture itself is research-os).
3. **egui renderer choice.** `egui-directx11` (community, successor to unmaintained `egui-d3d11`, built on Microsoft's `windows` crate) versus a small in-repo renderer based on the documented `FullOutput` contract [S13][S9]. Pin egui/`windows` versions together; community renderer support is not an official egui backend (official ones are egui-wgpu/egui-glow) [S14].
4. **Presentation path.** Classic HWND swap chain vs DirectComposition swap chain — affects where premultiplied alpha is interpreted; owned by research-os.
5. **Module boundary.** Who owns the D3D device, the frame order, and `platform_output` execution — see issue #6 (runtime module boundaries).
6. **Expanded-Mode transition.** Exact hit rect and click-through toggling policy — see issue #3 / Island Behavior inventory.

---

## Sources

- **[S1]** Microsoft, *How to render by using a Direct2D device context* — https://learn.microsoft.com/en-us/windows/win32/direct2d/devices-and-device-contexts
- **[S2]** Microsoft, *Direct2D and Direct3D interoperability overview* — https://learn.microsoft.com/en-us/windows/win32/direct2d/direct2d-and-direct3d-interoperation-overview
- **[S3]** Microsoft, *Surface sharing between Windows graphics APIs* — https://learn.microsoft.com/en-us/windows/win32/direct3darticles/surface-sharing-between-windows-graphics-apis
- **[S4]** Microsoft, *ID2D1DeviceContext::CreateBitmapFromDxgiSurface* — https://learn.microsoft.com/en-us/windows/win32/api/d2d1_1/nf-d2d1_1-id2d1devicecontext-createbitmapfromdxgisurface(idxgisurface_constd2d1_bitmap_properties1_id2d1bitmap1)
- **[S5]** Microsoft, *ID2D1DeviceContext::SetTarget* — https://learn.microsoft.com/en-us/windows/win32/api/d2d1_1/nf-d2d1_1-id2d1devicecontext-settarget
- **[S6]** Microsoft, *D2D1_BITMAP_OPTIONS* — https://learn.microsoft.com/en-us/windows/win32/api/d2d1_1/ne-d2d1_1-d2d1_bitmap_options
- **[S7]** Microsoft, *D2D1_ALPHA_MODE* — https://learn.microsoft.com/en-us/windows/win32/api/dcommon/ne-dcommon-d2d1_alpha_mode
- **[S8]** Microsoft, *Using Color in Direct2D* — https://learn.microsoft.com/en-us/windows/win32/learnwin32/using-color-in-direct2d
- **[S9]** egui, *Context* docs (v0.37) — https://docs.rs/egui/latest/egui/struct.Context.html
- **[S10]** egui, *RawInput* docs — https://docs.rs/egui/latest/egui/struct.RawInput.html
- **[S11]** egui, *FullOutput* docs — https://docs.rs/egui/latest/egui/struct.FullOutput.html
- **[S12]** epaint, *Mesh* docs — https://docs.rs/epaint/latest/epaint/mesh/struct.Mesh.html
- **[S13]** NekomaruQwQ, *egui-directx11* README and source — https://github.com/NekomaruQwQ/egui-directx11
- **[S14]** egui, *egui-wgpu* docs (official renderer reference) — https://docs.rs/egui-wgpu/latest/egui_wgpu/
- **[ADR-0001/0002/0003]** `docs/adr/` in `D:/Project/Aeolia/dynamic-island`; glossary terms from `GLOSSARY.md`.
