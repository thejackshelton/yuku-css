const std = @import("std");
const ast = @import("ast.zig");

const Allocator = std.mem.Allocator;
const NodeIndex = ast.NodeIndex;
const NodeList = ast.NodeList;
const Span = ast.Span;
const Message = ast.Message;

/// Parses a style sheet. Never fails on bad CSS: it reports diagnostics and keeps what parses.
/// `source` must be shorter than 4 GiB.
pub fn parse(gpa: Allocator, source: []const u8) Allocator.Error!ast.Tree {
    var arena = std.heap.ArenaAllocator.init(gpa);
    errdefer arena.deinit();
    var parser: Parser = .{ .src = source, .gpa = arena.allocator() };
    const root = try parser.parseStyleSheet();
    return .{
        .source = source,
        .nodes = parser.nodes.items,
        .extra = parser.extra.items,
        .root = root,
        .diagnostics = parser.diagnostics.items,
        .arena = arena,
    };
}

// bounds both the parser's recursion and the decoder's
const max_depth = 128;

const Error = Allocator.Error;
const SelectorError = Allocator.Error || error{InvalidSelector};

const Parsed = struct {
    node: NodeIndex,
    next: u32,
};

const Stop = struct {
    index: u32,
    kind: enum { brace, semi, close, eof },
};

const BlockKind = enum { style, keyframes };

const Parser = struct {
    src: []const u8,
    gpa: Allocator,
    nodes: std.ArrayList(ast.Node) = .empty,
    extra: std.ArrayList(NodeIndex) = .empty,
    scratch: std.ArrayList(NodeIndex) = .empty,
    diagnostics: std.ArrayList(ast.Diagnostic) = .empty,
    depth: u32 = 0,

    fn add(p: *Parser, data: ast.Data, start: u32, end: u32) Error!NodeIndex {
        const index: NodeIndex = @fromBackingInt(@intCast(p.nodes.items.len));
        try p.nodes.append(p.gpa, .{ .data = data, .span = .{ .start = start, .end = end } });
        return index;
    }

    fn push(p: *Parser, node: NodeIndex) Error!void {
        try p.scratch.append(p.gpa, node);
    }

    fn listFrom(p: *Parser, base: usize) Error!NodeList {
        const items = p.scratch.items[base..];
        const start: u32 = @intCast(p.extra.items.len);
        try p.extra.appendSlice(p.gpa, items);
        p.scratch.shrinkRetainingCapacity(base);
        return .{ .start = start, .len = @intCast(items.len) };
    }

    fn raw(p: *Parser, start: u32, end: u32) Error!NodeIndex {
        return p.add(.{ .raw = .{ .value = .{ .start = start, .end = end } } }, start, end);
    }

    // the same region can be scanned twice, so a repeated diagnostic is dropped
    fn report(p: *Parser, message: Message, start: u32, end: u32) Error!void {
        const recent = p.diagnostics.items[p.diagnostics.items.len -| 8..];
        for (recent) |diagnostic| {
            if (diagnostic.message == message and diagnostic.span.start == start) return;
        }
        try p.diagnostics.append(p.gpa, .{ .message = message, .span = .{ .start = start, .end = end } });
    }

    fn fail(p: *Parser, message: Message, start: u32, end: u32) SelectorError {
        try p.report(message, start, end);
        return error.InvalidSelector;
    }

    fn parseStyleSheet(p: *Parser) Error!NodeIndex {
        const end: u32 = @intCast(p.src.len);
        const base = p.scratch.items.len;
        var i: u32 = 0;
        while (true) {
            i = try p.skipTrivia(i, end);
            if (i >= end) break;
            const rest = p.src[i..end];
            if (std.mem.startsWith(u8, rest, "<!--")) {
                i += 4;
                continue;
            }
            if (std.mem.startsWith(u8, rest, "-->")) {
                i += 3;
                continue;
            }
            switch (p.src[i]) {
                '@' => {
                    const at_rule = try p.parseAtRule(i, end, false);
                    try p.push(at_rule.node);
                    i = at_rule.next;
                },
                '}' => {
                    try p.report(.unexpected_close, i, i + 1);
                    i += 1;
                },
                else => {
                    const stop = try p.statementEnd(i, end);
                    if (stop.kind == .brace) {
                        const rule = try p.parseRule(i, stop.index, end, .top);
                        try p.push(rule.node);
                        i = rule.next;
                    } else {
                        try p.report(.declaration_outside_rule, i, p.trimEnd(i, stop.index));
                        i = if (stop.kind == .semi) stop.index + 1 else stop.index;
                    }
                },
            }
        }
        const children = try p.listFrom(base);
        return p.add(.{ .style_sheet = .{ .children = children } }, 0, end);
    }

    /// `open` is the `{`. `nested` is whether the block sits inside a style rule.
    fn parseBlock(p: *Parser, open: u32, end: u32, kind: BlockKind, nested: bool) Error!Parsed {
        if (p.depth >= max_depth) {
            try p.report(.nesting_too_deep, open, open + 1);
            const close = try p.skipNested(open, end);
            return .{ .node = try p.add(.{ .block = .{ .children = .{} } }, open, close), .next = close };
        }
        p.depth += 1;
        defer p.depth -= 1;

        const base = p.scratch.items.len;
        var i = open + 1;
        const close: u32 = while (true) {
            i = try p.skipTrivia(i, end);
            if (i >= end) {
                try p.report(.unclosed_block, open, open + 1);
                break end;
            }
            switch (p.src[i]) {
                '}' => break i + 1,
                ';' => {
                    i += 1;
                    continue;
                },
                '@' => {
                    const at_rule = try p.parseAtRule(i, end, nested);
                    try p.push(at_rule.node);
                    i = at_rule.next;
                    continue;
                },
                else => {},
            }
            const stop = try p.statementEnd(i, end);
            if (kind == .keyframes) {
                if (stop.kind == .brace) {
                    const rule = try p.parseRule(i, stop.index, end, .keyframe);
                    try p.push(rule.node);
                    i = rule.next;
                } else {
                    try p.report(.expected_keyframe_rule, i, p.trimEnd(i, stop.index));
                    i = if (stop.kind == .semi) stop.index + 1 else stop.index;
                }
            } else if (stop.kind == .brace and !p.isCustomPropertyStart(i, stop.index)) {
                const rule = try p.parseRule(i, stop.index, end, if (nested) .nested else .top);
                try p.push(rule.node);
                i = rule.next;
            } else {
                const declaration = try p.parseDeclaration(i, end, if (stop.kind == .brace) null else stop);
                if (declaration.node != .null) try p.push(declaration.node);
                i = declaration.next;
            }
        };
        const children = try p.listFrom(base);
        return .{ .node = try p.add(.{ .block = .{ .children = children } }, open, close), .next = close };
    }

    fn parseRule(p: *Parser, start: u32, open: u32, end: u32, context: enum { top, nested, keyframe }) Error!Parsed {
        const prelude_end = p.trimEnd(start, open);
        const prelude = switch (context) {
            .keyframe => try p.raw(start, prelude_end),
            .top, .nested => p.parseSelectorList(start, prelude_end, context == .nested, false) catch |err| switch (err) {
                error.InvalidSelector => try p.raw(start, prelude_end),
                else => |other| return other,
            },
        };
        const block = try p.parseBlock(open, end, .style, true);
        const rule = try p.add(.{ .rule = .{ .prelude = prelude, .block = block.node } }, start, block.next);
        return .{ .node = rule, .next = block.next };
    }

    fn parseAtRule(p: *Parser, start: u32, end: u32, nested: bool) Error!Parsed {
        const name_start = start + 1;
        const name_end = p.identEnd(name_start, end);
        if (name_end == name_start) try p.report(.expected_at_rule_name, start, start + 1);
        const name: Span = .{ .start = name_start, .end = name_end };

        const stop = try p.statementEnd(name_end, end);
        const prelude_start = p.skipWhitespace(name_end, stop.index);
        const prelude_end = p.trimEnd(prelude_start, stop.index);
        const prelude: NodeIndex = if (prelude_start < prelude_end) try p.raw(prelude_start, prelude_end) else .null;
        const statement_end = if (prelude != .null) prelude_end else name_end;

        switch (stop.kind) {
            .brace => {
                const keyframes = std.ascii.endsWithIgnoreCase(p.src[name_start..name_end], "keyframes");
                const block = try p.parseBlock(stop.index, end, if (keyframes) .keyframes else .style, nested);
                const node = try p.add(.{ .at_rule = .{ .name = name, .prelude = prelude, .block = block.node } }, start, block.next);
                return .{ .node = node, .next = block.next };
            },
            .semi, .close, .eof => {
                const node_end = if (stop.kind == .semi) stop.index + 1 else statement_end;
                const node = try p.add(.{ .at_rule = .{ .name = name, .prelude = prelude, .block = .null } }, start, node_end);
                return .{ .node = node, .next = if (stop.kind == .semi) stop.index + 1 else stop.index };
            },
        }
    }

    /// Returns a null node when the statement is not a declaration; `next` then skips it.
    /// `known_stop` is the statement's end when no `{}` block precedes it.
    fn parseDeclaration(p: *Parser, start: u32, end: u32, known_stop: ?Stop) Error!Parsed {
        const property_end = if (p.isIdentStart(start, end)) p.identEnd(start, end) else start;
        const after_property = try p.skipTrivia(property_end, end);
        if (property_end == start or after_property >= end or p.src[after_property] != ':') {
            const stop = known_stop orelse try p.valueEnd(start, end);
            const message: Message = if (property_end == start) .expected_property else .expected_colon;
            try p.report(message, start, p.trimEnd(start, stop.index));
            return .{ .node = .null, .next = if (stop.kind == .semi) stop.index + 1 else stop.index };
        }

        const value_start = p.skipWhitespace(after_property + 1, end);
        const stop = known_stop orelse try p.valueEnd(value_start, end);
        var value_end = p.trimEnd(value_start, stop.index);
        const declaration_end = value_end;
        const important = p.importantStart(value_start, value_end);
        if (important) |bang| value_end = p.trimEnd(value_start, bang);

        const value = try p.raw(value_start, value_end);
        const node = try p.add(.{ .declaration = .{
            .property = .{ .start = start, .end = property_end },
            .value = value,
            .important = important != null,
        } }, start, declaration_end);
        return .{ .node = node, .next = if (stop.kind == .semi) stop.index + 1 else stop.index };
    }

    /// The offset of the `!` of a trailing `!important`.
    fn importantStart(p: *Parser, start: u32, end: u32) ?u32 {
        const word: []const u8 = "important";
        const len: u32 = @intCast(word.len);
        if (end - start < len + 1) return null;
        if (!std.ascii.eqlIgnoreCase(p.src[end - len .. end], word)) return null;
        var i = end - len;
        while (i > start and isSpace(p.src[i - 1])) i -= 1;
        if (i > start and p.src[i - 1] == '!') return i - 1;
        return null;
    }

    fn isCustomPropertyStart(p: *Parser, start: u32, limit: u32) bool {
        if (!std.mem.startsWith(u8, p.src[start..limit], "--")) return false;
        var i = p.identEnd(start, limit);
        while (i < limit and isSpace(p.src[i])) i += 1;
        return i < limit and p.src[i] == ':';
    }

    fn parseSelectorList(p: *Parser, start: u32, end: u32, relative: bool, allow_empty: bool) SelectorError!NodeIndex {
        if (p.depth >= max_depth) return p.fail(.nesting_too_deep, start, end);
        p.depth += 1;
        defer p.depth -= 1;

        const first = try p.skipTrivia(start, end);
        if (first >= end) {
            if (allow_empty) return p.add(.{ .selector_list = .{ .children = .{} } }, start, start);
            return p.fail(.expected_selector, start, end);
        }

        const base = p.scratch.items.len;
        errdefer p.scratch.shrinkRetainingCapacity(base);
        var i = first;
        var last_end = first;
        while (true) {
            const complex = try p.parseComplex(i, end, relative);
            try p.push(complex.node);
            last_end = p.nodes.items[@backingInt(complex.node)].span.end;
            if (complex.next >= end) break;
            i = complex.next + 1;
        }
        const children = try p.listFrom(base);
        return p.add(.{ .selector_list = .{ .children = children } }, first, last_end);
    }

    /// `next` is the `,` that ends the selector, or `end`.
    fn parseComplex(p: *Parser, start: u32, end: u32, relative: bool) SelectorError!Parsed {
        const base = p.scratch.items.len;
        errdefer p.scratch.shrinkRetainingCapacity(base);

        var i = try p.skipTrivia(start, end);
        const first = i;
        var last_end = i;
        var compounds: u32 = 0;
        var pending: ?struct { name: ast.Combinator, start: u32, end: u32, explicit: bool } = null;
        while (i < end and p.src[i] != ',') {
            if (p.combinatorAt(i, end)) |combinator| {
                const width: u32 = if (combinator == .column) 2 else 1;
                if (pending != null and pending.?.explicit) return p.fail(.unexpected_in_selector, i, i + width);
                if (compounds == 0 and !relative) return p.fail(.expected_selector, i, i + width);
                pending = .{ .name = combinator, .start = i, .end = i + width, .explicit = true };
                last_end = i + width;
                i = try p.skipTrivia(i + width, end);
                continue;
            }
            if (compounds > 0 and pending == null) return p.fail(.unexpected_in_selector, i, i + 1);
            if (pending) |combinator| {
                try p.push(try p.add(.{ .combinator = .{ .name = combinator.name } }, combinator.start, combinator.end));
                pending = null;
            }
            const compound = try p.parseCompound(i, end);
            try p.push(compound.node);
            compounds += 1;
            last_end = compound.next;
            const after = try p.skipTrivia(compound.next, end);
            if (after > compound.next and after < end and p.src[after] != ',' and p.combinatorAt(after, end) == null) {
                pending = .{ .name = .descendant, .start = compound.next, .end = after, .explicit = false };
            }
            i = after;
        }
        if (pending) |combinator| return p.fail(.expected_selector, combinator.start, combinator.end);
        if (compounds == 0) {
            if (first < end) return p.fail(.expected_selector, first, first + 1);
            return p.fail(.expected_selector, start -| 1, start);
        }

        const children = try p.listFrom(base);
        const node = try p.add(.{ .complex_selector = .{ .children = children } }, first, last_end);
        return .{ .node = node, .next = i };
    }

    fn combinatorAt(p: *Parser, i: u32, end: u32) ?ast.Combinator {
        return switch (p.src[i]) {
            '>' => .child,
            '+' => .next_sibling,
            '~' => .subsequent_sibling,
            '|' => if (i + 1 < end and p.src[i + 1] == '|') .column else null,
            else => null,
        };
    }

    fn parseCompound(p: *Parser, start: u32, end: u32) SelectorError!Parsed {
        const base = p.scratch.items.len;
        errdefer p.scratch.shrinkRetainingCapacity(base);

        var i = start;
        if (try p.parseQualifiedName(i, end, true)) |name| {
            try p.push(try p.add(.{ .type_selector = .{ .namespace = name.namespace, .name = name.name } }, start, name.end));
            i = name.end;
        }
        while (i < end) {
            const simple_start = i;
            switch (p.src[i]) {
                '#' => {
                    const name_end = p.identEnd(i + 1, end);
                    if (name_end == i + 1) return p.fail(.expected_name, i, i + 1);
                    i = name_end;
                    try p.push(try p.add(.{ .id_selector = .{ .name = .{ .start = simple_start + 1, .end = i } } }, simple_start, i));
                },
                '.' => {
                    if (!p.isIdentStart(i + 1, end)) return p.fail(.expected_name, i, i + 1);
                    i = p.identEnd(i + 1, end);
                    try p.push(try p.add(.{ .class_selector = .{ .name = .{ .start = simple_start + 1, .end = i } } }, simple_start, i));
                },
                '&' => {
                    i += 1;
                    try p.push(try p.add(.{ .nesting_selector = .{} }, simple_start, i));
                },
                '[' => {
                    const attribute = try p.parseAttribute(i, end);
                    try p.push(attribute.node);
                    i = attribute.next;
                },
                ':' => {
                    const pseudo = try p.parsePseudo(i, end);
                    try p.push(pseudo.node);
                    i = pseudo.next;
                },
                else => break,
            }
        }
        if (p.scratch.items.len == base) return p.fail(.unexpected_in_selector, start, start + 1);
        if (i < end and !p.endsCompound(i, end)) return p.fail(.unexpected_in_selector, i, i + 1);

        const children = try p.listFrom(base);
        return .{ .node = try p.add(.{ .compound_selector = .{ .children = children } }, start, i), .next = i };
    }

    fn endsCompound(p: *Parser, i: u32, end: u32) bool {
        const byte = p.src[i];
        if (isSpace(byte) or byte == ',' or p.combinatorAt(i, end) != null) return true;
        return byte == '/' and i + 1 < end and p.src[i + 1] == '*';
    }

    const QualifiedName = struct { namespace: ?Span, name: Span, end: u32 };

    /// `ns|name`, `*|name`, `|name`, or `name`; `*` stands for a name when `universal`.
    fn parseQualifiedName(p: *Parser, start: u32, end: u32, universal: bool) SelectorError!?QualifiedName {
        const first = p.nameAt(start, end, universal) orelse {
            if (start < end and p.src[start] == '|' and !(start + 1 < end and p.src[start + 1] == '|')) {
                const name = p.nameAt(start + 1, end, universal) orelse return p.fail(.expected_name, start, start + 1);
                return .{ .namespace = .{ .start = start, .end = start }, .name = name, .end = name.end };
            }
            return null;
        };
        const bar = first.end;
        if (bar + 1 < end and p.src[bar] == '|' and p.src[bar + 1] != '|' and p.src[bar + 1] != '=') {
            const name = p.nameAt(bar + 1, end, universal) orelse return p.fail(.expected_name, bar, bar + 1);
            return .{ .namespace = first, .name = name, .end = name.end };
        }
        return .{ .namespace = null, .name = first, .end = first.end };
    }

    fn nameAt(p: *Parser, start: u32, end: u32, universal: bool) ?Span {
        if (start >= end) return null;
        if (p.src[start] == '*' and (universal or (start + 1 < end and p.src[start + 1] == '|'))) {
            return .{ .start = start, .end = start + 1 };
        }
        if (!p.isIdentStart(start, end)) return null;
        return .{ .start = start, .end = p.identEnd(start, end) };
    }

    fn parseAttribute(p: *Parser, open: u32, end: u32) SelectorError!Parsed {
        var i = try p.skipTrivia(open + 1, end);
        const name = try p.parseQualifiedName(i, end, false) orelse return p.fail(.invalid_attribute, open, i + 1);
        i = try p.skipTrivia(name.end, end);
        var matcher: ?Span = null;
        var value: ?Span = null;
        var modifier: ?Span = null;
        if (i < end and p.src[i] != ']') {
            if (p.src[i] == '=') {
                matcher = .{ .start = i, .end = i + 1 };
            } else if (i + 1 < end and p.src[i + 1] == '=' and std.mem.indexOfScalar(u8, "~|^$*", p.src[i]) != null) {
                matcher = .{ .start = i, .end = i + 2 };
            } else return p.fail(.invalid_attribute, open, i + 1);
            i = try p.skipTrivia(matcher.?.end, end);
            if (i < end and (p.src[i] == '"' or p.src[i] == '\'')) {
                const string_end = try p.stringEnd(i, end);
                if (p.src[string_end - 1] != p.src[i] or string_end == i + 1) return error.InvalidSelector;
                value = .{ .start = i, .end = string_end };
            } else if (p.isIdentStart(i, end)) {
                value = .{ .start = i, .end = p.identEnd(i, end) };
            } else return p.fail(.invalid_attribute, open, @min(i + 1, end));
            i = try p.skipTrivia(value.?.end, end);
            if (p.isIdentStart(i, end)) {
                modifier = .{ .start = i, .end = p.identEnd(i, end) };
                i = try p.skipTrivia(modifier.?.end, end);
            }
        }
        if (i >= end or p.src[i] != ']') return p.fail(.expected_attribute_end, open, @min(i + 1, end));
        const node = try p.add(.{ .attribute_selector = .{
            .namespace = name.namespace,
            .name = name.name,
            .matcher = matcher,
            .value = value,
            .modifier = modifier,
        } }, open, i + 1);
        return .{ .node = node, .next = i + 1 };
    }

    fn parsePseudo(p: *Parser, colon: u32, end: u32) SelectorError!Parsed {
        var i = colon + 1;
        const element = i < end and p.src[i] == ':';
        if (element) i += 1;
        if (!p.isIdentStart(i, end)) return p.fail(.expected_name, colon, @min(i + 1, end));
        const name: Span = .{ .start = i, .end = p.identEnd(i, end) };
        i = name.end;

        var argument: NodeIndex = .null;
        if (i < end and p.src[i] == '(') {
            const close = try p.matchBlock(i, end, ')') orelse return error.InvalidSelector;
            argument = try p.pseudoArgument(p.src[name.start..name.end], element, i + 1, close - 1);
            i = close;
        }
        const node = if (element)
            try p.add(.{ .pseudo_element_selector = .{ .name = name, .argument = argument } }, colon, i)
        else
            try p.add(.{ .pseudo_class_selector = .{ .name = name, .argument = argument } }, colon, i);
        return .{ .node = node, .next = i };
    }

    fn pseudoArgument(p: *Parser, name: []const u8, element: bool, start: u32, end: u32) SelectorError!NodeIndex {
        const trimmed_start = p.skipWhitespace(start, end);
        const trimmed_end = p.trimEnd(trimmed_start, end);
        if (element) return p.raw(trimmed_start, trimmed_end);

        const Kind = enum { forgiving, list, relative, nth_of, nth };
        const kinds = std.StaticStringMap(Kind).initComptime(.{
            .{ "is", .forgiving },
            .{ "where", .forgiving },
            .{ "matches", .list },
            .{ "-webkit-any", .list },
            .{ "-moz-any", .list },
            .{ "not", .list },
            .{ "host", .list },
            .{ "host-context", .list },
            .{ "has", .relative },
            .{ "nth-child", .nth_of },
            .{ "nth-last-child", .nth_of },
            .{ "nth-of-type", .nth },
            .{ "nth-last-of-type", .nth },
        });
        var lower: [16]u8 = undefined;
        if (name.len > lower.len) return p.raw(trimmed_start, trimmed_end);
        const kind = kinds.get(std.ascii.lowerString(&lower, name)) orelse return p.raw(trimmed_start, trimmed_end);
        return switch (kind) {
            .forgiving => p.parseSelectorList(start, end, false, true),
            .list => p.parseSelectorList(start, end, false, false),
            .relative => p.parseSelectorList(start, end, true, false),
            .nth_of, .nth => p.parseNth(trimmed_start, trimmed_end, kind == .nth_of),
        };
    }

    fn parseNth(p: *Parser, start: u32, end: u32, allow_of: bool) SelectorError!NodeIndex {
        var nth_end = end;
        var selector: NodeIndex = .null;
        var i = start;
        while (i < end) : (i += 1) {
            if (!isSpace(p.src[i])) continue;
            const word = p.skipWhitespace(i, end);
            if (word + 2 <= end and std.ascii.eqlIgnoreCase(p.src[word .. word + 2], "of") and
                (word + 2 == end or isSpace(p.src[word + 2])))
            {
                if (!allow_of) return p.fail(.invalid_nth, start, end);
                nth_end = i;
                selector = try p.parseSelectorList(word + 2, end, false, false);
                break;
            }
        }
        const nth = p.src[start..nth_end];
        if (!isAnPlusB(nth)) return p.fail(.invalid_nth, start, nth_end);
        return p.add(.{ .nth = .{ .nth = .{ .start = start, .end = nth_end }, .selector = selector } }, start, end);
    }

    fn skipWhitespace(p: *Parser, start: u32, end: u32) u32 {
        var i = start;
        while (i < end and isSpace(p.src[i])) i += 1;
        return i;
    }

    fn trimEnd(p: *Parser, start: u32, end: u32) u32 {
        var i = end;
        while (i > start and isSpace(p.src[i - 1])) i -= 1;
        return i;
    }

    fn skipTrivia(p: *Parser, start: u32, end: u32) Error!u32 {
        var i = start;
        while (i < end) {
            if (isSpace(p.src[i])) {
                i += 1;
            } else if (p.src[i] == '/' and i + 1 < end and p.src[i + 1] == '*') {
                i = try p.commentEnd(i, end);
            } else break;
        }
        return i;
    }

    fn commentEnd(p: *Parser, start: u32, end: u32) Error!u32 {
        if (std.mem.indexOfPos(u8, p.src[0..end], start + 2, "*/")) |close| return @intCast(close + 2);
        try p.report(.unclosed_comment, start, end);
        return end;
    }

    /// A newline ends a string early, as a bad string, with a diagnostic.
    fn stringEnd(p: *Parser, start: u32, end: u32) Error!u32 {
        const quote = p.src[start];
        var i = start + 1;
        while (i < end) {
            const byte = p.src[i];
            if (byte == quote) return i + 1;
            if (byte == '\\') {
                i = @min(i + 2, end);
            } else if (isNewline(byte)) {
                try p.report(.unclosed_string, start, i);
                return i;
            } else i += 1;
        }
        try p.report(.unclosed_string, start, end);
        return end;
    }

    /// Skips one component value: a comment, string, url, bracketed block, escape, or byte.
    fn skipComponent(p: *Parser, i: u32, end: u32) Error!u32 {
        return switch (p.src[i]) {
            '/' => if (i + 1 < end and p.src[i + 1] == '*') p.commentEnd(i, end) else i + 1,
            '"', '\'' => p.stringEnd(i, end),
            '\\' => @min(i + 2, end),
            '(' => if (p.isUnquotedUrl(i, end)) p.urlEnd(i, end) else p.blockEnd(i, end, ')'),
            '[' => p.blockEnd(i, end, ']'),
            '{' => p.blockEnd(i, end, '}'),
            else => i + 1,
        };
    }

    /// `open` is the opening bracket. Returns the offset past its closer, or `end` when unclosed.
    fn blockEnd(p: *Parser, open: u32, end: u32, close: u8) Error!u32 {
        return try p.matchBlock(open, end, close) orelse end;
    }

    /// Null when the block is unclosed or nests too deep, with a diagnostic.
    fn matchBlock(p: *Parser, open: u32, end: u32, close: u8) Error!?u32 {
        if (p.depth >= max_depth) {
            try p.report(.nesting_too_deep, open, open + 1);
            _ = try p.skipNested(open, end);
            return null;
        }
        p.depth += 1;
        defer p.depth -= 1;
        var i = open + 1;
        while (i < end) {
            const byte = p.src[i];
            if (byte == close) return i + 1;
            i = if (significant[byte]) try p.skipComponent(i, end) else i + 1;
        }
        try p.report(.unclosed_block, open, open + 1);
        return null;
    }

    /// Matches brackets without recursion, for nesting past `max_depth`.
    fn skipNested(p: *Parser, open: u32, end: u32) Error!u32 {
        var depth: u32 = 0;
        var i = open;
        while (i < end) {
            switch (p.src[i]) {
                '(', '[', '{' => depth += 1,
                ')', ']', '}' => {
                    depth -= 1;
                    if (depth == 0) return i + 1;
                },
                '"', '\'' => {
                    i = try p.stringEnd(i, end);
                    continue;
                },
                '/' => if (i + 1 < end and p.src[i + 1] == '*') {
                    i = try p.commentEnd(i, end);
                    continue;
                },
                '\\' => i += 1,
                else => {},
            }
            i += 1;
        }
        return end;
    }

    fn isUnquotedUrl(p: *Parser, open: u32, end: u32) bool {
        if (open < 3 or !std.ascii.eqlIgnoreCase(p.src[open - 3 .. open], "url")) return false;
        if (open > 3 and isName(p.src[open - 4])) return false;
        const i = p.skipWhitespace(open + 1, end);
        return i >= end or (p.src[i] != '"' and p.src[i] != '\'');
    }

    fn urlEnd(p: *Parser, open: u32, end: u32) Error!u32 {
        var i = open + 1;
        while (i < end) {
            switch (p.src[i]) {
                ')' => return i + 1,
                '\\' => i = @min(i + 2, end),
                else => i += 1,
            }
        }
        try p.report(.unclosed_block, open, open + 1);
        return end;
    }

    /// Finds the top-level `{`, `;`, or `}` that ends the statement at `start`.
    fn statementEnd(p: *Parser, start: u32, end: u32) Error!Stop {
        var i = start;
        while (i < end) {
            if (!significant[p.src[i]]) {
                i += 1;
                continue;
            }
            switch (p.src[i]) {
                '{' => return .{ .index = i, .kind = .brace },
                ';' => return .{ .index = i, .kind = .semi },
                '}' => return .{ .index = i, .kind = .close },
                else => i = try p.skipComponent(i, end),
            }
        }
        return .{ .index = end, .kind = .eof };
    }

    /// Like `statementEnd`, but a `{}` block belongs to the value.
    fn valueEnd(p: *Parser, start: u32, end: u32) Error!Stop {
        var i = start;
        while (i < end) {
            if (!significant[p.src[i]]) {
                i += 1;
                continue;
            }
            switch (p.src[i]) {
                ';' => return .{ .index = i, .kind = .semi },
                '}' => return .{ .index = i, .kind = .close },
                else => i = try p.skipComponent(i, end),
            }
        }
        return .{ .index = end, .kind = .eof };
    }

    fn isIdentStart(p: *Parser, i: u32, end: u32) bool {
        if (i >= end) return false;
        const byte = p.src[i];
        if (isNameStart(byte)) return true;
        if (byte == '\\') return i + 1 < end and !isNewline(p.src[i + 1]);
        if (byte != '-' or i + 1 >= end) return false;
        const next = p.src[i + 1];
        return isNameStart(next) or next == '-' or (next == '\\' and i + 2 < end and !isNewline(p.src[i + 2]));
    }

    fn identEnd(p: *Parser, start: u32, end: u32) u32 {
        var i = start;
        while (i < end) {
            const byte = p.src[i];
            if (isName(byte)) {
                i += 1;
            } else if (byte == '\\' and i + 1 < end and !isNewline(p.src[i + 1])) {
                i += 1;
                if (std.ascii.isHex(p.src[i])) {
                    const digits_end = @min(i + 6, end);
                    while (i < digits_end and std.ascii.isHex(p.src[i])) i += 1;
                    if (i < end and isSpace(p.src[i])) i += if (p.src[i] == '\r' and i + 1 < end and p.src[i + 1] == '\n') 2 else 1;
                } else i += 1;
            } else break;
        }
        return i;
    }
};

// the bytes that start a component value or end a statement
const significant = blk: {
    var table: [256]bool = @splat(false);
    for ("{}()[];/\"'\\") |byte| table[byte] = true;
    break :blk table;
};

fn isSpace(byte: u8) bool {
    return byte == ' ' or byte == '\t' or isNewline(byte);
}

fn isNewline(byte: u8) bool {
    return byte == '\n' or byte == '\r' or byte == 0x0C;
}

fn isNameStart(byte: u8) bool {
    return std.ascii.isAlphabetic(byte) or byte == '_' or byte >= 0x80;
}

fn isName(byte: u8) bool {
    return isNameStart(byte) or std.ascii.isDigit(byte) or byte == '-';
}

fn isAnPlusB(text: []const u8) bool {
    if (std.ascii.eqlIgnoreCase(text, "even") or std.ascii.eqlIgnoreCase(text, "odd")) return true;
    var has_digit_or_n = false;
    for (text) |byte| switch (byte) {
        '0'...'9', 'n', 'N' => has_digit_or_n = true,
        '+', '-', ' ', '\t', '\n', '\r', 0x0C => {},
        else => return false,
    };
    return has_digit_or_n;
}

test "parses a rule" {
    var tree = try parse(std.testing.allocator, "a > .b:is(c, d) { color: red !important }");
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.len);
    const sheet = tree.node(tree.root).data.style_sheet;
    const rule = tree.node(tree.list(sheet.children)[0]).data.rule;
    try std.testing.expectEqual(ast.Tag.selector_list, std.meta.activeTag(tree.node(rule.prelude).data));
    const declaration = tree.node(tree.list(tree.node(rule.block).data.block.children)[0]).data.declaration;
    try std.testing.expectEqualStrings("color", tree.string(declaration.property));
    try std.testing.expect(declaration.important);
}

test "recovers from bad input" {
    var tree = try parse(std.testing.allocator, "a { color: red; ; } } b { width: 1px");
    defer tree.deinit();
    try std.testing.expectEqual(2, tree.diagnostics.len);
    try std.testing.expectEqual(2, tree.node(tree.root).data.style_sheet.children.len);
}
