// the options as src/index.ts packs them into one u32, read by every wasm build

const std = @import("std");
const parser = @import("parser.zig");

pub const parse_rule_prelude = 1 << 0;
pub const positions = 1 << 1;
pub const tokens = 1 << 2;
pub const context = 3;
pub const context_mask = 0xF;
pub const parse_value = 1 << 7;
pub const parse_custom_property = 1 << 8;
pub const parse_atrule_prelude = 1 << 9;
pub const atrule = 10;
pub const atrule_mask = 0xF;
pub const spec = 1 << 14;
pub const source_map = 1 << 15;

/// The parser options `parse` and `transform` send.
pub fn options(flags: u32) parser.Options {
    return .{
        .parse_rule_prelude = flags & parse_rule_prelude != 0,
        .parse_value = flags & parse_value != 0,
        .parse_custom_property = flags & parse_custom_property != 0,
        .lines = flags & positions != 0,
        .parse_atrule_prelude = flags & parse_atrule_prelude != 0,
        .atrule = std.enums.fromInt(parser.Atrule, (flags >> atrule) & atrule_mask) orelse .unknown,
        .context = std.enums.fromInt(parser.Context, (flags >> context) & context_mask) orelse .stylesheet,
    };
}
