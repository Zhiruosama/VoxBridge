//! Resize geometry uses AppKit's global logical points (Y increases upward).
#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn frame(
    original: Rect,
    direction: tauri_runtime::ResizeDirection,
    dx: f64,
    dy: f64,
    min_width: f64,
    min_height: f64,
) -> Rect {
    use tauri_runtime::ResizeDirection::*;
    let mut result = original;
    if matches!(direction, East | NorthEast | SouthEast) {
        result.width = (original.width + dx).max(min_width);
    } else if matches!(direction, West | NorthWest | SouthWest) {
        result.width = (original.width - dx).max(min_width);
        result.x = original.x + original.width - result.width;
    }
    if matches!(direction, North | NorthEast | NorthWest) {
        result.height = (original.height + dy).max(min_height);
    } else if matches!(direction, South | SouthEast | SouthWest) {
        result.height = (original.height - dy).max(min_height);
        result.y = original.y + original.height - result.height;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_runtime::ResizeDirection::*;
    #[test]
    fn all_edges_keep_the_opposite_anchor_and_unselected_axis() {
        let original = Rect {
            x: -1200.0,
            y: 900.0,
            width: 760.0,
            height: 320.0,
        };
        for edge in [
            North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest,
        ] {
            let next = frame(original, edge, 80.0, 40.0, 480.0, 220.0);
            let west = matches!(edge, West | NorthWest | SouthWest);
            let east = matches!(edge, East | NorthEast | SouthEast);
            let south = matches!(edge, South | SouthEast | SouthWest);
            let north = matches!(edge, North | NorthEast | NorthWest);
            assert_eq!(
                next.width,
                760.0
                    + if west {
                        -80.0
                    } else if east {
                        80.0
                    } else {
                        0.0
                    }
            );
            assert_eq!(
                next.height,
                320.0
                    + if south {
                        -40.0
                    } else if north {
                        40.0
                    } else {
                        0.0
                    }
            );
            assert_eq!(next.x, original.x + if west { 80.0 } else { 0.0 });
            assert_eq!(next.y, original.y + if south { 40.0 } else { 0.0 });
        }
    }
    #[test]
    fn minimum_size_and_backtracking_do_not_accumulate_coordinate_drift() {
        let original = Rect {
            x: 1100.0,
            y: -500.0,
            width: 760.0,
            height: 320.0,
        };
        for edge in [
            North, South, East, West, NorthEast, NorthWest, SouthEast, SouthWest,
        ] {
            for delta in [-10000.0, 10000.0] {
                let next = frame(original, edge, delta, delta, 480.0, 220.0);
                assert!(next.width >= 480.0 && next.height >= 220.0);
                if matches!(edge, West | NorthWest | SouthWest) {
                    assert_eq!(next.x + next.width, original.x + original.width);
                }
                if matches!(edge, South | SouthWest | SouthEast) {
                    assert_eq!(next.y + next.height, original.y + original.height);
                }
            }
            assert_eq!(frame(original, edge, 0.0, 0.0, 480.0, 220.0), original);
        }
    }
}
