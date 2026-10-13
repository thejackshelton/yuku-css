// css-tree's parser, over the token list: the same nodes, the same recovery to `Raw`, the same errors.
// Where CSS Syntax, Selectors, or Nesting read the source otherwise, see `nestedRuleAhead` and `blockKind`.

const std = @import("std");
const ast = @import("ast.zig");
const token = @import("token.zig");
const lexer = @import("lexer.zig");
const values = @import("syntax/value.zig");

const Allocator = std.mem.Allocator;
const NodeIndex = ast.NodeIndex;
const String = ast.String;
const Message = ast.Message;
const Tag = token.Tag;

/// css-tree's parse contexts: the node the source is read as.
pub const Context = enum(u4) {
    stylesheet,
    atrule,
    atrule_prelude,
    media_query_list,
    media_query,
    rule,
    selector_list,
    selector,
    block,
    declaration_list,
    declaration,
    value,
};

pub const Options = struct {
    /// When false, a rule's prelude is a `Raw`.
    parse_rule_prelude: bool = true,
    /// When true, a custom property's value, and a `var()` fallback, is a `Value`, not a `Raw`.
    parse_custom_property: bool = false,
    context: Context = .stylesheet,
};

pub const Error = error{OutOfMemory};
pub const ParseError = error{ OutOfMemory, Syntax };

// bounds the parser's recursion, and so the decoder's
pub const max_depth = 128;

pub const Stop = enum { balance_end, left_curly_bracket, left_curly_bracket_or_semicolon, exclamation_mark_or_semicolon, semicolon_included };

const Pseudo = enum { selector_list, selector, nth, identifier, lang };

const pseudos: std.StaticStringMapWithEql(Pseudo, std.static_string_map.eqlAsciiIgnoreCase) = .initComptime(.{
    .{ "dir", .identifier },
    .{ "has", .selector_list },
    .{ "lang", .lang },
    .{ "matches", .selector_list },
    .{ "is", .selector_list },
    .{ "-moz-any", .selector_list },
    .{ "-webkit-any", .selector_list },
    .{ "where", .selector_list },
    .{ "not", .selector_list },
    .{ "nth-child", .nth },
    .{ "nth-last-child", .nth },
    .{ "nth-last-of-type", .nth },
    .{ "nth-of-type", .nth },
    .{ "slotted", .selector },
    .{ "host", .selector },
    .{ "host-context", .selector },
});

/// Parses `source` as `options.context`. Never fails on bad CSS: what does not parse becomes `Raw`,
/// with a diagnostic.
pub fn parse(gpa: Allocator, source: []const u8, options: Options) Error!ast.Tree {
    var p: Parser = .{ .tree = .init(gpa, source), .src = source, .options = options };
    errdefer p.tree.deinit();
    const scan = try p.tokenize();
    p.tree.root = try p.root();
    if (scan.suspect) try p.lexErrors();
    try p.mergeSpecErrors();
    p.tree.tokens = p.tokens;
    p.tree.comment_count = scan.comments;
    return p.tree;
}

/// Tokenizes `source` into `tokens`, allocated from `gpa`.
pub fn tokenize(gpa: Allocator, tokens: *token.TokenList, source: []const u8) Error!void {
    try tokens.ensureTotalCapacity(gpa, tokenCapacity(source.len));
    _ = try lexer.tokenize(gpa, tokens, null, source);
}

fn tokenCapacity(len: usize) usize {
    return len / 2 + 64;
}

pub const Parser = struct {
    tree: ast.Tree,
    src: []const u8,
    options: Options,

    tokens: []const token.Token = &.{},
    balance: []const u32 = &.{},
    count: u32 = 0,
    first_offset: u32 = 0,

    // the current token, as css-tree's TokenStream keeps it
    index: u32 = std.math.maxInt(u32),
    tag: Tag = .eof,
    start: u32 = 0,
    end: u32 = 0,
    eof: bool = false,

    scratch: std.ArrayList(NodeIndex) = .empty,
    // errors the specs read where css-tree reads none, merged into the diagnostics at the end
    spec: std.ArrayList(ast.Diagnostic) = .empty,
    depth: u32 = 0,
    failure: ast.Diagnostic = undefined,
    space: String = .none,

    fn tokenize(p: *Parser) Error!lexer.Scan {
        const gpa = p.tree.allocator();
        var tokens: token.TokenList = .empty;
        var balance: std.ArrayList(u32) = .empty;
        try tokens.ensureTotalCapacity(gpa, tokenCapacity(p.src.len));
        try balance.ensureTotalCapacity(gpa, tokenCapacity(p.src.len));
        const scan = try lexer.tokenize(gpa, &tokens, &balance, p.src);
        p.tokens = tokens.items;
        p.balance = balance.items;
        p.count = @intCast(tokens.items.len);
        p.first_offset = if (p.count > 0) lexer.bomLen(p.src) else 0;

        try p.tree.nodes.ensureTotalCapacity(gpa, p.src.len / 4 + 64);
        try p.tree.extras.ensureTotalCapacity(gpa, p.src.len / 8 + 64);
        try p.scratch.ensureTotalCapacity(gpa, 256);

        p.end = p.first_offset;
        p.next();
        return scan;
    }

    pub fn next(p: *Parser) void {
        const n = p.index +% 1;
        if (n < p.count) {
            p.index = n;
            p.start = p.end;
            p.tag = p.tokens[n].tag;
            p.end = p.tokens[n].end;
        } else {
            p.eof = true;
            p.index = p.count;
            p.tag = .eof;
            p.start = @intCast(p.src.len);
            p.end = p.start;
        }
    }

    // css-tree's `skip`, which leaves `eof` set when it moves back
    pub fn skipTo(p: *Parser, target: u32) void {
        if (target < p.count) {
            p.index = target;
            p.start = if (target > 0) p.tokens[target - 1].end else 0;
            p.tag = p.tokens[target].tag;
            p.end = p.tokens[target].end;
        } else {
            p.index = p.count;
            p.next();
        }
    }

    pub fn lookupType(p: *const Parser, offset: i32) Tag {
        const i = @as(i64, p.index) + offset;
        return if (i >= 0 and i < p.count) p.tokens[@intCast(i)].tag else .eof;
    }

    fn lookupNonWsType(p: *const Parser) Tag {
        var i = p.index;
        while (i < p.count) : (i += 1) {
            const tag = p.tokens[i].tag;
            if (tag != .whitespace and tag != .comment) return tag;
        }
        return .eof;
    }

    fn lookupValue(p: *const Parser, offset: u32, comptime text: []const u8) bool {
        const i = p.index + offset;
        if (i >= p.count) return false;
        const start = if (i > 0) p.tokens[i - 1].end else 0;
        return std.ascii.eqlIgnoreCase(p.src[start..p.tokens[i].end], text);
    }

    pub fn tokenStart(p: *const Parser, i: u32) u32 {
        if (i == p.index) return p.start;
        if (i > 0) return if (i < p.count) p.tokens[i - 1].end else @intCast(p.src.len);
        return p.first_offset;
    }

    pub inline fn at(p: *const Parser, offset: u32) u8 {
        return if (offset < p.src.len) p.src[offset] else 0;
    }

    pub inline fn isDelim(p: *const Parser, comptime c: u8) bool {
        return p.tag == .delim and p.src[p.start] == c;
    }

    fn isDelimAt(p: *const Parser, comptime c: u8, offset: u32) bool {
        if (offset == 0) return p.isDelim(c);
        const i = p.index + offset;
        return i < p.count and p.tokens[i].tag == .delim and p.src[p.tokens[i - 1].end] == c;
    }

    pub fn isBalanceEdge(p: *const Parser, token_index: u32) bool {
        const balance = if (p.index < p.count) p.balance[p.index] else p.count;
        return balance < token_index;
    }

    pub fn skipSC(p: *Parser) void {
        while (p.tag == .whitespace or p.tag == .comment) p.next();
    }

    /// Returns whether it passed a `{}` block on the way.
    pub fn skipUntilBalanced(p: *Parser, start_token: u32, comptime stop: Stop) bool {
        var cursor = start_token;
        var block = false;
        while (cursor < p.count) : (cursor += 1) {
            const balance_end = p.balance[cursor];
            if (balance_end < start_token) break;
            const c = p.src[if (cursor > 0) p.tokens[cursor - 1].end else p.first_offset];
            switch (stop) {
                .balance_end => {},
                .left_curly_bracket => if (c == '{') break,
                .left_curly_bracket_or_semicolon => if (c == '{' or c == ';') break,
                .exclamation_mark_or_semicolon => if (c == '!' or c == ';') break,
                .semicolon_included => if (c == ';') {
                    cursor += 1;
                    break;
                },
            }
            const tag = p.tokens[cursor].tag;
            if (tag.isBlockOpener()) {
                block = block or tag == .left_curly_bracket;
                cursor = balance_end;
            }
        }
        p.skipTo(cursor);
        return block;
    }

    pub fn eat(p: *Parser, comptime tag: Tag) ParseError!void {
        if (p.tag != tag) {
            switch (tag) {
                .ident => if (p.tag == .function or p.tag == .url)
                    return p.fail(.identifier_expected_function_found, p.end - 1),
                .hash => if (p.isDelim('#')) {
                    const offset = p.start + 1;
                    p.next();
                    return p.fail(.name_expected, offset);
                },
                .percentage => if (p.tag == .number) return p.fail(.percent_sign_expected, p.end),
                else => {},
            }
            return p.fail(comptime expected(tag), null);
        }
        p.next();
    }

    pub fn eatDelim(p: *Parser, comptime c: u8, comptime message: Message) ParseError!void {
        if (!p.isDelim(c)) return p.fail(message, null);
        p.next();
    }

    pub fn consume(p: *Parser, comptime tag: Tag) ParseError!String {
        const start = p.start;
        try p.eat(tag);
        return .{ .start = start, .end = p.start };
    }

    pub fn fail(p: *Parser, message: Message, offset: ?u32) error{Syntax} {
        const len: u32 = @intCast(p.src.len);
        const at_offset: u32 = if (offset != null and offset.? < len)
            offset.?
        else if (p.eof) whitespaceStart(p.src) else p.start;
        const end = if (at_offset >= p.start and at_offset < p.end) p.end else at_offset;
        p.failure = .{ .message = message, .span = .{ .start = at_offset, .end = end } };
        return error.Syntax;
    }

    pub fn report(p: *Parser, diagnostic: ast.Diagnostic) Error!void {
        try p.tree.diagnostics.append(p.tree.allocator(), diagnostic);
    }

    pub const Checkpoint = struct { index: u32, eof: bool, nodes: usize, extras: usize, scratch: usize, spec: usize };

    pub fn checkpoint(p: *const Parser) Checkpoint {
        return .{
            .index = p.index,
            .eof = p.eof,
            .nodes = p.tree.nodes.len,
            .extras = p.tree.extras.items.len,
            .scratch = p.scratch.items.len,
            .spec = p.spec.items.len,
        };
    }

    pub fn rewind(p: *Parser, to: Checkpoint) void {
        p.tree.nodes.shrinkRetainingCapacity(to.nodes);
        p.tree.extras.shrinkRetainingCapacity(to.extras);
        p.scratch.shrinkRetainingCapacity(to.scratch);
        p.spec.shrinkRetainingCapacity(to.spec);
        p.skipTo(to.index);
    }

    /// Runs `consumer`; when it fails, rewinds and keeps the input as `Raw` up to `stop`.
    fn withFallback(
        p: *Parser,
        comptime consumer: anytype,
        args: anytype,
        comptime stop: Stop,
        comptime exclude_whitespace: bool,
    ) Error!NodeIndex {
        const start = p.checkpoint();
        return @call(.auto, consumer, .{p} ++ args) catch |err| switch (err) {
            error.OutOfMemory => |e| return e,
            error.Syntax => {
                const failure = p.failure;
                p.rewind(start);
                const node = try p.raw(stop, exclude_whitespace);
                try p.report(failure);
                return node;
            },
        };
    }

    pub fn add(p: *Parser, data: ast.NodeData, start: u32, end: u32) Error!NodeIndex {
        return p.tree.addNode(data, .{ .start = start, .end = end });
    }

    pub fn push(p: *Parser, node: NodeIndex) Error!void {
        if (p.scratch.items.len < p.scratch.capacity) {
            p.scratch.appendAssumeCapacity(node);
        } else {
            try p.scratch.append(p.tree.allocator(), node);
        }
    }

    pub fn flush(p: *Parser, base: usize) Error!ast.IndexRange {
        const range = try p.tree.addExtra(p.scratch.items[base..]);
        p.scratch.shrinkRetainingCapacity(base);
        return range;
    }

    fn spanOfList(p: *const Parser, range: ast.IndexRange) ast.Span {
        if (range.len == 0) return .{ .start = p.start, .end = p.start };
        const children = p.tree.extra(range);
        const spans = p.tree.nodes.items(.span);
        return .{ .start = spans[@backingInt(children[0])].start, .end = spans[@backingInt(children[children.len - 1])].end };
    }

    pub fn pooled(p: *Parser, text: []const u8) Error!String {
        return p.tree.addString(text);
    }

    fn specError(p: *Parser, message: Message, start: u32, end: u32) Error!void {
        try p.spec.append(p.tree.allocator(), .{ .message = message, .span = .{ .start = start, .end = end } });
    }

    // the diagnostics in css-tree's order, each spec error placed before the first that starts after it
    fn mergeSpecErrors(p: *Parser) Error!void {
        if (p.spec.items.len == 0) return;
        const byStart = struct {
            fn less(_: void, a: ast.Diagnostic, b: ast.Diagnostic) bool {
                return a.span.start < b.span.start;
            }
        }.less;
        std.sort.block(ast.Diagnostic, p.spec.items, {}, byStart);
        const own = p.tree.diagnostics.items;
        var merged: std.ArrayList(ast.Diagnostic) = try .initCapacity(p.tree.allocator(), own.len + p.spec.items.len);
        var i: usize = 0;
        for (p.spec.items) |d| {
            while (i < own.len and own[i].span.start <= d.span.start) : (i += 1) merged.appendAssumeCapacity(own[i]);
            merged.appendAssumeCapacity(d);
        }
        merged.appendSliceAssumeCapacity(own[i..]);
        p.tree.diagnostics = merged;
    }

    // CSS Syntax's tokenizer errors, which css-tree's tokenizer recovers from without one
    fn lexErrors(p: *Parser) Error!void {
        const len: u32 = @intCast(p.src.len);
        var start = p.first_offset;
        for (p.tokens) |t| {
            defer start = t.end;
            const text = p.src[start..t.end];
            switch (t.tag) {
                .comment => if (text.len < 4 or !std.mem.endsWith(u8, text, "*/")) try p.specError(.unterminated_comment, len, len),
                .string => if (!stringClosed(text)) try p.specError(.unterminated_string, len, len),
                .bad_string => {
                    const newline = t.end - @as(u32, if (std.mem.endsWith(u8, text, "\r\n")) 2 else 1);
                    try p.specError(.newline_in_string, newline, t.end);
                },
                .url, .bad_url => try p.urlError(start, t.end),
                .delim => if (text[0] == '\\') {
                    if (t.end == len) try p.specError(.unexpected_end, len, len) else try p.specError(.invalid_escape, start, t.end);
                },
                else => {},
            }
        }
    }

    // a bad URL that ends at whitespace before more than `)` is no error
    fn urlError(p: *Parser, start: u32, end: u32) Error!void {
        const src = p.src;
        const len: u32 = @intCast(src.len);
        const l: lexer.Lexer = .{ .src = src, .pos = start };
        var i = start + 4;
        while (i < end and lexer.isSpace(src[i])) i += 1;
        while (i < end) {
            const c = src[i];
            if (c == ')') return;
            if (lexer.isSpace(c)) {
                while (i < len and lexer.isSpace(src[i])) i += 1;
                if (i == len) break;
                return;
            }
            if (c == '"' or c == '\'' or c == '(' or lexer.isNonPrintable(c)) return p.specError(.bad_url, i, i + 1);
            if (c == '\\') {
                if (i + 1 == len) break;
                if (lexer.isNewline(src[i + 1])) return p.specError(.invalid_escape, i, i + 1);
                i = l.escapeEnd(i);
            } else i += 1;
        }
        try p.specError(.unterminated_url, len, len);
    }

    fn root(p: *Parser) Error!NodeIndex {
        if (p.options.context == .stylesheet) return p.styleSheet();
        const start = p.checkpoint();
        const node = p.contextNode() catch |err| switch (err) {
            error.OutOfMemory => |e| return e,
            error.Syntax => {
                const failure = p.failure;
                p.rewind(start);
                p.skipTo(p.count);
                const node = try p.rawFrom(p.first_offset, false);
                try p.report(failure);
                return node;
            },
        };
        if (!p.eof) {
            p.fail(.unexpected_input, null) catch {};
            try p.report(p.failure);
        }
        return node;
    }

    fn contextNode(p: *Parser) ParseError!NodeIndex {
        return switch (p.options.context) {
            .stylesheet => unreachable,
            .atrule => p.atrule(false),
            .rule => p.rule(false),
            .selector_list => p.selectorList(false),
            .selector => p.selector(false),
            .block => p.parseBlock(true, true),
            .declaration_list => p.declarationList(),
            .declaration => p.declaration(false),
            .value => values.value(p),
            .atrule_prelude, .media_query_list, .media_query => {
                p.skipSC();
                return p.raw(.balance_end, true);
            },
        };
    }

    fn declarationList(p: *Parser) ParseError!NodeIndex {
        const base = p.scratch.items.len;
        while (!p.eof) {
            const child = switch (p.tag) {
                .whitespace, .comment, .semicolon => {
                    p.next();
                    continue;
                },
                .at_keyword => try p.withFallback(atrule, .{true}, .semicolon_included, true),
                else => if (p.isDelim('&'))
                    try p.withFallback(rule, .{true}, .semicolon_included, true)
                else
                    try p.declarationStatement(),
            };
            try p.push(child);
        }
        const children = try p.flush(base);
        const span = p.spanOfList(children);
        return p.add(.{ .declaration_list = .{ .children = children } }, span.start, span.end);
    }

    fn styleSheet(p: *Parser) Error!NodeIndex {
        const start = p.start;
        const base = p.scratch.items.len;
        while (!p.eof) {
            const child = switch (p.tag) {
                .whitespace => {
                    p.next();
                    continue;
                },
                .comment => if (p.at(p.start + 2) == '!') try p.comment() else {
                    p.next();
                    continue;
                },
                .cdo, .cdc => try p.marker(),
                .at_keyword => try p.withFallback(atrule, .{false}, .balance_end, false),
                else => try p.withFallback(rule, .{false}, .balance_end, false),
            };
            try p.push(child);
        }
        const children = try p.flush(base);
        return p.add(.{ .style_sheet = .{ .children = children } }, start, p.start);
    }

    fn comment(p: *Parser) Error!NodeIndex {
        const start = p.start;
        var end = p.end;
        p.next();
        if (p.src[end - 2] == '*' and p.src[end - 1] == '/') end -= 2;
        // as JavaScript's `substring`, which swaps a reversed range
        const value: String = .{ .start = @min(start + 2, end), .end = @max(start + 2, end) };
        return p.add(.{ .comment = .{ .value = value } }, start, p.start);
    }

    fn marker(p: *Parser) Error!NodeIndex {
        const start = p.start;
        const data: ast.NodeData = if (p.tag == .cdo) .{ .cdo = .{} } else .{ .cdc = .{} };
        p.next();
        return p.add(data, start, p.start);
    }

    pub fn raw(p: *Parser, comptime stop: Stop, exclude_whitespace: bool) Error!NodeIndex {
        const start = p.start;
        _ = p.skipUntilBalanced(p.index, stop);
        return p.rawFrom(start, exclude_whitespace);
    }

    pub fn rawFrom(p: *Parser, start: u32, exclude_whitespace: bool) Error!NodeIndex {
        var end = p.start;
        if (exclude_whitespace and p.start > start and p.index > 0 and p.lookupType(-1) == .whitespace) {
            end = if (p.index > 1) p.tokenStart(p.index - 1) else p.first_offset;
        }
        return p.add(.{ .raw = .{ .value = .{ .start = start, .end = end } } }, start, end);
    }

    fn atrule(p: *Parser, is_declaration: bool) ParseError!NodeIndex {
        const start = p.start;
        try p.eat(.at_keyword);
        const name: String = .{ .start = start + 1, .end = p.start };
        p.skipSC();
        var prelude: NodeIndex = .null;
        if (!p.eof and p.tag != .left_curly_bracket and p.tag != .semicolon) {
            prelude = try p.raw(.left_curly_bracket_or_semicolon, true);
            p.skipSC();
        }
        var block: NodeIndex = .null;
        switch (p.tag) {
            .semicolon => p.next(),
            .left_curly_bracket => {
                const text = p.src[name.start..name.end];
                const style = p.blockKind(text, is_declaration);
                // the rules of `@scope` are relative to its root (css-cascade-6)
                block = try p.parseBlock(style, style or std.ascii.eqlIgnoreCase(text, "scope"));
            },
            else => {},
        }
        return p.add(.{ .atrule = .{ .name = name, .prelude = prelude, .block = block } }, start, p.start);
    }

    /// Whether the block of an at-rule holds declarations.
    fn blockKind(p: *const Parser, name: []const u8, is_declaration: bool) bool {
        const Kind = enum { nested, style };
        const kinds: std.StaticStringMapWithEql(Kind, std.static_string_map.eqlAsciiIgnoreCase) = .initComptime(.{
            .{ "container", .nested },
            .{ "media", .nested },
            .{ "scope", .nested },
            .{ "starting-style", .nested },
            .{ "supports", .nested },
            // css-tree reads `@layer`'s block as rules only; nested in a style rule, CSS Nesting reads declarations too
            .{ "layer", .nested },
            .{ "font-face", .style },
            .{ "page", .style },
            .{ "nest", .style },
        });
        return switch (kinds.get(name) orelse return p.declarationBlockAhead()) {
            .nested => is_declaration,
            .style => true,
        };
    }

    // css-tree guesses an unknown at-rule's block holds declarations when a `}` comes before any `{` or at-rule
    fn declarationBlockAhead(p: *const Parser) bool {
        var i = p.index + 1;
        while (i < p.count) : (i += 1) switch (p.tokens[i].tag) {
            .right_curly_bracket => return true,
            .left_curly_bracket, .at_keyword => return false,
            else => {},
        };
        return false;
    }

    /// A `nested` rule's selectors may start with a combinator (css-nesting-1).
    fn rule(p: *Parser, nested: bool) ParseError!NodeIndex {
        const start = p.start;
        const prelude = if (p.options.parse_rule_prelude)
            try p.withFallback(rulePrelude, .{nested}, .left_curly_bracket, true)
        else
            try p.raw(.left_curly_bracket, true);
        const block = try p.parseBlock(true, true);
        return p.add(.{ .rule = .{ .prelude = prelude, .block = block } }, start, p.start);
    }

    fn rulePrelude(p: *Parser, nested: bool) ParseError!NodeIndex {
        const list = try p.selectorList(nested);
        if (!p.eof and p.tag != .left_curly_bracket) return p.fail(.unexpected_input, null);
        return list;
    }

    /// `relative`: the selectors of its rules may start with a combinator.
    fn parseBlock(p: *Parser, is_style: bool, relative: bool) ParseError!NodeIndex {
        if (p.depth >= max_depth) return p.fail(.nesting_too_deep, null);
        p.depth += 1;
        defer p.depth -= 1;

        const start = p.start;
        try p.eat(.left_curly_bracket);
        const base = p.scratch.items.len;
        while (!p.eof) {
            const child = switch (p.tag) {
                .right_curly_bracket => break,
                .whitespace, .comment => {
                    p.next();
                    continue;
                },
                .at_keyword => try p.withFallback(atrule, .{is_style}, .balance_end, true),
                else => if (!is_style or p.isDelim('&'))
                    try p.withFallback(rule, .{relative}, .balance_end, true)
                else
                    try p.declarationStatement(),
            };
            try p.push(child);
        }
        if (!p.eof) try p.eat(.right_curly_bracket);
        const children = try p.flush(base);
        return p.add(.{ .block = .{ .children = children } }, start, p.start);
    }

    // css-tree reads every statement of a style block that does not start with `&` as a declaration;
    // CSS Syntax reads a nested rule when its `{}` block comes before any `;`, unless it is a custom property
    fn declarationStatement(p: *Parser) Error!NodeIndex {
        if (p.tag == .semicolon) return p.raw(.semicolon_included, true);
        const start = p.checkpoint();
        var node = p.declaration(true) catch |err| switch (err) {
            error.OutOfMemory => |e| return e,
            error.Syntax => blk: {
                const failure = p.failure;
                p.rewind(start);
                if (p.nestedRuleAhead()) break :blk NodeIndex.null;
                const node = try p.raw(.semicolon_included, true);
                try p.report(failure);
                break :blk node;
            },
        };
        if (node == .null) {
            p.rewind(start);
            // css-tree reads a rule here without trying a declaration, so `eof` keeps no trace of the attempt
            p.eof = start.eof;
            node = try p.withFallback(rule, .{true}, .balance_end, true);
        } else if (p.tag == .semicolon) {
            p.next();
        }
        return node;
    }

    fn nestedRuleAhead(p: *const Parser) bool {
        const first = p.index;
        var i = first;
        while (i < p.count) : (i += 1) {
            if (p.balance[i] < first) return false;
            const tag = p.tokens[i].tag;
            if (tag == .semicolon) return false;
            if (tag == .left_curly_bracket) return !p.customPropertyAhead();
            if (tag.isBlockOpener()) i = p.balance[i];
        }
        return false;
    }

    fn customPropertyAhead(p: *const Parser) bool {
        if (p.tag != .ident or p.end - p.start < 2 or p.src[p.start] != '-' or p.src[p.start + 1] != '-') return false;
        var i = p.index + 1;
        while (i < p.count and (p.tokens[i].tag == .whitespace or p.tokens[i].tag == .comment)) i += 1;
        return i < p.count and p.tokens[i].tag == .colon;
    }

    /// Null when `nested` and the value holds a `{}` block, which makes the statement a nested rule.
    fn declaration(p: *Parser, nested: bool) ParseError!NodeIndex {
        const start = p.start;
        const start_token = p.index;
        const property = try p.parseProperty();
        const custom = property.end - property.start >= 2 and p.src[property.start] == '-' and p.src[property.start + 1] == '-';
        p.skipSC();
        try p.eat(.colon);
        if (!custom) p.skipSC();
        const value_start = p.start;
        if (p.skipUntilBalanced(p.index, .exclamation_mark_or_semicolon) and nested and !custom) return .null;
        const value = try p.rawFrom(value_start, !custom);
        var important: String = .none;
        if (p.isDelim('!')) {
            p.next();
            p.skipSC();
            important = try p.consume(.ident);
            p.skipSC();
        }
        if (!p.eof and p.tag != .semicolon and !p.isBalanceEdge(start_token)) return p.fail(.unexpected_input, null);
        return p.add(.{ .declaration = .{ .important = important, .property = property, .value = value } }, start, p.start);
    }

    fn parseProperty(p: *Parser) ParseError!String {
        const start = p.start;
        if (p.tag == .delim) switch (p.src[p.start]) {
            '*', '$', '+', '#', '&' => p.next(),
            '/' => {
                p.next();
                if (p.isDelim('/')) p.next();
            },
            else => {},
        };
        if (p.tag == .hash) try p.eat(.hash) else try p.eat(.ident);
        return .{ .start = start, .end = p.start };
    }

    /// `relative`: a selector may start with a combinator, as in `:has()` and nested rules.
    fn selectorList(p: *Parser, relative: bool) ParseError!NodeIndex {
        const base = p.scratch.items.len;
        while (!p.eof) {
            try p.push(try p.selector(relative));
            if (p.tag != .comma) break;
            p.next();
        }
        const children = try p.flush(base);
        const span = p.spanOfList(children);
        return p.add(.{ .selector_list = .{ .children = children } }, span.start, span.end);
    }

    // what Selectors 4's grammar rejects and css-tree reads keeps css-tree's tree, with a spec error
    fn selector(p: *Parser, relative: bool) ParseError!NodeIndex {
        const base = p.scratch.items.len;
        var space = false;
        var after_combinator = false;
        while (!p.eof) {
            switch (p.tag) {
                .comment => {
                    p.next();
                    continue;
                },
                .whitespace => {
                    space = true;
                    p.next();
                    continue;
                },
                else => {},
            }
            const child = try p.selectorNode() orelse break;
            const first = p.scratch.items.len == base;
            const span = p.tree.span(child);
            switch (p.tree.data(child)) {
                .combinator => {
                    if (first and !relative) {
                        try p.specError(.relative_selector_not_allowed, span.start, span.end);
                    } else if (after_combinator) {
                        try p.specError(.compound_selector_expected, span.start, span.end);
                    }
                    after_combinator = true;
                },
                else => |data| {
                    if (data == .type_selector and !first and !space and !after_combinator) {
                        try p.specError(.type_selector_not_first, span.start, span.end);
                    }
                    after_combinator = false;
                },
            }
            if (space and !first) try p.descendant(p.scratch.items[p.scratch.items.len - 1], child);
            space = false;
            try p.push(child);
        }
        if (p.scratch.items.len == base) return p.fail(.selector_expected, null);
        if (after_combinator) {
            const end = p.tree.span(p.scratch.items[p.scratch.items.len - 1]).end;
            try p.specError(.compound_selector_expected, end, end);
        }
        const children = try p.flush(base);
        const span = p.spanOfList(children);
        return p.add(.{ .selector = .{ .children = children } }, span.start, span.end);
    }

    // css-tree adds no position to the descendant combinator; its span here is the space it stands for
    fn descendant(p: *Parser, last: NodeIndex, child: NodeIndex) Error!void {
        const data = p.tree.nodes.items(.data);
        if (data[@backingInt(last)] == .combinator or data[@backingInt(child)] == .combinator) return;
        if (p.space.start == String.none.start) p.space = try p.pooled(" ");
        const spans = p.tree.nodes.items(.span);
        const start = spans[@backingInt(last)].end;
        const end = spans[@backingInt(child)].start;
        try p.push(try p.add(.{ .combinator = .{ .name = p.space } }, start, end));
    }

    fn selectorNode(p: *Parser) ParseError!?NodeIndex {
        return switch (p.tag) {
            .left_square_bracket => try p.attributeSelector(),
            .hash => try p.idSelector(),
            .colon => try p.pseudo(p.lookupType(1) == .colon),
            .ident => try p.typeSelector(),
            .number, .percentage => try p.percentage(),
            .dimension => if (p.src[p.start] == '.') p.fail(.identifier_expected, p.start + 1) else null,
            .delim => switch (p.src[p.start]) {
                '+', '>', '~', '/' => try p.combinator(),
                '.' => try p.classSelector(),
                '*' => try p.typeSelector(),
                '|' => if (p.isDelimAt('|', 1)) try p.combinator() else try p.typeSelector(),
                '#' => try p.idSelector(),
                '&' => try p.nestingSelector(),
                else => null,
            },
            else => null,
        };
    }

    fn typeSelector(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        if (p.isDelim('|')) {
            p.next();
            try p.identOrAsterisk();
        } else {
            try p.identOrAsterisk();
            if (p.isDelim('|') and !p.isDelimAt('|', 1)) {
                p.next();
                try p.identOrAsterisk();
            }
        }
        return p.add(.{ .type_selector = .{ .name = .{ .start = start, .end = p.start } } }, start, p.start);
    }

    fn identOrAsterisk(p: *Parser) ParseError!void {
        if (p.tag != .ident and !p.isDelim('*')) return p.fail(.identifier_or_asterisk_expected, null);
        p.next();
    }

    fn idSelector(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        try p.eat(.hash);
        return p.add(.{ .id_selector = .{ .name = .{ .start = start + 1, .end = p.start } } }, start, p.start);
    }

    fn classSelector(p: *Parser) ParseError!NodeIndex {
        try p.eatDelim('.', .full_stop_expected);
        const start = p.start - 1;
        const end = p.end;
        const name = try p.consume(.ident);
        return p.add(.{ .class_selector = .{ .name = name } }, start, end);
    }

    fn nestingSelector(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        try p.eatDelim('&', .ampersand_expected);
        return p.add(.{ .nesting_selector = .{} }, start, p.start);
    }

    fn combinator(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        switch (p.src[p.start]) {
            '>', '+', '~' => p.next(),
            // the column combinator (selectors-4)
            '|' => {
                p.next();
                p.next();
            },
            '/' => {
                p.next();
                if (p.tag != .ident or !p.lookupValue(0, "deep")) return p.fail(.deep_expected, null);
                p.next();
                try p.eatDelim('/', .solidus_expected);
            },
            else => return p.fail(.combinator_expected, null),
        }
        return p.add(.{ .combinator = .{ .name = .{ .start = start, .end = p.start } } }, start, p.start);
    }

    pub fn percentage(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        const end = p.end;
        const value: String = .{ .start = start, .end = (lexer.Lexer{ .src = p.src, .pos = start }).numberEnd(start) };
        try p.eat(.percentage);
        return p.add(.{ .percentage = .{ .value = value } }, start, end);
    }

    fn attributeSelector(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        try p.eat(.left_square_bracket);
        p.skipSC();
        const name = try p.attributeName();
        p.skipSC();
        var matcher: ast.Matcher = .none;
        var value: NodeIndex = .null;
        var flags: String = .none;
        if (p.tag != .right_square_bracket) {
            if (p.tag != .ident) {
                matcher = try p.attributeMatcher();
                p.skipSC();
                value = if (p.tag == .string) try p.string() else try p.identifier();
                p.skipSC();
            }
            if (p.tag == .ident) {
                flags = try p.consume(.ident);
                p.skipSC();
            }
        }
        try p.eat(.right_square_bracket);
        return p.add(.{ .attribute_selector = .{ .name = name, .matcher = matcher, .value = value, .flags = flags } }, start, p.start);
    }

    fn attributeName(p: *Parser) ParseError!NodeIndex {
        if (p.eof) return p.fail(.unexpected_end, null);
        const start = p.start;
        var expect_ident = false;
        if (p.isDelim('*')) {
            expect_ident = true;
            p.next();
        } else if (!p.isDelim('|')) {
            try p.eat(.ident);
        }
        if (p.isDelim('|')) {
            if (p.at(p.start + 1) != '=') {
                p.next();
                try p.eat(.ident);
            } else if (expect_ident) {
                return p.fail(.identifier_expected, p.end);
            }
        } else if (expect_ident) {
            return p.fail(.vertical_line_expected, null);
        }
        return p.add(.{ .identifier = .{ .name = .{ .start = start, .end = p.start } } }, start, p.start);
    }

    fn attributeMatcher(p: *Parser) ParseError!ast.Matcher {
        const matcher: ast.Matcher = switch (p.at(p.start)) {
            '=' => .equal,
            '~' => .includes,
            '|' => .dash,
            '^' => .prefix,
            '$' => .suffix,
            '*' => .substring,
            else => return p.fail(.attribute_operator_expected, null),
        };
        p.next();
        if (matcher != .equal) try p.eatDelim('=', .equal_sign_expected);
        return matcher;
    }

    fn pseudo(p: *Parser, element: bool) ParseError!NodeIndex {
        const start = p.start;
        try p.eat(.colon);
        if (element) try p.eat(.colon);
        var name: String = undefined;
        var children: ast.IndexRange = .none;
        if (p.tag == .function) {
            name = .{ .start = p.start, .end = p.end - 1 };
            p.next();
            const base = p.scratch.items.len;
            if (p.lookupNonWsType() != .right_parenthesis) {
                if (pseudos.get(p.src[name.start..name.end])) |kind| {
                    if (p.depth >= max_depth) return p.fail(.nesting_too_deep, null);
                    p.depth += 1;
                    defer p.depth -= 1;
                    p.skipSC();
                    try p.pseudoArgument(kind, std.ascii.eqlIgnoreCase(p.src[name.start..name.end], "has"));
                    p.skipSC();
                } else {
                    try p.push(try p.raw(.balance_end, false));
                }
            }
            children = try p.flush(base);
            try p.eat(.right_parenthesis);
        } else {
            name = try p.consume(.ident);
        }
        const data: ast.NodeData = if (element)
            .{ .pseudo_element_selector = .{ .name = name, .children = children } }
        else
            .{ .pseudo_class_selector = .{ .name = name, .children = children } };
        return p.add(data, start, p.start);
    }

    fn pseudoArgument(p: *Parser, kind: Pseudo, relative: bool) ParseError!void {
        switch (kind) {
            .selector_list => try p.push(try p.selectorList(relative)),
            .selector => try p.push(try p.selector(false)),
            .nth => try p.push(try p.nth()),
            .identifier => try p.push(try p.identifier()),
            .lang => while (!p.eof) {
                switch (p.tag) {
                    .ident => try p.push(try p.identifier()),
                    .string => try p.push(try p.string()),
                    .comma => try p.push(try p.operator()),
                    .right_parenthesis => break,
                    else => return p.fail(.identifier_string_or_comma_expected, null),
                }
                p.skipSC();
            },
        }
    }

    pub fn identifier(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        const end = p.end;
        const name = try p.consume(.ident);
        return p.add(.{ .identifier = .{ .name = name } }, start, end);
    }

    pub fn operator(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        p.next();
        return p.add(.{ .operator = .{ .value = .{ .start = start, .end = p.start } } }, start, p.start);
    }

    pub fn string(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        const end = p.end;
        try p.eat(.string);
        return p.add(.{ .string = .{ .value = try p.decodeString(start, end) } }, start, end);
    }

    // css-tree's `string.decode`, quirks included
    pub fn decodeString(p: *Parser, start: u32, end: u32) Error!String {
        const str = p.src[start..end];
        const len: u32 = @intCast(str.len);
        const quote = str[0];
        const first: u32 = if (quote == '"' or quote == '\'') 1 else 0;
        const last: u32 = if (first == 1 and len > 1 and str[len - 1] == quote) len - 1 else len;
        return p.decodeEscapes(start, end, first, last);
    }

    /// css-tree's escape decoding of `string` and `url`, over `first..last` of `start..end`.
    pub fn decodeEscapes(p: *Parser, start: u32, end: u32, first: u32, last: u32) Error!String {
        std.debug.assert(start <= end and end <= p.src.len);
        std.debug.assert(first <= last and last <= end - start);
        const str = p.src[start..end];
        const len: u32 = @intCast(str.len);
        if (std.mem.findScalar(u8, str[first..last], '\\') == null) {
            return .{ .start = start + first, .end = start + last };
        }

        const gpa = p.tree.allocator();
        var decoded: std.ArrayList(u8) = .empty;
        var i = first;
        while (i < last) : (i += 1) {
            if (str[i] != '\\') {
                try decoded.append(gpa, str[i]);
                continue;
            }
            if (i == last - 1) {
                if (i != len - 1) {
                    decoded.clearRetainingCapacity();
                    try decoded.appendSlice(gpa, str[i + 1 ..]);
                }
                break;
            }
            i += 1;
            const c = str[i];
            if (lexer.validEscape('\\', c)) {
                const escape_end = escapeEnd(str, i - 1);
                try appendEscaped(gpa, &decoded, str[i..escape_end]);
                i = escape_end - 1;
            } else if (c == '\r' and i + 1 < len and str[i + 1] == '\n') {
                i += 1;
            }
        }
        return p.pooled(decoded.items);
    }

    fn nth(p: *Parser) ParseError!NodeIndex {
        p.skipSC();
        const start = p.start;
        const value = if (p.lookupValue(0, "odd") or p.lookupValue(0, "even")) try p.identifier() else try p.anPlusB();
        var end = p.start;
        p.skipSC();
        var of: NodeIndex = .null;
        if (p.lookupValue(0, "of")) {
            p.next();
            of = try p.selectorList(false);
            end = p.start;
        }
        return p.add(.{ .nth = .{ .nth = value, .selector = of } }, start, end);
    }

    fn anPlusB(p: *Parser) ParseError!NodeIndex {
        const start = p.start;
        var a: String = .none;
        var b: String = .none;
        if (p.tag == .number) {
            try p.checkInteger(0, false);
            b = try p.consume(.number);
        } else if (p.tag == .ident and p.src[p.start] == '-') {
            a = try p.pooled("-1");
            try p.expectChar(1, 'n');
            switch (p.end - p.start) {
                2 => {
                    p.next();
                    b = try p.anPlusBTail();
                },
                3 => {
                    try p.expectChar(2, '-');
                    b = try p.negativeInteger();
                },
                else => {
                    try p.expectChar(2, '-');
                    try p.checkInteger(3, true);
                    p.next();
                    b = .{ .start = start + 2, .end = p.start };
                },
            }
        } else if (p.tag == .ident or (p.isDelim('+') and p.lookupType(1) == .ident)) {
            var sign: u32 = 0;
            a = try p.pooled("1");
            if (p.isDelim('+')) {
                sign = 1;
                p.next();
            }
            try p.expectChar(0, 'n');
            switch (p.end - p.start) {
                1 => {
                    p.next();
                    b = try p.anPlusBTail();
                },
                2 => {
                    try p.expectChar(1, '-');
                    b = try p.negativeInteger();
                },
                else => {
                    try p.expectChar(1, '-');
                    try p.checkInteger(2, true);
                    p.next();
                    b = .{ .start = start + sign + 1, .end = p.start };
                },
            }
        } else if (p.tag == .dimension) {
            const signed: u32 = @intFromBool(p.src[p.start] == '+' or p.src[p.start] == '-');
            var i = p.start + signed;
            while (i < p.end and lexer.isDigit(p.src[i])) i += 1;
            if (i == p.start + signed) return p.fail(.integer_expected, p.start + signed);
            try p.expectChar(i - p.start, 'n');
            a = .{ .start = start, .end = i };
            if (i + 1 == p.end) {
                p.next();
                b = try p.anPlusBTail();
            } else {
                try p.expectChar(i - p.start + 1, '-');
                if (i + 2 == p.end) {
                    b = try p.negativeInteger();
                } else {
                    try p.checkInteger(i - p.start + 2, true);
                    p.next();
                    b = .{ .start = i + 1, .end = p.start };
                }
            }
        } else {
            return p.fail(.unexpected_input, null);
        }
        if (a.start < p.src.len and p.src[a.start] == '+') a.start += 1;
        if (b.start < p.src.len and p.src[b.start] == '+') b.start += 1;
        return p.add(.{ .an_plus_b = .{ .a = a, .b = b } }, start, p.start);
    }

    // `-n- 3`, after the `-`: the next integer, made negative
    fn negativeInteger(p: *Parser) ParseError!String {
        p.next();
        p.skipSC();
        try p.checkInteger(0, true);
        return p.negated(try p.consume(.number));
    }

    fn negated(p: *Parser, number: String) Error!String {
        var buffer: [64]u8 = undefined;
        const digits = p.src[number.start..number.end];
        if (digits.len + 1 > buffer.len) {
            const joined = try std.mem.concat(p.tree.allocator(), u8, &.{ "-", digits });
            return p.pooled(joined);
        }
        buffer[0] = '-';
        @memcpy(buffer[1..][0..digits.len], digits);
        return p.pooled(buffer[0 .. digits.len + 1]);
    }

    // the `B` of `An+B` after the `n`: a signed integer, or a sign then an integer
    fn anPlusBTail(p: *Parser) ParseError!String {
        var offset: u32 = 0;
        var sign: u8 = 0;
        var tag = p.tag;
        while (tag == .whitespace or tag == .comment) {
            offset += 1;
            tag = p.lookupType(@intCast(offset));
        }
        if (tag != .number) {
            if (p.isDelimAt('+', offset) or p.isDelimAt('-', offset)) {
                sign = if (p.isDelimAt('+', offset)) '+' else '-';
                while (true) {
                    offset += 1;
                    tag = p.lookupType(@intCast(offset));
                    if (tag != .whitespace and tag != .comment) break;
                }
                if (tag != .number) {
                    p.skipTo(p.index + offset);
                    try p.checkInteger(0, true);
                }
            } else {
                return .none;
            }
        }
        if (offset > 0) p.skipTo(p.index + offset);
        if (sign == 0) {
            const c = p.at(p.start);
            if (c != '+' and c != '-') return p.fail(.number_sign_expected, null);
        }
        try p.checkInteger(0, sign != 0);
        const number = try p.consume(.number);
        return if (sign == '-') p.negated(number) else number;
    }

    fn checkInteger(p: *Parser, offset: u32, disallow_sign: bool) ParseError!void {
        var i = p.start + offset;
        const c = p.at(i);
        if (c == '+' or c == '-') {
            if (disallow_sign) return p.fail(.number_sign_not_allowed, null);
            i += 1;
        }
        while (i < p.end) : (i += 1) {
            if (!lexer.isDigit(p.src[i])) return p.fail(.integer_expected, i);
        }
    }

    fn expectChar(p: *Parser, offset: u32, comptime c: u8) ParseError!void {
        if (std.ascii.toLower(p.at(p.start + offset)) == c) return;
        return p.fail(if (c == 'n') .n_expected else .hyphen_minus_expected, p.start + offset);
    }
};

fn stringClosed(text: []const u8) bool {
    var i: usize = 1;
    while (i < text.len) {
        if (text[i] == text[0]) return i == text.len - 1;
        i += if (text[i] != '\\') 1 else if (i + 2 < text.len and text[i + 1] == '\r' and text[i + 2] == '\n') 3 else 2;
    }
    return false;
}

fn expected(comptime tag: Tag) Message {
    return switch (tag) {
        .ident => .identifier_expected,
        .hash => .hash_expected,
        .colon => .colon_expected,
        .left_square_bracket => .left_square_bracket_expected,
        .right_square_bracket => .right_square_bracket_expected,
        .right_parenthesis => .right_parenthesis_expected,
        .left_curly_bracket => .left_curly_bracket_expected,
        .right_curly_bracket => .right_curly_bracket_expected,
        .at_keyword => .at_keyword_expected,
        .function => .function_expected,
        .string => .string_expected,
        .number => .number_expected,
        .percentage => .percentage_expected,
        .cdo => .cdo_expected,
        .cdc => .cdc_expected,
        .comment => .comment_expected,
        .delim => .delim_expected,
        else => @compileError("no message for " ++ @tagName(tag)),
    };
}

// where css-tree reports an error at the end of input: the end, before trailing whitespace
fn whitespaceStart(src: []const u8) u32 {
    var i: u32 = @intCast(src.len);
    while (i > 0 and lexer.isSpace(src[i - 1])) i -= 1;
    return i;
}

/// `from` is the backslash.
fn escapeEnd(str: []const u8, from: u32) u32 {
    var i = from + 2;
    if (i - 1 < str.len and std.ascii.isHex(str[i - 1])) {
        const max = @min(str.len, i + 5);
        while (i < max and std.ascii.isHex(str[i])) i += 1;
        if (i < str.len and lexer.isSpace(str[i])) i += if (str[i] == '\r' and i + 1 < str.len and str[i + 1] == '\n') 2 else 1;
    }
    return i;
}

/// `escaped` follows a backslash: one character, or hex digits and maybe a whitespace.
fn appendEscaped(gpa: Allocator, out: *std.ArrayList(u8), escaped: []const u8) Error!void {
    if (escaped.len == 1 and !std.ascii.isHex(escaped[0])) return out.append(gpa, escaped[0]);
    var code: u32 = 0;
    for (escaped) |c| {
        const digit = std.fmt.charToDigit(c, 16) catch break;
        code = code * 16 + digit;
    }
    if (code == 0 or (code >= 0xD800 and code <= 0xDFFF) or code > 0x10FFFF) code = 0xFFFD;
    var buffer: [4]u8 = undefined;
    const len = std.unicode.utf8Encode(@intCast(code), &buffer) catch unreachable;
    try out.appendSlice(gpa, buffer[0..len]);
}

test "parses a rule" {
    var tree = try parse(std.testing.allocator, "a > .b:is(c, d) { color: red !important }", .{});
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const sheet = tree.data(tree.root).style_sheet;
    const rule = tree.data(tree.extra(sheet.children)[0]).rule;
    try std.testing.expectEqual(ast.Tag.selector_list, std.meta.activeTag(tree.data(rule.prelude)));
    const declaration = tree.data(tree.extra(tree.data(rule.block).block.children)[0]).declaration;
    try std.testing.expectEqualStrings("color", tree.string(declaration.property));
    try std.testing.expectEqualStrings("important", tree.string(declaration.important));
}

test "keeps what does not parse as raw" {
    var tree = try parse(std.testing.allocator, "a; b { c: d } e {", .{});
    defer tree.deinit();
    try std.testing.expectEqual(1, tree.diagnostics.items.len);
    const children = tree.extra(tree.data(tree.root).style_sheet.children);
    try std.testing.expectEqual(2, children.len);
    const prelude = tree.data(tree.data(children[0]).rule.prelude).raw;
    try std.testing.expectEqualStrings("a; b", tree.string(prelude.value));
    try std.testing.expectEqual(ast.Tag.rule, std.meta.activeTag(tree.data(children[1])));
}

test "nests rules that css-tree reads as declarations" {
    var tree = try parse(std.testing.allocator, ".a { color: red; .b { color: blue } div:hover {} --x: { y } }", .{});
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const sheet = tree.data(tree.root).style_sheet;
    const block = tree.data(tree.data(tree.extra(sheet.children)[0]).rule.block).block;
    var tags: [4]ast.Tag = undefined;
    for (tree.extra(block.children), &tags) |child, *tag| tag.* = std.meta.activeTag(tree.data(child));
    try std.testing.expectEqualSlices(ast.Tag, &.{ .declaration, .rule, .rule, .declaration }, &tags);
}

test "survives deep nesting" {
    const gpa = std.testing.allocator;
    var source: std.ArrayList(u8) = .empty;
    defer source.deinit(gpa);
    for (0..300) |_| try source.appendSlice(gpa, "a{:is(");
    var tree = try parse(gpa, source.items, .{});
    defer tree.deinit();
    try std.testing.expect(tree.diagnostics.items.len > 0);
}

fn expectMessages(source: []const u8, options: Options, want: []const Message) !void {
    var tree = try parse(std.testing.allocator, source, options);
    defer tree.deinit();
    var messages: [8]Message = undefined;
    for (tree.diagnostics.items, 0..) |d, i| messages[i] = d.message;
    try std.testing.expectEqualSlices(Message, want, messages[0..tree.diagnostics.items.len]);
}

test "parses each context" {
    const cases = .{
        .{ Context.declaration_list, "a: b; c {}", ast.Tag.declaration_list },
        .{ Context.declaration, "a: b", ast.Tag.declaration },
        .{ Context.selector, "a > b", ast.Tag.selector },
        .{ Context.block, "{ a: b }", ast.Tag.block },
        .{ Context.value, "1px solid", ast.Tag.value },
    };
    inline for (cases) |case| {
        var tree = try parse(std.testing.allocator, case[1], .{ .context = case[0] });
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
        try std.testing.expectEqual(case[2], std.meta.activeTag(tree.data(tree.root)));
    }
    try expectMessages("a b", .{ .context = .declaration }, &.{.colon_expected});
}

test "reports what the specs reject" {
    try expectMessages("/* a", .{}, &.{.unterminated_comment});
    try expectMessages("a{b:'c", .{}, &.{.unterminated_string});
    try expectMessages("a{b:url(c\"d)}", .{}, &.{.bad_url});
    try expectMessages("> a {} a { > b {} } :has(> a) {}", .{}, &.{.relative_selector_not_allowed});
    try expectMessages("a > > b, c + {} a:hover|b {}", .{}, &.{ .compound_selector_expected, .compound_selector_expected, .type_selector_not_first });
    try expectMessages("a || b {}", .{}, &.{});
    try expectMessages("a{", .{}, &.{});
}
