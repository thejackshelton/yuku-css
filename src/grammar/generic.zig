//! css-tree's generic types: the types the lexer matches in code, not by a definition.

const std = @import("std");

pub const Generic = enum(u8) {
    ident_token,
    function_token,
    at_keyword_token,
    hash_token,
    string_token,
    bad_string_token,
    url_token,
    bad_url_token,
    delim_token,
    number_token,
    percentage_token,
    dimension_token,
    whitespace_token,
    cdo_token,
    cdc_token,
    colon_token,
    semicolon_token,
    comma_token,
    left_square_bracket_token,
    right_square_bracket_token,
    left_parenthesis_token,
    right_parenthesis_token,
    left_curly_bracket_token,
    right_curly_bracket_token,
    string,
    ident,
    percentage,
    zero,
    number,
    integer,
    custom_ident,
    dashed_ident,
    custom_property_name,
    hex_color,
    id_selector,
    an_plus_b,
    urange,
    declaration_value,
    any_value,
    dimension,
    angle,
    decibel,
    frequency,
    flex,
    length,
    resolution,
    semitones,
    time,
    attr_unit,

    /// The type's name in definition syntax.
    pub fn name(generic: Generic) []const u8 {
        return names[@backingInt(generic)];
    }
};

/// Every generic type's name, in css-tree's order.
pub const names: [count][]const u8 = .{
    "ident-token",          "function-token",    "at-keyword-token", "hash-token",
    "string-token",         "bad-string-token",  "url-token",        "bad-url-token",
    "delim-token",          "number-token",      "percentage-token", "dimension-token",
    "whitespace-token",     "CDO-token",         "CDC-token",        "colon-token",
    "semicolon-token",      "comma-token",       "[-token",          "]-token",
    "(-token",              ")-token",           "{-token",          "}-token",
    "string",               "ident",             "percentage",       "zero",
    "number",               "integer",           "custom-ident",     "dashed-ident",
    "custom-property-name", "hex-color",         "id-selector",      "an-plus-b",
    "urange",               "declaration-value", "any-value",        "dimension",
    "angle",                "decibel",           "frequency",        "flex",
    "length",               "resolution",        "semitones",        "time",
    "attr-unit",
};

pub const count = @typeInfo(Generic).@"enum".field_names.len;

const by_name: std.StaticStringMap(Generic) = blk: {
    var entries: [count]struct { []const u8, Generic } = undefined;
    for (&entries, 0..) |*entry, i| entry.* = .{ names[i], @fromBackingInt(@intCast(i)) };
    break :blk .initComptime(entries);
};

/// The generic type named `type_name`, if there is one.
pub fn find(type_name: []const u8) ?Generic {
    return by_name.get(type_name);
}

test find {
    try std.testing.expectEqual(Generic.length, find("length").?);
    try std.testing.expectEqual(null, find("color"));
    try std.testing.expectEqualStrings("attr-unit", Generic.attr_unit.name());
}

const css = @import("css");
const Tag = css.token.Tag;
const assert = std.debug.assert;

/// The tokens of the value being matched; a token starts where the one before it ends.
pub const Tokens = struct {
    source: []const u8,
    list: []const css.token.Token,
    /// Where token 0 starts, past a byte order mark.
    first: u32,

    pub fn len(t: *const Tokens) u32 {
        return @intCast(t.list.len);
    }

    pub fn tag(t: *const Tokens, i: u32) Tag {
        assert(i < t.list.len);
        return t.list[i].tag;
    }

    pub fn start(t: *const Tokens, i: u32) u32 {
        assert(i < t.list.len);
        return if (i == 0) t.first else t.list[i - 1].end;
    }

    pub fn text(t: *const Tokens, i: u32) []const u8 {
        assert(i < t.list.len);
        return t.source[t.start(i)..t.list[i].end];
    }
};

/// A bound of a type's range: none for infinity, and css-tree skips a bound with a unit.
pub const Bound = union(enum) {
    infinite,
    number: f64,
    unit,
};

pub const Range = struct {
    min: Bound,
    max: Bound,
};

pub const unit_groups = [_][]const u8{
    "length", "angle", "time", "frequency", "resolution", "flex", "decibel", "semitones",
};

/// css-tree's units, by group, lowercase.
pub const Units = struct {
    groups: [unit_groups.len][]const []const u8 = default_units,

    fn has(u: *const Units, group: usize, unit: []const u8) bool {
        assert(group < unit_groups.len);
        for (u.groups[group]) |known| {
            if (std.ascii.eqlIgnoreCase(known, unit)) return true;
        }
        return false;
    }
};

pub const default_units: [unit_groups.len][]const []const u8 = .{
    &.{
        "cm",    "mm",    "q",     "in",    "pt",    "pc",    "px",    "em",  "rem",
        "ex",    "rex",   "cap",   "rcap",  "ch",    "rch",   "ic",    "ric", "lh",
        "rlh",   "vw",    "svw",   "lvw",   "dvw",   "vh",    "svh",   "lvh", "dvh",
        "vi",    "svi",   "lvi",   "dvi",   "vb",    "svb",   "lvb",   "dvb", "vmin",
        "svmin", "lvmin", "dvmin", "vmax",  "svmax", "lvmax", "dvmax", "cqw", "cqh",
        "cqi",   "cqb",   "cqmin", "cqmax",
    },
    &.{ "deg", "grad", "rad", "turn" },
    &.{ "s", "ms" },
    &.{ "hz", "khz" },
    &.{ "dpi", "dpcm", "dppx", "x" },
    &.{"fr"},
    &.{"db"},
    &.{"st"},
};

const calc = [_][]const u8{ "calc(", "-moz-calc(", "-webkit-calc(" };
const comparison = [_][]const u8{ "min(", "max(", "clamp(" };
const stepped = [_][]const u8{ "round(", "mod(", "rem(" };
const trig_number = [_][]const u8{ "sin(", "cos(", "tan(" };
const trig_angle = [_][]const u8{ "asin(", "acos(", "atan(", "atan2(" };
const other_number = [_][]const u8{ "pow(", "sqrt(", "log(", "exp(", "sign(" };
const exponential = [_][]const u8{"hypot("};
const absolute = [_][]const u8{"abs("};

const number_functions = calc ++ comparison ++ stepped ++ trig_number ++ other_number ++
    exponential ++ absolute;
const percentage_functions = calc ++ comparison ++ stepped ++ exponential ++ absolute;
const dimension_functions = calc ++ comparison ++ stepped ++ trig_angle ++ exponential ++ absolute;

/// css-tree's CSS-wide keywords.
pub const css_wide_keywords = [_][]const u8{
    "initial",
    "inherit",
    "unset",
    "revert",
    "revert-layer",
};

fn byteAt(s: []const u8, i: usize) u8 {
    return if (i < s.len) s[i] else 0;
}

fn isDigit(c: u8) bool {
    return c >= '0' and c <= '9';
}

fn isHex(c: u8) bool {
    return std.ascii.isHex(c);
}

fn eqlAny(value: []const u8, comptime list: []const []const u8) bool {
    inline for (list) |name| {
        if (std.ascii.eqlIgnoreCase(value, name)) return true;
    }
    return false;
}

/// css-tree's `consumeNumber`: where the number at the start of `s` ends.
pub fn numberEnd(s: []const u8) u32 {
    var at: u32 = 0;
    if (byteAt(s, 0) == '+' or byteAt(s, 0) == '-') at = 1;
    while (isDigit(byteAt(s, at))) at += 1;
    if (byteAt(s, at) == '.' and isDigit(byteAt(s, at + 1))) {
        at += 2;
        while (isDigit(byteAt(s, at))) at += 1;
    }
    if (byteAt(s, at) | 0x20 == 'e') {
        var digit = at + 1;
        if (byteAt(s, digit) == '-' or byteAt(s, digit) == '+') digit += 1;
        if (isDigit(byteAt(s, digit))) {
            at = digit + 1;
            while (isDigit(byteAt(s, at))) at += 1;
        }
    }
    assert(at <= s.len);
    return at;
}

/// JavaScript's `Number(s)` for the decimal strings tokens hold, NaN when it is not one.
pub fn jsNumber(s: []const u8) f64 {
    const trimmed = std.mem.trim(u8, s, " \t\n\r\x0B\x0C");
    if (trimmed.len == 0) return 0;
    const end = numberEnd(trimmed);
    // a lone sign, or anything past the number, is not a number to JavaScript
    if (end != trimmed.len or (end == 1 and !isDigit(trimmed[0]))) return std.math.nan(f64);
    return decimal(trimmed);
}

const exact_powers = blk: {
    var t: [23]f64 = undefined;
    t[0] = 1;
    for (1..t.len) |i| t[i] = t[i - 1] * 10;
    break :blk t;
};

/// The value of a CSS number. Exact, as JavaScript reads it, up to 19 significant digits with a
/// decimal exponent within 22 and a mantissa below 2^53; beyond, within an ulp or two, which only a
/// range check at its very bound could tell.
pub fn decimal(s: []const u8) f64 {
    assert(s.len > 0);
    assert(numberEnd(s) == s.len);
    var at: usize = 0;
    const negative = s[0] == '-';
    if (s[0] == '+' or s[0] == '-') at = 1;
    var mantissa: u64 = 0;
    var digits: u32 = 0;
    var exponent: i32 = 0;
    var fraction = false;
    while (at < s.len) : (at += 1) {
        const c = s[at];
        if (c == '.') {
            fraction = true;
            continue;
        }
        if (!isDigit(c)) break;
        if (digits < 19) {
            mantissa = mantissa * 10 + (c - '0');
            if (mantissa != 0) digits += 1;
            if (fraction) exponent -= 1;
        } else if (!fraction) exponent += 1;
    }
    if (at < s.len) {
        at += 1;
        var sign: i32 = 1;
        if (s[at] == '+' or s[at] == '-') {
            if (s[at] == '-') sign = -1;
            at += 1;
        }
        var e: i32 = 0;
        while (at < s.len) : (at += 1) e = @min(e * 10 + (s[at] - '0'), 100_000);
        exponent += sign * e;
    }
    var value: f64 = @floatFromInt(mantissa);
    if (mantissa == 0) {
        value = 0;
    } else if (mantissa < (1 << 53) and exponent >= -22 and exponent <= 22) {
        const power = exact_powers[@abs(exponent)];
        value = if (exponent < 0) value / power else value * power;
    } else {
        value *= std.math.pow(f64, 10, @floatFromInt(exponent));
    }
    return if (negative) -value else value;
}

// IE's postfix hack, `123\0` or `123px\9`
fn isPostfixIeHack(s: []const u8, offset: usize) bool {
    if (offset + 2 != s.len) return false;
    return s[offset] == '\\' and isDigit(s[offset + 1]);
}

fn outOfRange(range: ?Range, value: []const u8, number_end: u32) bool {
    const r = range orelse return false;
    const num = jsNumber(if (number_end != value.len) value[0..number_end] else value);
    if (std.math.isNan(num)) return true;
    if (r.min == .number and num < r.min.number) return true;
    if (r.max == .number and num > r.max.number) return true;
    return false;
}

// tokens through the closer of the block `at` opens
fn consumeBlock(t: *const Tokens, at: u32) u32 {
    var stack: [max_depth]Tag = undefined;
    var depth: u32 = 0;
    var closing: Tag = .eof;
    var length: u32 = 0;
    while (at + length < t.len()) : (length += 1) {
        const tag_ = t.tag(at + length);
        switch (tag_) {
            .right_curly_bracket, .right_parenthesis, .right_square_bracket => {
                if (tag_ != closing) return length;
                depth -= 1;
                closing = stack[depth];
                if (depth == 0) return length + 1;
            },
            .function, .left_parenthesis, .left_square_bracket, .left_curly_bracket => {
                if (depth == max_depth) return length;
                stack[depth] = closing;
                depth += 1;
                closing = css.token.closer[@backingInt(tag_)];
            },
            else => {},
        }
    }
    return length;
}

const max_depth = 256;

// css-tree's `<declaration-value>` and `<any-value>`: balanced tokens, stopping at a bad token, an
// unmatched closer, and for declarations a top-level `;` or `!`
fn balanced(t: *const Tokens, at: u32, declaration: bool) u32 {
    if (at >= t.len()) return 0;
    var stack: [max_depth]Tag = undefined;
    var depth: u32 = 0;
    var closing: Tag = .eof;
    var length: u32 = 0;
    while (at + length < t.len()) : (length += 1) {
        const tag_ = t.tag(at + length);
        switch (tag_) {
            .bad_string, .bad_url => return length,
            .right_curly_bracket, .right_parenthesis, .right_square_bracket => {
                if (tag_ != closing) return length;
                depth -= 1;
                closing = stack[depth];
            },
            .semicolon => if (declaration and closing == .eof) return length,
            .delim => {
                if (declaration and closing == .eof and t.text(
                    at + length,
                )[0] == '!') return length;
            },
            .function, .left_parenthesis, .left_square_bracket, .left_curly_bracket => {
                if (depth == max_depth) return length;
                stack[depth] = closing;
                depth += 1;
                closing = css.token.closer[@backingInt(tag_)];
            },
            else => {},
        }
    }
    return length;
}

fn math(t: *const Tokens, at: u32, comptime names_: []const []const u8) ?u32 {
    if (at >= t.len()) return 0;
    if (t.tag(at) == .function and eqlAny(t.text(at), names_)) return consumeBlock(t, at);
    return null;
}

fn number(t: *const Tokens, at: u32, range: ?Range) u32 {
    if (at >= t.len()) return 0;
    const value = t.text(at);
    const end = numberEnd(value);
    if (end != value.len and !isPostfixIeHack(value, end)) return 0;
    return @intFromBool(!outOfRange(range, value, end));
}

fn integer(t: *const Tokens, at: u32, range: ?Range) u32 {
    if (at >= t.len() or t.tag(at) != .number) return 0;
    const value = t.text(at);
    var i: u32 = if (value[0] == '+' or value[0] == '-') 1 else 0;
    while (i < value.len) : (i += 1) {
        if (!isDigit(value[i])) return 0;
    }
    return @intFromBool(!outOfRange(range, value, i));
}

fn percentage(t: *const Tokens, at: u32, range: ?Range) u32 {
    if (at >= t.len() or t.tag(at) != .percentage) return 0;
    const value = t.text(at);
    return @intFromBool(!outOfRange(range, value, @intCast(value.len - 1)));
}

fn zero(t: *const Tokens, at: u32) bool {
    return at < t.len() and t.tag(at) == .number and jsNumber(t.text(at)) == 0;
}

fn dimension(t: *const Tokens, at: u32, range: ?Range, units: ?*const Units, group: usize) u32 {
    if (at >= t.len() or t.tag(at) != .dimension) return 0;
    const value = t.text(at);
    const end = numberEnd(value);
    if (units) |u| {
        var unit = value[end..];
        if (std.mem.indexOfScalarPos(u8, value, end, '\\')) |solidus| {
            if (isPostfixIeHack(value, solidus)) unit = value[end..solidus];
        }
        if (!u.has(group, unit)) return 0;
    }
    return @intFromBool(!outOfRange(range, value, end));
}

fn customIdent(t: *const Tokens, at: u32) u32 {
    if (at >= t.len() or t.tag(at) != .ident) return 0;
    const value = t.text(at);
    for (css_wide_keywords) |keyword| if (std.ascii.eqlIgnoreCase(value, keyword)) return 0;
    return @intFromBool(!std.ascii.eqlIgnoreCase(value, "default"));
}

fn dashedIdent(t: *const Tokens, at: u32) bool {
    if (at >= t.len() or t.tag(at) != .ident) return false;
    const value = t.text(at);
    return byteAt(value, 0) == '-' and byteAt(value, 1) == '-';
}

fn hexColor(t: *const Tokens, at: u32) u32 {
    if (at >= t.len() or t.tag(at) != .hash) return 0;
    const value = t.text(at);
    if (value.len != 4 and value.len != 5 and value.len != 7 and value.len != 9) return 0;
    for (value[1..]) |c| if (!isHex(c)) return 0;
    return 1;
}

fn idSelector(t: *const Tokens, at: u32) u32 {
    if (at >= t.len() or t.tag(at) != .hash) return 0;
    const v = t.text(at);
    return @intFromBool(identStart(byteAt(v, 1), byteAt(v, 2), byteAt(v, 3)));
}

fn isNameStart(c: u8) bool {
    return std.ascii.isAlphabetic(c) or c >= 0x80 or c == '_';
}

fn validEscape(a: u8, b: u8) bool {
    return a == '\\' and b != 0 and b != '\n' and b != '\r' and b != 0x0C;
}

// css-tree's `isIdentifierStart`, CSS Syntax's "would start an identifier"
fn identStart(a: u8, b: u8, c: u8) bool {
    if (a == '-') return isNameStart(b) or b == '-' or validEscape(b, c);
    return isNameStart(a) or validEscape(a, b);
}

/// U+FEFF or U+FFFE at the start, which the tokenizer skips.
pub fn bomLen(source: []const u8) u32 {
    if (source.len < 3 or source[0] != 0xEF) return 0;
    const feff = source[1] == 0xBB and source[2] == 0xBF;
    const fffe = source[1] == 0xBF and source[2] == 0xBE;
    return if (feff or fffe) 3 else 0;
}

fn attrUnit(t: *const Tokens, at: u32, units: *const Units) u32 {
    if (at >= t.len()) return 0;
    const value = t.text(at);
    if (t.tag(at) == .delim and std.mem.eql(u8, value, "%")) return 1;
    if (t.tag(at) != .ident) return 0;
    for (0..unit_groups.len) |group| if (units.has(group, value)) return 1;
    return 0;
}

/// How many tokens from `at` the generic type matches, 0 for none.
pub fn match(g: Generic, t: *const Tokens, at: u32, range: ?Range, units: *const Units) u32 {
    assert(at <= t.len());
    const count_ = switch (g) {
        .ident_token,
        .function_token,
        .at_keyword_token,
        .hash_token,
        .string_token,
        .bad_string_token,
        .url_token,
        .bad_url_token,
        .delim_token,
        .number_token,
        .percentage_token,
        .dimension_token,
        .whitespace_token,
        .cdo_token,
        .cdc_token,
        .colon_token,
        .semicolon_token,
        .comma_token,
        .left_square_bracket_token,
        .right_square_bracket_token,
        .left_parenthesis_token,
        .right_parenthesis_token,
        .left_curly_bracket_token,
        .right_curly_bracket_token,
        => @intFromBool(at < t.len() and t.tag(at) == tokenTag(g)),
        .string => @intFromBool(at < t.len() and t.tag(at) == .string),
        .ident => @intFromBool(at < t.len() and t.tag(at) == .ident),
        .percentage => math(t, at, &percentage_functions) orelse percentage(t, at, range),
        .zero => @intFromBool(zero(t, at)),
        .number => math(t, at, &number_functions) orelse number(t, at, range),
        .integer => math(t, at, &number_functions) orelse integer(t, at, range),
        .custom_ident => customIdent(t, at),
        .dashed_ident => @intFromBool(dashedIdent(t, at)),
        .custom_property_name => @intFromBool(
            dashedIdent(t, at) and !std.mem.eql(u8, t.text(at), "--"),
        ),
        .hex_color => hexColor(t, at),
        .id_selector => idSelector(t, at),
        .an_plus_b => @import("an_plus_b.zig").match(t, at),
        .urange => @import("urange.zig").match(t, at),
        .declaration_value => balanced(t, at, true),
        .any_value => balanced(t, at, false),
        .dimension => math(t, at, &dimension_functions) orelse dimension(t, at, range, null, 0),
        .length => math(t, at, &dimension_functions) orelse
            if (zero(t, at)) 1 else dimension(t, at, range, units, 0),
        .angle => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 1),
        .time => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 2),
        .frequency => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 3),
        .resolution => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 4),
        .flex => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 5),
        .decibel => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 6),
        .semitones => math(t, at, &dimension_functions) orelse dimension(t, at, range, units, 7),
        .attr_unit => attrUnit(t, at, units),
    };
    assert(at + count_ <= t.len());
    return count_;
}

fn tokenTag(g: Generic) Tag {
    assert(@backingInt(g) <= @backingInt(Generic.right_curly_bracket_token));
    return switch (g) {
        .ident_token => .ident,
        .function_token => .function,
        .at_keyword_token => .at_keyword,
        .hash_token => .hash,
        .string_token => .string,
        .bad_string_token => .bad_string,
        .url_token => .url,
        .bad_url_token => .bad_url,
        .delim_token => .delim,
        .number_token => .number,
        .percentage_token => .percentage,
        .dimension_token => .dimension,
        .whitespace_token => .whitespace,
        .cdo_token => .cdo,
        .cdc_token => .cdc,
        .colon_token => .colon,
        .semicolon_token => .semicolon,
        .comma_token => .comma,
        .left_square_bracket_token => .left_square_bracket,
        .right_square_bracket_token => .right_square_bracket,
        .left_parenthesis_token => .left_parenthesis,
        .right_parenthesis_token => .right_parenthesis,
        .left_curly_bracket_token => .left_curly_bracket,
        .right_curly_bracket_token => .right_curly_bracket,
        else => unreachable,
    };
}

test jsNumber {
    try std.testing.expectEqual(@as(f64, 0.1), jsNumber("0.1"));
    try std.testing.expectEqual(@as(f64, 1.5e-7), jsNumber("1.5e-7"));
    try std.testing.expectEqual(@as(f64, 0), jsNumber("-0.0e5"));
    try std.testing.expectEqual(@as(f64, 123.456), jsNumber("123.456"));
    try std.testing.expectEqual(@as(f64, 5), jsNumber("+5"));
    try std.testing.expectEqual(@as(f64, 0.5), jsNumber(".5"));
    try std.testing.expectEqual(@as(f64, 1000), jsNumber("1e3"));
    try std.testing.expect(std.math.isNan(jsNumber("-")));
    try std.testing.expect(std.math.isNan(jsNumber("1px")));
}
