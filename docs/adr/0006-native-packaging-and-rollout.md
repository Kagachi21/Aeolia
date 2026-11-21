# 0006-native-packaging-and-rollout.md

# Native packaging and rollout policy

The first native build ships as an unpackaged NSIS installer and uses manual installer updates. This matches the current distribution shape and avoids making package identity, signing, or a Store channel a prerequisite for proving Native Content Parity. The native build is rolled out in parallel first: Electron/Tauri remains the active path until the Golden Matrix is green, then replacement can be staged. WinRT notification listening and other package-identity-dependent capabilities stay honest best-effort or adapter-gated in this phase. The initial Windows gate is Windows 10 1809+ and Windows 11.
