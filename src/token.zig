const std = @import("std");

/// The token types of CSS Syntax Level 3, plus comments, numbered as css-tree numbers them.
pub const Tag = enum(u8) {
    eof,
    ident,
    function,
    at_keyword,
    hash,
    string,
    bad_string,
    url,
    bad_url,
    delim,
    number,
    percentage,
    dimension,
    whitespace,
    cdo,
    cdc,
    colon,
    semicolon,
    comma,
    left_square_bracket,
    right_square_bracket,
    left_parenthesis,
    right_parenthesis,
    left_curly_bracket,
    right_curly_bracket,
    comment,

    /// css-tree's `tokenNames`.
    pub fn name(tag: Tag) []const u8 {
        return switch (tag) {
            .eof => "EOF-token",
            .ident => "ident-token",
            .function => "function-token",
            .at_keyword => "at-keyword-token",
            .hash => "hash-token",
            .string => "string-token",
            .bad_string => "bad-string-token",
            .url => "url-token",
            .bad_url => "bad-url-token",
            .delim => "delim-token",
            .number => "number-token",
            .percentage => "percentage-token",
            .dimension => "dimension-token",
            .whitespace => "whitespace-token",
            .cdo => "CDO-token",
            .cdc => "CDC-token",
            .colon => "colon-token",
            .semicolon => "semicolon-token",
            .comma => "comma-token",
            .left_square_bracket => "[-token",
            .right_square_bracket => "]-token",
            .left_parenthesis => "(-token",
            .right_parenthesis => ")-token",
            .left_curly_bracket => "{-token",
            .right_curly_bracket => "}-token",
            .comment => "comment-token",
        };
    }

    /// css-tree's `tokenTypes` key.
    pub fn typeName(comptime tag: Tag) []const u8 {
        return switch (tag) {
            .eof => "EOF",
            .whitespace => "WhiteSpace",
            .cdo => "CDO",
            .cdc => "CDC",
            .left_parenthesis => "LeftParenthesis",
            .right_parenthesis => "RightParenthesis",
            else => comptime pascal(@tagName(tag)),
        };
    }

    pub inline fn isBlockOpener(tag: Tag) bool {
        return closer[@backingInt(tag)] != .eof;
    }
};

/// The closer of each block opener, eof for every other tag.
pub const closer: [32]Tag = blk: {
    var t: [32]Tag = @splat(.eof);
    t[@backingInt(Tag.function)] = .right_parenthesis;
    t[@backingInt(Tag.left_parenthesis)] = .right_parenthesis;
    t[@backingInt(Tag.left_square_bracket)] = .right_square_bracket;
    t[@backingInt(Tag.left_curly_bracket)] = .right_curly_bracket;
    break :blk t;
};

// the token list is copied to the wire as is, and the wire reads only `end` and `tag`
pub const Token = packed struct(u64) {
    /// Byte offset past the token; a token starts where the one before it ends.
    end: u32,
    tag: Tag,
    /// How many tokens away a bracket's partner is, 0 for none; `link_far` when too far to say.
    link: u24 = 0,

    pub const link_far = std.math.maxInt(u24);
};

pub const TokenList = std.ArrayList(Token);

fn pascal(comptime snake: []const u8) []const u8 {
    comptime {
        var out: []const u8 = "";
        var upper = true;
        for (snake) |c| {
            if (c == '_') {
                upper = true;
            } else {
                out = out ++ &[_]u8{if (upper) std.ascii.toUpper(c) else c};
                upper = false;
            }
        }
        return out;
    }
}

comptime {
    std.debug.assert(@sizeOf(Token) == 8);
    std.debug.assert(@typeInfo(Tag).@"enum".field_names.len == 26);
    std.debug.assert(@backingInt(Tag.comment) == 25);
}
