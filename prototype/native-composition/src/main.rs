//! PROTOTYPE for wayfinder issue #7 - NOT production code.
//!
//! One cargo command:
//!   cargo run -- --self-test
//!
//! Creates a hidden HWND, one shared D3D11 device (BGRA), an HWND swap chain,
//! a D2D/DirectWrite context derived from that device, and an egui-directx11
//! renderer on that same device. Renders a fixed frame sequence and prints the
//! full state so verification needs no human and no visible window.

mod app_state;
mod host;

use app_state::AppState;
use host::RenderHost;
use std::env;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetClientRect, RegisterClassW, ShowWindow, CW_USEDEFAULT,
    CS_HREDRAW, CS_VREDRAW, SW_HIDE, WNDCLASSW, WS_OVERLAPPEDWINDOW,
};

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn create_hidden_window(width: u32, height: u32) -> windows::core::Result<HWND> {
    unsafe {
        let hinstance = GetModuleHandleW(None)?;
        let class_name = windows::core::w!("AeoliaNativeCompositionPrototype");
        let class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance.into(),
            hIcon: windows::Win32::UI::WindowsAndMessaging::HICON::default(),
            hCursor: windows::Win32::UI::WindowsAndMessaging::HCURSOR::default(),
            hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH::default(),
            lpszMenuName: windows::core::PCWSTR::null(),
            lpszClassName: class_name,
        };
        // If the class already exists in this process, CreateWindowExW will
        // still succeed; let it report any real registration failure.
        let _ = RegisterClassW(&class);
        let hwnd = CreateWindowExW(
            windows::Win32::UI::WindowsAndMessaging::WINDOW_EX_STYLE(0),
            class_name,
            windows::core::w!("Aeolia native composition PROTOTYPE (hidden)"),
            WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width as i32,
            height as i32,
            None,
            None,
            Some(hinstance.into()),
            None,
        )?;
        let _ = ShowWindow(hwnd, SW_HIDE);
        let mut rect = windows::Win32::Foundation::RECT::default();
        GetClientRect(hwnd, &mut rect)?;
        println!(
            "[window] HWND={:?} client={}x{} (hidden, swap-chain presentation baseline)",
            hwnd,
            rect.right - rect.left,
            rect.bottom - rect.top
        );
        Ok(hwnd)
    }
}

fn print_banner() {
    println!("============================================================");
    println!(" A E O L I A  -  NATIVE COMPOSITION PROTOTYPE (issue #7)");
    println!();
    println!(" Throwaway spike. NOT production code. No persistence, no encoder,");
    println!(" no OS integrations. HLSL sources are untouched (hashes verified");
    println!(" at build time). Frame order: HLSL glass -> D2D/DW -> egui -> Present.");
    println!("============================================================");
}

fn main() {
    print_banner();

    let args: Vec<String> = env::args().skip(1).collect();
    let self_test = args.iter().any(|a| a == "--self-test");
    if !self_test {
        println!("Usage: cargo run -- --self-test [--frames N]");
        println!("(all verification runs through --self-test; no interactive window is used)");
        return;
    }
    let frames = args
        .iter()
        .position(|a| a == "--frames")
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(4);

    println!("[shader] build status = {}", env!("AEOLIA_SHADER_STATUS"));
    println!("[shader] candy variant = {}", env!("AEOLIA_CANDY_STATUS"));
    let hashes = include_str!(concat!(env!("OUT_DIR"), "/SOURCE_HASHES.txt"));
    for line in hashes.lines().filter(|l| !l.is_empty() && !l.starts_with('#')) {
        println!("[shader] {line}");
    }

    let width = 480u32;
    let height = 180u32;
    let hwnd = match create_hidden_window(width, height) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[FAIL] hidden HWND creation failed: {e}");
            std::process::exit(2);
        }
    };

    let egui_ctx = egui::Context::default();
    let (mut host, report) = match RenderHost::new(hwnd, width, height, egui_ctx) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[FAIL] render host creation failed: {e}");
            std::process::exit(3);
        }
    };

    println!("[device] driver={} feature_level={:#x}", report.driver, report.feature_level);
    println!("[device] D3D11 device   = {:#x}", report.device);
    println!("[device] D3D11 context  = {:#x}", report.context);
    println!("[device] DXGI swapchain = {:#x}", report.swapchain);
    println!("[device] D2D device     = {:#x}", report.d2d_device);
    println!("[device] D2D context    = {:#x}", report.d2d_context);
    println!("[device] DWrite factory = {:#x}", report.dwrite_factory);
    println!("[device] egui renderer  = {}", report.egui_renderer);
    println!("[device] glass shader   = {}", report.glass_shader);
    println!("[host]   {}", host.summary());

    // Pill is the initial state: click-through, no egui input.
    let mut state = AppState::default();
    println!("[state] INITIAL {}", state.state_line());

    let mut failures = 0;
    for _ in 0..frames {
        state.advance_frame();
        match host.render_frame(&state) {
            Ok(frame) => {
                println!(
                    "[frame {:<2}] state={} | glass={} | d2d={} | egui={} | Present(hr=0x{:08x})",
                    frame.frame,
                    frame.state_line,
                    frame.glass_draw,
                    frame.d2d_draw,
                    frame.egui_draw,
                    frame.present_hr as u32
                );
                if frame.present_hr < 0 {
                    failures += 1;
                }
            }
            Err(e) => {
                eprintln!("[frame {}] FAIL: {e}", state.frame);
                failures += 1;
            }
        }
    }

    println!("------------------------------------------------------------");
    if failures == 0 {
        println!("[PASS] self-test complete: {} frames, all stages executed.", frames);
        println!("[PASS] shared D3D11 device validated for glass + D2D/DW + egui.");
    } else {
        println!("[FAIL] self-test finished with {failures} failed frame(s).");
    }
    println!("[NOTE] egui is mounted ONLY in Expanded Mode; Pill stays click-through.");
    println!("============================================================");

    if failures > 0 {
        std::process::exit(4);
    }
}
