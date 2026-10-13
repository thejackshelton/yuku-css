//! css-tree's `<an-plus-b>`, CSS Syntax's An+B microsyntax over tokens: how many tokens it takes.

const std = @import("std");
const generic = @import("generic.zig");

const assert = std.debug.assert;
const Tokens = generic.Tokens;

fn valid(t: *const Tokens, i: u32) bool {
    return i < t.len();
}

fn isDelim(t: *const Tokens, i: u32, c: u8) bool {
    return valid(t, i) and t.tag(i) == .delim and t.text(i)[0] == c;
}

fn byteAt(s: []const u8, i: usize) u8 {
    return if (i < s.len) s[i] else 0;
}

fn isN(s: []const u8, i: usize) bool {
    return byteAt(s, i) | 0x20 == 'n';
}

// past whitespace and comments from `offset`
fn skipSpace(t: *const Tokens, base: u32, offset: u32) u32 {
    var at = offset;
    while (valid(
        t,
        base + at,
    ) and (t.tag(base + at) == .whitespace or t.tag(base + at) == .comment)) {
        at += 1;
    }
    assert(base + at <= t.len());
    return at;
}

fn checkInteger(t: *const Tokens, i: u32, value_offset: u32, disallow_sign: bool, offset: u32) u32 {
    if (!valid(t, i)) return 0;
    const value = t.text(i);
    var at = value_offset;
    const c = byteAt(value, at);
    if (c == '+' or c == '-') {
        if (disallow_sign) return 0;
        at += 1;
    }
    while (at < value.len) : (at += 1) {
        if (!std.ascii.isDigit(value[at])) return 0;
    }
    return offset + 1;
}

// `<signed-integer>` or `['+' | '-'] <signless-integer>` after `offset_` tokens, if any
fn consumeB(t: *const Tokens, base: u32, offset_: u32) u32 {
    var signed = false;
    var offset = skipSpace(t, base, offset_);
    if (!valid(t, base + offset)) return offset_;
    if (t.tag(base + offset) != .number) {
        if (!isDelim(t, base + offset, '+') and !isDelim(t, base + offset, '-')) return offset_;
        signed = true;
        offset = skipSpace(t, base, offset + 1);
        if (!valid(t, base + offset) or t.tag(base + offset) != .number) return 0;
    }
    if (!signed) {
        const c = t.text(base + offset)[0];
        if (c != '+' and c != '-') return 0;
    }
    return checkInteger(t, base + offset, if (signed) 0 else 1, signed, offset);
}

/// How many tokens from `at` an An+B takes, 0 for none.
pub fn match(t: *const Tokens, at: u32) u32 {
    if (!valid(t, at)) return 0;
    const tag = t.tag(at);
    const value = t.text(at);
    if (tag == .number) return checkInteger(t, at, 0, false, 0);
    if (tag == .ident and value[0] == '-') {
        if (!isN(value, 1)) return 0;
        switch (value.len) {
            2 => return consumeB(t, at, 1),
            3 => {
                if (value[2] != '-') return 0;
                const offset = skipSpace(t, at, 1);
                return checkInteger(t, at + offset, 0, true, offset);
            },
            else => {
                if (value[2] != '-') return 0;
                return checkInteger(t, at, 3, true, 0);
            },
        }
    }
    // css-tree reads the token after a `+` without checking there is one
    const plus = isDelim(t, at, '+') and valid(t, at + 1) and t.tag(at + 1) == .ident;
    if (tag == .ident or plus) {
        const offset: u32 = @intFromBool(tag != .ident);
        const name = t.text(at + offset);
        if (!isN(name, 0)) return 0;
        switch (name.len) {
            1 => return consumeB(t, at, offset + 1),
            2 => {
                if (name[1] != '-') return 0;
                const next = skipSpace(t, at, offset + 1);
                return checkInteger(t, at + next, 0, true, next);
            },
            else => {
                if (name[1] != '-') return 0;
                return checkInteger(t, at + offset, 2, true, offset);
            },
        }
    }
    if (tag == .dimension) {
        const sign: u32 = @intFromBool(value[0] == '+' or value[0] == '-');
        var i = sign;
        while (i < value.len and std.ascii.isDigit(value[i])) i += 1;
        if (i == sign or !isN(value, i)) return 0;
        if (i + 1 == value.len) return consumeB(t, at, 1);
        if (value[i + 1] != '-') return 0;
        if (i + 2 == value.len) {
            const offset = skipSpace(t, at, 1);
            return checkInteger(t, at + offset, 0, true, offset);
        }
        return checkInteger(t, at, i + 2, true, 0);
    }
    return 0;
}
