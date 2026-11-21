# 0005-native-runtime-boundaries.md

# Native runtime boundaries and data flow

The native runtime uses one process and one canonical Rust `AppState`. The Windows shell module owns the HWND, message loop, DPI/monitor handling, hotkeys, and OS event adapters. A render host owns one shared D3D11 device and the HWND swap chain; Direct2D/DirectWrite is derived from that device's DXGI interface, and egui-directx11 renders through the same device. Each frame is composed in the order HLSL glass, Direct2D/DirectWrite content, egui interaction, then Present. Render modules receive immutable frame snapshots and never own canonical state; they report interaction intents back to `AppState`, which is the only module that mutates island state and settings.

The supplied HLSL remains untouched. A build-time adapter generates the D3D11 shader by combining `GlassGPU.hlsl` with `LiquidGlassRefraction.hlsl`, mapping the legacy WPF-style samplers and `register(cN)` constants onto the D3D11 sampler/texture/cbuffer contract, and injecting the Candy Glass preset before `finishGlass()` with the documented `candyFinish()` replacement. The generated file is a build artifact, not a new source of truth.

An HWND swap chain is the presentation baseline. DirectComposition is deferred: if it becomes necessary, the change is contained in the render host and does not move state or OS adapter responsibilities. OS capabilities are placed behind narrow adapters for capture, notifications, hotkeys, media, and persistence so capability failures remain honest and testable.
