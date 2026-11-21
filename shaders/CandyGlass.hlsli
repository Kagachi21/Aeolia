// CandyGlass.hlsli
// Preset "Candy Glass" untuk LiquidGlassRefraction.hlsl + shader D3D11 pipeline.
// Include SETELAH deklarasi GlassConstants, SEBELUM finishGlass().
// Karakter: jelly pastel tembus pandang, bevel lebar, refraksi kuat,
// tepi bercahaya, saturasi tinggi, kilau gula lembut.

// ---------------------------------------------------------------
// 1. Preset parameter (nilai untuk register c0..c31 / sisi CPU)
// ---------------------------------------------------------------
#define CANDY_POWER_FACTOR   3.0    // c8  squircle (3.0 punya fast path)
#define CANDY_A              0.7    // c9
#define CANDY_B              2.8    // c10 amplitudo refraksi (default 2.3)
#define CANDY_C              5.2    // c11
#define CANDY_D              6.9    // c12 (otomatis x0.58 saat bevel)
#define CANDY_FPOWER         1.6    // c13 refraksi lebih tebal
#define CANDY_NOISE          0.04   // c14 grain halus
#define CANDY_GLOW_WEIGHT    0.60   // c15 specular
#define CANDY_GLOW_BIAS      0.35   // c16 pantulan
#define CANDY_GLOW_EDGE0     0.06   // c17 distorsi gelombang tepi
#define CANDY_BLUR           10.0   // c18 blur backdrop (px)
#define CANDY_CHROMA         0.90   // c19 aberasi kromatik
#define CANDY_SAT            1.35   // c20 saturasi
#define CANDY_BRIGHT         0.03   // c21
#define CANDY_HIGHLIGHT      1.20   // c26
#define CANDY_EDGE_BEND      1.30   // c30
#define CANDY_BEVEL_MODE     1.0    // c31 bevel lebar ala jelly

// Warna permen (sRGB). Dipakai di candyFinish().
#define CANDY_TINT_A  float3(1.00, 0.62, 0.80)  // pink
#define CANDY_TINT_B  float3(0.62, 0.95, 0.85)  // mint
#define CANDY_TINT_C  float3(0.76, 0.68, 1.00)  // lavender
#define CANDY_TINT_MIX       0.35   // kekuatan tint pada badan kaca
#define CANDY_INNER_GLOW     0.22   // cahaya subsurface dekat tepi
#define CANDY_SUGAR          0.10   // kilau gula (glitter halus)

// ---------------------------------------------------------------
// 2. Packing untuk jalur GLASS_PREFILTERED_BACKDROP (sisi CPU)
//    Rumus ini sama dengan cabang #else di shadeGlass().
// ---------------------------------------------------------------
/*
  halfW = notchW/2, halfH = notchH/2
  rimRadius   = min(min(halfW, halfH), rimCap)
  logBase     = log2(C * 2.718281828)
  bevel       = CANDY_BEVEL_MODE
  paramD      = D * lerp(1, 0.58, bevel)

  lens[2].y   = bleed            lens[3].y  = rimCap (ZRadius)
  lens[2].z   = -1 / halfW       lens[3].z  = -1 / halfH
  lens[6].y   = rimRadius        lens[6].z  = 1 / max(rimRadius, 1)
  lens[10].y  = B * exp2(-A * logBase)               // edgeLoss
  lens[12].y  = paramD * logBase                     // decay
  lens[12].z  = 2 * lens[12].y * 0.69314718          // turunan decay
  lens[15].y  = lerp(0.16, 0.36, bevel) * saturate(B * 0.45)   // dome
  spec        = clamp(GLOW_WEIGHT, 0, 2.5)
  lens[15].z  = 0.14 + 0.35 * spec                   // glintScale
  lens[16].y  = clamp(GLOW_BIAS, 0, 2.5) * 0.72 + spec * 0.42  // reflectScale
  lens[16].z  = sqrt(lens[16].y)                     // reflectPeak
  lens[30].y  = rimRadius * 1.5 * EDGE_BEND          // lever
  lens[26].z  = 1 / max(bottomCornerR * 0.85, lerp(18, 28, bevel))
  lens[26].w  = max(rimRadius, max(topCornerR, bottomCornerR), 1/lens[26].z) + 2  // inset (konservatif)
  chamfer     = lerp(1.8, 3.4, bevel)
  lens[31].y  = chamfer          lens[31].z = 1 / (0.2 - chamfer)
  // Cahaya: lens[28].y/lens[29].y = posisi cahaya lokal (px)
  //         lens[28].z = 1/(notchW*0.72), lens[29].z = 1/(notchH*0.95)
  // Pointer: lens[22].y/23.y = posisi pointer lokal, .z = 1/interactionScale
  //          lens[25].y = ripplePhase, .z = flex, .w = energyGain
*/

// ---------------------------------------------------------------
// 3. Tambahan Candy: ganti pemanggilan finishGlass() dengan candyFinish()
//    Tambahkan parameter insidePixels dan rimRadius dari shadeGlass().
// ---------------------------------------------------------------
float3 candyPalette(float2 p)
{
    // Gradien pink -> mint -> lavender mengikuti posisi lokal.
    float t = frac(dot(p, float2(0.0021, 0.0034)));
    float3 ab = lerp(CANDY_TINT_A, CANDY_TINT_B, smoothstep(0.0, 0.5, t));
    return lerp(ab, CANDY_TINT_C, smoothstep(0.5, 1.0, t));
}

float3 candyFinish(float3 col, float2 pixel, float insidePixels, float rimRadius)
{
    float edge = 1.0 - saturate(insidePixels / max(rimRadius, 1.0)); // 1 di tepi, 0 di tengah
    float3 tint = candyPalette(pixel);

    // Tint jelly: kali lembut, lebih pekat di tengah (badan tebal).
    col = lerp(col, col * (0.55 + 0.75 * tint), CANDY_TINT_MIX * (1.0 - 0.5 * edge));

    // Subsurface glow: cahaya berwarna menyala di dekat tepi.
    col += tint * (edge * edge) * CANDY_INNER_GLOW;

    // Sugar sparkle: butir kecil yang berkelip tipis, stabil per piksel.
    float s = rand(floor(pixel * 0.5));
    col += step(0.985, s) * CANDY_SUGAR * (0.4 + 0.6 * edge);

    // Grain, saturasi, brightness bawaan Liquid Glass.
    return finishGlass(col, pixel);
}

// Pemakaian di akhir shadeGlass():
//   col = candyFinish(col, localPos + halfSize, insidePixels, rimRadius);
// (ganti baris: col = finishGlass(col, localPos + halfSize);)
// Jalur "early out" backdrop murni di atas tetap memakai finishGlass()
// agar area di luar bevel tidak ikut ter-tint.
