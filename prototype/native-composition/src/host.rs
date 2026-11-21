//! Render host for the issue #7 spike.
//!
//! One process, one D3D11 device with BGRA support, one HWND swap chain.
//! D2D/DeviceContext derives from that same device's IDXGIDevice, and
//! egui-directx11 renders through that same device. Frame order is exactly:
//! HLSL glass -> D2D/DirectWrite -> egui (Expanded Mode only) -> Present.

use crate::app_state::AppState;
use std::mem;
use windows::core::{w, Interface, Result};
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_ALPHA_MODE, D2D1_ALPHA_MODE_IGNORE, D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F,
    D2D1_PIXEL_FORMAT, D2D_RECT_F,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, D2D1_BITMAP_OPTIONS, D2D1_BITMAP_OPTIONS_CANNOT_DRAW,
    D2D1_BITMAP_OPTIONS_TARGET, D2D1_BITMAP_PROPERTIES1, D2D1_DEVICE_CONTEXT_OPTIONS_NONE,
    D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_FACTORY_TYPE_SINGLE_THREADED, ID2D1Bitmap1, ID2D1Device,
    ID2D1DeviceContext, ID2D1Factory1,
};
use windows::Win32::Graphics::Direct3D::{
    D3D11_SRV_DIMENSION_TEXTURE2D, D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP,
    D3D_FEATURE_LEVEL, D3D_FEATURE_LEVEL_11_0,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDeviceAndSwapChain, D3D11_BIND_CONSTANT_BUFFER, D3D11_BIND_SHADER_RESOURCE,
    D3D11_BUFFER_DESC, D3D11_COMPARISON_NEVER, D3D11_FILTER_MIN_MAG_MIP_LINEAR,
    D3D11_SAMPLER_DESC, D3D11_SDK_VERSION,
    D3D11_SHADER_RESOURCE_VIEW_DESC, D3D11_SHADER_RESOURCE_VIEW_DESC_0,
    D3D11_SUBRESOURCE_DATA, D3D11_TEX2D_SRV, D3D11_TEXTURE2D_DESC,
    D3D11_TEXTURE_ADDRESS_CLAMP, D3D11_USAGE_DEFAULT, D3D11_VIEWPORT,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, ID3D11Buffer, ID3D11DepthStencilView, ID3D11Device,
    ID3D11DeviceContext, ID3D11PixelShader, ID3D11RenderTargetView, ID3D11SamplerState,
    ID3D11ShaderResourceView, ID3D11Texture2D, ID3D11VertexShader,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_MEASURING_MODE_NATURAL,
    IDWriteFactory, IDWriteTextFormat,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_MODE_SCALING_UNSPECIFIED,
    DXGI_MODE_SCANLINE_ORDER_UNSPECIFIED, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGISurface, IDXGISwapChain, DXGI_SWAP_CHAIN_DESC, DXGI_SWAP_EFFECT_DISCARD,
    DXGI_USAGE_RENDER_TARGET_OUTPUT,
};

/// Mirrors `cbuffer GlassConstants : register(b0)` in GlassGPU.hlsl.
#[repr(C)]
#[derive(Clone, Copy)]
struct GlassConstants {
    lens: [[f32; 4]; 32],
    crop_rect: [f32; 4],
    desktop_info: [f32; 4],
    pass_info: [f32; 4],
    source_region: [f32; 4],
    detail_region: [f32; 4],
}

/// Mirrors the generated `cbuffer LegacyGlassParams : register(b1)`.
#[repr(C)]
#[derive(Clone, Copy)]
struct LegacyParams {
    values: [f32; 32],
}

pub struct InitReport {
    pub driver: &'static str,
    pub feature_level: u32,
    pub device: usize,
    pub context: usize,
    pub swapchain: usize,
    pub d2d_device: usize,
    pub d2d_context: usize,
    pub dwrite_factory: usize,
    pub glass_shader: &'static str,
    pub egui_renderer: bool,
}

pub struct FrameReport {
    pub frame: u32,
    pub state_line: String,
    pub glass_draw: &'static str,
    pub d2d_draw: &'static str,
    pub egui_draw: &'static str,
    pub present_hr: i32,
}

pub struct RenderHost {
    // Held explicitly for app lifetime (ADR-0005): never rely on a D2D target
    // being the last reference to the D3D device.
    #[allow(dead_code)]
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    swapchain: IDXGISwapChain,
    rtv: ID3D11RenderTargetView,
    d2d_context: ID2D1DeviceContext,
    d2d_bitmap: ID2D1Bitmap1,
    text_format: IDWriteTextFormat,
    white_brush: windows::Win32::Graphics::Direct2D::ID2D1SolidColorBrush,
    egui_ctx: egui::Context,
    egui_renderer: egui_directx11::Renderer,
    // Glass pipeline (optional when DXC was unavailable at build time).
    glass_vs: Option<ID3D11VertexShader>,
    glass_ps: Option<ID3D11PixelShader>,
    glass_sampler: Option<ID3D11SamplerState>,
    glass_srv: Option<ID3D11ShaderResourceView>,
    glass_cb: Option<ID3D11Buffer>,
    legacy_cb: Option<ID3D11Buffer>,
    shader_status: &'static str,
    driver: &'static str,
    feature_level: u32,
    width: u32,
    height: u32,
}

fn glass_constants() -> GlassConstants {
    let mut c = GlassConstants {
        lens: [[0.0; 4]; 32],
        crop_rect: [0.0, 0.0, 480.0, 180.0],
        desktop_info: [1920.0, 1080.0, 1.0, 0.0],
        pass_info: [1.0 / 480.0, 1.0 / 180.0, 1.0, 0.5],
        source_region: [1.0, 1.0, 0.0, 0.0],
        detail_region: [1.0, 1.0, 0.0, 0.0],
    };
    let half_w = 120.0f32;
    let half_h = 44.0f32;
    let rim_cap = 24.0f32;
    let rim_radius = half_h.min(rim_cap);
    let inv_rim = 1.0 / rim_radius.max(1.0);
    let a = 0.7f32;
    let b = 2.3f32;
    let cparam = 5.2f32;
    let d = 6.9f32;
    let log_base = (cparam * std::f32::consts::E).log2();
    let bevel = 0.0f32;
    let param_d = d * (1.0 - bevel) + d * 0.58 * bevel;
    let decay = param_d * log_base;
    let edge_loss = b * (-a * log_base).exp2();
    let spec = 0.30f32;
    let reflect_scale = 0.0f32 * 0.72 + spec * 0.42;

    c.lens[2] = [0.0, 0.0 /* bleed */, -1.0 / half_w, 0.0];
    c.lens[3] = [0.0, rim_cap /* GLASS_RIM */, -1.0 / half_h, 0.0];
    c.lens[6] = [0.0, rim_radius, inv_rim, 0.0];
    c.lens[10] = [0.0, edge_loss, 0.0, 0.0];
    c.lens[12] = [0.0, decay, 2.0 * decay * 0.69314718, 0.0];
    c.lens[15] = [0.0, 0.16 * (b * 0.45), 0.14 + 0.35 * spec, 0.0];
    c.lens[16] = [0.0, reflect_scale, reflect_scale.sqrt(), 0.0];
    c.lens[22] = [0.0, 0.0, 1.0 / (half_w * 0.7), 0.0];
    c.lens[23] = [0.0, 0.0, 1.0 / (half_h * 1.5), 0.0];
    c.lens[25] = [0.0, 0.0, 0.0, 1.0];
    c.lens[26] = [0.0, 1.0 / 18.0, 1.0 / 18.0, rim_radius + 4.0];
    c.lens[28] = [0.0, 0.0, 1.0 / (240.0 * 0.72), 0.0];
    c.lens[29] = [0.0, 0.0, 1.0 / (88.0 * 0.95), 0.0];
    c.lens[30] = [0.0, rim_radius * 1.5 * 1.0, 0.0, 0.0];
    c.lens[31] = [0.0, 1.8, 1.0 / (0.2 - 1.8), 0.0];
    c
}

fn legacy_params() -> LegacyParams {
    let mut p = LegacyParams { values: [0.0; 32] };
    p.values[0] = 480.0; // srcW
    p.values[1] = 180.0; // srcH
    p.values[2] = 240.0; // notchW
    p.values[3] = 88.0; // notchH
    p.values[6] = 40.0; // bottomCornerR
    p.values[7] = 40.0; // topCornerR
    p.values[8] = 3.0; // powerFactor
    p.values[9] = 0.7; // u_a
    p.values[10] = 2.3; // u_b
    p.values[11] = 5.2; // u_c
    p.values[12] = 6.9; // u_d
    p.values[13] = 1.0; // u_fPower
    p.values[14] = 0.05; // u_noise
    p.values[15] = 0.30; // u_glowWeight
    p.values[17] = 0.06; // u_glowEdge0
    p.values[19] = 0.20; // u_chroma
    p.values[20] = 1.0; // satFactor
    p.values[26] = 0.5; // highlightStrength
    p.values[28] = 0.5; // lightX
    p.values[29] = 0.2; // lightY
    p.values[30] = 1.0; // edgeBend
    p
}

impl RenderHost {
    pub fn new(
        hwnd: HWND,
        width: u32,
        height: u32,
        egui_ctx: egui::Context,
    ) -> Result<(Self, InitReport)> {
        unsafe {
            println!("[host] step: create D3D11 device + swap chain");
            let (device, context, swapchain, driver, feature_level) =
                Self::create_device(hwnd, width, height)?;

            println!("[host] step: GetBuffer + CreateRenderTargetView");
            let back_buffer: ID3D11Texture2D = swapchain.GetBuffer(0)?;
            let mut rtv_opt = None;
            device.CreateRenderTargetView(&back_buffer, None, Some(&mut rtv_opt))?;
            let rtv = rtv_opt.unwrap();

            // D2D derives from the SAME D3D11 device's IDXGIDevice.
            println!("[host] step: D2D factory/device/context from same IDXGIDevice");
            let dxgi_device: IDXGIDevice = device.cast()?;
            let d2d_factory: ID2D1Factory1 =
                D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
            let d2d_device: ID2D1Device = d2d_factory.CreateDevice(&dxgi_device)?;
            let d2d_context: ID2D1DeviceContext =
                d2d_device.CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE)?;
            println!("[host] step: CreateBitmapFromDxgiSurface (shared back buffer)");
            let surface: IDXGISurface = back_buffer.cast()?;
            let variants: [(&str, D2D1_ALPHA_MODE, D2D1_BITMAP_OPTIONS); 4] = [
                ("premultiplied+TARGET", D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_BITMAP_OPTIONS_TARGET),
                ("ignore+TARGET", D2D1_ALPHA_MODE_IGNORE, D2D1_BITMAP_OPTIONS_TARGET),
                (
                    "premultiplied+TARGET|CANNOT_DRAW",
                    D2D1_ALPHA_MODE_PREMULTIPLIED,
                    D2D1_BITMAP_OPTIONS(D2D1_BITMAP_OPTIONS_TARGET.0 | D2D1_BITMAP_OPTIONS_CANNOT_DRAW.0),
                ),
                ("default properties (None)", D2D1_ALPHA_MODE_IGNORE, D2D1_BITMAP_OPTIONS(0)),
            ];
            let mut d2d_bitmap_opt = None;
            for (label, alpha, options) in variants {
                let props = D2D1_BITMAP_PROPERTIES1 {
                    pixelFormat: D2D1_PIXEL_FORMAT {
                        format: DXGI_FORMAT_B8G8R8A8_UNORM,
                        alphaMode: alpha,
                    },
                    dpiX: 96.0,
                    dpiY: 96.0,
                    bitmapOptions: options,
                    colorContext: mem::zeroed(),
                };
                match d2d_context.CreateBitmapFromDxgiSurface(&surface, Some(&props)) {
                    Ok(b) => {
                        println!("[host] D2D bitmap variant OK: {label}");
                        d2d_bitmap_opt = Some(b);
                        break;
                    }
                    Err(e) => println!("[host] D2D bitmap variant '{label}' failed: {e}"),
                }
            }
            let d2d_bitmap = d2d_bitmap_opt.ok_or_else(|| {
                windows::core::Error::new(
                    windows::Win32::Foundation::E_FAIL,
                    "all CreateBitmapFromDxgiSurface variants failed",
                )
            })?;

            // DirectWrite shares the same D2D context for drawing.
            println!("[host] step: DirectWrite factory + text format");
            egui_ctx.set_pixels_per_point(1.0);
            let dwrite: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let text_format: IDWriteTextFormat = dwrite.CreateTextFormat(
                w!("Segoe UI"),
                None,
                DWRITE_FONT_WEIGHT_NORMAL,
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                13.0,
                w!("en-US"),
            )?;
            let white_brush = d2d_context.CreateSolidColorBrush(
                &D2D1_COLOR_F {
                    r: 0.85,
                    g: 0.95,
                    b: 1.0,
                    a: 1.0,
                },
                None,
            )?;

            // egui-directx11 uses the SAME D3D11 device.
            println!("[host] step: egui-directx11::Renderer::new(same device)");
            let egui_renderer = egui_directx11::Renderer::new(&device)?;

            // Glass pipeline is optional: build.rs compiles it when DXC exists.
            println!("[host] step: glass VS/PS/sampler/texture/cbuffers");
            let status = env!("AEOLIA_SHADER_STATUS");
            let (glass_vs, glass_ps, glass_sampler, glass_srv, glass_cb, legacy_cb) =
                if status == "COMPILED" {
                    let vs_blob = std::fs::read(env!("AEOLIA_SHADER_VS"))?;
                    let ps_blob = std::fs::read(env!("AEOLIA_SHADER_PS"))?;
                    let mut vs = None;
                    let mut ps = None;
                    println!("[host] glass: CreateVertexShader ({} bytes)", vs_blob.len());
                    device.CreateVertexShader(&vs_blob, None, Some(&mut vs))?;
                    println!("[host] glass: CreatePixelShader ({} bytes)", ps_blob.len());
                    device.CreatePixelShader(&ps_blob, None, Some(&mut ps))?;

                    let sampler_desc = D3D11_SAMPLER_DESC {
                        Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
                        AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                        AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                        AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                        MipLODBias: 0.0,
                        MaxAnisotropy: 1,
                        ComparisonFunc: D3D11_COMPARISON_NEVER,
                        BorderColor: [0.0; 4],
                        MinLOD: 0.0,
                        MaxLOD: 3.4028235e38,
                    };
                    println!("[host] glass: CreateSamplerState");
                    let mut sampler = None;
                    device.CreateSamplerState(&sampler_desc, Some(&mut sampler))?;

                    // Procedural backdrop texture so the glass shader samples something.
                    let tex_w = 64u32;
                    let tex_h = 64u32;
                    let mut pixels = vec![0u8; (tex_w * tex_h * 4) as usize];
                    for y in 0..tex_h {
                        for x in 0..tex_w {
                            let i = ((y * tex_w + x) * 4) as usize;
                            pixels[i] = (x * 4) as u8;
                            pixels[i + 1] = (y * 4) as u8;
                            pixels[i + 2] = 200;
                            pixels[i + 3] = 255;
                        }
                    }
                    let tex_desc = D3D11_TEXTURE2D_DESC {
                        Width: tex_w,
                        Height: tex_h,
                        MipLevels: 1,
                        ArraySize: 1,
                        Format: DXGI_FORMAT_R8G8B8A8_UNORM,
                        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                        Usage: D3D11_USAGE_DEFAULT,
                        BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
                        CPUAccessFlags: 0,
                        MiscFlags: 0,
                    };
                    let initial = D3D11_SUBRESOURCE_DATA {
                        pSysMem: pixels.as_ptr() as *const _,
                        SysMemPitch: tex_w * 4,
                        SysMemSlicePitch: 0,
                    };
                    println!("[host] glass: CreateTexture2D backdrop");
                    let mut texture = None;
                    device.CreateTexture2D(&tex_desc, Some(&initial), Some(&mut texture))?;
                    let texture = texture.unwrap();
                    println!("[host] glass: CreateShaderResourceView");
                    let srv_desc = D3D11_SHADER_RESOURCE_VIEW_DESC {
                        Format: DXGI_FORMAT_R8G8B8A8_UNORM,
                        ViewDimension: D3D11_SRV_DIMENSION_TEXTURE2D,
                        Anonymous: D3D11_SHADER_RESOURCE_VIEW_DESC_0 {
                            Texture2D: D3D11_TEX2D_SRV {
                                MostDetailedMip: 0,
                                MipLevels: 1,
                            },
                        },
                    };
                    let mut srv = None;
                    device.CreateShaderResourceView(&texture, Some(&srv_desc), Some(&mut srv))?;
                    println!("[host] glass: constant buffers");

                    let gc = glass_constants();
                    let mut cb = None;
                    Self::create_constant_buffer(&device, &gc, &mut cb)?;
                    let lp = legacy_params();
                    let mut lcb = None;
                    Self::create_constant_buffer(&device, &lp, &mut lcb)?;

                    (vs, ps, sampler, srv, cb, lcb)
                } else {
                    (None, None, None, None, None, None)
                };

            let report = InitReport {
                driver,
                feature_level: feature_level.0 as u32,
                device: device.as_raw() as usize,
                context: context.as_raw() as usize,
                swapchain: swapchain.as_raw() as usize,
                d2d_device: d2d_device.as_raw() as usize,
                d2d_context: d2d_context.as_raw() as usize,
                dwrite_factory: dwrite.as_raw() as usize,
                glass_shader: status,
                egui_renderer: true,
            };

            Ok((
                Self {
                    device,
                    context,
                    swapchain,
                    rtv,
                    d2d_context,
                    d2d_bitmap,
                    text_format,
                    white_brush,
                    egui_ctx,
                    egui_renderer,
                    glass_vs,
                    glass_ps,
                    glass_sampler,
                    glass_srv,
                    glass_cb,
                    legacy_cb,
                    shader_status: status,
                    driver,
                    feature_level: feature_level.0 as u32,
                    width,
                    height,
                },
                report,
            ))
        }
    }

    unsafe fn create_constant_buffer<T: Copy>(
        device: &ID3D11Device,
        data: &T,
        out: &mut Option<ID3D11Buffer>,
    ) -> Result<()> {
        let desc = D3D11_BUFFER_DESC {
            ByteWidth: (mem::size_of::<T>()) as u32,
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
            StructureByteStride: 0,
        };
        let initial = D3D11_SUBRESOURCE_DATA {
            pSysMem: data as *const T as *const _,
            SysMemPitch: 0,
            SysMemSlicePitch: 0,
        };
        device.CreateBuffer(&desc, Some(&initial), Some(out as *mut Option<ID3D11Buffer>))
    }

    unsafe fn create_device(
        hwnd: HWND,
        width: u32,
        height: u32,
    ) -> Result<(ID3D11Device, ID3D11DeviceContext, IDXGISwapChain, &'static str, D3D_FEATURE_LEVEL)> {
        let swap_desc = DXGI_SWAP_CHAIN_DESC {
            BufferDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_MODE_DESC {
                Width: width,
                Height: height,
                RefreshRate: DXGI_RATIONAL {
                    Numerator: 60,
                    Denominator: 1,
                },
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                ScanlineOrdering: DXGI_MODE_SCANLINE_ORDER_UNSPECIFIED,
                Scaling: DXGI_MODE_SCALING_UNSPECIFIED,
            },
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            OutputWindow: hwnd,
            Windowed: windows::core::BOOL(1),
            SwapEffect: DXGI_SWAP_EFFECT_DISCARD,
            Flags: 0,
        };
        let levels = [D3D_FEATURE_LEVEL_11_0];

        for (driver, dt) in [
            ("HARDWARE", D3D_DRIVER_TYPE_HARDWARE),
            ("WARP", D3D_DRIVER_TYPE_WARP),
        ] {
            let mut device = None;
            let mut context = None;
            let mut swapchain = None;
            let mut feature_level = D3D_FEATURE_LEVEL(0);
            let result = D3D11CreateDeviceAndSwapChain(
                None::<&windows::Win32::Graphics::Dxgi::IDXGIAdapter>,
                dt,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&levels),
                D3D11_SDK_VERSION,
                Some(&swap_desc),
                Some(&mut swapchain),
                Some(&mut device),
                Some(&mut feature_level),
                Some(&mut context),
            );
            if result.is_ok()
                && device.is_some()
                && context.is_some()
                && swapchain.is_some()
            {
                return Ok((
                    device.unwrap(),
                    context.unwrap(),
                    swapchain.unwrap(),
                    driver,
                    feature_level,
                ));
            }
            println!("  [host] {driver} device creation failed: {:?}", result.err());
        }
        Err(windows::core::Error::from_hresult(
            windows::Win32::Foundation::E_FAIL,
        ))
    }

    pub fn render_frame(&mut self, state: &AppState) -> Result<FrameReport> {
        let frame = state.frame;
        let state_line = state.state_line();
        unsafe {
            // 1. Bind the shared back-buffer RTV and clear once, BEFORE glass.
            self.context
                .OMSetRenderTargets(Some(&[Some(self.rtv.clone())]), None::<&ID3D11DepthStencilView>);
            self.context
                .ClearRenderTargetView(&self.rtv, &[0.03, 0.04, 0.07, 1.0]);

            // 2. HLSL glass pass on the shared device.
            let glass_draw = if self.shader_status == "COMPILED" {
                self.context.RSSetViewports(Some(&[D3D11_VIEWPORT {
                    TopLeftX: 0.0,
                    TopLeftY: 0.0,
                    Width: self.width as f32,
                    Height: self.height as f32,
                    MinDepth: 0.0,
                    MaxDepth: 1.0,
                }]));
                self.context.VSSetShader(self.glass_vs.as_ref(), None);
                self.context.PSSetShader(self.glass_ps.as_ref(), None);
                self.context.PSSetShaderResources(
                    0,
                    Some(&[Some(self.glass_srv.as_ref().unwrap().clone())]),
                );
                self.context
                    .PSSetSamplers(0, Some(&[Some(self.glass_sampler.as_ref().unwrap().clone())]));
                self.context.VSSetConstantBuffers(
                    0,
                    Some(&[Some(self.glass_cb.as_ref().unwrap().clone())]),
                );
                self.context.PSSetConstantBuffers(
                    0,
                    Some(&[Some(self.glass_cb.as_ref().unwrap().clone())]),
                );
                self.context.PSSetConstantBuffers(
                    1,
                    Some(&[Some(self.legacy_cb.as_ref().unwrap().clone())]),
                );
                self.context.Draw(3, 0);
                "DRAWN"
            } else {
                "SKIPPED (no DXC bytecode)"
            };

            // 3. Direct2D / DirectWrite: visible state line, no Clear after glass.
            self.d2d_context.SetTarget(&self.d2d_bitmap);
            self.d2d_context.BeginDraw();
            let rect = D2D_RECT_F {
                left: 12.0,
                top: 12.0,
                right: (self.width - 12) as f32,
                bottom: 40.0,
            };
            let text: Vec<u16> = state_line.encode_utf16().collect();
            self.d2d_context.DrawText(
                &text,
                &self.text_format,
                &rect,
                &self.white_brush,
                D2D1_DRAW_TEXT_OPTIONS_NONE,
                DWRITE_MEASURING_MODE_NATURAL,
            );
            self.d2d_context.EndDraw(None, None)?;
            self.d2d_context.SetTarget(None);
            let d2d_draw = "DRAWN";

            // 4. egui: ONLY in Expanded Mode. Pill is click-through and feeds no input.
            let egui_draw = if state.mode.egui_input() {
                let input = egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::pos2(0.0, 0.0),
                        egui::vec2(self.width as f32, self.height as f32),
                    )),
                    focused: true,
                    ..Default::default()
                };
                let full_output = self.egui_ctx.run_ui(input, |ctx| {
                    egui::Window::new("Expanded Mode - egui")
                        .fixed_pos(egui::pos2(16.0, 56.0))
                        .collapsible(false)
                        .resizable(false)
                        .show(ctx, |ui| {
                            ui.label("egui mounted on the shared D3D11 device");
                            ui.label(state_line.clone());
                            let _ = ui.button("Expanded-only interaction");
                        });
                });
                let (renderer_output, _platform_output, _viewports) =
                    egui_directx11::split_output(full_output);
                self.egui_renderer.render(
                    &self.context,
                    &self.rtv,
                    &self.egui_ctx,
                    renderer_output,
                )?;
                "MOUNTED"
            } else {
                // Pill: do not feed input, do not run, do not render egui.
                "SKIPPED (Pill is click-through)"
            };

            // 5. Present on the same swap chain.
            let present_hr = self.swapchain.Present(0, windows::Win32::Graphics::Dxgi::DXGI_PRESENT(0)).0;

            Ok(FrameReport {
                frame,
                state_line,
                glass_draw,
                d2d_draw,
                egui_draw,
                present_hr,
            })
        }
    }

    pub fn summary(&self) -> String {
        format!(
            "driver={} feature_level={:#x} shader={} egui=egui-directx11 v0.13.0+egui-0.35.0 size={}x{}",
            self.driver, self.feature_level, self.shader_status, self.width, self.height
        )
    }
}
