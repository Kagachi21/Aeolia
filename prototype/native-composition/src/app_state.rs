//! Minimal in-memory stand-in for the canonical Rust AppState described in
//! ADR-0005. The real AppState lives in the production runtime; this spike only
//! needs a visible Pill <-> Expanded Mode transition and its input consequence.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IslandMode {
    Pill,
    Expanded,
}

impl IslandMode {
    pub fn label(self) -> &'static str {
        match self {
            IslandMode::Pill => "Pill",
            IslandMode::Expanded => "Expanded Mode",
        }
    }

    /// Pill is click-through and must not feed input to egui. Only Expanded Mode
    /// mounts the egui renderer and receives pointer/keyboard input.
    pub fn click_through(self) -> bool {
        matches!(self, IslandMode::Pill)
    }

    pub fn egui_input(self) -> bool {
        !self.click_through()
    }
}

#[derive(Clone, Copy, Debug)]
pub struct AppState {
    pub mode: IslandMode,
    pub frame: u32,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            mode: IslandMode::Pill,
            frame: 0,
        }
    }
}

impl AppState {
    /// The only place that mutates island state (ADR-0005).
    pub fn advance_frame(&mut self) {
        self.frame += 1;
        self.mode = if self.frame % 2 == 0 {
            IslandMode::Expanded
        } else {
            IslandMode::Pill
        };
    }

    pub fn state_line(&self) -> String {
        format!(
            "frame={:<2} mode={:<13} click_through={:<5} egui_input={:<5} egui_render={}",
            self.frame,
            self.mode.label(),
            self.mode.click_through(),
            self.mode.egui_input(),
            if self.mode.egui_input() {
                "MOUNTED"
            } else {
                "SKIPPED"
            }
        )
    }
}
