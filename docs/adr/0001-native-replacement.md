# 0001-native-replacement.md

# Native replacement of the Electron runtime

The migration target is a full native application built from Rust and the Windows crate, with Direct3D 11 and HLSL for glass and frame effects, Direct2D/DirectWrite for vector and text drawing, and egui for expanded-mode interaction. Electron, WebView, and the existing Tauri runtime are not retained in the final runtime. This is hard to reverse and changes the whole delivery shape, so it is recorded as an explicit boundary before planning begins.
