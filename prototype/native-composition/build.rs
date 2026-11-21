//! Build-time adapter for the supplied HLSL sources (wayfinder issue #7 spike).
//!
//! Reads (never edits) the three user-supplied shader files in ../../shaders,
//! verifies their SHA-256 hashes against shaders/README.md, generates two
//! D3D11-compatible intermediate HLSL files (base Liquid Glass + optional
//! Candy Glass variant), writes them as committed build artifacts under
//! `generated/`, and — when a DXC compiler is available — compiles the VS/PS
//! bytecode used by the self-test.

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const EXPECTED_HASHES: &[(&str, &str)] = &[
    (
        "LiquidGlassRefraction.hlsl",
        "5f696fd0bb33a18f35fa6c5d1bf2e55fbe219bb2956cd28d0c1bf21fdf77c9b3",
    ),
    (
        "GlassGPU.hlsl",
        "f47e9e091b7a0be6ee29d6f67b6a13a9e64a1f0f623ccfe3d77b52ad8bfd8f5b",
    ),
    (
        "CandyGlass.hlsli",
        "4679d73f6773e2335dc4942f33a7a49516555e80ae901f26cd2954a4428eb38e",
    ),
];

/// `register(cN)` scalar declarations from LiquidGlassRefraction.hlsl, mapped
/// onto a dedicated D3D11 cbuffer. This keeps every optical formula byte-for-byte
/// identical to the supplied source while replacing WPF register syntax.
const LEGACY_PARAMS: &[(&str, usize)] = &[
    ("srcW", 0),
    ("srcH", 1),
    ("notchW", 2),
    ("notchH", 3),
    ("offX", 4),
    ("offY", 5),
    ("bottomCornerR", 6),
    ("topCornerR", 7),
    ("powerFactor", 8),
    ("u_a", 9),
    ("u_b", 10),
    ("u_c", 11),
    ("u_d", 12),
    ("u_fPower", 13),
    ("u_noise", 14),
    ("u_glowWeight", 15),
    ("u_glowBias", 16),
    ("u_glowEdge0", 17),
    ("blurRadius", 18),
    ("u_chroma", 19),
    ("satFactor", 20),
    ("brightAdd", 21),
    ("pointerX", 22),
    ("pointerY", 23),
    ("pointerActive", 24),
    ("pressAmount", 25),
    ("highlightStrength", 26),
    ("flexStrength", 27),
    ("lightX", 28),
    ("lightY", 29),
    ("edgeBend", 30),
    ("bevelMode", 31),
];

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest.iter() {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn cargo_warning(msg: &str) {
    println!("cargo:warning={msg}");
}

fn find_compiler(exe: &str, env_var: &str) -> Option<PathBuf> {
    if let Ok(path) = env::var(env_var) {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir("C:/Program Files (x86)/Windows Kits/10/bin") {
        for entry in entries.flatten() {
            let p = entry.path().join("x64").join(exe);
            if p.is_file() {
                candidates.push(p);
            }
        }
    }
    candidates.sort();
    if let Some(p) = candidates.pop() {
        return Some(p);
    }
    // Last resort: whatever is on PATH.
    let probe = Command::new(exe).arg("/?").output().ok();
    if probe.is_some_and(|o| o.status.success()) {
        return Some(PathBuf::from(exe));
    }
    None
}

fn compile_hlsl(
    compiler: &Path,
    is_fxc: bool,
    entry: &str,
    target: &str,
    hlsl: &Path,
    out: &Path,
) -> bool {
    let mut command = Command::new(compiler);
    if is_fxc {
        // fxc emits DXBC bytecode that D3D11 can load directly.
        command.args(["/T", target, "/E", entry, "/Fo"]).arg(out).arg(hlsl);
    } else {
        // dxc emits DXIL for SM5+ targets, which D3D11 cannot load; keep only
        // as an HLSL syntax check fallback.
        command.args(["-T", target, "-E", entry, "-Fo"]).arg(out).arg(hlsl);
    }
    match command.output() {
        Ok(output) => {
            if output.status.success() {
                true
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                cargo_warning(&format!(
                    "HLSL compile failed for {entry}/{target}: {} {}",
                    stderr.trim(),
                    stdout.trim()
                ));
                false
            }
        }
        Err(e) => {
            cargo_warning(&format!("HLSL compiler invocation failed for {entry}/{target}: {e}"));
            false
        }
    }
}

fn transform_refraction(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for line in source.lines() {
        let trimmed = line.trim_start();
        // Drop the legacy sampler declaration; D3D11 uses sourceTexture + linearSampler.
        if trimmed.starts_with("sampler2D input") {
            continue;
        }
        // Drop register(cN) scalar declarations; generated #defines replace them.
        if trimmed.starts_with("float ") && trimmed.contains("register(c") && trimmed.contains(':') {
            continue;
        }
        let replaced = line.replace("tex2D(input,", "sourceTexture.Sample(linearSampler,");
        out.push_str(&replaced);
        out.push('\n');
    }
    out
}

fn legacy_cbuffer_block() -> String {
    let mut s = String::from(concat!(
        "// === GENERATED by build.rs: legacy register(cN) -> D3D11 cbuffer ===\n",
        "// Optical formulas below are verbatim from LiquidGlassRefraction.hlsl.\n",
        "cbuffer LegacyGlassParams : register(b1)\n{\n    float legacyParams[32];\n};\n"
    ));
    for (name, idx) in LEGACY_PARAMS {
        s.push_str(&format!("#define {name} legacyParams[{idx}]\n"));
    }
    s.push('\n');
    s
}

const ENTRY_POINT: &str = concat!(
    "// === GENERATED by build.rs: D3D11 entry point ===\n",
    "float4 glassPs(VertexOutput i) : SV_Target\n",
    "{\n",
    "    float2 frameSize = max(float2(notchW, notchH), float2(1.0, 1.0));\n",
    "    float2 srcSize = max(float2(srcW, srcH), float2(1.0, 1.0));\n",
    "    if (min(min(srcW, srcH), min(notchW, notchH)) < 1.0)\n",
    "        return sampleSource(saturate(i.uv));\n",
    "    return shadeGlass(i.uv * frameSize, 1.0 / srcSize);\n",
    "}\n"
);

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let shader_dir = manifest_dir.join("..").join("..").join("shaders");
    let generated_dir = manifest_dir.join("generated");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    fs::create_dir_all(&generated_dir).unwrap();
    fs::create_dir_all(&out_dir).unwrap();

    // 1. Verify the supplied sources are untouched.
    let mut sources = BTreeMap::new();
    for (name, expected) in EXPECTED_HASHES {
        let path = shader_dir.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = fs::read(&path)
            .unwrap_or_else(|e| panic!("cannot read source shader {}: {e}", path.display()));
        // shaders/README.md hashes are of LF-normalized content; the working tree
        // checks these files out with CRLF on Windows. Normalize only for hashing.
        let normalized: Vec<u8> = bytes.iter().copied().filter(|&b| b != b'\r').collect();
        let actual = sha256_hex(&normalized);
        if actual != *expected {
            panic!(
                "SOURCE SHADER MODIFIED: {name} expected {expected}, got {actual}. \
                 The supplied HLSL is the source of truth and must not be edited."
            );
        }
        sources.insert(*name, String::from_utf8(normalized).unwrap());
        println!("cargo:warning=source OK {name} sha256={actual} (LF-normalized)");
    }

    // 2. Build the common D3D11 body.
    let glass_gpu = &sources["GlassGPU.hlsl"];
    let refraction = transform_refraction(&sources["LiquidGlassRefraction.hlsl"]);
    let legacy = legacy_cbuffer_block();

    let base = format!(
        "// GENERATED BUILD ARTIFACT - do not edit. Source: shaders/GlassGPU.hlsl + \
         shaders/LiquidGlassRefraction.hlsl (see shaders/README.md).\n\
         // Maps legacy sampler2D/tex2D/register(cN) to D3D11 Texture2D/SamplerState/cbuffer.\n\n\
         {glass_gpu}\n{legacy}\n\
         // === GENERATED by build.rs: refraction body from LiquidGlassRefraction.hlsl ===\n\
         {refraction}\n{ENTRY_POINT}"
    );

    // 3. Optional Candy Glass variant: inject the preset before finishGlass()
    //    and replace only the final finishGlass() call inside shadeGlass().
    let candy_hlsli = &sources["CandyGlass.hlsli"];
    let candy_needle = "    col = finishGlass(col, localPos + halfSize);";
    let occurrences = base.matches(candy_needle).count();
    assert_eq!(
        occurrences, 1,
        "expected exactly one final finishGlass() call inside shadeGlass(), found {occurrences}"
    );
    let candy_inject = format!(
        "// === GENERATED by build.rs: optional Candy Glass preset (shaders/CandyGlass.hlsli) ===\n\
         // Forward declarations so candyFinish() can call the body defined below.\n\
         float3 finishGlass(float3 col, float2 pixel);\n\
         float rand(float2 co);\n\
         {candy_hlsli}\n"
    );
    let legacy_marker = "// === GENERATED by build.rs: refraction body from LiquidGlassRefraction.hlsl ===\n";
    let candy = base
        .replacen(legacy_marker, &format!("{candy_inject}{legacy_marker}"), 1)
        .replace(
            candy_needle,
            "    col = candyFinish(col, localPos + halfSize, insidePixels, rimRadius);",
        );

    // 4. Write the committed artifacts and mirrored OUT_DIR copies.
    for (name, content) in [("glass_d3d11.hlsl", &base), ("glass_d3d11_candy.hlsl", &candy)] {
        fs::write(generated_dir.join(name), content).unwrap();
        fs::write(out_dir.join(name), content).unwrap();
    }

    let mut manifest = String::from(
        "# Hash validation for the supplied HLSL source of truth.\n\
         # Expected values are recorded in ../../shaders/README.md.\n\
         # build.rs fails the build if any source hash differs.\n\n",
    );
    for (name, expected) in EXPECTED_HASHES {
        manifest.push_str(&format!("SOURCE  {name:<28} {expected}\n"));
    }
    for (name, content) in [("glass_d3d11.hlsl", &base), ("glass_d3d11_candy.hlsl", &candy)] {
        manifest.push_str(&format!(
            "GENERATED {name:<27} {}\n",
            sha256_hex(content.as_bytes())
        ));
    }
    fs::write(generated_dir.join("SOURCE_HASHES.txt"), &manifest).unwrap();
    fs::write(out_dir.join("SOURCE_HASHES.txt"), &manifest).unwrap();

    // 5. Compile D3D11-loadable DXBC bytecode. fxc is preferred because dxc
    //    emits DXIL for SM5 targets, which D3D11 cannot load. HLSL generation
    //    is always done regardless of compiler availability.
    let vs_path = out_dir.join("glass_vs.cso");
    let ps_path = out_dir.join("glass_ps.cso");
    let hlsl = out_dir.join("glass_d3d11.hlsl");
    let status = if let Some(fxc) = find_compiler("fxc.exe", "FXC_PATH") {
        println!("cargo:warning=FXC compiler: {}", fxc.display());
        let vs_ok = compile_hlsl(&fxc, true, "fullscreenVs", "vs_5_0", &hlsl, &vs_path);
        let ps_ok = compile_hlsl(&fxc, true, "glassPs", "ps_5_0", &hlsl, &ps_path);
        if vs_ok && ps_ok {
            "COMPILED"
        } else {
            "HLSL_ONLY"
        }
    } else if let Some(dxc) = find_compiler("dxc.exe", "DXC_PATH") {
        cargo_warning("fxc not found; dxc emits DXIL (not D3D11-loadable). HLSL syntax check only.");
        println!("cargo:warning=DXC compiler: {}", dxc.display());
        let _ = compile_hlsl(&dxc, false, "fullscreenVs", "vs_5_0", &hlsl, &vs_path);
        let _ = compile_hlsl(&dxc, false, "glassPs", "ps_5_0", &hlsl, &ps_path);
        "HLSL_ONLY"
    } else {
        cargo_warning("No HLSL compiler found; generated HLSL only (self-test will skip glass draw).");
        "NO_COMPILER"
    };

    // 5b. Candy Glass optional variant: at minimum it must parse and compile.
    let candy_hlsl = out_dir.join("glass_d3d11_candy.hlsl");
    let candy_status = if let Some(fxc) = find_compiler("fxc.exe", "FXC_PATH") {
        let candy_ps = out_dir.join("glass_candy_ps.cso");
        if compile_hlsl(&fxc, true, "glassPs", "ps_5_0", &candy_hlsl, &candy_ps) {
            "COMPILED"
        } else {
            "FAILED"
        }
    } else {
        "NOT_CHECKED"
    };
    println!("cargo:rustc-env=AEOLIA_CANDY_STATUS={candy_status}");
    println!("cargo:warning=Candy Glass variant compile status: {candy_status}");

    println!("cargo:rustc-env=AEOLIA_SHADER_STATUS={status}");
    println!("cargo:rustc-env=AEOLIA_SHADER_VS={}", vs_path.display());
    println!("cargo:rustc-env=AEOLIA_SHADER_PS={}", ps_path.display());
    println!("cargo:rerun-if-changed={}", manifest_dir.join("build.rs").display());
    println!("cargo:warning=shader generation status: {status}");
}
