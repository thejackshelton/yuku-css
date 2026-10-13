//! css-tree's `<urange>`, a unicode range over tokens: how many tokens it takes.

const std = @import("std");
const generic = @import("generic.zig");

const assert = std.debug.assert;
const Tokens = generic.Tokens;

fn isDelim(t: *const Tokens, i: u32, c: u8) bool {
    return i < t.len() and t.tag(i) == .delim and t.text(i)[0] == c;
}

// hex digits from `offset`, up to six; a dash after some digits ends the first number, and then
// css-tree claims six, so no question mark may follow
fn hexSequence(value: []const u8, offset: u32, allow_dash: bool) u32 {
    var len: u32 = 0;
    var at = offset;
    while (at < value.len) : (at += 1) {
        const c = value[at];
        if (c == '-' and allow_dash and len != 0) return 6;
        if (!std.ascii.isHex(c)) return 0;
        len += 1;
        if (len > 6) return 0;
    }
    assert(len <= 6);
    return len;
}

fn withQuestionMarks(t: *const Tokens, base: u32, consumed_: u32, length_: u32) u32 {
    if (consumed_ == 0) return 0;
    var consumed = consumed_;
    var length = length_;
    while (isDelim(t, base + length, '?')) : (length += 1) {
        consumed += 1;
        if (consumed > 6) return 0;
    }
    assert(base + length <= t.len());
    return length;
}

/// How many tokens from `at` a `<urange>` takes, 0 for none.
pub fn match(t: *const Tokens, at: u32) u32 {
    if (at >= t.len() or t.tag(at) != .ident or t.text(at)[0] | 0x20 != 'u') return 0;
    var length: u32 = 1;
    if (at + length >= t.len()) return 0;
    if (isDelim(t, at + length, '+')) {
        length += 1;
        if (at + length >= t.len()) return 0;
        if (t.tag(at + length) == .ident) {
            return withQuestionMarks(t, at, hexSequence(t.text(at + length), 0, true), length + 1);
        }
        if (isDelim(t, at + length, '?')) return withQuestionMarks(t, at, 1, length + 1);
        return 0;
    }
    const tag = t.tag(at + length);
    if (tag == .number) {
        const consumed = hexSequence(t.text(at + length), 1, true);
        if (consumed == 0) return 0;
        length += 1;
        if (at + length >= t.len()) return length;
        const next = t.tag(at + length);
        if (next == .dimension or next == .number) {
            const value = t.text(at + length);
            if (value[0] != '-' or hexSequence(value, 1, false) == 0) return 0;
            return length + 1;
        }
        return withQuestionMarks(t, at, consumed, length);
    }
    if (tag == .dimension) {
        return withQuestionMarks(t, at, hexSequence(t.text(at + length), 1, true), length + 1);
    }
    return 0;
}
